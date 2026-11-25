import { describe, expect, it } from 'vitest';
import { FLAT_STILL_MS, keepWatching } from '../src/extract/refwait.ts';
import { coarseTones, isLookupTable, TEX_GRID } from '../src/replay/graph.ts';
import { proxyMesh } from '../src/replay/rebuild.ts';

describe('Round 26: reference watch past a loader with a stuck counter', () => {
  const base = {
    elapsed: 60_000,
    ms: 20_000,
    hardCap: 50_000,
    longCap: 50_000,
    loader: true,
    pctAge: 60_000,
    bestFlat: true,
    changedAge: FLAT_STILL_MS + 5000,
    quick: true,
  };
  it('a black loader holding at 63% keeps the watch going within the extra wait', () => {
    expect(keepWatching(base)).toBe(true);
    expect(keepWatching({ ...base, loader: false })).toBe(false);
    expect(keepWatching({ ...base, elapsed: 200_000 })).toBe(false);
  });
});

describe('Round 26: coarse colour grids for --own-assets images', () => {
  it('keeps the tones of each cell and none of the detail', () => {
    const w = 32;
    const h = 16;
    // left half dark noise, right half bright noise
    const img = new Float64Array(w * h).map((_, p) => (p % w < w / 2 ? 20 : 220) + ((p * 7919) % 17));
    coarseTones(
      w,
      h,
      1,
      (p) => img[p],
      (p, _c, v) => {
        img[p] = v;
      },
    );
    expect(img[0]).toBeLessThan(60);
    expect(img[w - 1]).toBeGreaterThan(200);
    // inside one cell every pixel is the same value
    const cw = w / TEX_GRID;
    expect(img[1]).toBeCloseTo(img[0], 9);
    expect(new Set(Array.from({ length: cw }, (_, x) => img[x].toFixed(6))).size).toBe(1);
  });
  it('handles textures smaller than the grid', () => {
    const img = [10, 200];
    coarseTones(
      2,
      1,
      1,
      (p) => img[p],
      (p, _c, v) => {
        img[p] = v;
      },
    );
    expect(img).toEqual([10, 200]);
  });
});

describe('Round 26: stand-ins carry the other vertex attributes', () => {
  it('averages normals, UVs and barycentrics per cluster under their names', () => {
    // a 10x10 grid of quads in the xy plane
    const N = 11;
    const P: number[][] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) P.push([x / 10, y / 10, 0]);
    const tris: number[] = [];
    for (let y = 0; y < N - 1; y++)
      for (let x = 0; x < N - 1; x++) {
        const i = y * N + x;
        tris.push(i, i + 1, i + N, i + 1, i + N + 1, i + N);
      }
    const px = proxyMesh(tris, (v) => P[v], [0, 0, 0], [1, 1, 0], 4, [
      { name: 'normal', size: 3, read: () => [0, 0, 1] },
      { name: 'uv', size: 2, read: (v) => [P[v][0], P[v][1]] },
      { name: 'aBary', size: 3, read: (v) => [v % 3 === 0 ? 1 : 0, v % 3 === 1 ? 1 : 0, v % 3 === 2 ? 1 : 0] },
    ]);
    expect(px).not.toBeNull();
    const nv = (px?.pos.length ?? 0) / 3;
    expect(px?.attrs?.normal.data.length).toBe(nv * 3);
    expect(px?.attrs?.normal.data.slice(0, 3)).toEqual([0, 0, 1]);
    expect(px?.attrs?.uv.size).toBe(2);
    // the averaged UV of a cluster sits where its averaged position is (the grid's UV is its xy)
    expect(px?.attrs?.uv.data[0]).toBeCloseTo(px?.pos[0] ?? -1, 3);
    expect(px?.attrs?.aBary.data.length).toBe(nv * 3);
  });
  it('without extra attributes the result is unchanged', () => {
    const P = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ];
    const px = proxyMesh([0, 1, 2, 1, 3, 2, 0, 2, 1, 1, 2, 3, 0, 3, 1, 2, 3, 0], (v) => P[v], [0, 0, 0], [1, 1, 0], 16);
    expect(px?.attrs).toBeUndefined();
  });
});

describe('Round 27: lookup tables stay as recorded under --own-assets', () => {
  it('tells code tables from pictures', () => {
    expect(isLookupTable(32, 32, 32)).toBe(true); // 3D colour LUT
    expect(isLookupTable(256, 1)).toBe(true); // gradient ramp
    expect(isLookupTable(1024, 4)).toBe(true); // palette strip
    expect(isLookupTable(64, 64)).toBe(true); // tiny table / noise
    expect(isLookupTable(512, 512)).toBe(false);
    expect(isLookupTable(128, 40)).toBe(false);
  });
});
