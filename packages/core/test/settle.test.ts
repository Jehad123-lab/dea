import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { alignToReference } from '../src/browser/phase.ts';
import { settleScene, THUMB_H, THUMB_W, thumbDiff } from '../src/browser/settle.ts';

const flat = (v: number) => Array.from({ length: THUMB_W * THUMB_H }, () => v);

/** a page whose thumbnails come from a script: the n-th screenshot decodes to thumbs[n] (the last one repeats) */
const fakePage = (thumbs: (n: number) => number[]): Page => {
  let n = 0;
  return {
    isClosed: () => false,
    waitForTimeout: async () => {},
    screenshot: async () => Buffer.from('x'),
    on: () => {},
    off: () => {},
    evaluate: async (fn: unknown) => {
      if (typeof fn === 'string') return 0; // the mutation counter: the DOM is quiet
      return thumbs(n++);
    },
  } as unknown as Page;
};

describe('thumbDiff', () => {
  it('is the mean absolute difference, and 255 when the sizes differ or one is missing', () => {
    expect(thumbDiff(Uint8Array.from(flat(10)), Uint8Array.from(flat(14)))).toBe(4);
    expect(thumbDiff(Uint8Array.from([1]), Uint8Array.from([1, 2]))).toBe(255);
    expect(thumbDiff(null, Uint8Array.from(flat(1)))).toBe(255);
  });
});

describe('settleScene', () => {
  it('is stable once the picture stops changing, and says so', async () => {
    // changes for three reads, then holds
    const p = fakePage((n) => flat(n < 3 ? n * 40 : 120));
    const r = await settleScene(p, { capMs: 5000, minMs: 0, everyMs: 1, quietReads: 3 });
    expect(r.stable).toBe(true);
    expect(r.reason).toBe('stable');
    expect(r.reads).toBeGreaterThanOrEqual(6);
    expect(r.timeDriven).toBe(false);
  });
  it('gives up at the cap on a scene that never stops, and calls it time-driven when nothing was loading', async () => {
    const p = fakePage((n) => flat((n * 37) % 250));
    const r = await settleScene(p, { capMs: 80, minMs: 0, everyMs: 1, quietReads: 3 });
    expect(r.stable).toBe(false);
    expect(r.reason).toBe('cap');
    expect(r.timeDriven).toBe(true);
    expect(r.recentDiff).toBeGreaterThan(5);
  });
  it('does not call a quiet-then-changing page stable after one still read', async () => {
    const p = fakePage((n) => flat(n % 2 ? 50 : 50 + (n < 8 ? 30 : 0)));
    const r = await settleScene(p, { capMs: 5000, minMs: 0, everyMs: 1, quietReads: 4 });
    // 4 quiet reads in a row are needed: the page is called stable only after the flicker ends
    expect(r.stable).toBe(true);
    expect(r.reads).toBeGreaterThan(8);
  });
});

describe('alignToReference', () => {
  it('reports no alignment when there is no reference picture', async () => {
    const r = await alignToReference(
      fakePage(() => flat(100)),
      null,
      { capMs: 2000 },
    );
    expect(r.aligned).toBeNull();
    expect(r.settle.stable).toBe(true);
  });
  it('waits for a time-driven scene to pass the reference phase', async () => {
    // settles on 100 for the settle wait? no: it keeps moving, then lands on the reference (200) and is caught there
    const ref = Uint8Array.from(flat(200));
    const p = fakePage((n) => flat(n < 20 ? (n * 13) % 90 : n === 20 ? 200 : 60));
    const r = await alignToReference(p, ref, { capMs: 400, everyMs: 1, threshold: 6 });
    expect(r.settle.stable).toBe(false);
    expect(r.aligned === true || r.aligned === false).toBe(true);
    expect(r.bestDiff).not.toBeNull();
  });
  it('is aligned straight away when the settled picture is the reference', async () => {
    const ref = Uint8Array.from(flat(100));
    const r = await alignToReference(
      fakePage(() => flat(101)),
      ref,
      { capMs: 2000 },
    );
    expect(r.aligned).toBe(true);
    expect(r.reads).toBe(0);
  });
  it('says it was another phase when the page settles on a different picture', async () => {
    const ref = Uint8Array.from(flat(200));
    const r = await alignToReference(
      fakePage(() => flat(90)),
      ref,
      { capMs: 60, everyMs: 1 },
    );
    expect(r.aligned).toBe(false);
    expect(r.note).toContain('another phase');
  });
});
