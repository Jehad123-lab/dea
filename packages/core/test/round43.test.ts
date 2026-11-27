import { describe, expect, it } from 'vitest';
import { proxyMesh, type StandInInfo, standInTable, uvBucket } from '../src/replay/rebuild.ts';

describe('Round 43: stand-ins keep their UVs in the right colour-grid cell', () => {
  it('buckets a UV by the 8x8 grid, repeating', () => {
    expect(uvBucket([0, 0])).toBe(1);
    expect(uvBucket([0.99, 0.99])).toBe(64);
    expect(uvBucket([1.06, -0.94])).toBe(uvBucket([0.06, 0.06]));
    expect(uvBucket([Number.NaN, 0])).toBe(0);
  });
  it('a cell spanning two atlas islands keeps one vertex per island', () => {
    // a 5x5 lattice in 4 cells per side: columns x = 3 and x = 4 share a cell, and only x = 4 maps to the other UV island
    const P: number[][] = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) P.push([x, y, 0]);
    const uv = P.map((p) => (p[0] < 4 ? [0.05, 0.05] : [0.9, 0.9]));
    const tris: number[] = [];
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = y * 5 + x;
        tris.push(v, v + 1, v + 6, v, v + 6, v + 5);
      }
    const px = proxyMesh(tris, (v) => P[v], [0, 0, 0], [4, 4, 0], 4, [{ name: 'uv', size: 2, read: (v) => uv[v] }]);
    expect(px).not.toBeNull();
    // no averaged UV between the islands (it would show the colour of some other part of the atlas)
    for (const x of px?.attrs?.uv.data ?? []) expect([0.05, 0.9]).toContain(x);
    expect(px?.flipped).toBe(0);
  });
});

describe('Round 43: the stand-in table', () => {
  const row = (i: number): StandInInfo => ({
    material: 1,
    program: 'p',
    mode: 4,
    instances: 0,
    vertices: 100 + i,
    standInVertices: 10,
    kept: [],
    dropped: [],
    flipped: i,
    bothSides: 2,
  });
  it('shows facing counts, explains instances, and points to extract.json for every row', () => {
    const md = standInTable(Array.from({ length: 45 }, (_, i) => row(i))).join('\n');
    expect(md).toContain('| 44 / 2 |');
    expect(md).toContain('instances: how many copies');
    expect(md).toContain('all 45 stand-ins: extract.json, replay.rebuild.stats.standIns');
    expect(md).not.toContain('| 100 → 10 |');
  });
});
