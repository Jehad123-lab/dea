import type { Page } from 'playwright';
import { NAME_SHIM } from './init.ts';

/**
 * "Is the scene stable?" in place of a fixed wait. A page is stable when nothing is loading, the DOM has stopped changing
 * and the picture (a small grey thumbnail of the window) no longer moves between reads. A scene that never settles inside
 * the cap (an intro that loops, a clock-driven scene) is reported as such, with how much the picture still moved, so
 * the caller can say "time-driven" instead of treating the last frame as the rest state.
 */
export interface SettleOptions {
  /** longest wait (ms); default 45 000 */
  capMs?: number;
  /** shortest wait before stable can be declared (ms); default 1 200 */
  minMs?: number;
  /** gap between thumbnail reads (ms); default 700 */
  everyMs?: number;
  /** consecutive quiet reads needed; default 3 */
  quietReads?: number;
  /** mean absolute difference (0..255) under which two thumbnails are the same picture; default 0.8 */
  threshold?: number;
}

export interface SettleResult {
  /** true when the picture, the DOM and the network were quiet for `quietReads` reads in a row */
  stable: boolean;
  /** time spent (ms) */
  ms: number;
  /** thumbnail reads taken */
  reads: number;
  /** the last difference between two reads (0..255) */
  lastDiff: number;
  /** the mean of the differences over the last 4 reads (0..255): how much a scene that never settled still moves */
  recentDiff: number;
  /** a scene that kept moving to the cap while the network and DOM were quiet: driven by time, not by loading */
  timeDriven: boolean;
  /** requests still in flight when the wait ended */
  inFlight: number;
  /** the thumbnail of the last read (64 × 40 grey) */
  thumb: Uint8Array | null;
  reason: 'stable' | 'cap' | 'closed';
}

export const THUMB_W = 64;
export const THUMB_H = 40;

/** A 64 × 40 grey thumbnail of what the window shows now (a JPEG screenshot decoded in the page). */
export async function thumbOf(page: Page): Promise<Uint8Array | null> {
  const buf = await page.screenshot({ type: 'jpeg', quality: 40 }).catch(() => null);
  if (!buf) return null;
  return thumbOfImage(page, `data:image/jpeg;base64,${buf.toString('base64')}`);
}

/** The same thumbnail of any image given as a data URL (a reference screenshot), decoded in the given page. */
export async function thumbOfImage(page: Page, src: string): Promise<Uint8Array | null> {
  await page.evaluate(NAME_SHIM).catch(() => {});
  const arr = await page
    .evaluate(
      async ([s, w, h]) => {
        const im = new Image();
        await new Promise<void>((r) => {
          im.onload = () => r();
          im.onerror = () => r();
          im.src = s as string;
        });
        if (!im.width) return null;
        const c = document.createElement('canvas');
        c.width = w as number;
        c.height = h as number;
        const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        x.drawImage(im, 0, 0, w as number, h as number);
        const d = x.getImageData(0, 0, w as number, h as number).data;
        const out: number[] = [];
        for (let i = 0; i < d.length; i += 4) out.push(Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]));
        return out;
      },
      [src, THUMB_W, THUMB_H] as const,
    )
    .catch(() => null);
  return arr ? Uint8Array.from(arr) : null;
}

/** Mean absolute difference between two thumbnails (0..255); 255 when they cannot be compared. */
export function thumbDiff(a: Uint8Array | null, b: Uint8Array | null): number {
  if (!a || !b || a.length !== b.length || !a.length) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs((a[i] as number) - (b[i] as number));
  return s / a.length;
}

/** Counts requests in flight on a page (until the returned function is called). */
export function watchNetwork(page: Page): { inFlight: () => number; stop: () => void } {
  const open = new Set<unknown>();
  const on = (r: unknown) => open.add(r);
  const off = (r: unknown) => open.delete(r);
  page.on('request', on);
  page.on('requestfinished', off);
  page.on('requestfailed', off);
  return {
    // a long-lived stream (event source, websocket upgrade, a video that keeps buffering) must not hold the page "loading" forever
    inFlight: () => open.size,
    stop: () => {
      page.off('request', on);
      page.off('requestfinished', off);
      page.off('requestfailed', off);
    },
  };
}

const MUTATION_PROBE = `(() => {
  if (window.__deaMut) return window.__deaMut.n;
  const m = { n: 0 };
  window.__deaMut = m;
  try { new MutationObserver((l) => { m.n += l.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (e) {}
  return 0;
})()`;

/** Wait until the scene is stable (see SettleOptions), or the cap. */
export async function settleScene(page: Page, o: SettleOptions = {}): Promise<SettleResult> {
  const cap = o.capMs ?? 45_000;
  const min = o.minMs ?? 1200;
  const every = o.everyMs ?? 700;
  const need = o.quietReads ?? 3;
  const thr = o.threshold ?? 0.8;
  const t0 = Date.now();
  const net = watchNetwork(page);
  let prev: Uint8Array | null = null;
  let quiet = 0;
  let reads = 0;
  let lastDiff = 255;
  const recent: number[] = [];
  let mut = (await page.evaluate(MUTATION_PROBE).catch(() => -1)) as number;
  let netQuietAt = Date.now();
  let domQuietAt = Date.now();
  let result: SettleResult | null = null;
  try {
    for (;;) {
      if (page.isClosed()) {
        result = {
          stable: false,
          ms: Date.now() - t0,
          reads,
          lastDiff,
          recentDiff: 255,
          timeDriven: false,
          inFlight: net.inFlight(),
          thumb: prev,
          reason: 'closed',
        };
        break;
      }
      await page.waitForTimeout(every).catch(() => {});
      const th = await thumbOf(page);
      reads++;
      const d = prev && th ? thumbDiff(prev, th) : 255;
      prev = th ?? prev;
      lastDiff = d;
      recent.push(d);
      if (recent.length > 4) recent.shift();
      const nowMut = (await page.evaluate('window.__deaMut ? window.__deaMut.n : -1').catch(() => -1)) as number;
      const domMoved = nowMut >= 0 && mut >= 0 && nowMut - mut > 6;
      mut = nowMut;
      if (domMoved) domQuietAt = Date.now();
      if (net.inFlight() > 0) netQuietAt = Date.now();
      const elapsed = Date.now() - t0;
      const pictureQuiet = d <= thr;
      const settled = pictureQuiet && !domMoved && net.inFlight() === 0;
      quiet = settled ? quiet + 1 : 0;
      if (elapsed >= min && quiet >= need) {
        result = {
          stable: true,
          ms: elapsed,
          reads,
          lastDiff: d,
          recentDiff: recent.reduce((a, b) => a + b, 0) / recent.length,
          timeDriven: false,
          inFlight: 0,
          thumb: prev,
          reason: 'stable',
        };
        break;
      }
      if (elapsed >= cap) {
        const recentDiff = recent.reduce((a, b) => a + b, 0) / recent.length;
        // the network and the DOM had been quiet for a while, yet the picture still moved: it is driven by time
        const quietFor = Math.min(Date.now() - netQuietAt, Date.now() - domQuietAt);
        result = {
          stable: false,
          ms: elapsed,
          reads,
          lastDiff: d,
          recentDiff,
          timeDriven: recentDiff > thr && quietFor >= Math.min(8000, cap / 3),
          inFlight: net.inFlight(),
          thumb: prev,
          reason: 'cap',
        };
        break;
      }
    }
  } finally {
    net.stop();
  }
  return result as SettleResult;
}
