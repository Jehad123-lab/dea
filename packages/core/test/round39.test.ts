import { describe, expect, it } from 'vitest';
import { normalBucket, proxyMesh } from '../src/replay/rebuild.ts';

// a unit cube as 6 faces with their own vertices (flat shading: each corner appears 3 times with 3 normals)
function cube() {
  const P: number[][] = [];
  const N: number[][] = [];
  const tris: number[] = [];
  const faces: Array<[number, number]> = [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [2, 1],
    [2, -1],
  ];
  for (const [ax, sg] of faces) {
    const u = (ax + 1) % 3;
    const v = (ax + 2) % 3;
    const base = P.length;
    for (const [a, b] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const p = [0, 0, 0];
      p[ax] = sg > 0 ? 1 : 0;
      p[u] = a;
      p[v] = b;
      P.push(p);
      const n = [0, 0, 0];
      n[ax] = sg;
      N.push(n);
    }
    tris.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { P, N, tris };
}

describe('Round 39: stand-ins keep hard edges', () => {
  it('buckets a normal by its main direction', () => {
    expect(normalBucket([1, 0, 0])).toBe(1);
    expect(normalBucket([-0.2, 0.1, -0.9])).toBe(6);
    expect(normalBucket([0, 0, 0])).toBe(0);
  });
  it("a flat-shaded cube's stand-in keeps one unit normal per face", () => {
    const { P, N, tris } = cube();
    const px = proxyMesh(tris, (v) => P[v], [0, 0, 0], [1, 1, 1], 2, [{ name: 'normal', size: 3, read: (v) => N[v] }]);
    expect(px).not.toBeNull();
    const n = px?.attrs?.normal.data ?? [];
    // every vertex of the stand-in keeps an axis normal of length 1 (before Round 39 the corners averaged 3 faces: 0.577 each)
    for (let i = 0; i < n.length; i += 3) {
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 3);
      expect(Math.max(Math.abs(n[i]), Math.abs(n[i + 1]), Math.abs(n[i + 2]))).toBeCloseTo(1, 3);
    }
    expect(px?.idx.length).toBe(36);
  });
  it('a mesh without normals clusters by position only', () => {
    const { P, tris } = cube();
    const px = proxyMesh(tris, (v) => P[v], [0, 0, 0], [1, 1, 1], 2);
    expect((px?.pos.length ?? 0) / 3).toBe(8);
  });
});
