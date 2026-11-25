import { describe, expect, it } from 'vitest';
import {
  betterFrame,
  FLAT_EXTRA_FULL_MS,
  FLAT_EXTRA_QUICK_MS,
  FLAT_STILL_MS,
  type FrameStats,
  frameChanged,
  frameStats,
  isFlat,
  keepWatching,
  THUMB_H,
  THUMB_W,
  type WatchState,
} from '../src/extract/refwait.ts';
import { proxyMesh, standinSummary, triangleIds } from '../src/replay/rebuild.ts';
import { REBUILD_RUNNER } from '../src/replay/runner.ts';

// Round 25: a flat (loader-like) reference frame, stand-ins for strips / fans / instanced draws, the summary wording

const thumb = (f: (x: number, y: number) => number) => {
  const a: number[] = [];
  for (let y = 0; y < THUMB_H; y++) for (let x = 0; x < THUMB_W; x++) a.push(f(x, y));
  return a;
};

describe('reference frame: flat (loading screen) detection', () => {
  const grey = frameStats(thumb(() => 128));
  const greyNoise = frameStats(thumb((x, y) => 126 + ((x * 7 + y * 13) % 5)));
  const scene = frameStats(thumb((x, y) => (((x >> 3) + (y >> 3)) % 2 ? 230 : 20)));
  it('a uniform grey screen (igloo.inc) is flat, a detailed frame is not', () => {
    expect(grey).toMatchObject({ sd: 0, edges: 0, mean: 128 });
    expect(isFlat(grey)).toBe(true);
    expect(isFlat(greyNoise)).toBe(true);
    expect(isFlat(scene)).toBe(false);
    expect(scene.edges).toBeGreaterThan(0.05);
    expect(isFlat(null)).toBe(true);
  });
  it('a smooth gradient has variance but no edges: still not flat (variance alone is detail)', () => {
    const g = frameStats(thumb((x) => (x / THUMB_W) * 255));
    expect(g.edges).toBe(0);
    expect(isFlat(g)).toBe(false);
  });
  it('a near-uniform frame never replaces a detailed one, even with a higher score', () => {
    expect(betterFrame({ score: 50, flat: true }, { score: 10, flat: false })).toBe(false);
    expect(betterFrame({ score: 3, flat: false }, { score: 7, flat: true })).toBe(true);
    expect(betterFrame({ score: 12, flat: false }, { score: 10, flat: false })).toBe(true);
    expect(betterFrame({ score: 1, flat: true }, { score: -1, flat: true })).toBe(true);
    expect(betterFrame({ score: 1, flat: true }, null)).toBe(true);
  });
  it('frameChanged sees a pulsing loader and ignores an identical frame', () => {
    const a: FrameStats = { sd: 2, edges: 0, mean: 120 };
    expect(frameChanged(a, { ...a })).toBe(false);
    expect(frameChanged(a, { ...a, mean: 124 })).toBe(true);
    expect(frameChanged(null, a)).toBe(true);
  });
});

describe('reference watch: when to stop', () => {
  const base: WatchState = {
    elapsed: 0,
    ms: 20_000,
    hardCap: 50_000,
    longCap: 50_000,
    loader: false,
    pctAge: 0,
    bestFlat: false,
    changedAge: 0,
    quick: true,
  };
  it('the base window and a loader up to the hard cap still hold', () => {
    expect(keepWatching({ ...base, elapsed: 10_000 })).toBe(true);
    expect(keepWatching({ ...base, elapsed: 30_000 })).toBe(false);
    expect(keepWatching({ ...base, elapsed: 30_000, loader: true })).toBe(true);
    // quick mode: longCap = hardCap, a rising counter does not go past it (PR #15)
    expect(keepWatching({ ...base, elapsed: 55_000, loader: true, pctAge: 1000 })).toBe(false);
  });
  it('a flat best frame buys at most the bounded extra past the hard cap, while frames change', () => {
    const at = (elapsed: number, more: Partial<WatchState> = {}) => keepWatching({ ...base, elapsed, bestFlat: true, loader: true, pctAge: 60_000, ...more });
    expect(at(55_000)).toBe(true);
    expect(at(50_000 + FLAT_EXTRA_QUICK_MS - 1)).toBe(true);
    expect(at(50_000 + FLAT_EXTRA_QUICK_MS)).toBe(false);
    // a flat picture that stopped changing, with no loader on screen, is not going anywhere (Round 26: a visible loader
    // with a stuck counter still holds)
    expect(at(55_000, { changedAge: FLAT_STILL_MS + 1, loader: false })).toBe(false);
    expect(at(55_000, { changedAge: FLAT_STILL_MS + 1 })).toBe(true);
    // full mode waits longer
    expect(at(50_000 + FLAT_EXTRA_QUICK_MS + 5000, { quick: false, longCap: 420_000 })).toBe(true);
    expect(at(50_000 + FLAT_EXTRA_FULL_MS, { quick: false, longCap: 420_000 })).toBe(false);
  });
  it('a detailed best frame stops at the usual limits', () => {
    expect(keepWatching({ ...base, elapsed: 55_000, loader: true, pctAge: 60_000 })).toBe(false);
  });
});

const docWith = (bytes: Uint8Array) => ({ snap: { buffers: [{ id: 7, kind: 'element', usage: 0x88e4, o: 0, l: bytes.length }] } }) as never;

describe('--own-assets stand-ins: strips, fans, restarts', () => {
  it('a TRIANGLE_STRIP becomes triangles with GL winding', () => {
    const t = triangleIds(docWith(new Uint8Array(0)), new Uint8Array(0), { mode: 5, first: 10, count: 5, index: null });
    expect(Array.from(t ?? [])).toEqual([10, 11, 12, 12, 11, 13, 12, 13, 14]);
  });
  it('a TRIANGLE_FAN fans out from its first vertex', () => {
    const t = triangleIds(docWith(new Uint8Array(0)), new Uint8Array(0), { mode: 6, first: 0, count: 5, index: null });
    expect(Array.from(t ?? [])).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4]);
  });
  it('an indexed strip respects the primitive-restart index (0xffff for u16)', () => {
    const ix = new Uint16Array([0, 1, 2, 3, 0xffff, 4, 5, 6]);
    const bin = new Uint8Array(ix.buffer);
    const t = triangleIds(docWith(bin), bin, { mode: 5, first: 0, count: ix.length, index: { buf: 7, type: 0x1403, offset: 0 } });
    expect(Array.from(t ?? [])).toEqual([0, 1, 2, 2, 1, 3, 4, 5, 6]);
  });
  it('plain lists still work; lines, points and an unreadable index give null', () => {
    const z = new Uint8Array(0);
    expect(Array.from(triangleIds(docWith(z), z, { mode: 4, first: 3, count: 7, index: null }) ?? [])).toEqual([3, 4, 5, 6, 7, 8]);
    expect(triangleIds(docWith(z), z, { mode: 1, first: 0, count: 12, index: null })).toBeNull();
    expect(triangleIds(docWith(z), z, { mode: 0, first: 0, count: 12, index: null })).toBeNull();
    expect(triangleIds(docWith(z), z, { mode: 5, first: 0, count: 8, index: { buf: 7, type: 0x1403, offset: 0 } })).toBeNull();
  });
  it('a detailed strip mesh (a sphere as row strips) gets a coarse stand-in, not a box', () => {
    const n = 48;
    const P: number[][] = [];
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const th = (i / n) * Math.PI;
        const ph = (j / n) * Math.PI * 2;
        P.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]);
      }
    const ix: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i) ix.push(0xffffffff);
      for (let j = 0; j <= n; j++) ix.push(i * (n + 1) + j, (i + 1) * (n + 1) + j);
    }
    const u = new Uint32Array(ix);
    const bin = new Uint8Array(u.buffer);
    const t = triangleIds(docWith(bin), bin, { mode: 5, first: 0, count: u.length, index: { buf: 7, type: 0x1405, offset: 0 } });
    expect(t).not.toBeNull();
    expect((t as Uint32Array).length).toBe(n * n * 2 * 3);
    expect(Math.max(...(t as Uint32Array))).toBeLessThan(P.length);
    const px = proxyMesh(t as Uint32Array, (v) => P[v], [-1, -1, -1], [1, 1, 1]);
    expect(px).not.toBeNull();
  });
  it('the runner draws a stand-in of an instanced draw with its instance attributes and count', () => {
    expect(REBUILD_RUNNER).toMatch(/\(step\.proxy \|\| step\.placeholder\) && step\.instances/);
    expect(REBUILD_RUNNER).toMatch(/if \(a\.div\) geo\.setAttribute\(a\.name, attrOf\(a\)\)/);
  });
});

describe('--own-assets summary wording', () => {
  it('counts stand-ins as coarse shapes and boxes, not "boxes" for all', () => {
    expect(standinSummary({ placeholders: 3, proxies: 3 })).toBe('3 mesh(es) are stand-ins (3 coarse shapes, 0 boxes)');
    expect(standinSummary({ placeholders: 50, proxies: 49 })).toBe('50 mesh(es) are stand-ins (49 coarse shapes, 1 box)');
    expect(standinSummary({ placeholders: 1, proxies: 1 })).toBe('1 mesh(es) are stand-ins (1 coarse shape, 0 boxes)');
  });
});
