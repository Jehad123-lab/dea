import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import type { Browser } from 'playwright';
import { decodeAssets } from '../assets/index.ts';
import { launchBrowser, releaseBrowser, withSharedBrowser } from '../browser/open.ts';
import type { PhaseInfo } from '../browser/phase.ts';
import { type CacheStats, ContentCache, cacheKey, currentCache, fmtMb, withCache } from '../cache.ts';
import { type Driver, driverText, type TraceDoc, traceWebGL } from '../debug/trace.ts';
import { type DesignDoc, decodeDesign } from '../design/index.ts';
import { type BootInfo, bootInfo, buildLedger, type PageMapInfo, renderLedgerMd, type ScrollTapeInfo } from '../evidence/ledger.ts';
import { newRunId, RunWriter, resolveRun, runsDir } from '../evidence/run.ts';
import { type Gap, renderGaps } from '../gaps.ts';
import { decodeMotion, type GsapNode, gsapModule, type MotionDoc } from '../motion/index.ts';
import { pool } from '../pool.ts';
import { REPLAY_CAPTURE_SCRIPT } from '../replay/capture.ts';
import { animateEntries, buildGraph, type CaptureDoc, compactCapture, fitCapture, placeholderTextures, renderGraphMd, TEX_GRID } from '../replay/graph.ts';
import { fitInputs, type InputMap, inferInputs, inputsSummary, type ProbeData, type ProbeReport } from '../replay/inputs.ts';
import { REPLAY_PLAYER } from '../replay/player.ts';
import { compactFrames, type RebuildStats, rebuildMd, rebuildPipeline, type StandInInfo, standinSummary } from '../replay/rebuild.ts';
import { REBUILD_RUNNER } from '../replay/runner.ts';
import { recoverScene, sceneGlb, sceneMd, sceneModule } from '../replay/scene.ts';
import { buildPageMap, fitScrollTape, pageMapMd, type ScrollTapeFit, tapeMoved } from '../replay/scrolltape.ts';
import { fitTape } from '../replay/tape.ts';
import type { InspectOptions } from '../see/inspect.ts';
import { currentTimings, overBudget, type StageTiming, Timings, type TimingsDoc, timed, withTimings } from '../timings.ts';
import { type FullPageResult, type PageStopsResult, pageStopsMd, readFullPage, scorePageStops, stopsSheet } from './fullpage.ts';
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
  threeRevision,
  tokenFiles,
  withScroll,
} from './generate.ts';
import {
  classifyInputs,
  diffStates,
  framesStrip,
  INTERACTION_SCRIPT,
  type InteractionResult,
  interactionMd,
  meanResponse,
  scoreInteraction,
  setDragStep,
} from './interaction.ts';
import { type KitManifest, libraryAdd } from './library.ts';
import { ownAssetsPage, pageIsWorthKeeping } from './pagelayer.ts';
import { domPageMap } from './pagemap.ts';
import {
  compareImages,
  envLine,
  kitInteraction,
  kitSteadiness,
  LAYOUT_READ,
  placeholderPng,
  previewHtml,
  type RefEnv,
  readLayout,
  referenceShot,
  renderPreview,
  type Similarity,
  serveDir,
  sideBySide,
} from './preview.ts';
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

/**
 * Round 35: without a recording there is no (a) or (b), but the canvas still gets a score: DEA's own start (the shader
 * modules on a full-screen quad) against the site's canvas. igloo.inc's unrecorded run printed "canvas 66.1%" next to
 * "replay: not recorded", which read like a (b) score. Say what it is.
 */
/**
 * Round 38: one line saying what each --own-assets placeholder kind costs on the canvas, from the never-shipped variants.
 * A variant that keeps the site's images and still scores like the shipped rebuild means the images were not the loss.
 */
/**
 * Round 40: the materials whose stand-ins --own-assets-cost scores one at a time: the `max` with the most stand-ins (ties:
 * the most site vertices), so the cost line says which material's meshes the (b) gap comes from.
 */
export function costMaterials(list: StandInInfo[], max = 6): Array<{ material: number; program: string; n: number; vertices: number }> {
  const by = new Map<number, { material: number; program: string; n: number; vertices: number }>();
  for (const r of list) {
    const m = by.get(r.material) ?? { material: r.material, program: r.program, n: 0, vertices: 0 };
    m.n++;
    m.vertices += r.vertices;
    by.set(r.material, m);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || b.vertices - a.vertices).slice(0, max);
}

/** Round 46: the finer colour grids --own-assets-cost scores (never shipped): 16 and 32 cells per side, those finer than the shipped one */
/** Round 47: frames to record: --frames clamped to 2-120, default 2 (quick too: one frame has no clocks, nothing animates) */
export function recordFrameCount(n?: number): number {
  return n != null && Number.isFinite(n) ? Math.max(2, Math.min(120, Math.round(n))) : 2;
}

export function costGrids(shipped: number): number[] {
  return [16, 32].filter((g) => g > shipped);
}

/** Round 50: default seconds --own-assets-cost may spend on its variants */
export const OWN_COST_BUDGET_S = 240;

/** Round 50: --own-assets-cost-budget clamped to 30-3600 s; the default when unset or not a number */
export function ownCostBudget(s?: number): number {
  return s != null && Number.isFinite(s) ? Math.max(30, Math.min(3600, Math.round(s))) : OWN_COST_BUDGET_S;
}

/**
 * Round 50: whether one more variant fits: the time spent so far plus the slowest variant scored yet (the first one always
 * runs, so the line has at least one number)
 */
export function costFits(spentMs: number, slowestMs: number, budgetS: number): boolean {
  return spentMs === 0 || spentMs + slowestMs <= budgetS * 1000;
}

export function ownCostLine(shipped: number | null, cost: Array<{ what: string; canvas: number | null; page: number; skipped?: string }>): string {
  const p = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const parts = cost.map((c) => {
    if (c.skipped) return `${c.what}: not scored (${c.skipped})`;
    if (c.canvas == null) return `${c.what}: canvas n/a, page ${p(c.page)}`;
    const gain = shipped != null ? ` (${c.canvas >= shipped ? '+' : ''}${Math.round((c.canvas - shipped) * 1000) / 10} points)` : '';
    return `${c.what}: canvas ${p(c.canvas)}${gain}, page ${p(c.page)}`;
  });
  return `--own-assets cost (variants scored, never shipped; shipped canvas ${shipped != null ? p(shipped) : 'n/a'}): ${parts.join(' · ')}`;
}

export const UNRECORDED_CANVAS_NOTE = "(DEA's own shader-module draft, not (a) or (b): nothing was recorded, so this is not a rebuild score)";

export interface ExtractOptions extends InspectOptions {
  to?: Target;
  /**
   * rough and fast: one recorded frame, a reference watch that stops when the page settles (20 s cap), no motion
   * decode, no trace, no parameter sweep, no research, no build check. Labelled QUICK in every report.
   */
  quick?: boolean;
  /** do not read or write DEA's content cache (static files, stage runs, the reference capture) */
  noCache?: boolean;
  /** where the cache lives (default <DEA_HOME>/cache) */
  cacheDir?: string;
  /** the cache's size cap in MB (default 1024); the least recently used entries go first */
  cacheMaxMb?: number;
  /** how many decoders run side by side (default 3; 1 runs them one after another) */
  concurrency?: number;
  /** run the decoders while the reference is captured (faster with a GPU; without one a heavy intro may not finish) */
  overlap?: boolean;
  /** a CSS selector: keep only motion whose targets or triggers mention it */
  section?: string;
  /** reference textures by path but write neutral placeholders of the same size instead of the site's files */
  ownAssets?: boolean;
  /**
   * Round 38: with --own-assets, also score two variants that are never shipped (real images + stand-in meshes, image grids +
   * real meshes), so the report says what each placeholder kind costs (three.js keyframes: images ~11 points, shapes ~26)
   */
  ownAssetsCost?: boolean;
  /**
   * Round 46: cells per side of each image's colour grid with --own-assets (default TEX_GRID = 8, 2-64). A finer grid keeps more
   * of the site's artwork (three.js keyframes bakes all its colour into one atlas, so 8x8 cells cost about 7 points): the
   * user's call, never DEA's default.
   */
  ownAssetsGrid?: number;
  /**
   * Round 50: seconds --own-assets-cost may spend scoring its variants (default OWN_COST_BUDGET_S = 240). Each variant is a full
   * render and score: lusion.co (76 passes, 170 draws) ran past 300 s on a software GPU. Variants left when the budget runs
   * out are listed as not scored, so the line still says what was measured.
   */
  ownAssetsCostBudget?: number;
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
  /** read only the first screen's DOM, not the whole page */
  noPage?: boolean;
  /** your own screenshot of the original (PNG/JPEG), e.g. from a machine with a GPU, instead of DEA's */
  reference?: string;
  /** how long DEA watches the original for its reference screenshot (default 45 s) */
  referenceMs?: number;
  /**
   * Round 47: how many consecutive WebGL frames to record (default 2, also in --quick; 2-120). Two give the clocks (uTime
   * follows real time); more give a motion loop: a CPU animation (three.js AnimationMixer: model matrices and bone textures set
   * each frame) plays back frame by frame at the recorded timing in the rebuild.
   */
  frames?: number;
  /** do not record and replay the site's WebGL frames */
  noReplay?: boolean;
  /** the largest recording (after compaction) DEA keeps, in MB (default 64); a bigger one is dropped with a note */
  maxCaptureMb?: number;
  /** what the scroll tape may add to the recording, in MB (default 64): its stops are spread over the page to reach the end within it */
  tapeMb?: number;
}

/** What the recording and replay of the site's WebGL frames gave. */
export interface ReplayInfo {
  frames: number;
  passes: number;
  draws: number;
  programs: number;
  bytes: number;
  /** canvas score of the replay alone (before research) */
  canvas: number | null;
  page: number | null;
  kept: boolean;
  /** which side the canvas scores used: the reference screenshot, or the canvas copied at the recorded frame when the page paints over it */
  canvasRef?: 'screenshot' | 'canvas';
  roles: string[];
  scene: { meshes: number; camera: boolean; canvas: number | null; page: number | null } | null;
  errors: string[];
  placeholders?: number;
  /** Round 46: cells per side of the images' colour grids (--own-assets-grid) */
  texGrid?: number;
  /** --own-assets: data textures kept as recorded because they are lookup tables (LUTs, ramps, tiny tables) */
  lookups?: number;
  /** false with --own-assets: the capture replay was scored but its recorded bytes are not in the kit */
  shipped: boolean;
  /** uniforms the replay and the rebuild drive from live pointer, scroll and window size */
  inputs?: InputMap[];
  /** clock uniforms that advance with real time */
  clocks?: number;
  /** the scroll tape: frames recorded at scroll stops and played from the live scroll (null: the scroll changed nothing) */
  scrollTape?: ScrollTapeInfo | null;
  /** the page map: sections and the scene at each scroll stop */
  map?: PageMapInfo | null;
  /** the boot timeline: when the canvas, the first draw and the last shader link happened */
  boot?: BootInfo | null;
  /**
   * The editable rebuild: the recorded render graph as a three.js project (rebuild/rebuild.js + public/rebuild/), scored
   * on its own. Unlike the capture replay above (the recorded calls played back), this is code you can change.
   */
  rebuild: null | {
    canvas: number | null;
    page: number | null;
    kept: boolean;
    stats: RebuildStats;
    errors: string[];
    /** canvas score of (b) against (a): what the translation to three.js itself loses */
    vsReplay?: number | null;
    /** Round 38 (--own-assets-cost): the score of each never-shipped variant, to show what each placeholder kind costs */
    ownCost?: Array<{ what: string; canvas: number | null; page: number; skipped?: string }>;
  };
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
    /** the reference frame is near-uniform: it likely still shows a loading screen (one without a visible counter) */
    referenceFlat?: boolean;
    /** Round 32: GPU / CPU masks DEA applied, WebGL contexts the page lost, a fallback-mode class */
    referenceEnv?: RefEnv;
    standin?: Standin | null;
    /** the canvas-only perceptual score (text masked out) at the start and at the end; null when there is no canvas */
    canvas?: { start: CanvasScore | null; final: CanvasScore | null };
  };
  /** the recorded-and-replayed WebGL frames; null when not recorded (with the reason in gaps) */
  replay: ReplayInfo | null;
  build: BuildCheck | null;
  gaps: Gap[];
  techniques: Technique[];
  extractMd: string;
  summary: string;
  /** wall time per stage and peak memory (also written to timings.json in the run) */
  timings?: TimingsDoc;
  /** the interaction check: scripted pointer and scroll, site vs kit, and what each input does in the kit */
  interaction?: InteractionResult | null;
  /** the whole page: the kit scored at each scroll stop against the original's screenshot there */
  pageStops?: PageStopsResult | null;
  /** what the content cache served and kept in this run; absent with --no-cache */
  cache?: CacheStats & { dir: string; sizeBytes: number | null; capBytes: number };
  /** true in quick mode: a rough result */
  quick?: boolean;
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** bump when a decoder's output changes shape, so older cached runs are not reused */
const STAGE_CACHE_VERSION = 1;
// bumped when the probe or the capture's result format changes; the recorder's own source is hashed into the key too, so a change
// to it never serves a recording made by the old one
// 4: the scroll tape covers the whole page (recordScrollTape), so a recording made by the old tape is not served
// 5: the reference watch waits past flat loaders (refwait), so a capture whose reference is a loading screen is taken again
const CAPTURE_CACHE_VERSION = 5;
/** the recorder and the first-screen reader: a change to either takes the capture again instead of reusing an older reading */
const CAPTURE_CODE = createHash('sha1').update(REPLAY_CAPTURE_SCRIPT).update(LAYOUT_READ(null)).digest('hex').slice(0, 12);

type RefShot = Awaited<ReturnType<typeof referenceShot>>;

/** The reference screenshot (with the recorded frames behind it): your own image, the cache, or a fresh watch. */
async function referenceFor(
  browser: Browser,
  url: string,
  vp: { width: number; height: number },
  opts: ExtractOptions,
  say: (s: string) => void,
): Promise<RefShot> {
  if (opts.reference)
    return {
      png: `data:image/${/\.png$/i.test(opts.reference) ? 'png' : 'jpeg'};base64,${(await readFile(opts.reference)).toString('base64')}`,
      atMs: 0,
      loader: false,
      layout: null,
    };
  const quick = Boolean(opts.quick);
  // no --reference-ms: watch until the page settles (45 s cap, 20 s in quick mode); a given --reference-ms watches that long
  const smart = opts.referenceMs == null;
  const ms = opts.referenceMs ?? (quick ? 20_000 : 45_000);
  // Round 47: two frames in quick mode too (one gave no clocks, so the live demos stood still); --frames records a motion loop
  const frames = recordFrameCount(opts.frames);
  const record = !opts.noReplay;
  // the scripted pointer / scroll and the input probe run on the live site right after the recording (full mode)
  const interact = record && !quick;
  const cache = currentCache();
  const key = cacheKey(
    'capture',
    CAPTURE_CACHE_VERSION,
    CAPTURE_CODE,
    url,
    vp,
    ms,
    smart,
    opts.section ?? null,
    record,
    frames,
    interact,
    opts.browser ?? 'auto',
    opts.tapeMb ?? null,
  );
  const d = cache ? await cache.get('capture', key) : null;
  if (cache && d) {
    try {
      const m = JSON.parse(await readFile(join(d, 'meta.json'), 'utf8')) as {
        atMs: number;
        loader: boolean;
        flat?: boolean;
        made: string;
        recordingError?: string;
        phase?: PhaseInfo | null;
        env?: RefEnv;
      };
      // a cached reference that is still a flat frame (a loader) is not worth reusing: watch again, the page may load this time
      if (m.flat) throw new Error('flat reference');
      const png = `data:image/png;base64,${(await readFile(join(d, 'ref.png'))).toString('base64')}`;
      const layout = JSON.parse(await readFile(join(d, 'layout.json'), 'utf8'));
      const recording = existsSync(join(d, 'capture.bin'))
        ? {
            doc: JSON.parse(await readFile(join(d, 'capture.json'), 'utf8')) as CaptureDoc,
            bin: await readFile(join(d, 'capture.bin')),
            ...(existsSync(join(d, 'canvas.png')) ? { canvasPng: `data:image/png;base64,${(await readFile(join(d, 'canvas.png'))).toString('base64')}` } : {}),
          }
        : null;
      const probe = existsSync(join(d, 'probe.json')) ? (JSON.parse(await readFile(join(d, 'probe.json'), 'utf8')) as ProbeData) : null;
      const interaction: Buffer[] = [];
      for (let i = 0; existsSync(join(d, `interaction-${i}.png`)); i++) interaction.push(await readFile(join(d, `interaction-${i}.png`)));
      say(`reusing the reference screenshot and the recorded frames from ${m.made} (cache; --no-cache takes them again)`);
      currentTimings()?.note(`from cache (made ${m.made})`);
      cache.stats.reused.push({ what: 'reference + capture', at: m.made });
      return {
        png,
        atMs: m.atMs,
        loader: m.loader,
        flat: m.flat ?? false,
        layout,
        ...(m.env ? { env: m.env } : {}),
        ...(record ? { recording, ...(m.recordingError ? { recordingError: m.recordingError } : {}) } : {}),
        ...(interact ? { probe, interaction: interaction.length ? interaction : undefined, phase: m.phase ?? null } : {}),
      };
    } catch {
      /* a damaged entry: take it again */
    }
  }
  say(
    smart
      ? `taking the reference screenshot: watching until the page settles (up to ${Math.round(ms / 1000)} s), the frame with the most detail`
      : 'taking the reference screenshot (after the intro, the frame with the most detail)',
  );
  const r = await referenceShot(browser, url, vp, ms, opts.section ?? null, record, smart, frames, interact, opts.tapeMb);
  // a capture whose recording failed is not kept: the next run tries again
  if (cache && r.png && (!record || r.recording)) {
    const files: Record<string, string | Uint8Array> = {
      'ref.png': Buffer.from(r.png.slice(r.png.indexOf(',') + 1), 'base64'),
      'layout.json': JSON.stringify(r.layout ?? null),
    };
    if (r.recording) {
      files['capture.json'] = JSON.stringify(r.recording.doc);
      files['capture.bin'] = r.recording.bin;
      if (r.recording.canvasPng) files['canvas.png'] = Buffer.from(r.recording.canvasPng.slice(r.recording.canvasPng.indexOf(',') + 1), 'base64');
    }
    if (r.probe) files['probe.json'] = JSON.stringify(r.probe);
    for (const [i, b] of (r.interaction ?? []).entries()) files[`interaction-${i}.png`] = b;
    await cache
      .put(
        'capture',
        key,
        {
          url,
          atMs: r.atMs,
          loader: r.loader,
          ...(r.flat ? { flat: true } : {}),
          made: new Date().toISOString(),
          ...(r.recordingError ? { recordingError: r.recordingError } : {}),
          ...(r.phase ? { phase: r.phase } : {}),
          ...(r.env ? { env: r.env } : {}),
        },
        files,
      )
      .catch(() => {});
  }
  return r;
}

/** Round 33: stages handed in with --from in this run (for the cache line) */
const givenStages: string[] = [];

/** set when a pointer tape fitted something that follows the pointer (read by the inputs line) */
let tapeDriven: { drag: boolean; n: number } | null = null;

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
/** Why the editable rebuild did not run, in words that say what to do (three.js comes from a CDN in the preview). */
export function rebuildErrorText(err: string): string {
  if (/dynamically imported module|Failed to fetch|NetworkError|cdn\.jsdelivr|esm\.sh/i.test(err))
    return `three.js could not be loaded from the CDN (no internet on this machine?), so the rebuild was never drawn. Run again with internet to score it. (${err.slice(0, 140)})`;
  return err.slice(0, 200);
}

/** What `dea record` took: the reference screenshot and the recorded WebGL frames, kept in the cache for the next extract. */
export interface RecordResult {
  url: string;
  /** true when the cache already held this capture (nothing was taken again) */
  reused: boolean;
  /** true when the WebGL frames were recorded (an editable rebuild can be made from them) */
  recorded: boolean;
  recordingError: string | null;
  /** when, after load, the reference frame was taken */
  atMs: number;
  cacheDir: string;
  seconds: number;
}

/**
 * The reference capture on its own: the slowest step of `dea extract` (the watch until the page settles, the WebGL
 * recording, the scripted input), split out so a slow machine or a time-limited box can take it in a separate call.
 * It writes the same cache entry extract reads, so a later `dea extract <url>` with the same capture options
 * (--section, --reference-ms, --quick, --no-replay, --tape-mb, --browser) reuses it instead of opening the site again.
 */
export async function recordReference(url: string, opts: ExtractOptions = {}): Promise<RecordResult> {
  if (opts.reference) throw new Error('dea record takes the reference itself; --reference (your own screenshot) belongs to dea extract');
  const cache = opts.noCache ? null : (currentCache() ?? new ContentCache({ dir: opts.cacheDir, maxMb: opts.cacheMaxMb }));
  if (!cache) throw new Error('dea record keeps what it takes in the cache, so it cannot run with --no-cache');
  const t0 = Date.now();
  let reused = false;
  const say = (s: string) => {
    if (s.startsWith('reusing the reference')) reused = true;
    opts.onProgress?.(s);
  };
  // the same viewport extractRun gives referenceFor: a different one would be a different cache key
  const vp = { width: 1440, height: 900 };
  const r = await withCache(cache, () =>
    withSharedBrowser(
      opts.browser ?? 'auto',
      opts.headless ?? true,
      async () => {
        const { browser } = await launchBrowser(opts.browser ?? 'auto', opts.headless ?? true);
        try {
          return await referenceFor(browser, url, vp, opts, say);
        } finally {
          await releaseBrowser(browser);
        }
      },
      { max: 1 },
    ),
  );
  const rec = r as RefShot & { recording?: unknown; recordingError?: string };
  return {
    url,
    reused,
    recorded: Boolean(rec.recording),
    recordingError: rec.recordingError ?? (opts.noReplay ? 'not recorded (--no-replay)' : rec.recording ? null : 'nothing was recorded'),
    atMs: r.atMs,
    cacheDir: cache.dir,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
}

export async function extract(url: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const outer = currentTimings();
  const tm = outer ?? new Timings(opts.quick ? 'extract --quick' : 'extract', url).start();
  const cache = opts.noCache ? null : (currentCache() ?? new ContentCache({ dir: opts.cacheDir, maxMb: opts.cacheMaxMb }));
  const r = await withTimings(tm, () =>
    withCache(cache, () =>
      withSharedBrowser(opts.browser ?? 'auto', opts.headless ?? true, () => extractRun(url, opts), { max: Math.max(1, opts.concurrency ?? 3) + 1 }),
    ),
  );
  if (cache) {
    const kept = await cache.prune().catch(() => null);
    r.cache = { ...cache.stats, dir: cache.dir, sizeBytes: kept?.bytes ?? null, capBytes: cache.maxBytes };
    tm.notes.push(
      `cache: ${cache.stats.hits} files served (${fmtMb(cache.stats.bytesServed)}), ${cache.stats.misses} fetched, ${cache.stats.reused.length + givenStages.length} stage(s) reused${givenStages.length ? ` (${givenStages.length} from --from)` : ''}; ${kept ? fmtMb(kept.bytes) : '?'} of ${fmtMb(cache.maxBytes)} in ${cache.dir}`,
    );
  } else tm.notes.push('cache: off (--no-cache)');
  if (!outer) {
    const doc = tm.stop();
    r.timings = doc;
    await writeFile(join(r.dir, 'timings.json'), `${JSON.stringify(doc, null, 2)}\n`).catch(() => {});
  }
  return r;
}

type Mark = (() => void) & { row?: StageTiming };
/** time a block that does not fit in one call: returns the function that ends it (`under` nests it) */
function mark(name: string, under?: Mark): Mark {
  const t = currentTimings();
  if (!t) return () => {};
  const { row, end } = t.begin(name, under?.row);
  return Object.assign(end, { row });
}

async function extractRun(url: string, opts: ExtractOptions): Promise<ExtractResult> {
  // Round 33: run.json's startedAt is the start of the run (it was stamped while writing, 149 ms before finishedAt)
  const runStartedAt = new Date().toISOString();
  givenStages.length = 0;
  const target = opts.to ?? 'react';
  const say = (s: string) => opts.onProgress?.(s);
  const texGrid = opts.ownAssetsGrid != null && Number.isFinite(opts.ownAssetsGrid) ? Math.max(2, Math.min(64, Math.round(opts.ownAssetsGrid))) : TEX_GRID;
  if (opts.ownAssetsGrid != null && !opts.ownAssets) say('--own-assets-grid does nothing without --own-assets: ignored');
  else if (opts.ownAssetsGrid != null && texGrid !== opts.ownAssetsGrid) say(`--own-assets-grid ${opts.ownAssetsGrid}: using ${texGrid} (2-64)`);
  if (opts.ownAssetsCost && !opts.ownAssets)
    say('--own-assets-cost does nothing without --own-assets (it scores what the --own-assets placeholders cost): ignored');
  setDragStep(false);
  // the run-time budget (--budget): once it is spent, the optional stages are skipped and the run says so
  const budgetSkip = (what: string): boolean => {
    if (!overBudget()) return false;
    say(`${what} skipped: the run-time budget is spent (--budget)`);
    return true;
  };
  const child = { browser: opts.browser, headless: opts.headless, runsRoot: opts.runsRoot, onProgress: opts.onProgress };

  // 0. the reference watch (the longest wait) starts at once, beside the decoders
  const quick = Boolean(opts.quick);
  const cache = currentCache();
  const vp0 = { width: 1440, height: 900 };
  let browser: Browser | null = null;
  let domMapInfo: PageMapInfo | null = null;
  if (!opts.noDiff || opts.ownAssets) browser = (await timed('browser launch', () => launchBrowser(opts.browser ?? 'auto', true))).browser;
  const refP = !opts.noDiff && browser ? timed('reference screenshot + capture', () => referenceFor(browser as Browser, url, vp0, opts, say)) : null;
  refP?.catch(() => {}); // awaited below; a failure is read there
  // the reference capture runs on its own unless --overlap: a heavy site's intro on a machine without a GPU slows to a
  // crawl when other pages render beside it, and the reference would catch the loading screen
  if (refP && !opts.overlap) await refP.catch(() => {});

  // 1. the decoders (or earlier runs, or the cache), side by side
  const dirOf = async (id?: string) => (id ? resolveRun(id) : null);
  const stage = async (name: string, fromId: string | undefined, run: () => Promise<string | null>): Promise<string | null> => {
    const given = await dirOf(fromId);
    if (given) {
      // Round 33: a stage handed in with --from is reused too (the cache line said "0 stage(s) reused")
      givenStages.push(`${name} (--from ${fromId})`);
      currentTimings()?.record(name, currentTimings()?.now() ?? 0, 0, `from --from ${fromId}`);
      return given;
    }
    const key = cacheKey('stage', STAGE_CACHE_VERSION, name, url, opts.browser ?? 'auto', opts.headless ?? true);
    const hit = cache ? await cache.meta<{ dir: string; made: string }>('stage', key) : null;
    if (hit && existsSync(hit.dir)) {
      currentTimings()?.record(name, currentTimings()?.now() ?? 0, 0, `from cache (made ${hit.made})`);
      cache?.stats.reused.push({ what: name, at: hit.made });
      say(`${name}: reusing the run from ${hit.made} (cache)`);
      return hit.dir;
    }
    // a heavy page can crash its renderer on a machine without a GPU: the stage gets one more go before the run gives up
    const dir = await timed(name, () =>
      run().catch((e) => {
        if (!/crashed|Target closed|has been closed|disposed/i.test(String(e))) throw e;
        say(
          `${name}: the page or its browser connection went away (${String(e).split('\n')[0].slice(0, 100)}), often a renderer crash on software WebGL; trying once more`,
        );
        return run();
      }),
    );
    if (dir && cache) await cache.put('stage', key, { dir, made: new Date().toISOString() }).catch(() => {});
    return dir;
  };
  const limit = pool(Math.max(1, opts.concurrency ?? 3));
  const [designDir0, motionDir, [assetsDir0, traceDir]] = await Promise.all([
    limit(() =>
      stage('design', opts.from?.design, async () => {
        say('decoding the design (tokens, fonts, first screen)');
        return (await decodeDesign(url, quick ? { ...child, scrollSteps: 2, scrollBudgetMs: 20_000 } : child)).dir;
      }),
    ),
    quick && !opts.from?.motion
      ? Promise.resolve(null)
      : limit(() =>
          stage('motion', opts.from?.motion, async () => {
            say('decoding the motion (GSAP, ScrollTrigger, CSS, recordings)');
            return (await decodeMotion(url, child)).dir;
          }).catch((e) => {
            say(`motion: skipped (${String(e).slice(0, 100)})`);
            return null;
          }),
        ),
    limit(async () => {
      const a = await stage('assets', opts.from?.assets, async () => {
        say('collecting the assets (textures, shader programs, models)');
        return (await decodeAssets(url, quick ? { ...child, scrollSteps: 6 } : child)).dir;
      });
      if ((opts.noTrace || quick) && !opts.from?.trace) return [a, null] as const;
      if (!opts.from?.trace && !(a && programsExist(a))) return [a, null] as const;
      const t = await stage('trace', opts.from?.trace, async () => {
        say('tracing the live WebGL calls (uniform values and what drives them)');
        return (await traceWebGL(url, { ...child, ms: 10_000 }).catch(() => null))?.dir ?? null;
      });
      return [a, t] as const;
    }),
  ]);
  if (!designDir0 || !assetsDir0) throw new Error('the design or assets decode did not finish');
  const designDir = designDir0;
  const assetsDir = assetsDir0;
  const trace = traceDir ? await readJson<TraceDoc>(join(traceDir, 'trace.json')) : null;
  const observed = observedFrom(trace);
  const design = await readJson<DesignDoc & { tokens: Record<string, Record<string, { $type: string; $value: unknown }>> }>(join(designDir, 'design.json'));
  const designRun = await readJson<{
    page?: { headings?: Array<{ level: number; text: string }>; title?: string };
    meta?: { title?: string; finalUrl?: string };
  }>(join(designDir, 'run.json'));
  const motion = motionDir ? await readJson<MotionDoc>(join(motionDir, 'motion.json')) : null;
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
  const threeVersion = threeRevision(design?.stack?.find((s) => /three/i.test(s.name))?.version);

  say('writing design tokens');
  let tree = motion?.gsap?.tree ?? [];
  if (opts.section) tree = filterTree(tree, opts.section);
  const tk = tokenFiles(design?.tokens ?? {}, { eases: easesOf(tree) });
  // web fonts: the files the page downloaded, served from /fonts with @font-face rules
  const manifest = await readJson<{
    network?: Array<{ kind: string; url: string; file: string | null; details?: { meshes?: Array<{ name: string; vertices: number | null }> } }>;
  }>(join(assetsDir, 'assets', 'manifest.json'));
  const fontFiles = (manifest?.network ?? []).filter((a) => a.kind === 'font' && a.file);
  const faces: string[] = [];
  // the site's own @font-face rules, one by one: weight, style and unicode-range as the site declared them (a font split into
  // latin / latin-ext / cyrillic files needs the ranges, or the last file declared wins for every glyph)
  const ruled = new Set<string>();
  const bare = (u: string) => u.split('?')[0].split('#')[0];
  for (const r of (design?.typography?.fontFaceRules ?? []) as Array<{
    family: string;
    weight: string;
    style: string;
    unicodeRange?: string;
    urls: string[];
  }>) {
    const f = fontFiles.find((ff) => r.urls.some((u) => bare(u) === bare(ff.url)));
    if (!f || !r.family) continue;
    const name = basename(bare(f.url));
    const fmt = /\.woff2$/i.test(name) ? 'woff2' : /\.woff$/i.test(name) ? 'woff' : /\.otf$/i.test(name) ? 'opentype' : 'truetype';
    for (const dir of ['public/fonts', 'fonts']) {
      await mkdir(join(out, dir), { recursive: true });
      await copyFile(join(assetsDir, f.file as string), join(out, dir, name)).catch(() => {});
    }
    if (!files.includes(`public/fonts/${name}`)) files.push(`public/fonts/${name}`);
    ruled.add(r.family.toLowerCase());
    faces.push(
      `@font-face {\n  font-family: "${r.family}";\n  src: url("/fonts/${name}") format("${fmt}");\n  font-weight: ${r.weight || '400'};\n  font-style: ${r.style || 'normal'};\n${r.unicodeRange ? `  unicode-range: ${r.unicodeRange};\n` : ''}  font-display: swap;\n}`,
    );
  }
  for (const fam of (design?.typography?.families ?? []) as Array<{ family: string; files?: string[] }>) {
    if (ruled.has(fam.family.toLowerCase())) continue;
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
        `@font-face {\n  font-family: "${fam.family}";\n  src: url("/fonts/${name}") format("${fmt}");\n  font-weight: ${weight};\n${/italic|oblique/i.test(name) ? '  font-style: italic;\n' : ''}  font-display: swap;\n}`,
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

  let diff: ExtractResult['diff'] = null;
  let replay: ReplayInfo | null = null;
  let replayError: string | null = null;
  /** set when the recording was over the cap and its read-only images were halved to fit */
  let replayFitNote: string | null = null;
  let probeReport: ProbeReport | null = null;
  let interaction: InteractionResult | null = null;
  let pageStops: PageStopsResult | null = null;
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
      for (const name of texNames.values())
        await copyFile(join(out, 'public', 'textures', name), join(out, 'textures', name))
          .then(() => {
            // Round 40: these previews are in the kit too (extract.json listed none of them)
            if (!files.includes(`textures/${name}`)) files.push(`textures/${name}`);
          })
          .catch(() => {});
    }

    // 4. visual diff + analysis + research loop
    if (!opts.noDiff && browser) {
      const vp = design?.layout?.viewport ? { width: design.layout.viewport.width, height: design.layout.viewport.height } : { width: 1440, height: 900 };
      say('taking the reference screenshot (after the intro, the frame with the most detail)');
      const ref = await (refP as Promise<RefShot>);
      const original = ref.png;
      await put('preview/original.png', Buffer.from(original.slice(original.indexOf(',') + 1), 'base64'));
      // the site's own frames, recorded right before that screenshot: the render graph, the replay, the 3D scene
      const recording = 'recording' in ref ? ref.recording : null;
      // the canvas as the recorded frame drew it: scored instead of the screenshot when the page paints something over it
      const canvasRef = recording?.canvasPng ?? null;
      if (canvasRef && !opts.ownAssets) await put('preview/canvas-original.png', Buffer.from(canvasRef.slice(canvasRef.indexOf(',') + 1), 'base64'));
      replayError = 'recordingError' in ref ? (ref.recordingError ?? null) : opts.reference ? 'a reference image was given, so nothing was recorded' : null;
      let recDoc: CaptureDoc | null = null;
      let scrollFit: ScrollTapeFit | null = null;
      let pageMap: ReturnType<typeof buildPageMap> | null = null;
      // a page with nothing to record in WebGL still gets its map: the sections it has, found by scrolling a fresh load
      if (!recording && !quick && !opts.reference) {
        const m = await timed('page map (DOM only)', () => domPageMap(browser as Browser, url, vp).catch(() => null));
        if (m) {
          await put('page-map.json', `${JSON.stringify(m, null, 2)}\n`);
          await put('page-map.md', pageMapMd(m));
          domMapInfo = {
            mechanism: m.mechanism,
            extent: m.extent,
            documentHeight: m.documentHeight,
            sections: m.sections.length,
            stops: m.stops.length,
            sceneChanges: 0,
            canvases: m.canvases.length,
          };
          say(`page map: ${m.stops.length} stops over ${m.extent} px of ${m.documentHeight} px, ${m.sections.length} sections`);
        }
      }
      let hasScene = false;
      let fullPage: FullPageResult | null = null;
      let rebuildDoc: { pipeline: import('../replay/rebuild.ts').PipelineDoc; stats: RebuildStats } | null = null;
      // Round 38: never-shipped rebuild variants for --own-assets-cost, and the shipped files to put back after scoring them
      type RbFiles = { pipeline: string; shaders: Record<string, string>; data: Uint8Array };
      let ownCostVariants: Array<{ what: string; build: () => RbFiles }> = [];
      if (recording) {
        say('recorded the WebGL frames behind that screenshot; building the render graph and the replay');
        const doneBuild = mark('build the replay, editable rebuild and scene');
        const c = compactCapture(recording.doc, new Uint8Array(recording.bin.buffer, recording.bin.byteOffset, recording.bin.byteLength));
        // a recording with a scroll tape carries the scenes down the whole page (the tape's own budget is 64 MB), so its default cap is larger
        const capMb = opts.maxCaptureMb ?? (recording.doc.scroll ? 128 : 64);
        // over the cap: shrink the largest read-only images until it fits, rather than losing the whole replay
        let fitNote: string | null = null;
        if (c.bin.length > capMb * 1e6) {
          const fit = fitCapture(c.doc, new Uint8Array(c.bin.buffer, c.bin.byteOffset, c.bin.byteLength), capMb * 1e6);
          if (fit?.scaled.length) {
            fitNote = `the recording was ${(c.bin.length / 1e6).toFixed(1)} MB, over the ${capMb} MB cap: ${fit.scaled.length} read-only image${fit.scaled.length === 1 ? '' : 's'} halved to fit (${fit.scaled.map((x) => `${x.from[0]}x${x.from[1]} -> ${x.to[0]}x${x.to[1]}`).join(', ')}; --max-capture-mb ${Math.ceil(c.bin.length / 1e6)} keeps them full size)`;
            say(`recording shrunk: ${fitNote}`);
            c.doc = fit.doc;
            c.bin = fit.bin;
            replayFitNote = fitNote;
          }
        }
        if (c.bin.length > capMb * 1e6) {
          replayError = `the recording is ${(c.bin.length / 1e6).toFixed(1)} MB after compaction, over the ${capMb} MB cap, and halving its read-only images did not bring it under (--max-capture-mb ${Math.ceil(c.bin.length / 1e6)} keeps it)`;
          say(`recording dropped: ${replayError}`);
        } else {
          recDoc = c.doc;
          const binU8 = new Uint8Array(c.bin.buffer, c.bin.byteOffset, c.bin.byteLength);
          // the scroll tape: frames recorded at scroll stops are kept apart from the rest and pointer-tape frames
          if (recDoc.scroll && recDoc.frames.length > recDoc.scroll.from) {
            const allFrames = recDoc.frames;
            recDoc.scrollFrames = allFrames.slice(recDoc.scroll.from);
            recDoc.frames = allFrames.slice(0, recDoc.scroll.from);
            scrollFit = fitScrollTape(recDoc, binU8, { stops: recDoc.scroll.stops });
            if (scrollFit) {
              pageMap = buildPageMap(url, scrollFit, { mechanism: recDoc.scroll.mechanism, stops: recDoc.scroll.stops as never });
              if (tapeMoved(scrollFit)) recDoc.scroll.fit = scrollFit;
              else {
                // nothing the recorder could see changed with the scroll: the frames are not kept
                delete recDoc.scrollFrames;
                pageMap.mechanism = 'none';
              }
            } else delete recDoc.scrollFrames;
            say(
              scrollFit
                ? `scroll tape (${recDoc.scroll.mechanism} scroll): ${recDoc.scroll.stops.length} stops, ${tapeMoved(scrollFit) ? `the picture's recorded state changed by up to ${Math.round(Math.max(...scrollFit.stops.map((x) => x.changed)) * 100)}% against the top; ${scrollFit.uploadBuffers} buffers re-uploaded (${scrollFit.uploadFull} in full at every stop)` : 'nothing the recorder saw changed with the scroll'}`
                : 'scroll tape: too few stops to fit',
            );
          }
          // the pointer tape: frames recorded while the pointer moved and settled are kept apart from the rest frames
          if (recDoc.tape && recDoc.frames.length > recDoc.tape.from) {
            const all = recDoc.frames;
            const drag = recDoc.tapeDrag && all.length > recDoc.tapeDrag.from ? recDoc.tapeDrag : null;
            recDoc.frames = all.slice(0, recDoc.tape.from);
            recDoc.tapeFrames = all.slice(recDoc.tape.from, drag ? drag.from : undefined);
            let tf = fitTape(recDoc, binU8, recDoc.tapeFrames, recDoc.tape.move);
            const follows = (t: typeof tf) => t.anchors.length + (t.uniforms?.length ?? 0) > 0;
            let how = 'hover';
            if (drag && !follows(tf)) {
              // nothing followed the hovering pointer: the site may draw only while the button is held (paint, fluid, drag to orbit)
              const dragFrames = all.slice(drag.from);
              const td = fitTape(recDoc, binU8, dragFrames, drag.move);
              if (follows(td)) {
                recDoc.tapeFrames = dragFrames;
                recDoc.tape = { from: recDoc.tape.from, move: drag.move, still: drag.still, drag: true };
                tf = td;
                how = 'drag (button held)';
              }
            }
            delete recDoc.tapeDrag;
            recDoc.tape.anchors = tf.anchors;
            recDoc.tape.uniforms = tf.uniforms ?? [];
            tapeDriven =
              tf.uniforms?.length || tf.anchors.length ? { drag: Boolean(recDoc.tape.drag), n: (tf.uniforms?.length ?? 0) + tf.anchors.length } : null;
            recDoc.tape.fit = { report: tf.report, path: tf.path };
            say(
              `pointer tape (${how}): ${recDoc.tapeFrames.length} frames; ${tf.anchors.length} uploads anchored to the pointer path (${tf.report.map((r) => `buffer ${r.buf}: ${r.reason}`).join('; ') || 'no CPU uploads'}); ${tf.uniforms?.length ?? 0} uniforms follow the live pointer${tf.uniforms?.length ? ` (${tf.uniforms.map((u) => `${u.n} ${u.kind}`).join(', ')})` : ''}`,
            );
          } else delete recDoc.tape;
          recDoc.animate = animateEntries(recDoc);
          recDoc.graph = buildGraph(recDoc, binU8);
          // live input: what the probe measured on the site, and what the uniforms' names suggest beyond it
          recDoc.viewport = { w: vp0.width, h: vp0.height };
          probeReport = 'probe' in ref && ref.probe ? fitInputs(ref.probe) : null;
          const measured = probeReport?.inputs ?? [];
          const FLOATS = new Set([0x1406, 0x8b50, 0x8b51, 0x8b52]);
          const named = recDoc.snap.programs.flatMap((P) =>
            P.uniforms.filter((u) => FLOATS.has(u.type)).map((u) => ({ program: P.id, name: u.name, value: Array.isArray(u.v) ? u.v : [u.v] })),
          );
          recDoc.inputs = [...measured, ...inferInputs(named, recDoc.canvas, measured)];
          if (recDoc.inputs.length) say(`live input: ${inputsSummary(recDoc.inputs)}`);
          // the live scroll is eased the way the site eased it before it picks a stop
          if (recDoc.scroll?.fit) {
            const ks = recDoc.inputs
              .filter((m) => m.kind === 'scroll' && m.source === 'measured' && m.k > 0 && m.k < 1)
              .map((m) => m.k)
              .sort((a, b) => a - b);
            if (ks.length) recDoc.scroll.fit.k = ks[Math.floor(ks.length / 2)];
          }
          const models = (manifest?.network ?? [])
            .filter((a) => a.kind === 'glb' || a.kind === 'gltf')
            .flatMap((m) => (m.details?.meshes ?? []).map((x) => ({ name: `${basename(m.url.split('?')[0])} › ${x.name}`, vertices: x.vertices })));
          const sc = recoverScene(recDoc, binU8, { models });
          // (a) the capture replay: the recorded calls played back (the ground truth DEA scores against). With
          // --own-assets it is scored and then removed: the kit carries no recorded bytes of the site's.
          await put('public/replay/capture.json', JSON.stringify(recDoc));
          await put('public/replay/capture.bin', c.bin);
          await put('replay/replay.js', REPLAY_PLAYER);
          await put('render-graph.md', renderGraphMd(recDoc.graph, recDoc, url));
          // (b) the editable rebuild: the same render graph as three.js objects you can change
          const sceneNodes = new Map(sc.meshes.map((m, i) => [`${m.frame}|${m.cmd}`, m.match ? `${m.match} (mesh ${i})` : `mesh ${i}`]));
          let placeholders: number | undefined;
          const lookupInfo = { lookups: 0 };
          let rbDoc = recDoc;
          let rbBin = binU8;
          if (opts.ownAssets) {
            rbDoc = structuredClone(recDoc);
            rbBin = new Uint8Array(binU8);
            placeholders = placeholderTextures(rbDoc, rbBin, lookupInfo, texGrid);
          }
          const rb = rebuildPipeline(rbDoc, rbBin, {
            data: opts.ownAssets ? 'data.bin' : '../replay/capture.bin',
            ownAssets: opts.ownAssets,
            sceneNodes,
            texGrid,
          });
          await put('public/rebuild/pipeline.json', JSON.stringify(compactFrames(rb.pipeline)));
          for (const [f, s2] of Object.entries(rb.shaders)) await put(`public/rebuild/${f}`, s2);
          if (opts.ownAssets) await put('public/rebuild/data.bin', Buffer.from(rbBin.buffer, rbBin.byteOffset, rbBin.byteLength));
          await put('rebuild/rebuild.js', REBUILD_RUNNER);
          rebuildDoc = { pipeline: rb.pipeline, stats: rb.stats };
          if (opts.ownAssets && opts.ownAssetsCost) {
            // built one at a time when scored (Round 40: up to 8 variants, each a full copy of the recording)
            const variant =
              (images: boolean, meshes: boolean, realMaterials?: number[], grid = texGrid) =>
              (): RbFiles => {
                const d = structuredClone(recDoc as CaptureDoc);
                const b = new Uint8Array(binU8);
                if (!images) placeholderTextures(d, b, { lookups: 0 }, grid);
                const v = rebuildPipeline(d, b, { data: 'data.bin', ownAssets: true, standIns: !meshes, realMaterials, sceneNodes, texGrid: grid });
                return { pipeline: JSON.stringify(compactFrames(v.pipeline)), shaders: v.shaders, data: b };
              };
            ownCostVariants = [
              { what: "the site's real images, stand-in meshes", build: variant(true, false) },
              { what: "image colour grids, the site's real meshes", build: variant(false, true) },
              // Round 40: which material's stand-ins cost the points: the site's meshes for one material at a time
              ...costMaterials(rb.stats.standIns ?? []).map((m) => ({
                what: `the site's meshes for material ${m.material} only (${m.program}, ${m.n} stand-in${m.n === 1 ? '' : 's'})`,
                build: variant(false, false, [m.material]),
              })),
              // Round 46: what finer colour grids would buy (stand-in meshes, grids only), so the --own-assets-grid choice has numbers
              ...costGrids(texGrid).map((g) => ({
                what: `image colour grids of ${g}x${g} (--own-assets-grid ${g}), stand-in meshes`,
                build: variant(false, false, undefined, g),
              })),
            ];
          }
          if (sc.meshes.length) {
            hasScene = true;
            await put('public/scene/scene.glb', sceneGlb(sc, { placeholders: Boolean(opts.ownAssets) }));
            await put('scene/scene.js', sceneModule());
            await put('scene/scene.md', sceneMd(sc, url));
          }
          replay = {
            frames: recDoc.frames.length,
            passes: recDoc.graph.passes.length,
            draws: recDoc.graph.passes.reduce((n, p) => n + p.drawCount, 0),
            programs: recDoc.graph.programs.filter((p) => p.draws).length,
            bytes: c.bin.length,
            canvas: null,
            page: null,
            kept: false,
            roles: [...new Set(recDoc.graph.passes.map((p) => p.role))],
            scene: sc.meshes.length ? { meshes: sc.meshes.length, camera: Boolean(sc.camera), canvas: null, page: null } : null,
            errors: recDoc.errors.slice(0, 10),
            placeholders,
            ...(opts.ownAssets ? { lookups: lookupInfo.lookups, texGrid } : {}),
            shipped: !opts.ownAssets,
            inputs: (recDoc.inputs ?? []).filter((m) => m.kind !== 'clock'),
            clocks: new Set((recDoc.animate ?? []).map((a) => `${a.frame}|${a.cmd}`)).size
              ? new Set(rb.pipeline.clocks.map((x) => `${x.program}|${x.uniform}`)).size || 1
              : 0,
            rebuild: { canvas: null, page: null, kept: false, stats: rb.stats, errors: [] },
            boot: bootInfo(recDoc.boot),
            ...(scrollFit && recDoc.scroll
              ? {
                  scrollTape: {
                    stops: scrollFit.stops.length,
                    at: scrollFit.stops.map((x) => x.sc),
                    mechanism: recDoc.scroll.fit ? recDoc.scroll.mechanism : ('none' as const),
                    changed: scrollFit.stops.map((x) => x.changed),
                    mode: recDoc.scroll.fit ? ('frames' as const) : ('none' as const),
                    frames: recDoc.scrollFrames?.length ?? 0,
                    bytes: scrollFit.bytes,
                    uploadBuffers: scrollFit.uploadBuffers,
                    uploadFull: scrollFit.uploadFull,
                  },
                  map: pageMap
                    ? {
                        mechanism: pageMap.mechanism,
                        extent: pageMap.extent,
                        documentHeight: pageMap.documentHeight,
                        sections: pageMap.sections.length,
                        stops: pageMap.stops.length,
                        sceneChanges: pageMap.sceneChanges,
                        canvases: pageMap.canvases.length,
                      }
                    : null,
                }
              : {}),
          };
          if (pageMap) {
            await put('page-map.json', `${JSON.stringify(pageMap, null, 2)}\n`);
            await put('page-map.md', pageMapMd(pageMap));
          }
          say(
            `replay: ${replay.passes} passes, ${replay.draws} draws, ${replay.programs} programs, ${(c.bin.length / 1e6).toFixed(1)} MB${sc.meshes.length ? `; scene: ${sc.meshes.length} meshes` : ''}; editable rebuild: ${rb.stats.draws} draws, ${rb.stats.materials} materials, ${rb.stats.cameras} cameras`,
          );
        }
        doneBuild();
      }
      // the first screen's text as laid out on the site (with your own screenshot, read on both of the site's paths)
      const layoutCandidates = (
        opts.reference
          ? await timed('read the text layout', () =>
              Promise.all([readLayout(browser, url, vp, opts.section ?? null, 8000, true), readLayout(browser, url, vp, opts.section ?? null, 8000, false)]),
            )
          : [ref.layout]
      )
        .filter((l): l is HeroLayout => Boolean(l?.boxes.length || l?.canvas || l?.background))
        // --own-assets: the site's logos and images on the first screen become placeholders of the same size
        .map((l) =>
          opts.ownAssets
            ? {
                ...l,
                graphics: (l.graphics ?? []).map((g) => ({ k: g.k, kind: 'placeholder' as const, x: g.x, y: g.y, w: g.w, h: g.h, opacity: g.opacity })),
                // a picture painted as a background is the site's own file too: a flat grey stands in
                shapes: (l.shapes ?? []).map((s) =>
                  /url\(/.test(s.gradient ?? '') ? { ...s, gradient: null, background: 'rgb(128, 128, 128)', bgSize: undefined } : s,
                ),
              }
            : l,
        );
      say('rendering the rebuild and comparing it with the original first screen');
      const doneScore = mark('render and score');
      let renders = 0;
      const server = await serveDir(out);
      const cmp = await browser.newPage();
      let lastPng = '';
      let renderError: string | undefined;
      let lastErr: string | undefined;
      let lastCmp: Similarity | null = null;
      const render = async (p: Params) => {
        renders++;
        const r = await renderPreview(browser, server.url, p, vp);
        renderError ??= r.error;
        lastErr = r.error;
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
          // the text is judged over the site's own picture when DEA recorded it (the capture replay), so a stand-in
          // canvas does not decide which text layout reads closest
          const judge: Params = recDoc && replay ? { program: '__replay' } : {};
          let pick: HeroLayout | null = null;
          let pickScore = await render({ ...params, ...judge });
          for (const l of layoutCandidates) {
            await put('preview/index.html', previewHtml(mods, threeVersion, heroHtml(l)));
            const sc = await render({ ...params, ...judge, background: rgbHex(l.background) ?? params.background });
            if (sc > pickScore) {
              pickScore = sc;
              pick = l;
            }
          }
          layout = pick;
          if (layout && 'layoutScroll' in ref && ref.layoutScroll) {
            layout = withScroll(layout, ref.layoutScroll);
            if (layout.scroll)
              say(
                `first screen: ${Object.keys(layout.scroll.items).length} element(s) move with scroll (keyframes at ${layout.scroll.positions.join(', ')} px)`,
              );
          }
          // the whole page, not only the first screen: every element read at a series of scroll stops (fresh load, settled).
          // When no first-screen reading beat the plain heading, the page read can still stand on its own: it starts from no
          // first-screen items and the page supplies all of them, kept only when the first screen is not worse than the heading
          if (!quick && !opts.noPage && !opts.reference && !opts.section && ref.loader) {
            // a page read behind a loading screen copies the loading screen at every stop: better no page layer than a wrong one
            say('the original is still behind its loading screen: not reading the page below it (the read would copy the loader at every stop)');
          }
          if (!quick && !opts.noPage && !opts.reference && !opts.section && !ref.loader && !budgetSkip('whole-page read')) {
            fullPage = await timed('read the whole page (scroll stops)', () =>
              readFullPage(browser as Browser, url, vp, { shots: true, onProgress: say, reference: ref.loader ? null : ref.png }).catch((e) => {
                say(`whole-page read failed: ${(e as Error).message.split('\n')[0]}`);
                return null;
              }),
            );
            if (fullPage && pageIsWorthKeeping(fullPage.layer)) {
              const standalone = !layout;
              const hero: HeroLayout = layout ?? { ...layoutCandidates[0], boxes: [], shapes: [], graphics: [] };
              const withPage: HeroLayout = { ...hero, page: opts.ownAssets ? ownAssetsPage(fullPage.layer) : fullPage.layer };
              if (standalone) {
                await put('preview/index.html', previewHtml(mods, threeVersion, heroHtml(withPage)));
                const sc = await render({ ...params, ...judge, background: rgbHex(withPage.background) ?? params.background });
                // the plain heading has nothing below the first screen, so a slightly lower first screen is still the better kit
                if (sc >= pickScore - 0.1) {
                  layout = withPage;
                  say(
                    `no first-screen reading beat the plain heading; the whole-page read is kept for what it adds below the first screen (first screen ${Math.round(sc * 100)}% vs ${Math.round(pickScore * 100)}% for the heading)`,
                  );
                } else {
                  say(
                    `the whole-page read (${Math.round(sc * 100)}% on the first screen) is more than 10 points under the plain heading (${Math.round(pickScore * 100)}%); leaving it out`,
                  );
                  fullPage = null;
                }
              } else layout = withPage;
            } else if (fullPage) {
              say('the page has no more than its first screen to scroll through; keeping the first-screen kit');
              fullPage = null;
            }
          }
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
        const canvasBox =
          (layout ?? layoutCandidates[0] ?? null)?.canvas ??
          (recDoc ? { x: recDoc.canvas.x, y: recDoc.canvas.y, w: recDoc.canvas.cssW, h: recDoc.canvas.cssH } : null);
        const canvasStart = await compareCanvas(cmp, original, lastPng, canvasBox, textBoxes, vp, canvasRef);
        if (canvasStart?.reference === 'canvas')
          say(
            'the reference screenshot does not show the canvas (a loading screen or an overlay is painted over it), so the canvas DEA copied at the recorded frame is what the replay and the rebuild are scored against',
          );
        let best = start;
        // the replay of the site's own frames, and the recovered 3D scene: kept when the canvas gets closer
        let replayKept = false;
        const doneRR = mark('score the replay and the rebuild', doneScore);
        if (recDoc && replay) {
          const sR = await render({ ...params, program: '__replay' });
          const cR = await compareCanvas(cmp, original, lastPng, canvasBox, textBoxes, vp, canvasRef);
          const replayPng = lastPng;
          replay.page = sR;
          replay.canvas = cR?.score ?? null;
          if (cR?.reference) replay.canvasRef = cR.reference;
          if (replay.scene && hasScene) {
            const sS = await render({ ...params, program: '__scene' });
            const cS = await compareCanvas(cmp, original, lastPng, canvasBox, textBoxes, vp, canvasRef);
            replay.scene.page = sS;
            replay.scene.canvas = cS?.score ?? null;
            await put('preview/scene.png', Buffer.from(lastPng.slice(lastPng.indexOf(',') + 1), 'base64'));
          }
          say(`(a) capture replay (the recorded frames played back): canvas ${cR ? pct(cR.score) : 'n/a'}, page ${pct(sR)}`);
          await put('preview/replay.png', Buffer.from(replayPng.slice(replayPng.indexOf(',') + 1), 'base64'));
          await put(
            'preview/side-by-side-replay.png',
            await sideBySide(cmp, original, replayPng, [
              `original (${url})`,
              `(a) capture replay, recorded frames played back: page ${pct(sR)}, canvas ${cR ? pct(cR.score) : 'n/a'}`,
            ]),
          );
          // (b) the editable rebuild, scored on its own
          let cB: CanvasScore | null = null;
          let sB = 0;
          if (replay.rebuild && rebuildDoc) {
            sB = await render({ ...params, program: '__rebuild' });
            cB = await compareCanvas(cmp, original, lastPng, canvasBox, textBoxes, vp, canvasRef);
            replay.rebuild.page = sB;
            replay.rebuild.canvas = cB?.score ?? null;
            replay.rebuild.errors = lastErr ? [lastErr] : [];
            const rebuildPng = lastPng;
            // Round 38: what each placeholder kind costs: score the never-shipped variants, then put the shipped files back
            if (ownCostVariants.length) {
              // each variant gets its own folder: the preview browser caches /public/rebuild/ by URL, so rewriting the shipped
              // folder in place scored the shipped files again (first try: real images "+0 points" on keyframes)
              const cost: Array<{ what: string; canvas: number | null; page: number; skipped?: string }> = [];
              const budget = ownCostBudget(opts.ownAssetsCostBudget);
              const costStart = Date.now();
              let slowest = 0;
              for (const [i, v0] of ownCostVariants.entries()) {
                const spent = Date.now() - costStart;
                if (!costFits(spent, slowest, budget)) {
                  cost.push({ what: v0.what, canvas: null, page: 0, skipped: `over the ${budget} s budget: --own-assets-cost-budget` });
                  continue;
                }
                const vStart = Date.now();
                const dir = `public/rebuild-cost-${i}`;
                const v = { what: v0.what, files: v0.build() };
                await put(`${dir}/pipeline.json`, v.files.pipeline);
                for (const [n, src] of Object.entries(v.files.shaders)) await put(`${dir}/${n}`, src);
                await put(`${dir}/data.bin`, Buffer.from(v.files.data.buffer, v.files.data.byteOffset, v.files.data.byteLength));
                const sv = await render({ ...params, program: '__rebuild', rebuildBase: `../${dir}/` });
                const cv = await compareCanvas(cmp, original, lastPng, canvasBox, textBoxes, vp, canvasRef);
                cost.push({ what: v.what, canvas: cv?.score ?? null, page: sv });
                slowest = Math.max(slowest, Date.now() - vStart);
                // never shipped: the kit keeps only the real --own-assets rebuild
                await rm(join(out, dir), { recursive: true, force: true }).catch(() => {});
                // and out of the kit's file list (Round 38 left 120 entries that were not on disk)
                for (let j = files.length - 1; j >= 0; j--) if (files[j].startsWith(`${dir}/`)) files.splice(j, 1);
              }
              replay.rebuild.ownCost = cost;
              const line = ownCostLine(cB?.score ?? null, cost);
              say(line);
              currentTimings()?.note(line);
              ownCostVariants = [];
            }
            // how close (b) comes to (a), pixel structure only: what the three.js translation itself loses
            const agree = await compareCanvas(cmp, replayPng, rebuildPng, canvasBox, textBoxes, vp);
            replay.rebuild.vsReplay = agree?.score ?? null;
            say(
              `(b) editable rebuild (three.js from the render graph): canvas ${cB ? pct(cB.score) : 'n/a'}, page ${pct(sB)}; against (a) itself: ${replay.rebuild.vsReplay != null ? pct(replay.rebuild.vsReplay) : 'n/a'}`,
            );
            // a rebuild that never ran scores like a bad one: say why, so a low number is not read as a bad translation
            if (lastErr) say(`(b) did not run, so its score says nothing about the rebuild: ${rebuildErrorText(lastErr)}`);
            await put('preview/rebuild.png', Buffer.from(rebuildPng.slice(rebuildPng.indexOf(',') + 1), 'base64'));
            await put(
              'preview/side-by-side-rebuild.png',
              await sideBySide(cmp, original, rebuildPng, [
                `original (${url})`,
                `(b) editable rebuild, three.js from the render graph: page ${pct(sB)}, canvas ${cB ? pct(cB.score) : 'n/a'}`,
              ]),
            );
            await put('rebuild.md', rebuildMd(rebuildDoc.pipeline, rebuildDoc.stats, { canvas: cB?.score ?? null, page: sB }, Boolean(opts.ownAssets)));
          }
          // the project runs the editable rebuild when it beats DEA's own start; the capture replay only when the rebuild
          // could not and the recorded bytes may ship
          const beats = (x: CanvasScore | null) => Boolean(x && (!canvasStart || x.score > canvasStart.score + 0.005));
          if (replay.rebuild && beats(cB)) {
            replayKept = true;
            replay.rebuild.kept = true;
            params = { ...params, program: '__rebuild' };
            best = sB;
            say(`keeping the editable rebuild: canvas ${pct((cB as CanvasScore).score)} (DEA's start: ${canvasStart ? pct(canvasStart.score) : 'n/a'})`);
          } else if (!opts.ownAssets && beats(cR)) {
            replayKept = true;
            replay.kept = true;
            params = { ...params, program: '__replay' };
            best = sR;
            say(`keeping the capture replay (the editable rebuild scored lower): canvas ${pct((cR as CanvasScore).score)}`);
          } else say(`neither the rebuild nor the replay beat the start on the canvas; keeping the shader rebuild`);
        }
        // analysis first: DEA's own facts as candidates (the screen's mean colour, other palette colours, each shader, opacity)
        doneRR();
        const doneSweep = mark('parameter sweep (+ stand-in search)', doneScore);
        const meanOriginal = (await compareImages(cmp, original, original)).meanA;
        const palette = Object.values(design?.tokens?.color ?? {}).map((v) => String((v as { $value?: string }).$value));
        const candidates: Array<[string, Array<string | number>]> = [
          ['background', [meanOriginal, ...palette]],
          ['program', ['', ...(passes.length ? ['__pipeline'] : []), ...mods.map((m) => m.name)]],
          ['opacity', [0.6, 0.3]],
          ['text', palette],
        ];
        let skipped = 0;
        for (const [k, vals] of quick ? [] : candidates.filter(([k]) => !replayKept || (k !== 'program' && k !== 'opacity'))) {
          // a knob whose first two values change nothing on screen (the background under an opaque full-screen canvas)
          // is not swept further
          let unseen = 0;
          for (const [vi, v] of vals.entries()) {
            if (params[k] === v) continue;
            const s = await render({ ...params, [k]: v });
            if (Math.abs(s - best) < 0.0003) unseen++;
            if (s > best + 0.002) {
              best = s;
              params = { ...params, [k]: v };
            }
            if (unseen >= 2 && unseen === vi + 1 - (vals.slice(0, vi + 1).includes(params[k] as never) ? 1 : 0)) {
              skipped += vals.length - vi - 1;
              break;
            }
          }
        }
        if (skipped) currentTimings()?.note(`sweep: ${skipped} renders skipped (knobs that changed nothing on screen)`);
        // a technique stand-in where the site runs a system DEA does not rebuild (a GPGPU particle simulation): try it,
        // keep it only when the diff improves
        if (!quick && !replayKept && techniques.some((t) => t.id === 'gpgpu' || t.id === 'points')) {
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
        doneSweep();
        const providers = opts.providers ?? providersFromEnv();
        const doneResearch = mark('research loop', doneScore);
        const research = await researchLoop({
          params,
          render,
          knobs,
          providers,
          rounds: quick ? 0 : (opts.rounds ?? 3),
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
        doneResearch();
        citations.push(...research.citations);
        params = research.params;
        const final = research.best;
        await render(params);
        if (replayKept) {
          const pf = projectFiles(target, {
            mods,
            title,
            site: url,
            threeVersion,
            hasMotion,
            heading,
            layout,
            replay: params.program === '__replay',
            rebuild: params.program === '__rebuild',
            bothViews: params.program === '__rebuild' && Boolean(replay) && !opts.ownAssets,
          });
          for (const f of Object.keys(pf)) await put(f, pf[f]);
        }
        if (standin) {
          const pf = projectFiles(target, { mods, title, site: url, threeVersion, hasMotion, heading, layout, standin });
          for (const f of Object.keys(pf)) await put(f, pf[f]);
        } else if (files.includes('standins/particles.js')) {
          await rm(join(out, 'standins'), { recursive: true, force: true });
          files.splice(files.indexOf('standins/particles.js'), 1);
        }
        const canvasFinal = await compareCanvas(cmp, original, lastPng, canvasBox, textBoxes, vp, canvasRef);
        await put('preview/final.png', Buffer.from(lastPng.slice(lastPng.indexOf(',') + 1), 'base64'));
        await put(
          'preview/side-by-side.png',
          await sideBySide(cmp, original, lastPng, [
            `original (${url})`,
            `${params.program === '__rebuild' ? '(b) editable rebuild' : params.program === '__replay' ? '(a) capture replay' : 'DEA rebuild'}: page ${pct(final)}, canvas ${canvasFinal ? pct(canvasFinal.score) : 'n/a'}`,
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
          ...(ref.flat ? { referenceFlat: true } : {}),
          ...(ref.env ? { referenceEnv: ref.env } : {}),
          canvas: { start: canvasStart, final: canvasFinal },
        };
        // per-stop score of the whole page: the kit scrolled to each stop the original was read at, against the original's screenshot there
        if (layout?.page && fullPage?.shots.length && !budgetSkip('per-stop page score')) {
          const doneP = mark('score the page at each scroll stop', doneScore);
          try {
            say(`scoring the kit at each of the ${fullPage.layer.stops.length} scroll stops`);
            const shipsCanvas = params.program === '__replay' || params.program === '__rebuild';
            const views = [...(shipsCanvas ? [] : ['']), ...(replay && recDoc ? ['__replay'] : []), ...(replay?.rebuild && rebuildDoc ? ['__rebuild'] : [])];
            pageStops = await scorePageStops(browser as Browser, server.url, views, fullPage.layer.stops, fullPage.shots, vp, cmp, params, compareImages);
            const labels = fullPage.layer.stops.map((s) => `${s.y}px`);
            // only stops the kit was scored at can stand in the sheet (a view that draws a canvas scores an even sample)
            const scoredAt = [...Array(fullPage.layer.stops.length).keys()].filter((i) =>
              Object.values(pageStops?.stops[i]?.scores ?? {}).some((x) => typeof x === 'number'),
            );
            const universe = scoredAt.length ? scoredAt : [...Array(fullPage.layer.stops.length).keys()];
            const n = universe.length;
            const worst = universe
              .map((i) => ({ i, v: Math.min(...Object.values(pageStops?.stops[i]?.scores ?? {}).filter((x): x is number => typeof x === 'number'), 1) }))
              .sort((a, b) => a.v - b.v)
              .slice(0, 2)
              .map((x) => x.i);
            // at most 8 columns: the first and last stops, the two the kit gets worst, and an even spread for the rest
            const cols =
              n <= 8
                ? universe
                : (() => {
                    const pick = new Set([universe[0] as number, universe[n - 1] as number, ...worst]);
                    for (const k of [...Array(8).keys()]) if (pick.size < 8) pick.add(universe[Math.round((k * (n - 1)) / 7)] as number);
                    return [...pick].sort((a, b) => a - b);
                  })();
            const rowsP = [
              { label: 'original', frames: fullPage.shots },
              ...views.map((v) => ({
                label: v === '__replay' ? 'replay' : v === '__rebuild' ? 'rebuild' : 'kit',
                frames: pageStops?.kitShots[v || 'kit'] ?? [],
              })),
            ];
            await put('preview/page-stops.jpg', await stopsSheet(cmp, rowsP, labels, cols));
            await put(
              'page-stops.json',
              `${JSON.stringify({ stops: pageStops.stops, mean: pageStops.mean, page: { stops: fullPage.layer.stops, extent: fullPage.layer.extent, documentHeight: fullPage.layer.documentHeight, counts: fullPage.layer.counts, limits: fullPage.layer.limits, mechanism: fullPage.layer.mechanism, ratio: fullPage.layer.ratio } }, null, 2)}\n`,
            );
            say(
              `page at each stop (similarity to the original, mean): ${Object.entries(pageStops.mean)
                .map(([k, v]) => `${k === 'kit' ? 'kit' : k.replace('__', '')} ${v != null ? pct(v) : 'n/a'}`)
                .join(', ')}`,
            );
          } catch (e) {
            say(`per-stop score failed: ${(e as Error).message.split('\n')[0]}`);
          } finally {
            doneP();
          }
        }
        // live interaction: the same scripted pointer and scroll on the kit (replay and rebuild, running live) as on the site
        if (!quick && replay && 'interaction' in ref && ref.interaction?.length && !budgetSkip('interaction check')) {
          const doneI = mark('interaction check (scripted pointer + scroll, site vs kit)', doneScore);
          try {
            say('interaction check: the same pointer and scroll script on the kit, running live');
            const siteFrames = ref.interaction;
            // the site's script had a drag step when its page listens for a press (one more frame than the base script)
            setDragStep(siteFrames.length > 4);
            const siteState = 'interactionState' in ref ? (ref.interactionState ?? null) : null;
            const rows: Array<{ label: string; frames: Buffer[] }> = [{ label: 'original', frames: siteFrames }];
            const { program: _p, ...rest } = params;
            const res: InteractionResult = {
              script: INTERACTION_SCRIPT.map((x) => ({ name: x.name, does: x.does })),
              replay: null,
              rebuild: null,
              inputs: [],
              unexplained: probeReport?.unexplained ?? [],
              phase: 'phase' in ref ? (ref.phase ?? null) : null,
            };
            for (const prog of ['__replay', '__rebuild'] as const) {
              if (prog === '__rebuild' && !replay.rebuild) continue;
              // is the live picture steady? 8 consecutive frames, held (the kit's default) and alternating (the old way)
              let steady = await kitSteadiness(browser, server.url, prog, vp).catch(() => null);
              let heldLast = false;
              if (prog === '__replay' && steady?.shaking && recDoc) {
                // the two recorded frames differ in more than uniforms (lusion.co places instances from simulation state):
                // play the last recorded frame alone and check again
                recDoc.hold = 'last';
                await put('public/replay/capture.json', JSON.stringify(recDoc));
                const again = await kitSteadiness(browser, server.url, prog, vp).catch(() => null);
                if (again && !again.shaking) {
                  steady = again;
                  heldLast = true;
                  say('the replay flipped between its two recorded frames even with held uniforms: it now plays the last recorded frame alone (steady)');
                } else {
                  recDoc.hold = undefined;
                  await put('public/replay/capture.json', JSON.stringify(recDoc));
                }
              }
              const alternating = await kitSteadiness(browser, server.url, prog, vp, { steady: false }).catch(() => null);
              const k = await kitInteraction(browser, server.url, prog, vp, rest);
              const steps = await scoreInteraction(cmp, siteFrames, k.frames);
              if (siteState) (res.stateDiff ??= {})[prog === '__replay' ? 'replay' : 'rebuild'] = diffStates(siteState, k.states);
              res[prog === '__replay' ? 'replay' : 'rebuild'] = {
                steps,
                response: meanResponse(steps),
                steady,
                alternating,
                ...(heldLast ? { heldLast } : {}),
                ...(k.error ? { error: k.error } : {}),
              };
              rows.push({ label: prog === '__replay' ? '(a) replay' : '(b) rebuild', frames: k.frames });
            }
            const siteSteps = (res.rebuild ?? res.replay)?.steps ?? null;
            res.inputs = classifyInputs(replay.inputs ?? [], probeReport, replay.clocks ?? 0, siteSteps, tapeDriven);
            await put('preview/interaction.jpg', await framesStrip(cmp, rows));
            if (siteState) res.siteState = siteState;
            await put('interaction.json', JSON.stringify(res, null, 2));
            interaction = res;
            const fmt = (x: { response: number | null } | null) => (x?.response != null ? pct(x.response) : 'n/a');
            say(`interaction (where the picture changed after each move, site vs kit): replay ${fmt(res.replay)}, rebuild ${fmt(res.rebuild)}`);
          } catch (e) {
            say(`interaction check failed: ${(e as Error).message.split('\n')[0]}`);
          } finally {
            doneI();
          }
        }
      } finally {
        doneScore();
        currentTimings()?.note(`${renders} preview renders`);
        await cmp.close();
        await server.close();
      }
    }
  } finally {
    await releaseBrowser(browser);
  }

  // with --own-assets the capture replay was only a yardstick: its recorded bytes leave the kit
  if (opts.ownAssets && replay) {
    await rm(join(out, 'public', 'replay'), { recursive: true, force: true });
    await rm(join(out, 'replay'), { recursive: true, force: true });
    for (let i = files.length - 1; i >= 0; i--) if (/^(public\/)?replay\//.test(files[i])) files.splice(i, 1);
  }

  // 5. techniques behind it, researched in free sources (cited; values and pointers only, no code copied)
  const providersT = opts.providers ?? providersFromEnv();
  if (techniques.length && providersT.length && !opts.noResearch && !quick && !budgetSkip('technique research')) {
    say(`researching ${techniques.length} technique(s) seen in the pipeline`);
    techniques = await timed('technique research', () => researchTechniques(techniques, providersT, { onStep: say }));
  }

  // 6. does the project build?
  let build: BuildCheck | null = null;
  if (opts.verifyBuild && !quick && !budgetSkip('build check')) {
    if (target === 'framer') build = { ok: true, skipped: 'Framer components build inside Framer', ms: 0, log: '' };
    else {
      say('checking the project builds (npm install, npm run build)');
      build = await timed('verify build (npm install + build)', () => verifyBuild(out));
      say(build.ok ? `npm run build passed in ${Math.round(build.ms / 1000)} s` : `npm run build failed (${build.step})`);
    }
  }

  // 7. README + extract.md + dea-kit.json
  const doneWrite = mark('write the kit and report');
  const extractedAt = new Date().toISOString();
  const gaps = extractGaps({
    url,
    mods,
    diff,
    build,
    hasMotion,
    trace,
    passes: passes.length,
    referenceLoader: diff?.referenceLoader ?? false,
    replay,
    replayError,
  });
  const mdBase = renderExtractMd({
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
    quick,
    reused: cache?.stats.reused ?? [],
    section: opts.section,
    hasMotion,
    techniques,
    build,
    gaps,
    extractedAt,
    replay,
    replayError,
  });
  const mdI = interaction ? `${mdBase.trimEnd()}\n\n${interactionMd(interaction)}\n` : mdBase;
  const md = (layout as HeroLayout | null)?.page
    ? `${mdI.trimEnd()}\n\n${pageStopsMd((layout as HeroLayout).page as NonNullable<HeroLayout['page']>, pageStops)}`
    : mdI;
  // the evidence ledger: the same facts as data (label, measurement, coverage, limits, next probe), for agents and for the MCP
  const layoutPage = (layout as HeroLayout | null)?.page ?? null;
  const ledger = await buildLedger({
    url,
    runId: w.id,
    quick,
    ownAssets: Boolean(opts.ownAssets),
    machine: `${platform()} · ${cpus().length} CPUs · ${Math.round(totalmem() / 1e9)} GB`,
    diff: diff
      ? { start: diff.start, final: diff.final, referenceLoader: diff.referenceLoader, referenceFlat: diff.referenceFlat, referenceAtMs: diff.referenceAtMs }
      : null,
    replay,
    interaction,
    phase: interaction?.phase
      ? {
          aligned: interaction.phase.aligned,
          refDiff: interaction.phase.refDiff,
          bestDiff: interaction.phase.bestDiff,
          waitedMs: interaction.phase.waitedMs,
          note: interaction.phase.note,
          stable: interaction.phase.settle.stable,
          timeDriven: interaction.phase.settle.timeDriven,
        }
      : null,
    pageStops: pageStops
      ? {
          views: pageStops.mean,
          stops: pageStops.stops,
          extent: layoutPage?.extent ?? 0,
          documentHeight: layoutPage?.documentHeight ?? 0,
          elements: layoutPage ? layoutPage.boxes.length + layoutPage.shapes.length + layoutPage.graphics.length : 0,
          counts: layoutPage?.counts ?? { static: 0, fixed: 0, moving: 0 },
          limits: layoutPage?.limits ?? [],
          mechanism: layoutPage?.mechanism ?? 'native',
        }
      : null,
    build,
    gaps,
    map: replay?.map ?? domMapInfo,
    boot: replay?.boot ?? null,
    hashFiles: files.filter((f) => !/\.(woff2?|ttf|otf|jpe?g|png|webp)$/i.test(f)).map((rel) => ({ rel, abs: join(out, rel) })),
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
    ownAssets: Boolean(opts.ownAssets),
    provenance: `Extracted from ${url} on ${extractedAt.slice(0, 10)} by DEA. Third-party code, shaders, fonts and assets belong to their owners.`,
  };
  await put('dea-kit.json', `${JSON.stringify(kit, null, 2)}\n`);
  await put('README.md', md);
  await put('evidence.json', `${JSON.stringify(ledger, null, 2)}\n`);
  await put('evidence.md', renderLedgerMd(ledger));
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
      // the two WebGL results scored on their own, for dea scoreboard: (a) the capture replay, (b) the editable rebuild
      replay: replay
        ? {
            canvas: replay.canvas,
            page: replay.page,
            kept: replay.kept,
            rebuild: replay.rebuild
              ? {
                  canvas: replay.rebuild.canvas,
                  page: replay.rebuild.page,
                  vsReplay: replay.rebuild.vsReplay ?? null,
                  kept: replay.rebuild.kept,
                  stats: replay.rebuild.stats,
                  ...(replay.rebuild.ownCost?.length ? { ownCost: replay.rebuild.ownCost } : {}),
                }
              : null,
          }
        : null,
      quick: Boolean(quick),
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
        startedAt: runStartedAt,
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
    ...(quick ? ['QUICK MODE (rough): 2 frames, no motion/trace/sweep/research/build check; run without --quick for the full result'] : []),
    ...(cache?.stats.reused.length
      ? [`reused from the cache: ${cache.stats.reused.map((r) => `${r.what} (${r.at})`).join(', ')} · --no-cache observes everything again`]
      : []),
    ...(givenStages.length ? [`handed in: ${givenStages.join(', ')}`] : []),
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
          `visual diff (${canvasLine(diff.canvas?.final)})${diff.canvas?.start && diff.canvas.final ? `, from ${pct(diff.canvas.start.score)} at the start` : ''}${!replay && diff.canvas?.final ? ` ${UNRECORDED_CANVAS_NOTE}` : ''}`,
        ]
      : []),
    ...(replay
      ? [
          `(a) capture replay, the recorded frames played back (ground truth, not editable): canvas ${replay.canvas != null ? pct(replay.canvas) : 'n/a'}, page ${replay.page != null ? pct(replay.page) : 'n/a'} · ${replay.passes} passes, ${replay.draws} draws, ${replay.programs} programs, ${(replay.bytes / 1e6).toFixed(1)} MB (render-graph.md)${replay.shipped ? '' : ', scored but not in the kit (--own-assets)'}`,
          replay.rebuild
            ? `(b) editable rebuild, three.js from the render graph (rebuild.md): canvas ${replay.rebuild.canvas != null ? pct(replay.rebuild.canvas) : 'n/a'}, page ${replay.rebuild.page != null ? pct(replay.rebuild.page) : 'n/a'}${replay.rebuild.vsReplay != null ? `, ${pct(replay.rebuild.vsReplay)} against (a)` : ''} · ${replay.rebuild.stats.materials} RawShaderMaterials, ${replay.rebuild.stats.cameras} cameras, ${replay.rebuild.stats.renderTargets} render targets; recorded bytes still used: ${(replay.rebuild.stats.recordedBufferBytes / 1e6).toFixed(1)} MB geometry, ${(replay.rebuild.stats.recordedTextureBytes / 1e6).toFixed(1)} MB textures${opts.ownAssets ? ` (--own-assets: images are coarse colour grids, ${standinSummary(replay.rebuild.stats)})` : ''}${replay.rebuild.kept ? ' · what the project runs' : ''}${replay.rebuild.errors.length ? ` · DID NOT RUN: ${rebuildErrorText(replay.rebuild.errors[0])}` : ''}`
            : '(b) editable rebuild: not made',
          ...(replay.rebuild?.ownCost?.length ? [ownCostLine(replay.rebuild.canvas ?? null, replay.rebuild.ownCost)] : []),
          ...(replay.scene
            ? [
                `scene: ${replay.scene.meshes} meshes + camera in public/scene/scene.glb${replay.scene.canvas != null ? ` (canvas ${pct(replay.scene.canvas)} with a plain material)` : ''}`,
              ]
            : []),
        ]
      : [`replay: not recorded${replayError ? ` (${replayError})` : ''}`]),
    ...(replayFitNote ? [`replay shrunk to fit: ${replayFitNote}`] : []),
    ...(interaction
      ? [
          `interaction (scripted pointer + scroll, where the picture changed, site vs kit): replay ${interaction.replay?.response != null ? pct(interaction.replay.response) : 'n/a'}, rebuild ${interaction.rebuild?.response != null ? pct(interaction.rebuild.response) : 'n/a'} (preview/interaction.jpg)`,
          `inputs: ${interaction.inputs.map((v) => `${v.input} ${v.status === 'verified' ? '✔ verified' : v.status === 'inferred' ? '≈ inferred' : v.status === 'frozen' ? '✖ frozen' : '– not used'}`).join(' · ')}`,
        ]
      : []),
    gaps.length ? `open gaps: ${gaps.length} (see "Gap → path to result" in the report)` : 'open gaps: none',
  ].join('\n');
  w.emit({ type: 'run.finished', runId: w.id, dir: w.dir, summary, at: new Date().toISOString() });
  doneWrite();
  return {
    runId: w.id,
    dir: w.dir,
    out,
    target,
    files,
    shaders: mods,
    diff,
    replay,
    build,
    gaps,
    techniques,
    extractMd: md,
    summary,
    quick,
    interaction,
    pageStops,
  };
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
  replay?: ReplayInfo | null;
  replayError?: string | null;
}): Gap[] {
  const gaps: Gap[] = [];
  const site = o.url;
  if (!o.replay && o.replayError && !/reference image/.test(o.replayError))
    gaps.push({
      area: 'extract',
      topic: "The site's WebGL frames were not recorded",
      known: ['✔ The shader modules hold the exact GLSL; the pipeline order is in pipeline.js.'],
      missing: o.replayError,
      next: [
        { why: 'give a slow intro more time before recording', command: `dea extract ${site} --reference-ms 180000` },
        { why: 'see whether the canvas draws continuously', command: `dea trace ${site} --ms 20000` },
      ],
    });
  if (o.replay?.kept)
    gaps.push({
      area: 'extract',
      topic: 'The replay is a recording, not the site’s logic',
      known: [
        `✔ ${o.replay.frames} frames, ${o.replay.passes} passes and ${o.replay.draws} draws replay call for call with the site's shaders, buffers and textures.`,
        '✔ Clock uniforms advance with real time (≈ named like time and growing between frames).',
      ],
      missing:
        'Values the site drives from the pointer, scroll or its own state replay as recorded; the drawing buffer keeps the recorded size; content that appears after the recorded moment is not in it.',
      approximation: {
        text: 'Drive values yourself with replay.setUniform(program, name, value); the drivers DEA traced are in the shader modules and the trace report.',
      },
      next: [
        { why: 'find what drives each uniform (clock, scroll, pointer)', command: `dea trace ${site} --ms 30000` },
        { why: 'record another moment (after scrolling to a section)', command: `dea extract ${site} --section <selector>` },
      ],
    });
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
        : o.diff.referenceFlat
          ? 'The reference looks like a loading screen: the kept frame is near-uniform (almost no detail), so the scores (and a replay that "matches" it) compare against that flat frame, not the site.'
          : o.passes > 1
            ? 'The preview draws one program at a time; the site composes many passes (simulation, scene, post-processing) and its own meshes, which a single full-screen program cannot match.'
            : 'Layout, meshes or images outside the shader are not rebuilt.',
      approximation:
        o.passes > 1
          ? { text: 'Run the passes in order with createPipeline(renderer) from pipeline.js and hook your scene into the scene passes.' }
          : undefined,
      next: [
        ...(o.referenceLoader || o.diff.referenceFlat
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
  if (rts.length && !o.replay?.kept)
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
  motion: string | null;
  assets: string;
  ownAssets: boolean;
  quick?: boolean;
  reused?: Array<{ what: string; at: string }>;
  section?: string;
  hasMotion: boolean;
  trace?: string | null;
  techniques?: Technique[];
  build?: BuildCheck | null;
  gaps?: Gap[];
  extractedAt?: string;
  replay?: ReplayInfo | null;
  replayError?: string | null;
}): string {
  const run = o.target === 'framer' ? 'Paste `DeaScene.tsx` into a new Code File in Framer.' : '```bash\nnpm install\nnpm run dev\n```';
  const L = [
    `# Extracted from ${o.url} (${o.target})`,
    '',
    ...(o.quick
      ? [
          '> **QUICK MODE: a rough result.** Two recorded frames, no motion decode, no live trace, no parameter sweep, no research, no build check. Run without `--quick` for the full extract and its scores.',
          '',
        ]
      : []),
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
  L.push('', "## The site's own frames: (a) capture replay and (b) editable rebuild", '');
  if (o.replay) {
    const r = o.replay;
    L.push(
      'Two different things, scored separately. **(a) Capture replay**: the recorded calls played back. It is the ground truth for the score, not code to build on. **(b) Editable rebuild**: the same render graph turned into a three.js project (materials, geometry, cameras, render targets, passes) that you can change; it still reads the recorded vertex and texture bytes where `rebuild.md` says so.',
      '',
      `| | canvas | page | in the kit |`,
      `|---|---|---|---|`,
      `| (a) capture replay | ${r.canvas != null ? pct(r.canvas) : 'n/a'} | ${r.page != null ? pct(r.page) : 'n/a'} | ${r.shipped ? "`replay/replay.js` + `public/replay/` (the site's bytes)" : 'no (--own-assets): scored, then removed'} |`,
      `| (b) editable rebuild${r.rebuild?.vsReplay != null ? ` (${pct(r.rebuild.vsReplay)} against (a))` : ''} | ${r.rebuild?.canvas != null ? pct(r.rebuild.canvas) : 'n/a'} | ${r.rebuild?.page != null ? pct(r.rebuild.page) : 'n/a'} | ${r.rebuild ? `\`rebuild/rebuild.js\` + \`public/rebuild/\`${r.rebuild.kept ? ' (what the project runs)' : ''}` : 'not made'} |`,
      '',
      ...(r.rebuild
        ? [
            `- ✔ (b) \`public/rebuild/pipeline.json\`: ${r.rebuild.stats.draws} draws in the site's order as ${r.rebuild.stats.materials} RawShaderMaterials (GLSL in \`public/rebuild/shaders/\`), ${r.rebuild.stats.cameras} camera(s), ${r.rebuild.stats.renderTargets} render targets, ${r.rebuild.stats.glSteps} raw WebGL step(s). three.js reproduces the site's matrices from the camera and model matrix on ${r.rebuild.stats.matricesExact} draw(s)${r.rebuild.stats.matricesOff.length ? `, not on ${r.rebuild.stats.matricesOff.length}` : ''}.`,
            `- recorded in (b): ${(r.rebuild.stats.recordedBufferBytes / 1e6).toFixed(1)} MB of vertex/index buffers and ${(r.rebuild.stats.recordedTextureBytes / 1e6).toFixed(1)} MB of texture pixels and simulation start state${o.ownAssets ? `; --own-assets: images are coarse colour grids and large meshes are stand-ins, ${standinSummary(r.rebuild.stats)}; their bytes are not in the kit` : " (the site's own bytes: for study and prototyping)"}. See \`rebuild.md\`.`,
            ...(r.rebuild.ownCost?.length ? [`- ${ownCostLine(r.rebuild.canvas ?? null, r.rebuild.ownCost)}`] : []),
          ]
        : []),
      '',
      `✔ DEA recorded ${r.frames} consecutive frames of the site's WebGL right before the reference screenshot: every call with its arguments, and every buffer, texture, shader program and render target as it was when the frames began (read back from the GPU). ${(r.bytes / 1e6).toFixed(1)} MB in \`public/replay/\`.`,
      '',
      `- ✔ \`replay/replay.js\` runs exactly those calls with the site's own GLSL, geometry and textures: ${r.passes} passes, ${r.draws} draws, ${r.programs} programs. Passes seen (≈ roles read from the facts): ${r.roles.join(', ')}.`,
      `- ✔ \`render-graph.md\`: every pass in order, its target, programs, draws, the textures it reads, blend and depth.`,
      `- ≈ Clock uniforms (a value named like time that grew between the frames) advance with real time; everything else replays as recorded, frame after frame. \`replay.setUniform(program, name, value)\` overrides a value, \`replay.setPassEnabled(i, false)\` switches a pass off.`,
      r.canvas != null
        ? `- (a) alone: canvas ${pct(r.canvas)}, page ${pct(r.page ?? 0)}. ${r.kept ? '✔ The project runs it (the editable rebuild scored lower).' : 'The project does not run it: it is the reference.'}`
        : '- The replay was not scored.',
      ...(r.canvasRef === 'canvas'
        ? [
            '- ✔ The reference screenshot does not show the canvas (a loading screen or an overlay is painted over it), so (a) and (b) are scored against the canvas DEA copied at the recorded frame: `preview/canvas-original.png`.',
          ]
        : []),
      ...(r.scene
        ? [
            `- ✔ \`public/scene/scene.glb\` + \`scene/scene.js\`: ${r.scene.meshes} mesh(es) read back from the GPU buffers with their model matrices${r.scene.camera ? ' and the camera (from the view and projection uniforms)' : ''}; see \`scene/scene.md\`.${r.scene.canvas != null ? ` Rendered with a plain material it scores canvas ${pct(r.scene.canvas)}: the placement is the site's, the look is in the replay.` : ''}`,
          ]
        : ['- No mesh draws in the recorded frame (full-screen passes and points only), so no scene.glb.']),
      ...(o.ownAssets && r.placeholders != null
        ? [
            `- ≈ --own-assets: ${r.placeholders} uploaded texture(s) in the replay are an ${r.texGrid ?? TEX_GRID}×${r.texGrid ?? TEX_GRID} grid of their own average colours at the same size (tones, no detail)${r.lookups ? `; ${r.lookups} lookup table(s) (colour LUTs, ramps, tiny data textures: the site's code tables, not artwork) are kept as recorded` : ''}; render targets and geometry are the frames' own.`,
          ]
        : []),
      ...(r.errors.length ? [`- Recording notes: ${r.errors.slice(0, 5).join('; ')}`] : []),
    );
  } else
    L.push(`Not recorded${o.replayError ? `: ${o.replayError}` : ''}. Without a recording the rebuild uses the shader modules and the pipeline order above.`);
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
    // Round 28: said whatever the score (a high score against a loader is the misleading case: --no-replay on
    // jehaduddin.vercel.app scored 95% against its "28" preloader and extract.md said nothing)
    if (o.diff.referenceLoader || o.diff.referenceFlat)
      L.push(
        `- ⚠ The reference${o.diff.referenceAtMs != null ? ` (taken at ${Math.round(o.diff.referenceAtMs / 1000)} s)` : ''} ${o.diff.referenceLoader ? 'still shows a loading screen' : 'is near-uniform (likely a loading screen)'}: every score here is against that frame, not the site. Try \`--reference-ms 180000\` or \`--reference hero.png\`.`,
      );
    {
      const env = envLine(o.diff.referenceEnv);
      if (env) L.push(`- Page environment: ${env}.`);
    }
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
    `- motion run: ${o.motion ? basename(o.motion) : 'skipped (quick mode)'}`,
    ...(o.reused?.length ? [`- reused from the cache (not observed again in this run): ${o.reused.map((r) => `${r.what} (${r.at})`).join(', ')}`] : []),
    `- assets run: ${basename(o.assets)}`,
    ...(o.trace ? [`- live trace run: ${basename(o.trace)}`] : []),
    '',
  );
  return `${L.join('\n')}\n`;
}
