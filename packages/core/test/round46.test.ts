import { describe, expect, it } from 'vitest';
import { costGrids } from '../src/extract/index.ts';
import { coarseTones, placeholderTextures, TEX_GRID } from '../src/replay/graph.ts';
import { proxyMesh, uvBucket } from '../src/replay/rebuild.ts';

/** an inward-wound unit sphere (an outline shell) */
function shell(rings = 24, segs = 48) {
  const P: number[][] = [];
  for (let i = 0; i <= rings; i++)
    for (let j = 0; j <= segs; j++) {
      const th = (i / rings) * Math.PI;
      const ph = (j / segs) * 2 * Math.PI;
      P.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]);
    }
  const tris: number[] = [];
  const id = (i: number, j: number) => i * (segs + 1) + j;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1));
  return { P, tris };
}

describe('Round 46: shell push removed, --own-assets-grid', () => {
  it('an outline shell stand-in is no longer pushed out: corners stay at their cell averages', () => {
    const { P, tris } = shell();
    const N = P.map((p) => p.map((x) => -x));
    const px = proxyMesh(tris, (v) => P[v], [-1, -1, -1], [1, 1, 1], 4, [{ name: 'normal', size: 3, read: (v) => N[v] }]);
    expect(px?.pushedOut).toBe(0);
    let r = 0;
    const pos = px?.pos ?? [];
    for (let i = 0; i < pos.length; i += 3) r += Math.hypot(pos[i], pos[i + 1], pos[i + 2]);
    expect(r / (pos.length / 3)).toBeLessThan(1);
  });

  it('coarseTones and uvBucket take the grid size', () => {
    const w = 32;
    const px = Array.from({ length: w * w }, (_, p) => p % w);
    const out8 = new Array(w * w).fill(0);
    const out16 = new Array(w * w).fill(0);
    coarseTones(
      w,
      w,
      1,
      (p) => px[p],
      (p, _c, v) => {
        out8[p] = v;
      },
    );
    coarseTones(
      w,
      w,
      1,
      (p) => px[p],
      (p, _c, v) => {
        out16[p] = v;
      },
      16,
    );
    expect(new Set(out8.slice(0, w)).size).toBe(TEX_GRID);
    expect(new Set(out16.slice(0, w)).size).toBe(16);
    expect(uvBucket([0.99, 0.99])).toBe(TEX_GRID * TEX_GRID);
    expect(uvBucket([0.99, 0.99], 16)).toBe(256);
  });

  it('placeholderTextures paints at the grid it is given (default unchanged)', () => {
    // 128x128: above the lookup-table size (64x64 and smaller tables stay as recorded)
    const w = 128;
    const raw = Uint8Array.from({ length: w * w * 4 }, (_, i) => (Math.floor(i / 4) % w) * 2);
    const doc = (o: number) =>
      ({
        snap: { framebuffers: [], textures: [{ id: 1, levels: [{ w, h: w, o, l: raw.length, ch: 4, upType: 0x1401 }] }] },
      }) as unknown as Parameters<typeof placeholderTextures>[0];
    const a = new Uint8Array(raw);
    const b = new Uint8Array(raw);
    placeholderTextures(doc(0), a, { lookups: 0 });
    placeholderTextures(doc(0), b, { lookups: 0 }, 32);
    const row = (u: Uint8Array) => new Set(Array.from({ length: w }, (_, x) => u[x * 4])).size;
    expect(row(a)).toBe(8);
    expect(row(b)).toBe(32);
  });

  it('--own-assets-cost scores the finer grids only (16 and 32 above the shipped one)', () => {
    expect(costGrids(8)).toEqual([16, 32]);
    expect(costGrids(16)).toEqual([32]);
    expect(costGrids(32)).toEqual([]);
  });
});
