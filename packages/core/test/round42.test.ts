import { describe, expect, it } from 'vitest';
import { proxyMesh, triNormal } from '../src/replay/rebuild.ts';

// a 5x5 lattice in x, y as a quad grid at height z, facing +z (up) or -z (down)
function sheet(P: number[][], z: number, up: boolean): number[] {
  const base = P.length;
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) P.push([x, y, z]);
  const t: number[] = [];
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const v = base + y * 5 + x;
      if (up) t.push(v, v + 1, v + 6, v, v + 6, v + 5);
      else t.push(v, v + 6, v + 1, v, v + 5, v + 6);
    }
  return t;
}

const facings = (px: { pos: number[]; idx: number[] }) => {
  const p = (v: number) => [px.pos[v * 3], px.pos[v * 3 + 1], px.pos[v * 3 + 2]];
  const zs: number[] = [];
  for (let i = 0; i < px.idx.length; i += 3) zs.push(triNormal(p(px.idx[i]), p(px.idx[i + 1]), p(px.idx[i + 2]))[2]);
  return zs;
};

describe("Round 42: stand-ins keep the facing of the site's triangles", () => {
  it('a thin panel keeps both sides when they collapse onto the same corners', () => {
    const P: number[][] = [];
    const tris = [...sheet(P, 0.01, true), ...sheet(P, 0, false)];
    const px = proxyMesh(tris, (v) => P[v], [0, 0, 0], [4, 4, 0.01], 4);
    expect(px).not.toBeNull();
    const zs = facings(px as { pos: number[]; idx: number[] });
    expect(zs.some((z) => z > 0)).toBe(true);
    expect(zs.some((z) => z < 0)).toBe(true);
  });
  it('every stand-in triangle faces the way its site triangle did', () => {
    const P: number[][] = [];
    const tris = sheet(P, 0, true);
    const px = proxyMesh(tris, (v) => P[v], [0, 0, 0], [4, 4, 0], 3);
    expect(px).not.toBeNull();
    for (const z of facings(px as { pos: number[]; idx: number[] })) expect(z).toBeGreaterThanOrEqual(0);
  });
  it('the same triangle in the same winding is kept once', () => {
    const P: number[][] = [];
    const t = sheet(P, 0, true);
    const px = proxyMesh([...t, ...t], (v) => P[v], [0, 0, 0], [4, 4, 0], 4);
    const once = proxyMesh(t, (v) => P[v], [0, 0, 0], [4, 4, 0], 4);
    expect(px?.idx.length).toBe(once?.idx.length);
  });
});
