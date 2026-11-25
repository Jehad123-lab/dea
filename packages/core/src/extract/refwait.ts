/**
 * When the reference watch may stop, and which frame it keeps. Pure (no browser), so the rules are unit-tested.
 *
 * Round 25: igloo.inc's loader is a flat grey screen with no percentage. Past the hard cap only a rising counter bought more
 * time, so quick mode settled on the grey frame (canvas edges 0%, the replay "matched" it 100% by replaying grey). A flat
 * best frame now buys a bounded extra wait while the picture still changes, and never beats a detailed frame.
 */

export interface FrameStats {
  /** luminance standard deviation (0..~128) on the 96×60 thumbnail */
  sd: number;
  /** share of thumbnail pixels on an edge (neighbour luminance step above EDGE_STEP) */
  edges: number;
  /** mean luminance (0..255) */
  mean: number;
}

export const THUMB_W = 96;
export const THUMB_H = 60;
const EDGE_STEP = 24;
/** below both: near-uniform (a loading screen, a blank canvas, a solid fill) */
export const FLAT_SD = 8;
export const FLAT_EDGES = 0.01;
/** extra wait a flat best frame may buy past the hard cap */
export const FLAT_EXTRA_QUICK_MS = 30_000;
export const FLAT_EXTRA_FULL_MS = 60_000;
/** a flat picture that has not changed for this long, with no loader on screen, is not going anywhere. Round 26: 10 s gave up
 * on jehaduddin.vercel.app, whose black loader holds its counter at 63 for longer than that on a fresh capture */
export const FLAT_STILL_MS = 20_000;
/** Round 28: in quick mode a loader whose own counter keeps rising may hold the watch up to this long (jehaduddin.vercel.app's
 * counter crawls 63 -> 64 on software WebGL; the owner reached the real site only with --reference-ms 180000) */
export const QUICK_LOADER_CAP_MS = 180_000;
/** a loader counter that has not gone up for this long is stuck */
export const PCT_STALL_MS = 60_000;

/** Stats of a luminance thumbnail (row-major, `w`×`h`, values 0..255). */
export function frameStats(lum: ArrayLike<number>, w = THUMB_W, h = THUMB_H): FrameStats {
  const n = w * h;
  if (!n || lum.length < n) return { sd: 0, edges: 0, mean: 0 };
  let s = 0;
  let s2 = 0;
  let e = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = lum[i];
      s += l;
      s2 += l * l;
      const dx = x + 1 < w ? Math.abs(lum[i + 1] - l) : 0;
      const dy = y + 1 < h ? Math.abs(lum[i + w] - l) : 0;
      if (dx + dy > EDGE_STEP) e++;
    }
  const mean = s / n;
  return { sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), edges: e / n, mean };
}

export function isFlat(s: FrameStats | null | undefined): boolean {
  return !s || (s.sd < FLAT_SD && s.edges < FLAT_EDGES);
}

/** did the picture change between two reads (enough to say the page is still working)? */
export function frameChanged(a: FrameStats | null, b: FrameStats | null): boolean {
  if (!a || !b) return true;
  return Math.abs(a.sd - b.sd) > 0.5 || Math.abs(a.edges - b.edges) > 0.003 || Math.abs(a.mean - b.mean) > 1;
}

/** keep `cand` over `best`? A near-uniform frame never replaces a detailed one; a detailed one always replaces a flat one. */
export function betterFrame(cand: { score: number; flat: boolean }, best: { score: number; flat: boolean } | null): boolean {
  if (!best || best.score < 0) return true;
  if (cand.flat !== best.flat) return !cand.flat;
  return cand.score > best.score;
}

export interface WatchState {
  /** ms since the watch started */
  elapsed: number;
  /** the base watch length */
  ms: number;
  hardCap: number;
  longCap: number;
  /** a loader overlay is visible now */
  loader: boolean;
  /** ms since the loader's percentage counter last rose */
  pctAge: number;
  /** the best frame so far is near-uniform */
  bestFlat: boolean;
  /** ms since the picture last changed */
  changedAge: number;
  /** quick mode (1 recorded frame) */
  quick: boolean;
}

/** keep watching for a better reference frame? */
export function keepWatching(s: WatchState): boolean {
  if (s.elapsed < s.ms) return true;
  if (s.loader && (s.elapsed < s.hardCap || (s.pctAge < PCT_STALL_MS && s.elapsed < s.longCap))) return true;
  // Round 30: a visible loader over a flat kept frame holds the watch to the long cap even when its counter pauses (a --no-replay
  // run on jehaduddin.vercel.app stopped at 96 s on the flat loader; the next one reached the hero at 163 s)
  if (s.loader && s.bestFlat && s.elapsed < s.longCap) return true;
  // a flat best frame (a loader without a counter, a canvas not drawn yet) buys a bounded extra wait while frames still change
  const extra = s.quick ? FLAT_EXTRA_QUICK_MS : FLAT_EXTRA_FULL_MS;
  // a visible loader is still working even when its picture holds still (a stuck counter), so only stillness without one stops
  return s.bestFlat && (s.loader || s.changedAge < FLAT_STILL_MS) && s.elapsed < Math.max(s.ms, s.hardCap) + extra;
}

/** Round 29: a failed look through the loader is tried again after this long (at most PEEL_MAX times) */
export const PEEL_RETRY_MS = 30_000;
export const PEEL_MAX = 4;

/**
 * Look through the loader now? Round 29: only while the kept frame and this frame are both flat, and either the picture has sat
 * still for FLAT_STILL_MS or the watch has passed its hard cap (a counter that keeps crawling changes the picture, so stillness
 * alone never fired on jehaduddin.vercel.app). Not gated on the loader check, which can miss a loader.
 */
export function shouldPeel(s: {
  bestFlat: boolean;
  flat: boolean;
  changedAge: number;
  elapsed: number;
  hardCap: number;
  sincePeel: number;
  peels: number;
}): boolean {
  if (!s.bestFlat || !s.flat || s.peels >= PEEL_MAX || s.sincePeel < PEEL_RETRY_MS) return false;
  return s.changedAge >= FLAT_STILL_MS || s.elapsed >= s.hardCap;
}

/** Round 30: after a loading screen, how long the watch waits for the WebGL scene to mount and draw (quick / full) */
export const POST_LOADER_GL_QUICK_MS = 60_000;
export const POST_LOADER_GL_FULL_MS = 120_000;

/**
 * How long to wait for WebGL after the watch, in ms (0: no wait). Round 30: jehaduddin.vercel.app's loader finished at 162 s on
 * software WebGL and the watch ended one poll later, while the hero was still a poster <img> and R3F had not mounted, so nothing
 * was recorded ("no WebGL canvas drew a frame"). Only a page that showed a loader waits, and only while no WebGL canvas is drawing.
 */
export function postLoaderGlWait(s: { loaderSeen: boolean; bestFlat: boolean; glOnScreen: boolean; quick: boolean }): number {
  if (!s.loaderSeen || s.bestFlat || s.glOnScreen) return 0;
  return s.quick ? POST_LOADER_GL_QUICK_MS : POST_LOADER_GL_FULL_MS;
}
