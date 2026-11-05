import type { Page } from 'playwright';
import { type SettleResult, settleScene, thumbDiff, thumbOf } from './settle.ts';

/**
 * Bring a freshly loaded page to the phase a reference picture was taken in. A scene driven by time (an intro, a loop, a
 * timeline) is at a different point on every load; a number measured from "the page after N seconds" then changes from run
 * to run. Here the wait ends when the page is stable AND looks like the reference (a small grey thumbnail within a tolerance);
 * a page that never gets there says so, and the caller labels what it measured as measured from another phase.
 */
export interface PhaseResult {
  settle: SettleResult;
  /** mean absolute difference (0..255) between the page and the reference when the wait ended; null when no reference was given */
  refDiff: number | null;
  /** the best (smallest) difference seen while waiting */
  bestDiff: number | null;
  /** true: the page matched the reference phase; false: it did not within the cap; null: no reference to match */
  aligned: boolean | null;
  /** how long the whole wait took (ms) */
  waitedMs: number;
  /** thumbnails read after the page settled while waiting for the phase */
  reads: number;
  /** one plain sentence for the report */
  note: string;
}

/** thumbnails under this mean absolute difference (0..255) are the same picture for this purpose */
export const ALIGN_THRESHOLD = 6;

/** a PhaseResult without the thumbnail, for the report and the cache */
export type PhaseInfo = Omit<PhaseResult, 'settle'> & { settle: Omit<SettleResult, 'thumb'> };
export const phaseInfo = (r: PhaseResult): PhaseInfo => {
  const { thumb: _t, ...settle } = r.settle;
  return { ...r, settle };
};

export async function alignToReference(
  page: Page,
  reference: Uint8Array | null,
  o: { capMs?: number; threshold?: number; everyMs?: number } = {},
): Promise<PhaseResult> {
  const cap = o.capMs ?? 90_000;
  const thr = o.threshold ?? ALIGN_THRESHOLD;
  const every = o.everyMs ?? 1200;
  const t0 = Date.now();
  const settle = await settleScene(page, { capMs: Math.min(cap, 60_000) });
  if (!reference)
    return {
      settle,
      refDiff: null,
      bestDiff: null,
      aligned: null,
      waitedMs: Date.now() - t0,
      reads: 0,
      note: `${settle.stable ? 'settled' : settle.timeDriven ? 'kept moving (time-driven)' : 'still changing'} after ${Math.round(settle.ms / 1000)} s; no reference picture to match the phase against`,
    };
  let diff = thumbDiff(settle.thumb, reference);
  let best = diff;
  let reads = 0;
  // sampling continues while the picture is not the reference's: a scene on a timeline passes through the reference's phase, a still one never will
  while (diff > thr && Date.now() - t0 < cap) {
    await page.waitForTimeout(every).catch(() => {});
    const th = await thumbOf(page);
    reads++;
    diff = thumbDiff(th, reference);
    if (diff < best) best = diff;
  }
  const aligned = diff <= thr;
  const secs = Math.round((Date.now() - t0) / 1000);
  return {
    settle,
    refDiff: Math.round(diff * 10) / 10,
    bestDiff: Math.round(best * 10) / 10,
    aligned,
    waitedMs: Date.now() - t0,
    reads,
    note: aligned
      ? `the page matched the reference picture after ${secs} s (difference ${Math.round(diff * 10) / 10} of 255, ${settle.stable ? 'stable' : 'time-driven, caught in phase'})`
      : `the page never matched the reference picture within ${secs} s (closest ${Math.round(best * 10) / 10} of 255): what was measured next was measured from another phase of the site`,
  };
}
