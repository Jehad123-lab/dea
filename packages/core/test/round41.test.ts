import { describe, expect, it } from 'vitest';
import { drawBounds, isIdInput, proxyMesh } from '../src/replay/rebuild.ts';

describe('Round 41: batched meshes', () => {
  it("a draw's bounds cover only the vertices it draws, not the whole shared buffer", () => {
    // 2 objects in one buffer: a unit square at the origin and one at x = 100
    const pts = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [100, 0, 0],
      [101, 0, 0],
      [101, 1, 0],
      [100, 1, 0],
    ];
    const dv = new DataView(new Float32Array(pts.flat()).buffer);
    const own = drawBounds(dv, 0, 12, 3, [0, 1, 2, 0, 2, 3]);
    expect(own.min).toEqual([0, 0, 0]);
    expect(own.max).toEqual([1, 1, 0]);
    const all = drawBounds(dv, 0, 12, 3);
    expect(all.max[0]).toBe(101);
    const two = drawBounds(new DataView(new Float32Array([5, 6, 7, 8]).buffer), 0, 8, 2);
    expect(two).toEqual({ min: [5, 6, 0], max: [7, 8, 0] });
  });
  it('knows which vertex inputs are ids', () => {
    for (const n of ['batchId', 'objectId', 'aID', 'id', 'instance_id', 'aIndex']) expect(isIdInput(n)).toBe(true);
    for (const n of ['uv', 'normal', 'emission', 'grid', 'width', 'position']) expect(isIdInput(n)).toBe(false);
  });
  it('a cell keeps its first vertex id instead of averaging two ids', () => {
    // a 5x5 lattice (x, y 0..4) in 4 cells per side: columns x = 3 and x = 4 share a cell, and only x = 4 has id 3, so
    // an average would give a third id in between
    const P: number[][] = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) P.push([x, y, 0]);
    const ids = P.map((p) => (p[0] === 4 ? 3 : 1));
    const tris: number[] = [];
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = y * 5 + x;
        tris.push(v, v + 1, v + 6, v, v + 6, v + 5);
      }
    const read = (v: number) => [ids[v]];
    const picked = proxyMesh(tris, (v) => P[v], [0, 0, 0], [4, 4, 0], 4, [{ name: 'batchId', size: 1, read, pick: true }]);
    expect(picked).not.toBeNull();
    for (const x of picked?.attrs?.batchId.data ?? []) expect([1, 3]).toContain(x);
    const averaged = proxyMesh(tris, (v) => P[v], [0, 0, 0], [4, 4, 0], 4, [{ name: 'batchId', size: 1, read }]);
    expect(averaged?.attrs?.batchId.data.some((x) => x !== 1 && x !== 3)).toBe(true);
  });
});
