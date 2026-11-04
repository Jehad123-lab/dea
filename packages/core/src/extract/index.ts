import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { decodeAssets } from '../assets/index.ts';
import { launchBrowser } from '../browser/open.ts';
import { type Driver, driverText, type TraceDoc, traceWebGL } from '../debug/trace.ts';
import { type DesignDoc, decodeDesign } from '../design/index.ts';
import { newRunId, RunWriter, resolveRun, runsDir } from '../evidence/run.ts';
import { type Gap, renderGaps } from '../gaps.ts';
import { decodeMotion, type GsapNode, gsapModule, type MotionDoc } from '../motion/index.ts';
import type { InspectOptions } from '../see/inspect.ts';
import {
  type HeroLayout,
  heroHtml,
  keyframesCss,
  type Observed,
  type PipelinePass,
  type ProgramSource,
  particlesStandin,
  pickPrograms,
  pipelineModule,
  projectFiles,
  type ShaderModule,
  type Standin,
  shaderModule,
  type Target,
  tokenFiles,
} from './generate.ts';
import { type KitManifest, libraryAdd } from './library.ts';
import { compareImages, placeholderPng, previewHtml, readLayout, referenceShot, renderPreview, type Similarity, serveDir, sideBySide } from './preview.ts';
import {
  detectTechniques,
  type Finding,
  type Knob,
  type Params,
  providersFromEnv,
  type ResearchResult,
  researchLoop,
  researchTechniques,
  type SearchProvider,
  type Technique,
} from './research.ts';
import { type CanvasScore, canvasLine, compareCanvas } from './score.ts';

export interface ExtractOptions extends InspectOptions {
  to?: Target;
  /** a CSS selector: keep only motion whose targets or triggers mention it */
  section?: string;
  /** reference textures by path but write neutral placeholders of the same size instead of the site's files */
  ownAssets?: boolean;
  /** reuse earlier runs instead of opening the site again */
  from?: { design?: string; motion?: string; assets?: string; trace?: string };
  /** skip the live WebGL trace (uniform values and drivers) */
  noTrace?: boolean;
  /** run npm install and npm run build in the generated project and report the result (needs network) */
  verifyBuild?: boolean;
  /** search providers for the research-and-retry loop (default: from DEA_SEARCH; none = []) */
  providers?: SearchProvider[];
  /** skip the visual diff and research loop */
  noDiff?: boolean;
  /** research rounds (default 3) */
  rounds?: number;
  /** save the result in the local library under this name */
  library?: string;
  /** tags for the library entry */
  tags?: string[];
  /** skip searching free sources for the techniques DEA recognises */
  noResearch?: boolean;
  /** your own screenshot of the original (PNG/JPEG), e.g. from a machine with a GPU, instead of DEA's */
  reference?: string;
  /** how long DEA watches the original for its reference screenshot (default 45 s) */
  referenceMs?: number;
}

export interface ExtractResult {
  runId: string;
  dir: string;
  out: string;
  target: Target;
  files: string[];
  shaders: ShaderModule[];
  diff: null | {
    start: number;
    afterAnalysis: number;
    final: number;
    params: Params;
    research: ResearchResult | null;
    error?: string;
    parts?: Similarity;
    referenceAtMs?: number;
    referenceLoader?: boolean;
    standin?: Standin | null;
    /** the canvas-only perceptual score (text masked out) at the start and at the end; null when there is no canvas */
    canvas?: { start: CanvasScore | null; final: CanvasScore | null };
  };
  build: BuildCheck | null;
  gaps: Gap[];
  techniques: Technique[];
  extractMd: string;
  summary: string;
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

const programsExist = (assetsDir: string) => existsSync(join(assetsDir, 'assets', 'programs.json'));

/**
 * The trace's uniforms as defaults for the shader modules, keyed "<program>|<uniform>" and, when every program that
 * sets a uniform agrees on its value, also by the bare uniform name.
 */
export function observedFrom(trace: TraceDoc | null): Record<string, Observed> {
  const out: Record<string, Observed> = {};
  if (!trace) return out;
  const byName = new Map<string, Observed[]>();
  for (const u of trace.uniforms) {
    const o: Observed = { value: u.last, driver: u.driver, setBy: u.setBy };
    out[`${u.program}|${u.name}`] = o;
    byName.set(u.name, [...(byName.get(u.name) ?? []), o]);
  }
  for (const [n, os] of byName) {
    const same = os.every(
      (o) =>
        JSON.stringify(o.value) === JSON.stringify(os[0].value) ||
        (o.driver.kind === os[0].driver.kind && !['constant', 'unknown', 'animated'].includes(o.driver.kind)),
    );
    if (same) out[n] = os[0];
  }
  return out;
}

/** Keep only GSAP nodes (and their parents) whose targets mention the section's class or id. */
export function filterTree(nodes: GsapNode[], section: string): GsapNode[] {
  const token = section.replace(/^.*[\s>+~]/, '').replace(/^[a-z]+(?=[.#])/i, '');
  const hit = (n: GsapNode) => (n.targets ?? []).some((t) => t.includes(token));
  const walk = (ns: GsapNode[]): GsapNode[] =>
    ns.flatMap((n) => {
      if (n.children) {
        const kids = walk(n.children);
        return kids.length ? [{ ...n, children: kids }] : [];
      }
      return hit(n) ? [n] : [];
    });
  return walk(nodes);
}

const easesOf = (nodes: GsapNode[]): string[] => {
  const c = new Map<string, number>();
  const walk = (ns: GsapNode[]) => {
    for (const n of ns) {
      if (n.ease && !n.ease.startsWith('custom') && !n.ease.startsWith('back/')) c.set(n.ease, (c.get(n.ease) ?? 0) + 1);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
};

/**
 * Decode a site and write what you need to USE it: design tokens, motion as GSAP and CSS, shaders as three.js
 * modules with a minimal scene for React, vanilla or Framer, textures by local path. Then render the rebuild, compare
 * it with the original's first screen, and when it does not match, research and retry (up to 3 rounds).
 */
export async function extract(url: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const target = opts.to ?? 'react';
  const say = (s: string) => opts.onProgress?.(s);
  const child = { browser: opts.browser, headless: opts.headless, runsRoot: opts.runsRoot, onProgress: opts.onProgress };

  // 1. the three decoders (or earlier runs)
  const dirOf = async (id?: string) => (id ? resolveRun(id) : null);
  let designDir = await dirOf(opts.from?.design);
  if (!designDir) {
    say('decoding the design (tokens, fonts, first screen)');
    designDir = (await decodeDesign(url, child)).dir;
  }
  let motionDir = await dirOf(opts.from?.motion);
  if (!motionDir) {
    say('decoding the motion (GSAP, ScrollTrigger, CSS, recordings)');
    motionDir = (await decodeMotion(url, child)).dir;
  }
  let assetsDir = await dirOf(opts.from?.assets);
  if (!assetsDir) {
    say('collecting the assets (textures, shader programs, models)');
    assetsDir = (await decodeAssets(url, child)).dir;
  }
  let traceDir = await dirOf(opts.from?.trace);
  if (!traceDir && !opts.noTrace && programsExist(assetsDir)) {
    say('tracing the live WebGL calls (uniform values and what drives them)');
    traceDir = (await traceWebGL(url, { ...child, ms: 10_000 }).catch(() => null))?.dir ?? null;
  }
  const trace = traceDir ? await readJson<TraceDoc>(join(traceDir, 'trace.json')) : null;
  const observed = observedFrom(trace);
  const design = await readJson<DesignDoc & { tokens: Record<string, Record<string, { $type: string; $value: unknown }>> }>(join(designDir, 'design.json'));
  const designRun = await readJson<{
    page?: { headings?: Array<{ level: number; text: string }>; title?: string };
    meta?: { title?: string; finalUrl?: string };
  }>(join(designDir, 'run.json'));
  const motion = await readJson<MotionDoc>(join(motionDir, 'motion.json'));
  const programs = (await readJson<ProgramSource[]>(join(assetsDir, 'assets', 'programs.json'))) ?? [];

  // 2. the extract run
  const w = await new RunWriter(newRunId(url), opts.runsRoot ?? runsDir(), opts.onEvent).init();
  const out = w.path('extract');
  const files: string[] = [];
  const put = async (rel: string, body: string | Buffer) => {
    await mkdir(join(out, rel, '..'), { recursive: true });
    await writeFile(join(out, rel), body);
    if (!files.includes(rel)) files.push(rel);
  };
  const title = designRun?.meta?.title ?? url;
  const heading = (designRun?.page?.headings?.find((h) => h.level === 1)?.text ?? title).slice(0, 80);
  const threeVersion = String(design?.stack?.find((s) => /three/i.test(s.name))?.version ?? '170').replace(/^r/, '');

  say('writing design tokens');
  let tree = motion?.gsap?.tree ?? [];
  if (opts.section) tree = filterTree(tree, opts.section);
  const tk = tokenFiles(design?.tokens ?? {}, { eases: easesOf(tree) });
  // web fonts: the files the page downloaded, served from /fonts with @font-face rules
  const manifest = await readJson<{ network?: Array<{ kind: string; url: string; file: string | null }> }>(join(assetsDir, 'assets', 'manifest.json'));
  const fontFiles = (manifest?.network ?? []).filter((a) => a.kind === 'font' && a.file);
  const faces: string[] = [];
  for (const fam of (design?.typography?.families ?? []) as Array<{ family: string; files?: string[] }>) {
    const words = fam.family.toLowerCase().split(/\s+/)[0];
    const mine = fontFiles.filter((f) => (fam.files ?? []).includes(f.url) || f.url.toLowerCase().replace(/[-_ ]/g, '').includes(words.replace(/[-_ ]/g, '')));
    for (const f of mine) {
      const name = basename(f.url.split('?')[0]);
      const weight = /thin/i.test(name)
        ? 100
        : /extralight|ultralight/i.test(name)
          ? 200
          : /light/i.test(name)
            ? 300
            : /medium/i.test(name)
              ? 500
              : /semibold|demibold/i.test(name)
                ? 600
                : /extrabold|black|heavy/i.test(name)
                  ? 800
                  : /bold/i.test(name)
                    ? 700
                    : 400;
      const fmt = /\.woff2$/i.test(name) ? 'woff2' : /\.woff$/i.test(name) ? 'woff' : /\.otf$/i.test(name) ? 'opentype' : 'truetype';
      for (const dir of ['public/fonts', 'fonts']) {
        await mkdir(join(out, dir), { recursive: true });
        await copyFile(join(assetsDir, f.file as string), join(out, dir, name)).catch(() => {});
      }
      files.push(`public/fonts/${name}`);
      faces.push(
        `@font-face {\n  font-family: "${fam.family}";\n  src: url("/fonts/${name}") format("${fmt}");\n  font-weight: ${weight};\n  font-display: swap;\n}`,
      );
    }
  }
  await put('tokens/tokens.json', tk.json);
  await put(
    'tokens/tokens.css',
    faces.length
      ? `/* The site's own font files (check their licence before you ship). Weights are read from the file names (Inferred). */\n${faces.join('\n')}\n\n${tk.css}`
      : tk.css,
  );
  await put('tokens/tailwind.preset.js', tk.tailwind);

  say('writing motion (GSAP module, CSS keyframes)');
  const mdoc: MotionDoc | null = motion
    ? {
        ...motion,
        gsap: motion.gsap
          ? {
              ...motion.gsap,
              tree,
              scrollTriggers: opts.section
                ? motion.gsap.scrollTriggers.filter((s) => s.trigger.includes(opts.section?.replace(/^.*[\s>+~]/, '') ?? ''))
                : motion.gsap.scrollTriggers,
            }
          : null,
      }
    : null;
  const hasMotion = Boolean(mdoc?.gsap?.tree.length || mdoc?.gsap?.scrollTriggers.length || mdoc?.recorded.length);
  if (mdoc) await put('motion/timeline.js', gsapModule(mdoc, url));
  await put('motion/keyframes.css', keyframesCss(motion?.css?.keyframes ?? [], motion?.css?.transitions ?? []));

  say('writing shader modules and textures');
  const manifest2 = await readJson<{
    pipeline?: { captured: boolean; draws: number; passes: PipelinePass[] };
    textures?: Array<{ id: string; width: number | null; height: number | null; internalFormat: string; type: string; renderTarget: boolean }>;
  }>(join(assetsDir, 'assets', 'manifest.json'));
  const passes = manifest2?.pipeline?.passes ?? [];
  const inPipeline = new Set(passes.flatMap((p) => p.programs));
  const picked = pickPrograms(programs, passes.length ? 12 : 6, inPipeline);
  const texNames = new Map<string, string>();
  const textureName = (file: string) => {
    if (!texNames.has(file)) texNames.set(file, `${texNames.size + 1}-${basename(file).replace(/^\d+-/, '')}`);
    return texNames.get(file) as string;
  };
  const mods = picked.map((p) =>
    shaderModule(p, { last: motion?.recording?.lastValues ?? {}, textureDir: '/textures', ownAssets: Boolean(opts.ownAssets), textureName, observed }),
  );
  // unique module names
  const used = new Set<string>();
  for (const m of mods) {
    let n = m.name;
    for (let i = 2; used.has(n); i++) n = `${m.name}${i}`;
    used.add(n);
    if (n !== m.name) {
      m.code = m.code.replace(`name: '${m.name}'`, `name: '${n}'`);
      m.name = n;
      m.file = `shaders/${n}.js`;
    }
    await put(m.file, m.code);
  }
  for (const f of Object.keys(projectFiles(target, { mods, title, site: url, threeVersion, hasMotion, heading })))
    await put(f, projectFiles(target, { mods, title, site: url, threeVersion, hasMotion, heading })[f]);
  await put('preview/index.html', previewHtml(mods, threeVersion));
  if (passes.length) {
    const byProgram = new Map<string, ShaderModule>();
    for (const [i, p] of picked.entries()) byProgram.set(p.id, mods[i]);
    await put('pipeline.js', pipelineModule(passes, manifest2?.textures ?? [], byProgram, programs, url));
  }

  // techniques DEA recognises in the pipeline (used for stand-ins in the diff, then researched)
  const techText = [
    ...passes.flatMap((p) => p.programNames ?? []),
    ...programs.map((p) => `${p.name}\n${p.shaders.join('\n')}`),
    ...[...(manifest?.network ?? [])].map((n) => n.url),
  ].join('\n');
  let techniques: Technique[] = detectTechniques(techText);

  // 3. textures: the site's files, or placeholders of the same size
  const browserNeeded = Boolean(opts.ownAssets && texNames.size) || !opts.noDiff;
  const { browser } = browserNeeded ? await launchBrowser(opts.browser ?? 'auto', true) : { browser: null };
  let diff: ExtractResult['diff'] = null;
  let layout: HeroLayout | null = null;
  let standin: Standin | null = null;
  const rgbHex = (c: string | null | undefined): string | null => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c ?? '');
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
    return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  };
  const lum = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return 0;
    const n = Number.parseInt(m[1], 16);
    return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  const citations: Finding[] = [];
  try {
    for (const [src, name] of texNames) {
      if (opts.ownAssets && browser) {
        const page = await browser.newPage();
        const s = picked.flatMap((p) => p.samplers).find((x) => x.file === src);
        await put(`public/textures/${name}`, await placeholderPng(page, s?.width ?? 256, s?.height ?? 256, `your image ${s?.width}×${s?.height}`));
        await page.close();
      } else {
        await mkdir(join(out, 'public', 'textures'), { recursive: true });
        await copyFile(join(assetsDir, src), join(out, 'public', 'textures', name)).catch(() => {});
        files.push(`public/textures/${name}`);
      }
    }
    // the preview server serves /textures from public/
    if (texNames.size) {
      await mkdir(join(out, 'textures'), { recursive: true });
      for (const name of texNames.values()) await copyFile(join(out, 'public', 'textures', name), join(out, 'textures', name)).catch(() => {});
    }

    // 4. visual diff + analysis + research loop
    if (!opts.noDiff && browser) {
      const vp = design?.layout?.viewport ? { width: design.layout.viewport.width, height: design.layout.viewport.height } : { width: 1440, height: 900 };
      say('taking the reference screenshot (after the intro, the frame with the most detail)');
      const ref = opts.reference
        ? {
            png: `data:image/${/\.png$/i.test(opts.reference) ? 'png' : 'jpeg'};base64,${(await readFile(opts.reference)).toString('base64')}`,
            atMs: 0,
            loader: false,
            layout: null,
          }
        : await referenceShot(browser, url, vp, opts.referenceMs ?? 45_000, opts.section ?? null);
      const original = ref.png;
      await put('preview/original.png', Buffer.from(original.slice(original.indexOf(',') + 1), 'base64'));
      // the first screen's text as laid out on the site (with your own screenshot, read on both of the site's paths)
      const layoutCandidates = (
        opts.reference
          ? await Promise.all([readLayout(browser, url, vp, opts.section ?? null, 8000, true), readLayout(browser, url, vp, opts.section ?? null, 8000, false)])
          : [ref.layout]
      ).filter((l): l is HeroLayout => Boolean(l?.boxes.length || l?.canvas || l?.background));
      say('rendering the rebuild and comparing it with the original first screen');
      const server = await serveDir(out);
      const cmp = await browser.newPage();
      let lastPng = '';
      let renderError: string | undefined;
      let lastCmp: Similarity | null = null;
      const render = async (p: Params) => {
        const r = await renderPreview(browser, server.url, p, vp);
        renderError ??= r.error;
        lastPng = r.png;
        lastCmp = await compareImages(cmp, original, r.png);
        return lastCmp.similarity;
      };
      try {
        const hexOf = (k: string) => String((design?.tokens?.color?.[k] as { $value?: string } | undefined)?.$value ?? '');
        const sizes = Object.keys(design?.tokens?.fontSize ?? {})
          .map(Number)
          .filter(Number.isFinite);
        let params: Params = {
          background: hexOf('background') || '#ffffff',
          text: hexOf('text') || '#111111',
          font: String((design?.tokens?.fontFamily?.primary as { $value?: string } | undefined)?.$value ?? 'system-ui'),
          size: sizes.length ? Math.max(...sizes) : 64,
          program: mods[0]?.name ?? '',
          opacity: 1,
          heading,
        };
        // rebuild the site's text in the project and the preview with the reading that matches the original best,
        // and only when it beats the plain heading
        if (layoutCandidates.length) {
          let pick: HeroLayout | null = null;
          let pickScore = await render(params);
          for (const l of layoutCandidates) {
            await put('preview/index.html', previewHtml(mods, threeVersion, heroHtml(l)));
            const sc = await render({ ...params, background: rgbHex(l.background) ?? params.background });
            if (sc > pickScore) {
              pickScore = sc;
              pick = l;
            }
          }
          layout = pick;
          if (layout) {
            // ✔ the page's own background, read from the live page
            params = { ...params, background: rgbHex(layout.background) ?? params.background };
            await put('layout.json', `${JSON.stringify(layout, null, 2)}\n`);
            const pf = projectFiles(target, { mods, title, site: url, threeVersion, hasMotion, heading, layout });
            for (const f of Object.keys(pf)) await put(f, pf[f]);
            await put('preview/index.html', previewHtml(mods, threeVersion, heroHtml(layout)));
          } else {
            say("the site's text layout did not match the original better than a plain heading; leaving it out");
            await put('preview/index.html', previewHtml(mods, threeVersion));
          }
        }
        const start = await render(params);
        // the canvas-only score: the WebGL picture alone, with the site's text hidden
        const textBoxes = (layout ?? layoutCandidates[0] ?? null)?.boxes ?? [];
        const canvasBox = (layout ?? layoutCandidates[0] ?? null)?.canvas ?? null;
        const canvasStart = await compareCanvas(cmp, original, lastPng, canvasBox, textBoxes, vp);
        let best = start;
        // analysis first: DEA's own facts as candidates (the screen's mean colour, other palette colours, each shader, opacity)
        const meanOriginal = (await compareImages(cmp, original, original)).meanA;
        const palette = Object.values(design?.tokens?.color ?? {}).map((v) => String((v as { $value?: string }).$value));
        const candidates: Array<[string, Array<string | number>]> = [
          ['background', [meanOriginal, ...palette]],
          ['program', ['', ...(passes.length ? ['__pipeline'] : []), ...mods.map((m) => m.name)]],
          ['opacity', [0.6, 0.3]],
          ['text', palette],
        ];
        for (const [k, vals] of candidates)
          for (const v of vals) {
            if (params[k] === v) continue;
            const s = await render({ ...params, [k]: v });
            if (s > best + 0.002) {
              best = s;
              params = { ...params, [k]: v };
            }
          }
        // a technique stand-in where the site runs a system DEA does not rebuild (a GPGPU particle simulation): try it,
        // keep it only when the diff improves
        if (techniques.some((t) => t.id === 'gpgpu' || t.id === 'points')) {
          await put('standins/particles.js', particlesStandin());
          const light = [...palette].sort((a, b) => lum(b) - lum(a))[0] ?? '#ffffff';
          let tp: Params = { ...params, standin: 'particles', spread: 0.8, standinX: 0, standinY: 0, standinColor: light };
          let sBest = await render(tp);
          for (const [k, vals] of [
            ['spread', [0.5, 1.2, 1.7]],
            ['standinX', [-0.7, -0.35, 0.35, 0.7]],
            ['standinY', [-0.35, 0.35]],
          ] as Array<[string, number[]]>)
            for (const v of vals) {
              const s2 = await render({ ...tp, [k]: v });
              if (s2 > sBest + 0.002) {
                sBest = s2;
                tp = { ...tp, [k]: v };
              }
            }
          if (sBest > best + 0.002) {
            best = sBest;
            params = tp;
            standin = { kind: 'particles', spread: Number(tp.spread), x: Number(tp.standinX), y: Number(tp.standinY), color: String(tp.standinColor) };
            say(`a particle stand-in (≈, not the site's code) raised the match to ${Math.round(best * 1000) / 10}%`);
          }
        }
        const afterAnalysis = best;
        say(`rebuild is ${Math.round(best * 1000) / 10}% similar to the original first screen`);
        // research when still off
        const host = new URL(url).hostname;
        // with the site's own text layout in place, only the backdrop is left to look up
        const knobs: Knob[] = [
          { name: 'background', kind: 'color', near: /background|bg|dark|theme/i },
          ...(layout ? [] : [{ name: 'text', kind: 'color', near: /text|foreground|font colou?r|ink/i } as Knob, { name: 'font', kind: 'font' } as Knob]),
        ];
        const providers = opts.providers ?? providersFromEnv();
        const research = await researchLoop({
          params,
          render,
          knobs,
          providers,
          rounds: opts.rounds ?? 3,
          target: 0.92,
          onStep: say,
          relevant: (f) => {
            const hay = `${f.url} ${f.title} ${f.snippet}`.toLowerCase();
            const name = title
              .split(/[—|–-]/)[0]
              .trim()
              .toLowerCase();
            return hay.includes(host.replace(/^www\./, '')) || (name.length > 3 && hay.includes(name));
          },
          queries: (_p, round) =>
            [
              [`"${host}" background color hex`, `${title} brand colors`],
              [`${host} css font-family`, `${title} website design colors fonts`],
              [`${mods[0]?.name ?? 'webgl'} three.js shader background color`, `${host} design system`],
            ][round - 1] ?? [],
        });
        citations.push(...research.citations);
        params = research.params;
        const final = research.best;
        await render(params);
        if (standin) {
          const pf = projectFiles(target, { mods, title, site: url, threeVersion, hasMotion, heading, layout, standin });
          for (const f of Object.keys(pf)) await put(f, pf[f]);
        } else if (files.includes('standins/particles.js')) {
          await rm(join(out, 'standins'), { recursive: true, force: true });
          files.splice(files.indexOf('standins/particles.js'), 1);
        }
        const canvasFinal = await compareCanvas(cmp, original, lastPng, canvasBox, textBoxes, vp);
        await put('preview/final.png', Buffer.from(lastPng.slice(lastPng.indexOf(',') + 1), 'base64'));
        await put(
          'preview/side-by-side.png',
          await sideBySide(cmp, original, lastPng, [
            `original (${url})`,
            `DEA rebuild: page ${pct(final)}, canvas ${canvasFinal ? pct(canvasFinal.score) : 'n/a'}`,
          ]),
        );
        diff = {
          start,
          afterAnalysis,
          final,
          params,
          research,
          error: renderError,
          parts: lastCmp ?? undefined,
          referenceAtMs: ref.atMs,
          referenceLoader: ref.loader,
          canvas: { start: canvasStart, final: canvasFinal },
        };
      } finally {
        await cmp.close();
        await server.close();
      }
    }
  } finally {
    await browser?.close();
  }

  // 5. techniques behind it, researched in free sources (cited; values and pointers only, no code copied)
  const providersT = opts.providers ?? providersFromEnv();
  if (techniques.length && providersT.length && !opts.noResearch) {
    say(`researching ${techniques.length} technique(s) seen in the pipeline`);
    techniques = await researchTechniques(techniques, providersT, { onStep: say });
  }

  // 6. does the project build?
  let build: BuildCheck | null = null;
  if (opts.verifyBuild) {
    if (target === 'framer') build = { ok: true, skipped: 'Framer components build inside Framer', ms: 0, log: '' };
    else {
      say('checking the project builds (npm install, npm run build)');
      build = await verifyBuild(out);
      say(build.ok ? `npm run build passed in ${Math.round(build.ms / 1000)} s` : `npm run build failed (${build.step})`);
    }
  }

  // 7. README + extract.md + dea-kit.json
  const extractedAt = new Date().toISOString();
  const gaps = extractGaps({ url, mods, diff, build, hasMotion, trace, passes: passes.length, referenceLoader: diff?.referenceLoader ?? false });
  const md = renderExtractMd({
    url,
    target,
    files,
    mods,
    diff,
    citations,
    design: designDir,
    motion: motionDir,
    assets: assetsDir,
    trace: traceDir,
    ownAssets: Boolean(opts.ownAssets),
    section: opts.section,
    hasMotion,
    techniques,
    build,
    gaps,
    extractedAt,
  });
  const kit: KitManifest = {
    url,
    extractedAt,
    target,
    title,
    score: diff?.final ?? null,
    canvasScore: diff?.canvas?.final?.score ?? null,
    shaders: mods.map((m) => ({
      name: m.name,
      uniforms: m.uniforms.map((u) => u.name),
      drivers: Object.fromEntries(m.uniforms.filter((u) => u.driver).map((u) => [u.name, (u.driver as Driver).kind])),
    })),
    eases: easesOf(tree),
    colors: Object.values(design?.tokens?.color ?? {}).map((v) => String((v as { $value?: string }).$value)),
    fonts: Object.values(design?.tokens?.fontFamily ?? {}).map((v) => String((v as { $value?: string }).$value)),
    techniques: techniques.map((t) => t.name),
    provenance: `Extracted from ${url} on ${extractedAt.slice(0, 10)} by DEA. Third-party code, shaders, fonts and assets belong to their owners.`,
  };
  await put('dea-kit.json', `${JSON.stringify(kit, null, 2)}\n`);
  await put('README.md', md);
  await w.text('extract.md', md, 'extractMd');
  await w.json(
    'extract.json',
    {
      url,
      target,
      extractedAt,
      files,
      shaders: mods.map((m) => ({ name: m.name, file: m.file, fullscreen: m.fullscreen, uniforms: m.uniforms, textures: m.textures })),
      diff,
      build,
      techniques,
      gaps,
      sources: { design: designDir, motion: motionDir, assets: assetsDir, trace: traceDir },
    },
    'extract',
  );
  await w.json(
    'run.json',
    {
      meta: {
        id: w.id,
        kind: 'extract',
        url,
        finalUrl: url,
        title,
        startedAt: extractedAt,
        finishedAt: new Date().toISOString(),
        files: { ...w.files, run: 'run.json' },
      },
      facts: [],
    },
    'run',
  );
  if (opts.library) await libraryAdd(out, { name: opts.library, tags: opts.tags });
  const driven = mods.flatMap((m) => m.uniforms.filter((u) => u.driverFrom === 'trace').map((u) => `${u.name} ← ${driverText(u.driver as Driver)}`));
  const summary = [
    `Extracted ${url} for ${target}: ${files.length} files in ${out}`,
    `tokens: tokens.css, tailwind.preset.js, tokens.json · motion: ${mdoc?.gsap?.tree.length ?? 0} GSAP timelines/tweens, ${mdoc?.gsap?.scrollTriggers.length ?? 0} ScrollTriggers, ${motion?.css?.keyframes.length ?? 0} keyframes · shaders: ${mods.map((m) => m.name).join(', ') || 'none'}`,
    ...(driven.length ? [`uniform drivers from the live trace: ${driven.slice(0, 6).join('; ')}`] : []),
    ...(techniques.length ? [`techniques: ${techniques.map((t) => t.id).join(', ')}`] : []),
    build
      ? `build: ${build.skipped ? build.skipped : build.ok ? `npm run build passed (${Math.round(build.ms / 1000)} s)` : `failed at ${build.step}`}`
      : 'build: not checked (add --verify-build)',
    diff
      ? `visual diff (page): ${pct(diff.start)} → ${pct(diff.afterAnalysis)} after analysis → ${pct(diff.final)} after research (${diff.research?.stoppedBecause ?? ''})`
      : 'visual diff: skipped',
    ...(diff
      ? [
          `visual diff (${canvasLine(diff.canvas?.final)})${diff.canvas?.start && diff.canvas.final ? `, from ${pct(diff.canvas.start.score)} at the start` : ''}`,
        ]
      : []),
    gaps.length ? `open gaps: ${gaps.length} (see "Gap → path to result" in the report)` : 'open gaps: none',
  ].join('\n');
  w.emit({ type: 'run.finished', runId: w.id, dir: w.dir, summary, at: new Date().toISOString() });
  return { runId: w.id, dir: w.dir, out, target, files, shaders: mods, diff, build, gaps, techniques, extractMd: md, summary };
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export interface BuildCheck {
  ok: boolean;
  ms: number;
  log: string;
  step?: 'install' | 'build';
  skipped?: string;
}

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const p = spawn(cmd, args, { cwd, shell: process.platform === 'win32', env: { ...process.env, CI: '1', NO_COLOR: '1' } });
    let out = '';
    const keep = (b: Buffer) => {
      out = (out + b.toString()).slice(-20_000);
    };
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(t);
      done({ code, out });
    });
    p.on('error', (e) => {
      clearTimeout(t);
      done({ code: -1, out: `${out}\n${e.message}` });
    });
  });
}

/** npm install + npm run build in the generated project; node_modules and dist are removed afterwards. */
export async function verifyBuild(dir: string): Promise<BuildCheck> {
  const t0 = Date.now();
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    const i = await runCmd(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir, 300_000);
    if (i.code !== 0) return { ok: false, ms: Date.now() - t0, log: i.out.slice(-3000), step: 'install' };
    const b = await runCmd(npm, ['run', 'build'], dir, 240_000);
    return { ok: b.code === 0, ms: Date.now() - t0, log: b.out.slice(-3000), step: 'build' };
  } finally {
    await rm(join(dir, 'node_modules'), { recursive: true, force: true }).catch(() => {});
    await rm(join(dir, 'dist'), { recursive: true, force: true }).catch(() => {});
  }
}

/** "Gap → path to result" for an extract: what is Verified, what DEA filled in, and the next probe for each gap. */
export function extractGaps(o: {
  url: string;
  mods: ShaderModule[];
  diff: ExtractResult['diff'];
  build: BuildCheck | null;
  hasMotion: boolean;
  trace: TraceDoc | null;
  passes: number;
  referenceLoader: boolean;
}): Gap[] {
  const gaps: Gap[] = [];
  const site = o.url;
  if (o.build && !o.build.ok && !o.build.skipped)
    gaps.push({
      area: 'extract',
      topic: `The generated project did not build (${o.build.step})`,
      known: ['✔ Every file was written; the shaders are the exact GLSL the site compiled.'],
      missing: o.build.log.split('\n').filter(Boolean).slice(-4).join(' / ').slice(0, 400),
      next: [{ why: 'see the full error', command: 'npm install && npm run build' }],
    });
  if (o.diff && o.diff.final < 0.85) {
    const known = [
      `✔ Colour layout ${pct(o.diff.parts?.colour ?? 0)}, brightness layout ${pct(o.diff.parts?.layout ?? 0)}, edges ${pct(o.diff.parts?.edges ?? 0)} against the original first screen.`,
      ...(o.passes ? [`✔ The full render pipeline (${o.passes} passes, order and render targets) is in pipeline.js.`] : []),
    ];
    gaps.push({
      area: 'extract',
      topic: `The first screen of the rebuild is ${pct(o.diff.final)} similar`,
      known,
      missing: o.referenceLoader
        ? 'The original was still behind its loader when DEA took the reference (software WebGL on a machine without a GPU is slow), so the score compares against a loading screen.'
        : o.passes > 1
          ? 'The preview draws one program at a time; the site composes many passes (simulation, scene, post-processing) and its own meshes, which a single full-screen program cannot match.'
          : 'Layout, meshes or images outside the shader are not rebuilt.',
      approximation:
        o.passes > 1
          ? { text: 'Run the passes in order with createPipeline(renderer) from pipeline.js and hook your scene into the scene passes.' }
          : undefined,
      next: [
        ...(o.referenceLoader
          ? [
              {
                why: 'compare against a real frame: take a screenshot of the hero on a machine with a GPU',
                command: `dea extract ${site} --reference hero.png`,
              },
            ]
          : []),
        { why: 'wait longer for the intro before the reference screenshot', command: `dea extract ${site} --reference-ms 120000` },
        { why: 'read the values and drivers of every uniform', command: `dea trace ${site} --ms 30000` },
      ],
    });
  }
  const guessed = o.mods.flatMap((m) => m.uniforms.filter((u) => u.note?.includes('guess')).map((u) => `${m.name}.${u.name}`));
  if (guessed.length)
    gaps.push({
      area: 'extract',
      topic: `${guessed.length} uniform starting value(s) are guesses`,
      known: [
        `✔ ${o.mods.reduce((n, m) => n + m.uniforms.filter((u) => u.note?.startsWith('✔')).length, 0)} uniform values were read from the live trace.`,
        `≈ Guessed: ${guessed.slice(0, 10).join(', ')}${guessed.length > 10 ? ' …' : ''}`,
      ],
      missing: o.trace
        ? 'The trace never saw these set (they belong to programs that did not draw while DEA watched, or are set once before the trace hook).'
        : 'No live trace was run.',
      next: [
        { why: 'watch longer and scroll the whole page so every program draws', command: `dea trace ${site} --ms 30000` },
        { why: 'pause where one is set and read the caller variables', command: `dea trace ${site} --break uniform:${guessed[0].split('.').pop()}` },
      ],
    });
  const rts = o.mods.flatMap((m) => m.textures.filter((t) => t.note?.includes('render target')).map((t) => `${m.name}.${t.sampler}`));
  if (rts.length)
    gaps.push({
      area: 'extract',
      topic: 'Samplers fed by other passes',
      known: [`✔ ${rts.slice(0, 8).join(', ')} read textures the site draws at runtime.`],
      missing: 'Which pass writes each one is wired by order in pipeline.js (Inferred), not read from the code.',
      approximation: { text: 'pipeline.js connects each pass to the targets it read in the recorded frame.' },
      next: [{ why: 'see which program drew into which target, and the call that created each target', command: `dea assets ${site}` }],
    });
  if (!o.hasMotion)
    gaps.push({
      area: 'motion',
      topic: 'No live GSAP timelines were captured',
      known: ['✔ CSS @keyframes and transitions are in motion/keyframes.css.'],
      missing: 'Either the site animates without GSAP, or its intro tweens had finished before DEA read the GSAP instance.',
      next: [
        { why: 'record motion from the first frame and fit curves', command: `dea motion ${site}`, probe: 'motion' },
        { why: 'read the gsap.to/timeline calls in the code itself', command: `dea code ${site}`, probe: 'code' },
      ],
    });
  return gaps;
}

function renderExtractMd(o: {
  url: string;
  target: Target;
  files: string[];
  mods: ShaderModule[];
  diff: ExtractResult['diff'];
  citations: Finding[];
  design: string;
  motion: string;
  assets: string;
  ownAssets: boolean;
  section?: string;
  hasMotion: boolean;
  trace?: string | null;
  techniques?: Technique[];
  build?: BuildCheck | null;
  gaps?: Gap[];
  extractedAt?: string;
}): string {
  const run = o.target === 'framer' ? 'Paste `DeaScene.tsx` into a new Code File in Framer.' : '```bash\nnpm install\nnpm run dev\n```';
  const L = [
    `# Extracted from ${o.url} (${o.target})`,
    '',
    'Made by DEA from what the site actually rendered. ✔ Verified = read from the live page. ≈ Inferred = DEA filled a gap.',
    '',
    `> **Provenance.** Source: ${o.url} · extracted ${(o.extractedAt ?? new Date().toISOString()).slice(0, 10)} with DEA.`,
    '> The shaders, code, fonts, textures and models came from that site and belong to their owners: study them, and swap in your own before you ship anything public.',
    '',
    '## Run it',
    '',
    run,
    '',
    '## What is here',
    '',
    '- ✔ `tokens/tokens.css` (CSS variables), `tokens/tailwind.preset.js`, `tokens/tokens.json` (W3C design tokens): colours, fonts, type sizes, durations and easing curves read from the rendered page.',
    o.hasMotion
      ? `- ✔ \`motion/timeline.js\`: the GSAP timelines and ScrollTriggers read from the live GSAP instance${o.section ? ` (only those touching \`${o.section}\`)` : ''}; \`buildMotion()\` builds them. ≈ Targets that were JavaScript objects are placeholders you pass in.`
      : '- No GSAP motion was alive on the page; `motion/keyframes.css` has the CSS motion.',
    '- ✔ `motion/keyframes.css`: the `@keyframes` the site ships and its transition styles as classes.',
  ];
  for (const m of o.mods) {
    const guesses = m.uniforms.filter((u) => u.note?.includes('guess')).map((u) => u.name);
    const rts = m.textures.filter((t) => t.note?.includes('render target')).map((t) => t.sampler);
    const seen = m.uniforms.filter((u) => u.note?.startsWith('✔')).length;
    const drv = m.uniforms
      .filter((u) => u.driver)
      .map((u) => `${u.driverFrom === 'trace' ? '≈' : '≈ guess:'} ${u.name} ← ${driverText(u.driver as Driver)}`)
      .slice(0, 6);
    L.push(
      `- ✔ \`${m.file}\`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (${m.fullscreen ? 'full-screen quad' : m.points ? 'points' : '≈ plane stand-in geometry'}).${guesses.length ? ` ≈ Starting values guessed for ${guesses.slice(0, 6).join(', ')}.` : ''}${rts.length ? ` ≈ ${rts.join(', ')} come from another render pass on the site: wire your own render target.` : ''}${seen ? ` ✔ ${seen} value(s) from the live trace.` : ''}${drv.length ? ` Drivers: ${drv.join('; ')}.` : ''}`,
    );
  }
  if (!o.mods.length) L.push('- No custom shader program was found on the site, so no shader modules were written.');
  const tex = o.files.filter((f) => f.startsWith('public/textures/'));
  if (tex.length)
    L.push(
      `- ${o.ownAssets ? '≈ Placeholders of the same size (your own images go here)' : '✔ The site’s texture files'}: ${tex.map((t) => `\`${t}\``).join(', ')}`,
    );
  L.push('', '## How close the rebuild is', '');
  if (o.diff) {
    L.push(
      `DEA rendered \`preview/index.html\` and compared it with the original first screen after its intro (\`preview/original.png\` vs \`preview/final.png\`, side by side in \`preview/side-by-side.png\`). The score is 0.3 colour + 0.35 brightness layout + 0.35 edges, at 96×60.`,
      '',
      `- Start: ${pct(o.diff.start)} similar`,
      `- After DEA's own analysis (palette, screen colour, each shader, opacity): ${pct(o.diff.afterAnalysis)}`,
      `- After research and retry: ${pct(o.diff.final)} (${o.diff.research?.stoppedBecause ?? 'not run'})`,
      ...(o.diff.parts
        ? [`- Final parts: colour ${pct(o.diff.parts.colour)}, brightness layout ${pct(o.diff.parts.layout)}, edges ${pct(o.diff.parts.edges)}`]
        : []),
      `- **Canvas only** (the WebGL picture alone, the site's text hidden; 0.6 × SSIM at three scales + 0.2 × edges + 0.2 × tones): ${
        o.diff.canvas?.final
          ? `${pct(o.diff.canvas.start?.score ?? 0)} at the start → ${pct(o.diff.canvas.final.score)}; ${canvasLine(o.diff.canvas.final)}`
          : 'no canvas on the first screen'
      }`,
      `- Kept parameters: ${Object.entries(o.diff.params)
        .filter(([k]) => k !== 'heading')
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`,
    );
    if (o.diff.standin)
      L.push(
        `- ≈ Kept a technique stand-in: \`standins/particles.js\`, a particle cloud written by DEA (not the site's code) where the site runs its GPGPU particle simulation (spread ${o.diff.standin.spread}, offset ${o.diff.standin.x}, ${o.diff.standin.y}, colour ${o.diff.standin.color}). Replace it with a real simulation: see "Techniques behind it".`,
      );
    if (o.diff.error) L.push(`- The preview reported an error: ${o.diff.error}`);
    if (o.diff.research?.rounds.length) {
      L.push('', '### Research rounds', '');
      for (const r of o.diff.research.rounds)
        L.push(
          `- Round ${r.round}: searched ${r.queries.map((q) => `“${q}”`).join(', ')}; ${r.findings} findings; tried ${r.tried.length} value(s)${
            r.tried.filter((t) => t.kept).length
              ? `, kept ${r.tried
                  .filter((t) => t.kept)
                  .map((t) => `${t.knob} ${t.value}`)
                  .join(', ')}`
              : ', none helped'
          }${r.errors.length ? `; errors: ${r.errors.join('; ')}` : ''}.`,
        );
    }
    if (o.citations.length) {
      L.push('', '### Sources used (values only; no code copied)', '');
      for (const c of o.citations)
        L.push(`- [${c.title}](${c.url}) via ${c.source}${c.license ? `, licence ${c.license}` : ''}: ${(c as Finding & { used?: string }).used ?? ''}`);
    }
    L.push(
      '',
      'The page score compares colour layout, not text or motion: a high score means the first screen reads the same, not that the code is identical. The canvas score looks only at the 3D picture, so text and colour cannot carry it: read it to judge the effect itself.',
    );
  } else L.push('Skipped (`--no-diff`).');
  if (o.build) {
    L.push('', '## Does it build?', '');
    if (o.build.skipped) L.push(`Not checked: ${o.build.skipped}.`);
    else if (o.build.ok) L.push(`✔ \`npm install && npm run build\` passed on DEA's machine in ${Math.round(o.build.ms / 1000)} s (Vite).`);
    else L.push(`✘ \`npm run build\` failed at ${o.build.step}:`, '', '```', o.build.log.trim().split('\n').slice(-15).join('\n'), '```');
  }
  if (o.techniques?.length) {
    L.push(
      '',
      '## Techniques behind it',
      '',
      'Recognised in the decoded pipeline (✔ the evidence), with free sources to learn each one (links only; nothing copied):',
      '',
    );
    for (const t of o.techniques) {
      L.push(`- **${t.name}**: ✔ ${t.evidence}`);
      for (const f of t.sources) L.push(`  - [${f.title.slice(0, 90)}](${f.url}) via ${f.source}${f.license ? `, licence ${f.license}` : ''}`);
    }
  }
  if (o.gaps?.length) L.push('', renderGaps(o.gaps));
  L.push(
    '',
    '## Where it came from',
    '',
    `- design run: ${basename(o.design)}`,
    `- motion run: ${basename(o.motion)}`,
    `- assets run: ${basename(o.assets)}`,
    ...(o.trace ? [`- live trace run: ${basename(o.trace)}`] : []),
    '',
  );
  return `${L.join('\n')}\n`;
}
