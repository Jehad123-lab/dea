import { describe, expect, it } from 'vitest';
import { proxyMesh } from '../src/replay/rebuild.ts';

// Round 45 also pushed outline shells out; Round 46 removed that (see round46.test.ts). The UV-set split stays.
describe('Round 45: every UV set splits a stand-in cell', () => {
  it('a cell is also split by its second UV set (an AO map laid out apart from the colour map)', () => {
    // a 10x10 grid of quads; uv is the same everywhere, uv1 jumps between two far islands from one column to the next
    const P: number[][] = [];
    const uv1: number[][] = [];
    for (let y = 0; y <= 10; y++)
      for (let x = 0; x <= 10; x++) {
        P.push([x / 10, y / 10, 0]);
        uv1.push(x % 2 ? [0.95, 0.95] : [0.05, 0.05]);
      }
    const tris: number[] = [];
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        const a = y * 11 + x;
        tris.push(a, a + 1, a + 12, a, a + 12, a + 11);
      }
    const extra = [
      { name: 'uv', size: 2, read: () => [0.5, 0.5] },
      { name: 'uv1', size: 2, read: (v: number) => uv1[v] ?? [0.5, 0.5] },
    ];
    const px = proxyMesh(tris, (v) => P[v], [0, 0, 0], [1, 1, 0], 2, extra);
    expect(px).toBeTruthy();
    const d = px?.attrs?.uv1.data ?? [];
    // no corner takes the average of the two islands (0.5): each keeps its own
    for (let i = 0; i < d.length; i += 2) expect(Math.abs(d[i] - 0.5)).toBeGreaterThan(0.3);
  });
});
