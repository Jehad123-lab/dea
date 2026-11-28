import { describe, expect, it } from 'vitest';
import { costMeshSplit } from '../src/extract/index.ts';
import { proxyMesh, type StandInInfo } from '../src/replay/rebuild.ts';

const si = (material: number, program: string, vertices: number, buf: number, extra: Partial<StandInInfo> = {}): StandInInfo =>
  ({ material, program, mode: 4, instances: 0, vertices, standInVertices: Math.round(vertices / 4), kept: [], dropped: [], buf, ...extra }) as StandInInfo;

describe('Round 61: the biggest material, one mesh at a time', () => {
  // three.js keyframes: material 5 (normal #397), five meshes drawn twice each; outline shells and a small material aside
  const list = [
    ...[46938, 23062, 19672, 12782, 1792].flatMap((v, i) => [
      si(5, 'normal #397', v, 10 + i, { flipped: v === 46938 ? 3363 : 10 }),
      si(5, 'normal #397', v, 10 + i),
    ]),
    si(1, 'outline #379', 55921, 30),
    si(1, 'outline #379', 55921, 31),
    si(7, 'Material_5511 #454', 1612, 40),
  ];
  it('picks the material with the most vertices (not the outline shells), biggest meshes first, three of them', () => {
    const m = costMeshSplit(list);
    expect(m.map((x) => x.vertices)).toEqual([46938, 23062, 19672]);
    expect(m[0]).toMatchObject({ material: 5, buf: 10, n: 2, flipped: 3363 });
  });
  it('nothing when that material has one mesh', () => {
    expect(costMeshSplit([si(5, 'normal', 4000, 1), si(5, 'normal', 4000, 1)])).toEqual([]);
  });
  it('boxes are left out', () => {
    expect(costMeshSplit([si(5, 'normal', 4000, 1, { box: 'mode 0' }), si(5, 'normal', 3000, 2), si(5, 'normal', 2000, 3)]).map((x) => x.buf)).toEqual([2, 3]);
  });
});

describe('Round 61: folded stand-in triangles left out', () => {
  // a crumpled sheet: neighbouring rows of corners jump up and down, so averaging a cell turns some triangles over
  const N = 40;
  const P: number[][] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) P.push([i / (N - 1), j / (N - 1), (rnd() - 0.5) * 0.3]);
  const tris: number[] = [];
  for (let j = 0; j < N - 1; j++)
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      tris.push(a, a + 1, a + N, a + 1, a + N + 1, a + N);
    }
  const min = [0, 0, -0.15];
  const max = [1, 1, 0.15];
  it("'drop' keeps the same corners, leaves out exactly the folded triangles", () => {
    const flip = proxyMesh(tris, (v) => P[v], min, max, 8);
    const drop = proxyMesh(tris, (v) => P[v], min, max, 8, [], { folds: 'drop' });
    expect(flip?.flipped ?? 0).toBeGreaterThan(0);
    expect(drop?.flipped).toBe(flip?.flipped);
    expect(drop?.pos).toEqual(flip?.pos);
    expect((drop?.idx.length ?? 0) / 3).toBeLessThan((flip?.idx.length ?? 0) / 3);
  });
  it('the default turns them back, as before', () => {
    const a = proxyMesh(tris, (v) => P[v], min, max, 8);
    const b = proxyMesh(tris, (v) => P[v], min, max, 8, [], { folds: 'flip' });
    expect(b?.idx).toEqual(a?.idx);
  });
});
