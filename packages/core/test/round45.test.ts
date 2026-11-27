import { describe, expect, it } from 'vitest';
import { proxyMesh, standInTable, visibleWinding } from '../src/replay/rebuild.ts';

/** a UV sphere of radius 1: `inward` winds every triangle (and its normals) toward the centre, like a baked outline shell */
function sphere(inward: boolean, rings = 24, segs = 48) {
  const P: number[][] = [];
  const N: number[][] = [];
  for (let i = 0; i <= rings; i++)
    for (let j = 0; j <= segs; j++) {
      const th = (i / rings) * Math.PI;
      const ph = (j / segs) * 2 * Math.PI;
      const p = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      P.push(p);
      N.push(inward ? p.map((x) => -x) : p);
    }
  const tris: number[] = [];
  const id = (i: number, j: number) => i * (segs + 1) + j;
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segs; j++) {
      const a = id(i, j);
      const b = id(i + 1, j);
      const c = id(i + 1, j + 1);
      const d = id(i, j + 1);
      // counter-clockwise seen from outside: a d c, a c b (theta down, phi around)
      if (inward) tris.push(a, b, c, a, c, d);
      else tris.push(a, c, b, a, d, c);
    }
  return { P, N, tris };
}

const meanRadius = (pos: number[]) => {
  let s = 0;
  for (let i = 0; i < pos.length; i += 3) s += Math.hypot(pos[i], pos[i + 1], pos[i + 2]);
  return s / (pos.length / 3);
};

describe('Round 45: outline shells and every UV set', () => {
  it('visibleWinding reads which faces a culled material shows', () => {
    expect(visibleWinding(null)).toBeNull();
    expect(visibleWinding({ face: 0x0405, front: 0x0901 })).toBe('ccw');
    expect(visibleWinding({ face: 0x0405, front: 0x0900 })).toBe('cw');
    expect(visibleWinding({ face: 0x0404, front: 0x0901 })).toBe('cw');
    expect(visibleWinding({ face: 0x0408, front: 0x0901 })).toBeNull();
  });

  it('an inward-wound culled shell is pushed out to the outer edge of its cells, so it does not sink', () => {
    const { P, N, tris } = sphere(true);
    const extra = [{ name: 'normal', size: 3, read: (v: number) => N[v] }];
    const plain = proxyMesh(tris, (v) => P[v], [-1, -1, -1], [1, 1, 1], 4, extra);
    const shell = proxyMesh(tris, (v) => P[v], [-1, -1, -1], [1, 1, 1], 4, extra, { visible: 'ccw' });
    expect(plain && shell).toBeTruthy();
    if (!plain || !shell) return;
    expect(plain.pushedOut).toBe(0);
    expect(shell.pushedOut).toBeGreaterThan(0);
    // the cell averages sit inside the sphere; the pushed corners reach about its surface (a cell's outward direction is
    // not exactly radial, so on this coarse 4-cell grid a corner may land a few % past it)
    expect(meanRadius(plain.pos)).toBeLessThan(0.99);
    expect(meanRadius(shell.pos)).toBeGreaterThan(meanRadius(plain.pos));
    let far = 0;
    for (let i = 0; i < shell.pos.length; i += 3) far = Math.max(far, Math.hypot(shell.pos[i], shell.pos[i + 1], shell.pos[i + 2]));
    expect(far).toBeLessThan(1.1);
    // same corners and triangles: only positions move
    expect(shell.idx).toEqual(plain.idx);
  });

  it('an outward mesh, or one that is not culled, is left as it was', () => {
    const { P, N, tris } = sphere(false);
    const extra = [{ name: 'normal', size: 3, read: (v: number) => N[v] }];
    const plain = proxyMesh(tris, (v) => P[v], [-1, -1, -1], [1, 1, 1], 4, extra);
    const front = proxyMesh(tris, (v) => P[v], [-1, -1, -1], [1, 1, 1], 4, extra, { visible: 'ccw' });
    expect(front?.pushedOut).toBe(0);
    expect(front?.pos).toEqual(plain?.pos);
    const inner = sphere(true);
    const both = proxyMesh(inner.tris, (v) => inner.P[v], [-1, -1, -1], [1, 1, 1], 4, extra, { visible: null });
    expect(both?.pushedOut).toBe(0);
  });

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

  it('rebuild.md says how many outline shells were pushed out', () => {
    const L = standInTable([
      { material: 1, program: 'outline #379', mode: 4, instances: 0, vertices: 100, standInVertices: 40, kept: ['normal'], dropped: [], shellPushed: 12 },
    ]).join('\n');
    expect(L).toContain('outline shells (culled, visible faces point inward): 1 stand-in(s), 12 corner(s) pushed out');
  });
});
