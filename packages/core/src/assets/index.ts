import type { Response } from 'playwright';
import type { SourceMapConsumer } from 'source-map-js';
import { type CdpInitiator, flattenInitiator } from '../code/initiator.ts';
import { type Gap, renderGaps } from '../gaps.ts';
import { exercisePage } from '../see/exercise.ts';
import { collect, type InspectOptions, type InspectResult, type RunDoc } from '../see/inspect.ts';
import type { Fact } from '../types.ts';
import { type Origin, originOf, type Pass, passesOf, samplingLine } from './chain.ts';
import {
  type AssetKind,
  classify,
  type GlbSummary,
  glName,
  gltfSummary,
  hdrSize,
  imageSize,
  ktx2Summary,
  lottieSummary,
  parseGlb,
  riveSummary,
} from './files.ts';
import { ASSET_INIT_SCRIPT } from './hooks.ts';
import { programName, samplerRole, samplerUse } from './roles.ts';

export interface TextureInfo {
  id: string;
  target: string;
  width: number | null;
  height: number | null;
  format: string;
  type: string;
  internalFormat: string;
  wrap: string;
  filter: string;
  mipmaps: boolean;
  source: { kind: string; url?: string; w?: number; h?: number };
  dynamic: boolean;
  renderTarget: boolean;
  compressed: boolean;
  /** preview PNG in the run folder (what was uploaded, scaled to 512 px) */
  file: string | null;
  /** the original file from the network, when the pixels came from a URL */
  original: string | null;
  normalized: [number, number] | null;
  /** a 1×1 or 2×2 stand-in (engines bind one where a material has no texture yet) */
  placeholder: boolean;
  /** for pixels that arrived as an ImageBitmap: the downloaded image with the same size (Inferred) */
  likelyFrom?: string;
  /** the call stack at the first upload (DEA's texImage2D trace) */
  stack?: string[];
  usedBy: Array<{ program: string; sampler: string; role: string; uses: string[] }>;
}

export interface NetworkAsset {
  kind: AssetKind;
  url: string;
  mime: string;
  bytes: number;
  file: string | null;
  size?: { width: number; height: number } | null;
  details?: unknown;
  note?: string;
}

export interface AssetsDoc {
  textures: TextureInfo[];
  renderTargets: Array<{ id: string; file: string | null; error?: string }>;
  network: NetworkAsset[];
  programs: Array<{ id: string; name: string; samplers: string[] }>;
  webgpu: Array<{ source: unknown; size: string; format: string; file: string | null }>;
  counts: Record<string, number>;
  /** network → source → runtime, one line per texture and sampler */
  chains: Array<{
    texture: string;
    file: string;
    origin: Origin | null;
    program: string;
    sampler: string;
    shader: { stage: string; line: number; code: string } | null;
    text: string;
  }>;
  /** one frame of draw calls grouped into passes, in order */
  pipeline: { captured: boolean; draws: number; passes: Array<Pass & { targetText: string; programNames: string[]; inputTexts: string[] }> };
}

export interface AssetsResult extends InspectResult {
  assets: AssetsDoc;
  assetsMd: string;
  gaps: Gap[];
}

export interface AssetsOptions extends InspectOptions {
  /** read back render targets (runtime-generated textures) after the page ran (default true) */
  renderTargets?: boolean;
  /** largest single file saved from the network (default 25 MB) */
  maxFileBytes?: number;
  /** scroll steps while watching (default 16) */
  scrollSteps?: number;
}

const safe = (u: string, i: number) => {
  let base = u;
  try {
    base = new URL(u).pathname.split('/').pop() || 'file';
  } catch {
    /* keep */
  }
  return `${String(i).padStart(3, '0')}-${base.replace(/[^\w.-]+/g, '_').slice(-80)}`;
};

/**
 * Every visual asset the page actually uses: the textures WebGL received (with a preview of each, its format, wrap,
 * filter, and which shader sampler draws it), runtime render targets read back after the page ran, and the image,
 * texture, environment, model, video, Lottie, Rive and font files it downloaded, saved with a manifest.
 */
export async function decodeAssets(url: string, opts: AssetsOptions = {}): Promise<AssetsResult> {
  const bodies: Array<Promise<NetworkAsset | null>> = [];
  const initiators = new Map<string, CdpInitiator>();
  let saved = 0;
  let totalBytes = 0;
  const maxFile = opts.maxFileBytes ?? 25 * 1024 * 1024;
  let pageData: any = null;
  let targets: Array<{ id: string; preview?: { url?: string }; error?: string }> = [];
  const say = (s: string) => opts.onProgress?.(s);

  const result = await collect(
    url,
    'assets',
    {
      ...opts,
      tree: false,
      beforeGoto: async (page, cdp) => {
        await page.addInitScript({ content: ASSET_INIT_SCRIPT });
        // who asked for each file: Chrome's initiator stack, async callers included
        await cdp.send('Network.enable').catch(() => {});
        await cdp.send('Debugger.enable').catch(() => {});
        await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 }).catch(() => {});
        cdp.on('Network.requestWillBeSent', (e: { request: { url: string }; initiator: unknown }) => {
          if (!initiators.has(e.request.url) && initiators.size < 2000) initiators.set(e.request.url, flattenInitiator(e.initiator));
        });
        page.on('response', (res: Response) => {
          const u = res.url();
          if (u.startsWith('data:')) return;
          const mime = res.headers()['content-type'] ?? '';
          const kind = classify(u, mime) ?? (/json/.test(mime) ? 'other' : null);
          if (!kind) return;
          const i = bodies.length;
          if (i > 400) return;
          bodies.push(
            res
              .body()
              .then((b): NetworkAsset | null => {
                const head = new Uint8Array(b.buffer, b.byteOffset, Math.min(64, b.length));
                let k = classify(u, mime, head) ?? kind;
                let details: unknown;
                if (k === 'other') {
                  // a JSON body might be a Lottie animation
                  try {
                    const s = lottieSummary(JSON.parse(b.toString('utf8')));
                    if (!s) return null;
                    k = 'lottie';
                    details = s;
                  } catch {
                    return null;
                  }
                }
                return { kind: k, url: u, mime, bytes: b.length, file: null, details, buf: b } as NetworkAsset & { buf: Buffer };
              })
              .catch(() => null),
          );
        });
        if (opts.beforeGoto) await opts.beforeGoto(page, cdp);
      },
    },
    async (session, writer) => {
      const { page } = session;
      say('letting the page load, then scrolling it so lazy textures and models load');
      await writer.progress('exercising the page');
      await exercisePage(page, { steps: opts.scrollSteps ?? 16 });
      if (opts.renderTargets !== false) {
        say('reading back render targets (textures the page draws into at runtime)');
        targets = await page.evaluate((m) => (window as any).__DEA_ASSETS__?.readTargets?.(m) ?? [], 8).catch(() => []);
      }
      say('recording one frame of draw calls (the render pipeline)');
      await page.evaluate('window.__DEA_ASSETS__ && (window.__DEA_ASSETS__.capture.armed = true)').catch(() => {});
      for (let i = 0; i < 40; i++) {
        const done = await page.evaluate('window.__DEA_ASSETS__ ? window.__DEA_ASSETS__.capture.done : true').catch(() => true);
        if (done) break;
        await page.waitForTimeout(500);
      }
      pageData = await page
        .evaluate(() => {
          const A = (window as any).__DEA_ASSETS__;
          if (!A) return null;
          return {
            textures: Object.values(A.textures),
            programs: Object.values(A.programs),
            bindings: A.bindings,
            gpu: A.gpu,
            errors: A.errors,
            draws: A.capture.done ? A.capture.draws : [],
            captured: Boolean(A.capture.done),
          };
        })
        .catch(() => null);
      return undefined;
    },
  );
  const w = result.writer;
  const progress = async (s: string) => {
    say(s);
    await w.progress(s);
  };

  // ---------- network files
  await progress('saving the visual files the page downloaded');
  const net: NetworkAsset[] = [];
  const fromNet = new Map<string, string>();
  const settled = await Promise.race([Promise.all(bodies), new Promise<(NetworkAsset | null)[]>((r) => setTimeout(() => r([]), 20_000))]);
  for (const a of settled) {
    if (!a) continue;
    const buf = (a as NetworkAsset & { buf?: Buffer }).buf as Buffer;
    delete (a as any).buf;
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    if (a.kind === 'image') a.size = imageSize(u8);
    else if (a.kind === 'ktx2') a.details = ktx2Summary(u8);
    else if (a.kind === 'hdr') a.size = hdrSize(u8);
    else if (a.kind === 'glb') a.details = parseGlb(u8);
    else if (a.kind === 'gltf') {
      try {
        a.details = gltfSummary(JSON.parse(buf.toString('utf8')));
      } catch {
        a.details = { error: 'not valid JSON' };
      }
    } else if (a.kind === 'rive') {
      a.details = riveSummary(u8);
      a.note = 'Artboards, animations and state machines need the Rive runtime to list; the file is saved for the Rive editor.';
    }
    if (a.kind === 'ktx2' || a.kind === 'basis')
      a.note = 'Saved as the original file. DEA does not bundle a KTX2/Basis decoder; open it with the KTX tools or three.js KTX2Loader.';
    if (a.kind === 'exr') a.note = 'Saved as the original OpenEXR file (floating point HDR).';
    if (a.bytes <= maxFile && totalBytes + a.bytes <= 150 * 1024 * 1024 && saved < 300) {
      const file = `assets/network/${safe(a.url, ++saved)}`;
      await w.bytes(file, u8, 'x');
      a.file = file;
      totalBytes += a.bytes;
      fromNet.set(a.url, file);
    } else a.note = `${a.note ? `${a.note} ` : ''}Not saved: over the size limit.`;
    net.push(a);
  }
  delete w.files.x;

  // ---------- textures
  await progress('writing texture previews and what each texture drives');
  const progs = new Map<string, { id: string; name: string; shaders: string[] }>();
  for (const p of (pageData?.programs ?? []) as Array<{ id: string; shaders: string[] }>)
    progs.set(p.id, { id: p.id, name: programName(p.shaders ?? [], `program ${p.id.slice(1)}`), shaders: p.shaders ?? [] });
  const bindings = (pageData?.bindings ?? []) as Array<{ program: string; sampler: string; texture: string | null }>;
  const textures: TextureInfo[] = [];
  const dataUrlBytes = (u: string) => Uint8Array.from(Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'));
  for (const t of (pageData?.textures ?? []) as any[]) {
    if (!t.uploads && !t.renderTarget && !t.width) continue;
    let file: string | null = null;
    if (t.preview?.url) {
      file = `assets/textures/${t.id}.png`;
      await w.bytes(file, dataUrlBytes(t.preview.url), 'x');
    }
    const usedBy = bindings
      .filter((b) => b.texture === t.id)
      .map((b) => {
        const p = progs.get(b.program);
        const srcName = String(t.source?.url ?? '').startsWith('data:')
          ? ''
          : (String(t.source?.url ?? '')
              .split('/')
              .pop() ?? '');
        return { program: p?.name ?? b.program, sampler: b.sampler, role: samplerRole(b.sampler, srcName), uses: samplerUse(b.sampler, p?.shaders ?? []) };
      });
    const src = t.source ?? { kind: t.renderTarget ? 'render target' : 'unknown' };
    textures.push({
      id: t.id,
      target: t.target ?? '2d',
      width: t.width ?? src.w ?? null,
      height: t.height ?? src.h ?? null,
      format: glName(t.format),
      type: glName(t.type),
      internalFormat: glName(t.internalFormat),
      wrap: [glName(t.params?.wrapS), glName(t.params?.wrapT)].filter(Boolean).join(' / '),
      filter: [glName(t.params?.minFilter), glName(t.params?.magFilter)].filter(Boolean).join(' / '),
      mipmaps: Boolean(t.mipmaps),
      source: src,
      dynamic: Boolean(t.dynamic),
      renderTarget: Boolean(t.renderTarget),
      compressed: Boolean(t.compressed),
      file,
      original: src.url ? (fromNet.get(src.url) ?? null) : null,
      normalized: t.preview?.normalized ?? null,
      placeholder: (t.width ?? src.w ?? 0) * (t.height ?? src.h ?? 0) <= 4 && !t.renderTarget,
      stack: Array.isArray(t.stack) ? t.stack.slice(0, 12) : undefined,
      usedBy,
    });
  }
  // ImageBitmap uploads carry no URL: match them to a downloaded image of the same size when exactly one fits
  for (const t of textures) {
    if (t.source.url || !t.width || !['imagebitmap', 'canvas', 'imagedata'].includes(t.source.kind)) continue;
    const same = net.filter((a) => a.kind === 'image' && a.size?.width === t.width && a.size?.height === t.height);
    if (same.length === 1) {
      t.likelyFrom = same[0].url;
      t.original ??= same[0].file;
      continue;
    }
    // or an image embedded in a downloaded .glb model
    const inModels = net.flatMap((a) =>
      a.kind === 'glb' && a.details && !(a.details as any).error
        ? (a.details as GlbSummary).images.filter((im) => im.width === t.width && im.height === t.height).map((im) => `${a.url}#${im.name}`)
        : [],
    );
    if (inModels.length === 1) t.likelyFrom = inModels[0];
  }
  const renderTargets: AssetsDoc['renderTargets'] = [];
  for (const r of targets) {
    if (r.preview?.url) {
      const file = `assets/render-targets/${r.id}.png`;
      await w.bytes(file, dataUrlBytes(r.preview.url), 'x');
      renderTargets.push({ id: r.id, file });
    } else renderTargets.push({ id: r.id, file: null, error: r.error });
  }
  const webgpu: AssetsDoc['webgpu'] = [];
  for (const [i, g] of ((pageData?.gpu ?? []) as any[]).entries()) {
    let file: string | null = null;
    if (g.preview?.url) {
      file = `assets/webgpu/${i + 1}.png`;
      await w.bytes(file, dataUrlBytes(g.preview.url), 'x');
    }
    webgpu.push({ source: g.source, size: g.size, format: g.format, file });
  }
  delete w.files.x;

  // ---------- network → source → runtime
  await progress('linking files to the code that loaded them and the shaders that sample them');
  const mapCache = new Map<string, SourceMapConsumer | null>();
  const scriptTexts = new Map<string, string>();
  const fetchText = async (u: string) => {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const t = await r.text();
      return t.length > 15_000_000 ? null : t;
    } catch {
      return null;
    }
  };
  const originCache = new Map<string, Origin | null>();
  const originFor = async (u: string | undefined) => {
    if (!u || u.startsWith('data:')) return null;
    const base = u.split('#')[0];
    if (!originCache.has(base)) {
      const init = initiators.get(base);
      originCache.set(
        base,
        init?.frames.length
          ? await originOf(init.frames, fetchText, mapCache, scriptTexts)
          : init?.type === 'parser'
            ? { where: 'the HTML (a tag in the page)', label: 'Verified', how: 'requested by the HTML parser', frames: [] }
            : null,
      );
    }
    return originCache.get(base) ?? null;
  };
  for (const a of net) (a as NetworkAsset & { origin?: Origin | null }).origin = await originFor(a.url);
  const chains: AssetsDoc['chains'] = [];
  for (const t of textures) {
    if (t.placeholder) continue;
    const src = t.source.url ?? t.likelyFrom;
    let origin = await originFor(src);
    if (!origin && t.stack?.length && !t.renderTarget) {
      // no network request behind it (data, canvas, video frame): the stack DEA's texImage2D trace saw at the upload
      const frames = t.stack
        .map((l) => /at (?:(.+?) \()?((?:https?|webpack-internal):[^)\s]+):(\d+):(\d+)\)?/.exec(l))
        .filter((m): m is RegExpExecArray => Boolean(m))
        .map((m) => ({ functionName: m[1] ?? '', url: m[2], lineNumber: Number(m[3]) - 1, columnNumber: Number(m[4]) - 1 }));
      const o = frames.length ? await originOf(frames, fetchText, mapCache, scriptTexts) : null;
      if (o)
        origin = { ...o, how: `the call stack at the texture upload (DEA's texImage2D trace); ${o.how.replace(/^Chrome’s initiator stack/, 'positions')}` };
    }
    const fileName = src
      ? src.startsWith('data:')
        ? `inline image ${t.id}`
        : src.includes('.glb#')
          ? `${short(src.split('#')[0])} › ${src.split('#')[1]}`
          : short(src)
      : t.renderTarget
        ? `render target ${t.id}`
        : `${t.source.kind} texture ${t.id}`;
    const seen = new Set<string>();
    for (const b of bindings.filter((x) => x.texture === t.id)) {
      const p = progs.get(b.program);
      const key = `${p?.name}|${b.sampler}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const shader = samplingLine(p?.shaders ?? [], b.sampler);
      const text = `${fileName}${origin ? ` ← ${origin.where}${origin.via ? ` via ${origin.via}` : ''}${origin.excerpt ? ` [${origin.excerpt.replace(/\s+/g, ' ').slice(0, 90)}]` : ''}` : ''} → ${p?.name ?? b.program}.${b.sampler}${shader ? ` → ${shader.stage} shader line ${shader.line}: ${shader.code}` : ''}`;
      chains.push({ texture: t.id, file: fileName, origin, program: p?.name ?? b.program, sampler: b.sampler, shader, text });
    }
  }
  // ---------- render pipeline of one frame
  const draws = ((pageData?.draws ?? []) as Array<{ program: string; target: string; inputs: string[] }>).map((d) => ({ ...d, program: d.program ?? '?' }));
  const texText = (id: string) => {
    if (id === 'screen') return 'the screen';
    const t = textures.find((x) => x.id === id);
    return t ? `${id} (${t.width}×${t.height} ${t.internalFormat || t.type || ''}${t.source.url ? ` ${short(t.source.url)}` : ''})`.replace(/\s+\)/, ')') : id;
  };
  const pipeline: AssetsDoc['pipeline'] = {
    captured: Boolean(pageData?.captured),
    draws: draws.length,
    passes: passesOf(draws).map((p) => ({
      ...p,
      targetText: texText(p.target),
      programNames: p.programs.map((x) => progs.get(x)?.name ?? x),
      inputTexts: p.inputs.map(texText),
    })),
  };

  const counts: Record<string, number> = { textures: textures.length, renderTargets: renderTargets.length, webgpu: webgpu.length };
  for (const a of net) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  const doc: AssetsDoc = {
    textures,
    renderTargets,
    network: net,
    programs: [...progs.values()].map((p) => ({
      id: p.id,
      name: p.name,
      samplers: [...new Set(bindings.filter((b) => b.program === p.id).map((b) => b.sampler))],
    })),
    webgpu,
    counts,
    chains,
    pipeline,
  };
  await w.json('assets/manifest.json', doc, 'assetsManifest');
  // shader sources per program, with the texture file each sampler reads: what `dea extract` rebuilds from
  await w.json(
    'assets/programs.json',
    [...progs.values()].map((p) => ({
      id: p.id,
      name: p.name,
      shaders: p.shaders,
      samplers: bindings
        .filter((b) => b.program === p.id)
        .map((b) => {
          const t = textures.find((x) => x.id === b.texture);
          return {
            sampler: b.sampler,
            texture: b.texture,
            file: t?.original ?? t?.file ?? null,
            renderTarget: t?.renderTarget ?? false,
            width: t?.width ?? null,
            height: t?.height ?? null,
            wrap: t?.wrap ?? '',
            filter: t?.filter ?? '',
          };
        }),
    })),
    'assetsPrograms',
  );

  const gaps = assetGaps(doc, result.run.meta.finalUrl);
  await w.json('gaps.json', gaps, 'gaps');
  const md = renderAssetsMd(doc, result.run, gaps);
  await w.text('assets.md', md, 'assetsMd');

  const facts = assetFacts(doc);
  const run: RunDoc = { ...result.run, facts: [...result.run.facts, ...facts] };
  run.meta.files = { ...w.files, run: 'run.json', progress: 'progress.md' };
  run.meta.finishedAt = new Date().toISOString();
  await w.json('run.json', run, 'run');
  for (const f of facts) w.emit({ type: 'fact', runId: w.id, fact: f });
  const summary = assetsSummary(doc, run);
  w.emit({ type: 'run.finished', runId: w.id, dir: w.dir, summary, at: new Date().toISOString() });
  await progress('done');
  return { ...result, run, summary, assets: doc, assetsMd: md, gaps };
}

const short = (u?: string) => {
  if (!u) return '';
  if (u.startsWith('data:')) return 'inline data URI';
  try {
    const x = new URL(u);
    return x.pathname.split('/').pop() || x.host;
  } catch {
    return u.slice(0, 60);
  }
};

/** "noise.png → uNoise in heroHaze (noise source; offsets UVs (distortion))" */
export function drives(t: TextureInfo): string[] {
  if (t.placeholder) return [];
  const src = t.source.url ?? t.likelyFrom;
  const name = src
    ? src.startsWith('data:')
      ? `inline image ${t.id} (${t.width}×${t.height})`
      : `${src.includes('.glb#') ? `${short(src.split('#')[0])} › ${src.split('#')[1]}` : short(src)}${t.likelyFrom ? ' (matched by size)' : ''}`
    : t.renderTarget
      ? `render target ${t.id} (${t.width}×${t.height})`
      : `${t.source.kind} texture ${t.id} (${t.width}×${t.height})`;
  return [...new Set(t.usedBy.map((u) => `${name} → \`${u.sampler}\` in ${u.program}: ${u.role}${u.uses.length ? `; ${u.uses.join(', ')}` : ''}`))];
}

export function assetGaps(d: AssetsDoc, site: string): Gap[] {
  const gaps: Gap[] = [];
  const unbound = d.textures.filter((t) => !t.usedBy.length && !t.renderTarget && !t.placeholder);
  if (unbound.length)
    gaps.push({
      area: 'assets',
      topic: `${unbound.length} texture(s) uploaded but not seen in a draw`,
      known: unbound
        .slice(0, 6)
        .map((t) => `Verified: ${t.id} ${t.width ?? '?'}×${t.height ?? '?'} from ${t.source.kind}${t.source.url ? ` ${short(t.source.url)}` : ''}`),
      missing: 'which shader uses them: they were not drawn while DEA watched (later chapters, hover states, or preloaded for another page)',
      approximation: {
        text: 'treat them by their source and size: images as colour maps, small tiling data textures as noise; previews are saved in assets/textures/',
      },
      next: [{ why: 'scroll further and interact so the scenes that use them draw', command: `dea assets ${site} --scroll-steps 40 --headed` }],
    });
  if (d.pipeline && !d.pipeline.captured && d.textures.length)
    gaps.push({
      area: 'assets',
      topic: 'The render pipeline was not recorded',
      known: [`Verified: ${d.textures.filter((t) => t.renderTarget).length} render targets exist; ${d.programs.length} programs were linked`],
      missing: 'one complete animation frame: the page drew too slowly or not at all while DEA waited',
      approximation: {
        text: 'the sampler bindings above still say which program reads which texture; render targets point to post-processing or simulation passes',
      },
      next: [{ why: 'on a machine with a GPU the frame completes quickly', command: `dea assets ${site} --headed` }],
    });
  const rtFailed = d.renderTargets.filter((r) => !r.file);
  if (rtFailed.length)
    gaps.push({
      area: 'assets',
      topic: `${rtFailed.length} render target(s) could not be read back`,
      known: rtFailed.map((r) => `Verified: ${r.id} is a render target (${r.error ?? 'not readable'})`),
      missing: 'their pixels: float or depth targets cannot be read as 8-bit colour',
      approximation: { text: 'the shaders that draw into them are in the design decode; most are post-processing buffers or GPU simulation state' },
      next: [{ why: 'explains the programs that write into these targets', command: `dea code ${site}`, probe: 'code' }],
    });
  for (const a of d.network.filter((x) => x.kind === 'ktx2' || x.kind === 'basis'))
    gaps.push({
      area: 'assets',
      topic: `Compressed texture ${short(a.url)} not decoded to PNG`,
      known: [`Verified: ${a.kind.toUpperCase()} file, ${a.bytes} bytes${a.details && !(a.details as any).error ? `, ${JSON.stringify(a.details)}` : ''}`],
      missing: 'a PNG view: DEA ships no KTX2/Basis transcoder',
      approximation: { text: 'when the same texture was uploaded to WebGL, its preview is under assets/textures/ (look for compressed: true)' },
      next: [{ why: 'Khronos KTX tools (Apache-2.0) convert it to PNG', command: `ktx extract ${a.file ?? short(a.url)} out.png` }],
    });
  return gaps;
}

function assetFacts(d: AssetsDoc): Fact[] {
  const facts: Fact[] = [];
  facts.push({
    key: 'assets.textures',
    claim: `WebGL received ${d.textures.length} texture(s) (${d.textures.filter((t) => t.source.kind === 'image').length} from images, ${d.textures.filter((t) => t.source.kind === 'data').length} computed in JavaScript, ${d.textures.filter((t) => t.renderTarget).length} render targets).`,
    value: d.textures.length,
    label: 'Verified',
    evidence: [{ source: 'webgl', pointer: 'texImage2D / texSubImage2D / texStorage2D hooks', excerpt: 'assets/manifest.json' }],
  });
  let n = 0;
  for (const t of d.textures)
    for (const line of drives(t)) {
      if (n++ >= 20) break;
      facts.push({
        key: `assets.drives.${n}`,
        claim: line.replace(/`/g, ''),
        value: t.id,
        label: 'Inferred',
        why: 'the binding is Verified (seen at a draw call); the role comes from the sampler name and how the shader uses it',
        evidence: [{ source: 'webgl', pointer: `draw call: ${t.usedBy[0]?.program} sampler ${t.usedBy[0]?.sampler}`, excerpt: t.file ?? undefined }],
      });
    }
  const models = d.network.filter((a) => a.kind === 'glb' || a.kind === 'gltf');
  for (const m of models.slice(0, 5)) {
    const g = m.details as GlbSummary | { error: string };
    if (!g || 'error' in g) continue;
    facts.push({
      key: `assets.model.${short(m.url)}`,
      claim: `3D model ${short(m.url)}: ${g.meshes.length} mesh(es), ${g.materials.length} material(s), ${g.animations.length} animation(s)${g.animations.length ? ` (${g.animations.map((a) => `${a.name} ${a.seconds ?? '?'}s`).join(', ')})` : ''}.`,
      value: m.url,
      label: 'Verified',
      evidence: [{ source: 'har', pointer: m.url, excerpt: m.file ?? undefined }],
    });
  }
  for (const l of d.network.filter((a) => a.kind === 'lottie').slice(0, 5)) {
    const s = l.details as ReturnType<typeof lottieSummary>;
    if (s)
      facts.push({
        key: `assets.lottie.${short(l.url)}`,
        claim: `Lottie animation ${short(l.url)}: ${s.seconds}s at ${s.fps} fps, ${s.width}×${s.height}, ${s.layers.length} layer(s).`,
        value: l.url,
        label: 'Verified',
        evidence: [{ source: 'har', pointer: l.url }],
      });
  }
  return facts;
}

function assetsSummary(d: AssetsDoc, run: RunDoc): string {
  const c = d.counts;
  const lines = [
    `${run.meta.title || run.meta.finalUrl}`,
    `Textures in WebGL: ${d.textures.length} (${d.textures.filter((t) => t.file).length} previews saved), render targets read back: ${d.renderTargets.filter((r) => r.file).length}`,
    `Files: ${Object.entries(c)
      .filter(([k]) => !['textures', 'renderTargets', 'webgpu'].includes(k))
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}`,
  ];
  const rank = (t: TextureInfo) => (t.source.url || t.likelyFrom ? 0 : t.source.kind === 'data' || t.source.kind === 'canvas' ? 1 : 2);
  const dr = [...d.textures]
    .sort((a, b) => rank(a) - rank(b))
    .flatMap(drives)
    .slice(0, 8);
  if (dr.length) lines.push('What drives what:', ...dr.map((x) => `  ${x.replace(/`/g, '')}`));
  return lines.join('\n');
}

export function renderAssetsMd(d: AssetsDoc, run: RunDoc, gaps: Gap[]): string {
  const L: string[] = [
    `# Assets: ${run.meta.title || run.meta.finalUrl}`,
    '',
    `Every visual asset ${run.meta.finalUrl} used while DEA loaded and scrolled it. Files are in \`assets/\`; the full list is \`assets/manifest.json\`.`,
    '',
    '✔ Verified = seen at a WebGL call or in the network. ≈ Inferred = what a texture is for, read from the sampler name and how the shader uses it.',
    '',
    'Third-party assets belong to their owners: use them to learn and as reference, and swap in your own before you ship.',
    '',
  ];
  if (d.chains?.length) {
    L.push(
      '## Network → source → runtime',
      '',
      '✔ Each line: the file, the code that loaded it (Chrome’s initiator stack, through source maps when published), the program and sampler it is drawn with, and the shader line that samples it.',
      '',
    );
    for (const c of d.chains.slice(0, 60)) L.push(`- ${c.text.replace(/`/g, "'")}`);
    L.push('');
  }
  if (d.pipeline?.passes.length) {
    L.push(
      `## Render pipeline (one frame, ${d.pipeline.draws} draw calls)`,
      '',
      '✔ Recorded at the WebGL calls during one animation frame: which program drew into which target, in order, and what each pass read.',
      '',
    );
    for (const p of d.pipeline.passes.slice(0, 60))
      L.push(
        `${p.index}. → ${p.targetText}: ${p.programNames.slice(0, 4).join(', ')}${p.programNames.length > 4 ? ` +${p.programNames.length - 4}` : ''} (${p.draws} draw${p.draws > 1 ? 's' : ''})${p.inputTexts.length ? `; reads ${p.inputTexts.slice(0, 5).join(', ')}` : ''}`,
      );
    L.push('');
  } else if (d.pipeline && !d.pipeline.captured)
    L.push('## Render pipeline', '', 'No animation frame completed while DEA waited, so no pipeline was recorded (see gaps).', '');
  const withUse = d.textures.filter((t) => t.usedBy.length);
  if (withUse.length) {
    L.push('## What each texture drives', '');
    for (const t of withUse) for (const line of drives(t)) L.push(`- ≈ ${line}${t.file ? ` ([preview](${t.file}))` : ''}`);
    L.push('');
  }
  L.push(`## Textures WebGL received (${d.textures.length})`, '');
  if (d.textures.length) {
    L.push('| id | size | source | format | wrap | filter | mipmaps | preview |', '|---|---|---|---|---|---|---|---|');
    for (const t of d.textures.slice(0, 120))
      L.push(
        `| ${t.id}${t.renderTarget ? ' (render target)' : ''}${t.dynamic ? ' (updates)' : ''} | ${t.width ?? '?'}×${t.height ?? '?'} | ${t.source.kind}${t.source.url ? ` ${short(t.source.url)}` : ''} | ${[t.internalFormat, t.format, t.type].filter(Boolean).join(' ') || (t.compressed ? 'compressed' : '')} | ${t.wrap} | ${t.filter} | ${t.mipmaps ? 'yes' : 'no'} | ${t.file ? `[png](${t.file})` : t.original ? `[file](${t.original})` : '–'} |`,
      );
    L.push('');
  } else L.push('No WebGL textures were uploaded while DEA watched.', '');
  if (d.renderTargets.length) {
    L.push('## Render targets read back (Inferred: a snapshot of one moment)', '');
    for (const r of d.renderTargets) L.push(`- ${r.id}: ${r.file ? `[png](${r.file})` : (r.error ?? 'not readable')}`);
    L.push('');
  }
  const groups: Array<[string, AssetKind[]]> = [
    ['3D models', ['glb', 'gltf', 'model-bin']],
    ['Images', ['image', 'svg']],
    ['Compressed textures and environment maps', ['ktx2', 'basis', 'hdr', 'exr']],
    ['Video', ['video']],
    ['Lottie', ['lottie']],
    ['Rive', ['rive']],
    ['Fonts', ['font']],
  ];
  for (const [title, kinds] of groups) {
    const xs = d.network.filter((a) => kinds.includes(a.kind));
    if (!xs.length) continue;
    L.push(`## ${title} (${xs.length})`, '');
    for (const a of xs.slice(0, 60)) {
      const det = a.details as any;
      let extra = '';
      if (a.size) extra = ` ${a.size.width}×${a.size.height}`;
      if (det && (a.kind === 'glb' || a.kind === 'gltf') && !det.error) {
        const g = det as GlbSummary;
        extra = ` ${g.meshes.length} meshes, ${g.materials.length} materials${g.animations.length ? `, animations: ${g.animations.map((x) => `${x.name} (${x.seconds ?? '?'} s, ${x.channels} channels)`).join(', ')}` : ''}${g.extensions.length ? `; extensions ${g.extensions.join(', ')}` : ''}`;
        const slots = g.materials.filter((m) => Object.keys(m.slots).length).slice(0, 6);
        if (slots.length)
          extra += `; texture slots: ${slots
            .map(
              (m) =>
                `${m.name} {${Object.entries(m.slots)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}}`,
            )
            .join('; ')}`;
      } else if (det && a.kind === 'lottie')
        extra = ` ${det.seconds}s, ${det.fps} fps, ${det.width}×${det.height}, layers: ${det.layers.slice(0, 6).join(', ')}`;
      else if (det && !det.error && typeof det === 'object') extra = ` ${JSON.stringify(det)}`;
      L.push(`- ✔ ${a.file ? `[${short(a.url)}](${a.file})` : short(a.url)} (${Math.round(a.bytes / 1024)} KB)${extra}${a.note ? `. ${a.note}` : ''}`);
    }
    L.push('');
  }
  const gm = renderGaps(gaps);
  if (gm) L.push(gm);
  return `${L.join('\n')}\n`;
}
