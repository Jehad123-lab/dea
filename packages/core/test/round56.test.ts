import { describe, expect, it } from 'vitest';
import { proxyMesh, surfacePoint } from '../src/replay/rebuild.ts';

// a UV sphere of radius 1: the average of a cell's vertices lies inside it, the plane fit outside it, the blend on it
function sphere(rings = 48, segs = 96) {
  const P: number[][] = [];
  for (let r = 0; r <= rings; r++)
    for (let s = 0; s <= segs; s++) {
      const th = (Math.PI * r) / rings;
      const ph = (2 * Math.PI * s) / segs;
      P.push([Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]);
    }
  const T: number[] = [];
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      const b = a + segs + 1;
      T.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return { P, T };
}
const meanRadius = (pos: number[]) => {
  let s = 0;
  for (let i = 0; i < pos.length; i += 3) s += Math.hypot(pos[i], pos[i + 1], pos[i + 2]);
  return s / (pos.length / 3);
};

describe('Round 56: stand-in corner placement', () => {
  const { P, T } = sphere();
  const lo = [-1, -1, -1];
  const hi = [1, 1, 1];
  const pos = (v: number) => P[v];
  it('the default is still the average', () => {
    const def = proxyMesh(T, pos, lo, hi, 4);
    const avg = proxyMesh(T, pos, lo, hi, 4, [], { place: 'average' });
    expect(def?.pos).toEqual(avg?.pos);
    expect(def?.placed).toBe(0);
  });
  it('average inside, plane fit outside, blend closest to the radius (4, 8 and 16 cells)', () => {
    for (const g of [4, 8, 16]) {
      const ra = meanRadius(proxyMesh(T, pos, lo, hi, g, [], { place: 'average' })?.pos ?? []);
      const rs = meanRadius(proxyMesh(T, pos, lo, hi, g, [], { place: 'surface' })?.pos ?? []);
      const blend = proxyMesh(T, pos, lo, hi, g, [], { place: 'blend' });
      const rb = meanRadius(blend?.pos ?? []);
      expect(ra).toBeLessThan(1);
      expect(rs).toBeGreaterThan(1);
      expect(Math.abs(1 - rb)).toBeLessThan(Math.abs(1 - ra) / 3);
      expect(blend?.placed).toBeGreaterThan(0);
    }
  });
  it('same corners, same triangles: no more of the shape is kept', () => {
    const avg = proxyMesh(T, pos, lo, hi, 4, [], { place: 'average' });
    const blend = proxyMesh(T, pos, lo, hi, 4, [], { place: 'blend' });
    expect(blend?.pos.length).toBe(avg?.pos.length);
    expect(blend?.idx).toEqual(avg?.idx);
  });
  it('one plane: the average moves onto it along the normal only; out of reach or singular keeps the average', () => {
    const x = surfacePoint([0, 0, 0, 1, 0, 0, 0, 2, 0, 1], [0.3, 1.5, -0.2], 10);
    expect(x?.[0]).toBeCloseTo(0.3, 6);
    expect(x?.[2]).toBeCloseTo(-0.2, 6);
    expect(x?.[1]).toBeGreaterThan(1.95);
    expect(surfacePoint([0, 0, 0, 1, 0, 0, 0, 50, 0, 1], [0, 0, 0], 1)).toBeNull();
    expect(surfacePoint([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0], 1)).toBeNull();
  });
});
