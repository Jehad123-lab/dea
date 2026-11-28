import { describe, expect, it } from 'vitest';
import { bodyOfShell, isOutlineProgram, type ShellCandidate, shellFromBody, shellsFromBodies } from '../src/replay/rebuild.ts';

// a cube stand-in (8 corners, 12 outward triangles)
const cube = (h = 1) => ({
  pos: [-h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h, -h, -h, h, h, -h, h, h, h, h, -h, h, h],
  idx: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5],
});
const cand = (program: string, material: number, h: number): ShellCandidate => ({
  step: { proxy: cube(h) },
  info: { material, program },
  min: [-h, -h, -h],
  max: [h, h, h],
});

describe('Round 57: outline shells from their body', () => {
  it('knows outline programs', () => {
    expect(isOutlineProgram('outline')).toBe(true);
    expect(isOutlineProgram('MeshToonOutline')).toBe(true);
    expect(isOutlineProgram('normal')).toBe(false);
  });
  it('finds the body a shell wraps and its offset; not a body far smaller', () => {
    const body = cand('normal', 5, 1);
    const shell = cand('outline', 1, 1.02);
    const other = cand('normal', 6, 0.5);
    const m = bodyOfShell(shell, [shell, other, body]);
    expect(m?.body).toBe(body);
    expect(m?.offset).toBeCloseTo(0.02, 6);
    expect(bodyOfShell(cand('outline', 1, 3), [body])).toBeNull();
  });
  it('pushes the body out along its normals and turns the winding', () => {
    const uv = [];
    for (let v = 0; v < 8; v++) uv.push(v % 2 ? 0.4 : 0.2, v % 2 ? 0.6 : 0.4);
    const out = shellFromBody({ ...cube(1.02), attrs: { normal: { size: 3, data: new Array(24).fill(0) }, uv: { size: 2, data: uv } } }, cube(1), 0.1);
    // each corner moves 0.1 along its (area-weighted) normal: outward, by at most the offset
    for (let v = 0; v < 8; v++) {
      const gain = Math.hypot(out.pos[v * 3], out.pos[v * 3 + 1], out.pos[v * 3 + 2]) - Math.sqrt(3);
      expect(gain).toBeGreaterThan(0.08);
      expect(gain).toBeLessThanOrEqual(0.1001);
    }
    expect(out.idx.slice(0, 3)).toEqual([0, 1, 2]);
    expect(out.attrs?.normal.data.length).toBe(24);
    expect(out.attrs?.uv.data[0]).toBeCloseTo(0.3, 6);
    expect(out.attrs?.uv.data[1]).toBeCloseTo(0.5, 6);
  });
  it('replaces only outline shells with a fitting body, and records which', () => {
    const body = cand('normal', 5, 1);
    const shell = cand('outline', 1, 1.02);
    const lone = cand('outline', 1, 4);
    const loneProxy = lone.step.proxy;
    expect(shellsFromBodies([body, shell, lone])).toBe(1);
    expect(shell.info.shellOf).toMatchObject({ material: 5, offset: 0.02 });
    expect(lone.step.proxy).toBe(loneProxy);
    expect(body.info.shellOf).toBeUndefined();
  });
});
