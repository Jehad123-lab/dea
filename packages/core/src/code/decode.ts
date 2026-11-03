import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Response } from 'playwright';
import { deaHome } from '../evidence/run.ts';
import { redactBody, redactUrl } from '../evidence/secrets.ts';
import { collect, type InspectOptions, type InspectResult, type RunDoc } from '../see/inspect.ts';
import type { Fact } from '../types.ts';
import { type ApiCall, buildOpenApi, isApiCall, isAssetUrl, isTelemetry } from './api.ts';
import { CodeIndex, type Excerpt, type StaticTween } from './excerpt.ts';
import { renderApiMd, renderCodeMd, renderExplain } from './explain.ts';
import { CODE_INIT_SCRIPT } from './hooks.ts';
import { type ListenerInfo, parseStack, type Runtime, readListeners, readRuntime } from './runtime.ts';
import { detectBundler, isLibraryPath, type LoadedMap, loadSourceMap, readScripts, type ScriptRecord, safeSourcePath, watchScripts } from './scripts.ts';
import { explainPrograms } from './uniforms.ts';
import { unpack } from './unpack.ts';
import { checkScripts, loadRetireRepo, type VulnHit } from './vulns.ts';

/** The network log is stored with secrets redacted from URLs; every lookup uses the same redacted key. */
/** Fail instead of hanging when the browser stops answering. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`no answer in ${Math.round(ms / 1000)} s`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

const reqKey = (method: string, url: string) => `${method} ${redactUrl(url)}`;

export interface CodeOptions extends InspectOptions {
  /** try <script>.map when a file names no source map (default true) */
  probeMaps?: boolean;
  /** unpack (deobfuscate + unminify) app bundles that have no source map (default true) */
  unpack?: boolean;
  /** skip bundles bigger than this for unpacking (default 1.5 MB) */
  maxUnpackBytes?: number;
  /** check libraries against the retire.js vulnerability data (default true; downloads it once a day) */
  vulns?: boolean;
  /** scroll the whole page first so lazy chunks, ScrollTriggers and API calls show up (default true) */
  scroll?: boolean;
  /** how many wheel steps to scroll (default 36) */
  scrollSteps?: number;
}

export interface CodeResult extends InspectResult {
  code: CodeDoc;
  explainMd: string;
  codeMd: string;
  apiMd: string;
}

export interface CodeDoc {
  scripts: Array<Omit<ScriptRecord, 'source'> & { sourceMap: string | null; mapStatus: string; originals: number; unpacked: string | null }>;
  bundlers: ReturnType<typeof detectBundler>;
  sourceMaps: Array<{ script: string; map: string; found: string; sources: number; withContent: number; appSources: string[] }>;
  originals: { saved: number; library: number; files: string[] };
  unpacked: Array<{ script: string; file: string; bundle: string | null; modules: number; ms: number } | { script: string; error: string }>;
  vulns: { source: string; hits: VulnHit[] } | { error: string };
  runtime: Omit<Runtime, 'requests' | 'sockets'> & { requests: number; sockets: Runtime['sockets'] };
  listeners: Array<ListenerInfo & { where: string | null }>;
  api: ReturnType<typeof buildOpenApi>['endpoints'];
  /** files the code fetched itself (3D models, decoders, textures, JSON scenes), with the code that asked */
  assets: Array<{ url: string; mime: string; bytes: number; initiator: string | null }>;
  /** GSAP calls found by reading the code (they may run only after a click or a state change) */
  staticTweens: StaticTween[];
}

/**
 * Phase 7: how a site's code works. Collects every script (CDP), applies public source maps, unpacks bundles that
 * have none (webcrack), reads GSAP tweens and three.js materials at runtime with the code that built them, maps
 * listeners and API calls to code, checks libraries for known issues, and writes code.md, explain.md, api.md and
 * api/openapi.json.
 */
export async function decodeCode(url: string, opts: CodeOptions = {}, kind: 'code' | 'api' = 'code'): Promise<CodeResult> {
  let seen: Awaited<ReturnType<typeof watchScripts>> | null = null;
  const bodies = new Map<string, { text: string; mime: string }>();
  const meta = new Map<string, { resourceType: string; auth: string[]; mime: string; body: string | null }>();
  let runtime: Runtime | null = null;
  let listeners: ListenerInfo[] = [];
  let scripts: ScriptRecord[] = [];
  let finalUrl = url;
  const say = (s: string) => opts.onProgress?.(s);

  const result = await collect(
    url,
    kind,
    {
      ...opts,
      tree: opts.tree ?? false,
      beforeGoto: async (page, cdp) => {
        seen = await watchScripts(cdp);
        await page.addInitScript({ content: CODE_INIT_SCRIPT });
        page.on('request', (req: Request) => {
          const h = req.headers();
          const auth: string[] = [];
          const a = h.authorization ?? '';
          if (a) auth.push(/^bearer\s/i.test(a) ? 'Bearer' : /^basic\s/i.test(a) ? 'Basic' : 'header authorization');
          for (const k of Object.keys(h)) if (/(api[-_]?key|auth[-_]?token|access[-_]?token|^x-.*-(key|token)$)/i.test(k)) auth.push(`header ${k}`);
          if (h.cookie) auth.push(`cookie ${h.cookie.split('=')[0].trim().slice(0, 40)}`);
          try {
            for (const k of new URL(req.url()).searchParams.keys())
              if (/(api[-_]?key|access[-_]?token|^token$|^key$|^sig(nature)?$)/i.test(k)) auth.push(`query ${k}`);
          } catch {
            /* ignore */
          }
          meta.set(reqKey(req.method(), req.url()), { resourceType: req.resourceType(), auth, mime: h['content-type'] ?? '', body: req.postData() });
        });
        page.on('response', (res: Response) => {
          const req = res.request();
          const mime = res.headers()['content-type'] ?? '';
          const rt = req.resourceType();
          if (!/^(fetch|xhr|eventsource)$/.test(rt) && !/json|graphql/i.test(mime)) return;
          if (bodies.size > 300) return;
          res
            .text()
            .then((t) => {
              if (t.length <= 2_000_000) bodies.set(reqKey(req.method(), req.url()), { text: t, mime });
            })
            .catch(() => {});
        });
        if (opts.beforeGoto) await opts.beforeGoto(page, cdp);
      },
    },
    async (session, writer) => {
      const { page, cdp } = session;
      const t0 = Date.now();
      const mark = (s: string) => {
        say(s);
        void writer.progress(`${s} (+${Math.round((Date.now() - t0) / 1000)}s)`);
      };
      if (opts.scroll !== false) {
        mark('scrolling the whole page so lazy code, scroll animations and data calls run');
        // intros and preloaders first, then real (trusted) wheel input: works for native scroll and for
        // sites that drive their own scroll from wheel events
        await page.waitForTimeout(2500);
        const vp = page.viewportSize() ?? { width: 1440, height: 900 };
        // one real wheel + pointer move (trusted input), then a fast in-page run of wheel events and scrolls:
        // real input waits for each frame, which takes seconds on a machine without a GPU
        await page.mouse.move(vp.width / 2, vp.height / 2).catch(() => {});
        await page.mouse.wheel(0, 300).catch(() => {});
        await page
          .evaluate(async (steps) => {
            const step = Math.max(300, innerHeight * 0.6);
            const target = () => document.elementFromPoint(innerWidth / 2, innerHeight / 2) ?? document.body;
            const t0 = performance.now();
            for (let i = 0; i < steps; i++) {
              if (performance.now() - t0 > 25_000) break; // heavy pages on a GPU-less machine: keep the watch bounded
              const t = target();
              t.dispatchEvent(
                new WheelEvent('wheel', {
                  deltaY: step * 0.6,
                  deltaMode: 0,
                  bubbles: true,
                  cancelable: true,
                  clientX: innerWidth / 2,
                  clientY: innerHeight / 2,
                }),
              );
              t.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: innerWidth * (0.3 + (i % 10) / 25), clientY: innerHeight * 0.45 }));
              window.scrollBy(0, step);
              await new Promise((r) => setTimeout(r, 180));
            }
            await new Promise((r) => setTimeout(r, 600));
            window.scrollTo(0, 0);
          }, opts.scrollSteps ?? 24)
          .catch(() => {});
        await page.waitForTimeout(800);
      }
      mark('reading GSAP tweens, three.js materials and page sections at runtime');
      runtime = await readRuntime(page).catch((e) => {
        session.warnings.push(`runtime read failed: ${(e as Error).message.split('\n')[0]}`);
        return null;
      });
      // Pause the page's JavaScript while DEA reads listeners and sources: a busy render loop otherwise makes
      // every one of these hundreds of small reads wait for a frame.
      // One handler owns every pause from here on: while DEA wants the page held it records the pause; after that it
      // lets any late pause go at once (an idle page reaches the pending pause only when DEA's own reads run).
      let mode: 'hold' | 'release' = 'hold';
      let isPaused = false;
      const onPaused = () => {
        if (mode === 'hold') isPaused = true;
        else void cdp.send('Debugger.resume').catch(() => {});
      };
      cdp.on('Debugger.paused', onPaused);
      await cdp.send('Debugger.pause').catch(() => {});
      for (let i = 0; i < 40 && !isPaused; i++) await new Promise((r) => setTimeout(r, 100));
      if (!isPaused) {
        mode = 'release';
        await cdp.send('Debugger.resume').catch(() => {}); // a pause that landed in the last instant
        await withTimeout(cdp.send('Runtime.evaluate', { expression: '0' }), 3000).catch(() => {});
      }
      mark(`mapping event listeners to code${isPaused ? ' (page paused)' : ''}`);
      finalUrl = page.url();
      try {
        listeners = await withTimeout(readListeners(cdp), 90_000).catch((e) => {
          session.warnings.push(`listener read stopped: ${(e as Error).message}`);
          return [];
        });
        mark('collecting every script the page ran');
        scripts = seen ? await withTimeout(readScripts(cdp, seen, finalUrl), 120_000) : [];
      } finally {
        mode = 'release';
        await cdp.send('Debugger.resume').catch(() => {});
        cdp.off('Debugger.paused', onPaused);
      }
      mark(`collected ${scripts.length} scripts and ${listeners.length} listeners`);
      return undefined;
    },
  );
  const w = result.writer;
  const progress = async (s: string) => {
    say(s);
    await w.progress(s);
  };

  // ---------- source maps
  await progress(`looking for source maps on ${scripts.filter((s) => s.role !== 'inline').length} scripts`);
  const maps: LoadedMap[] = [];
  const mapStatus = new Map<string, string>();
  const candidates = scripts.filter((s) => s.role !== 'inline').slice(0, 40);
  for (let i = 0; i < candidates.length; i += 4) {
    await Promise.all(
      candidates.slice(i, i + 4).map(async (s) => {
        const m = await loadSourceMap(s, { probe: opts.probeMaps !== false }).catch((e) => ({ error: String(e), tried: '' }));
        if (!m) mapStatus.set(s.url, 'none published');
        else if ('error' in m) mapStatus.set(s.url, `declared but not readable (${m.error}) at ${m.tried}`);
        else {
          maps.push(m);
          mapStatus.set(s.url, m.found === 'probed' ? `found by trying ${m.mapUrl}` : `declared: ${m.mapUrl}`);
        }
      }),
    );
  }
  const originalsSaved: string[] = [];
  let libraryOriginals = 0;
  let bytes = 0;
  for (const m of maps) {
    for (const [src, text] of m.contents) {
      if (isLibraryPath(src)) {
        libraryOriginals++;
        continue;
      }
      if (originalsSaved.length >= 3000 || bytes > 40_000_000) break;
      const rel = `code/original/${safeSourcePath(src)}`;
      if (originalsSaved.includes(rel)) continue;
      await w.text(rel, text, `original:${rel}`);
      delete w.files[`original:${rel}`];
      originalsSaved.push(rel);
      bytes += text.length;
    }
  }

  // ---------- bundler, raw scripts, unpacking
  const bundlers = detectBundler(scripts);
  const unpacked: CodeDoc['unpacked'] = [];
  const unpackedFile = new Map<string, string>();
  for (const s of scripts) {
    if (s.role === 'inline' || s.source.length > 6_000_000) continue;
    const name = `code/scripts/${safeSourcePath(new URL(s.url).pathname).replace(/\//g, '_')}`;
    await w.text(name, s.source, `script:${name}`);
    delete w.files[`script:${name}`];
  }
  if (opts.unpack !== false) {
    const todo = scripts
      .filter((s) => (s.role === 'app' || s.role === 'mixed') && !maps.some((m) => m.script === s.url) && s.source.length > 2000)
      .filter((s) => s.source.length <= (opts.maxUnpackBytes ?? 1_500_000))
      .sort((a, b) => b.source.length - a.source.length)
      .slice(0, 5);
    await progress(
      `unpacking ${todo.length} app bundle(s) with webcrack: ${todo.map((s) => `${s.url.split('/').pop()} (${Math.round(s.source.length / 1024)} KB)`).join(', ')}`,
    );
    const results = new Map<string, Awaited<ReturnType<typeof unpack>>>();
    for (let i = 0; i < todo.length; i += 2) {
      await Promise.all(todo.slice(i, i + 2).map(async (s) => results.set(s.url, await unpack(s.source, { timeoutMs: 60_000 }))));
    }
    for (const s of todo) {
      const r = results.get(s.url) as Awaited<ReturnType<typeof unpack>>;
      if ('error' in r) {
        unpacked.push({ script: s.url, error: r.error });
        continue;
      }
      const base = safeSourcePath(new URL(s.url).pathname)
        .replace(/\//g, '_')
        .replace(/\.m?js$/, '');
      const file = `code/unpacked/${base}.js`;
      await w.text(file, r.code, `unpacked:${base}`);
      delete w.files[`unpacked:${base}`];
      for (const m of r.modules.slice(0, 300)) await w.text(`code/unpacked/${base}/${safeSourcePath(m.path)}.js`, m.code, 'x');
      delete w.files.x;
      unpackedFile.set(s.url, file);
      unpacked.push({ script: s.url, file, bundle: r.bundle, modules: r.modules.length, ms: r.ms });
    }
  }

  // ---------- code index: positions → readable code
  const index = new CodeIndex(scripts, maps);
  const label = (f: { url: string; line: number; col: number }, e: Excerpt) =>
    `${e.from === 'original' ? e.file : (f.url.split('/').pop() ?? f.url)}:${e.from === 'original' ? e.line : `${f.line}:${f.col}`}${e.name ? ` (${e.name})` : ''}`;
  const where = (f: { url: string; line: number; col: number }) => {
    const e = index.at(f.url, f.line, f.col, 30);
    return e ? label(f, e) : null;
  };
  /** The first frame of a call stack that is the site's own code: not a library file, not GSAP's internals. */
  const appSite = (stack: string[]): { where: string; excerpt: Excerpt } | null => {
    for (const f of parseStack(stack).slice(0, 14)) {
      const s = index.script(f.url);
      if (!s || s.role === 'vendor') continue;
      const e = index.at(f.url, f.line, f.col, 30);
      if (!e) continue;
      if (e.from === 'original' && isLibraryPath(e.file)) continue;
      if (e.from === 'bundle' && /_ptLookup|smoothChildTiming|GSAP target|_gsap\b|registerPlugin|_createPlugin|__webpack_require__/.test(e.code)) continue;
      return { where: label(f, e), excerpt: e };
    }
    return null;
  };

  // ---------- vulnerabilities
  let vulns: CodeDoc['vulns'] = { error: 'skipped' };
  if (opts.vulns !== false) {
    await progress('checking libraries against the retire.js vulnerability data');
    const repo = await loadRetireRepo(join(deaHome(), 'cache'));
    vulns =
      'error' in repo
        ? { error: repo.error }
        : {
            source: repo.source,
            hits: checkScripts(
              repo.repo,
              scripts.filter((s) => s.role !== 'inline'),
              result.run.stack.map((h) => ({ name: h.name, version: h.version })),
            ),
          };
  }

  // ---------- API calls → OpenAPI
  await progress('building the API map from the network log');
  const har = JSON.parse(await readFile(w.path('network.har'), 'utf8')) as { log: { entries: any[] } };
  const rt = runtime as Runtime | null;
  const initiatorOf = (u: string) => {
    const ru = redactUrl(u);
    const hit = rt?.requests.find((r) => {
      const x = redactUrl(r.url);
      return x === ru || ru.startsWith(x) || x.startsWith(ru.split('?')[0]);
    });
    if (!hit) return null;
    return appSite(hit.stack)?.where ?? null;
  };
  const calls: ApiCall[] = [];
  const assets: CodeDoc['assets'] = [];
  har.log.entries.forEach((e, i) => {
    const method = String(e.request?.method ?? 'GET');
    const u = String(e.request?.url ?? '');
    const key = reqKey(method, u);
    const m = meta.get(key);
    const responseMime = String(e.response?.content?.mimeType ?? '');
    if (!isApiCall({ method, url: u, responseMime, resourceType: m?.resourceType })) return;
    if (isAssetUrl(u, responseMime)) {
      if (assets.length < 80)
        assets.push({ url: u, mime: responseMime, bytes: Number(e.response?._transferSize ?? e.response?.content?.size ?? 0), initiator: initiatorOf(u) });
      return;
    }
    const b = bodies.get(key);
    calls.push({
      method,
      url: u,
      status: Number(e.response?.status ?? 0),
      requestMime: String(e.request?.postData?.mimeType ?? m?.mime ?? ''),
      requestBody: e.request?.postData?.text ?? (m?.body ? redactBody(m.body, m.mime) : null),
      responseMime,
      responseBody: b?.text ?? null,
      requestHeaderNames: (e.request?.headers ?? []).map((h: any) => String(h.name).toLowerCase()),
      auth: [...new Set(m?.auth ?? [])],
      harIndex: i,
      initiator: initiatorOf(u),
    });
  });
  const spec = buildOpenApi(calls, { title: result.run.meta.title, site: finalUrl });
  await w.json('api/openapi.json', spec.openapi, 'openapi');
  let bodyN = 0;
  for (const c of calls) {
    if (!c.responseBody || isTelemetry(c.url) || bodyN >= 60) continue;
    await w.text(`api/bodies/${String(++bodyN).padStart(3, '0')}.json`, redactBody(c.responseBody, c.responseMime), 'y');
  }
  delete w.files.y;

  // ---------- shaders explained
  const rawShaders = JSON.parse(await readFile(w.path('shaders.json'), 'utf8').catch(() => '[]'));
  const programs = explainPrograms(rawShaders, rt?.three.materials ?? []);

  // ---------- listeners, tween call sites
  const lst = listeners.map((l) => {
    const s = index.script(l.scriptId);
    const sec = l.top == null || !rt ? null : sectionAt(rt.sections, l.top);
    return { ...l, section: sec, where: s ? where({ url: s.url, line: l.line, col: l.col }) : null };
  });
  const tweenSites = new Map<number, { where: string; excerpt: Excerpt } | null>();
  for (const t of rt?.tweens ?? []) tweenSites.set(t.n * 10 + (t.kind === 'timeline' ? 1 : 0), appSite(t.stack));

  const code: CodeDoc = {
    scripts: scripts.map(({ source, ...s }) => ({
      ...s,
      sourceMap: maps.find((m) => m.script === s.url)?.mapUrl ?? null,
      mapStatus: mapStatus.get(s.url) ?? (s.role === 'inline' ? 'inline script' : 'not checked'),
      originals: maps.find((m) => m.script === s.url)?.withContent ?? 0,
      unpacked: unpackedFile.get(s.url) ?? null,
    })),
    bundlers,
    sourceMaps: maps.map((m) => ({
      script: m.script,
      map: m.mapUrl,
      found: m.found,
      sources: m.sources.length,
      withContent: m.withContent,
      appSources: m.sources.filter((x) => !isLibraryPath(x)).slice(0, 200),
    })),
    originals: { saved: originalsSaved.length, library: libraryOriginals, files: originalsSaved.slice(0, 500) },
    unpacked,
    vulns,
    runtime: rt ? { ...rt, requests: rt.requests.length, sockets: rt.sockets } : (null as unknown as CodeDoc['runtime']),
    listeners: lst,
    api: spec.endpoints,
    assets,
    staticTweens: index.staticTweens(),
  };

  await progress('writing the teardown (explain.md)');
  const ctx = { run: result.run, code, programs, index, tweenSites, rawShaders, calls, spec };
  const explainMd = renderExplain(ctx);
  const codeMd = renderCodeMd(ctx);
  const apiMd = renderApiMd(ctx);
  await w.text('explain.md', explainMd, 'explain');
  await w.text('code.md', codeMd, 'code');
  await w.text('api.md', apiMd, 'api');
  await w.json('code.json', code, 'codeJson');

  const facts: Fact[] = codeFacts(code, programs.length);
  const run: RunDoc = { ...result.run, facts: [...result.run.facts, ...facts], code: { file: 'code.json' } };
  run.meta.files = { ...w.files, run: 'run.json', progress: 'progress.md' };
  run.meta.finishedAt = new Date().toISOString();
  await w.json('run.json', run, 'run');
  for (const f of facts) w.emit({ type: 'fact', runId: w.id, fact: f });
  const summary = codeSummary(run, code, programs.length);
  w.emit({ type: 'run.finished', runId: w.id, dir: w.dir, summary, at: new Date().toISOString() });
  await progress('done');
  return { ...result, run, summary, code, explainMd, codeMd, apiMd };
}

export function sectionAt(sections: Runtime['sections'], top: number): number | null {
  let best: number | null = null;
  for (const s of sections) if (top >= s.top && top < s.top + s.height) best = s.index;
  return best;
}

function codeFacts(code: CodeDoc, programs: number): Fact[] {
  const facts: Fact[] = [];
  for (const b of code.bundlers)
    facts.push({
      key: `code.bundler.${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      claim: `Built with ${b.name}.`,
      value: b.name,
      label: b.label,
      evidence: b.evidence.map((e) => ({ source: 'script-url' as const, pointer: e })),
    });
  facts.push({
    key: 'code.sourcemaps',
    claim: code.sourceMaps.length
      ? `${code.sourceMaps.length} script(s) publish source maps; DEA recovered ${code.originals.saved} original source files.`
      : 'No public source maps: the original source files are not published.',
    value: code.sourceMaps.map((m) => m.map),
    label: 'Verified',
    evidence: code.scripts.slice(0, 6).map((s) => ({ source: 'script-url' as const, pointer: s.url, excerpt: s.mapStatus })),
  });
  if (code.runtime?.tweens?.length)
    facts.push({
      key: 'code.gsap.tweens',
      claim: `GSAP built ${code.runtime.tweens.filter((t) => t.kind === 'tween').length} tweens and ${code.runtime.tweens.filter((t) => t.kind === 'timeline').length} timelines while DEA watched; each is listed with its targets, timing and the code that created it.`,
      value: code.runtime.tweens.length,
      label: 'Verified',
      evidence: [{ source: 'cdp', pointer: 'runtime observers (tween creation stacks)', excerpt: code.runtime.tweens[0]?.stack[0] }],
    });
  if (programs)
    facts.push({
      key: 'code.shaders.explained',
      claim: `${programs} author-written shader stages explained uniform by uniform.`,
      value: programs,
      label: 'Verified',
      evidence: [{ source: 'shader', pointer: 'shaders.json' }],
    });
  const v = 'hits' in code.vulns ? code.vulns.hits.filter((h) => h.vulnerabilities.length) : [];
  facts.push({
    key: 'code.vulns',
    claim:
      'hits' in code.vulns
        ? v.length
          ? `Libraries with known issues: ${v.map((h) => `${h.library} ${h.version} (${h.vulnerabilities.length})`).join(', ')}.`
          : 'No known-vulnerable library versions found.'
        : `Vulnerability check not run: ${code.vulns.error}.`,
    value: v,
    label: 'hits' in code.vulns ? 'Verified' : 'Unknown',
    evidence: [{ source: 'script-url', pointer: 'hits' in code.vulns ? code.vulns.source : 'retire.js data' }],
  });
  facts.push({
    key: 'code.api',
    claim: `${code.api.filter((e) => !e.telemetry).length} API endpoints (plus ${code.api.filter((e) => e.telemetry).length} analytics) observed; see api/openapi.json.`,
    value: code.api.length,
    label: 'Verified',
    evidence: [{ source: 'har', pointer: 'network.har' }],
  });
  return facts;
}

function codeSummary(run: RunDoc, code: CodeDoc, programs: number): string {
  const app = code.scripts.filter((s) => s.role === 'app' || s.role === 'mixed');
  const lines = [
    `${run.meta.title || run.meta.finalUrl}`,
    '',
    `Built with: ${code.bundlers.map((b) => `${b.name} [${b.label}]`).join(', ') || 'unknown'}`,
    `Scripts: ${code.scripts.length} (${app.length} app, ${code.scripts.filter((s) => s.role === 'vendor').length} library, ${code.scripts.filter((s) => s.role === 'inline').length} inline)`,
    `Source maps: ${code.sourceMaps.length ? `${code.sourceMaps.length} public, ${code.originals.saved} original files recovered` : 'none public'}`,
    `Unpacked: ${code.unpacked.filter((u) => !('error' in u)).length} bundle(s)`,
    `GSAP: ${code.runtime?.tweens?.filter((t) => t.kind === 'tween').length ?? 0} tweens, ${code.runtime?.tweens?.filter((t) => t.kind === 'timeline').length ?? 0} timelines, ${code.runtime?.tweens?.filter((t) => t.scrollTrigger).length ?? 0} with ScrollTrigger`,
    `Shaders explained: ${programs}`,
    `Listeners mapped to code: ${code.listeners.filter((l) => l.where).length}`,
    `API: ${code.api.filter((e) => !e.telemetry).length} endpoints, ${code.api.filter((e) => e.telemetry).length} analytics`,
    `Known-vulnerable libraries: ${'hits' in code.vulns ? code.vulns.hits.filter((h) => h.vulnerabilities.length).length : 'not checked'}`,
  ];
  return lines.join('\n');
}
