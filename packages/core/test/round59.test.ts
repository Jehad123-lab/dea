import { describe, expect, it } from 'vitest';
import { bodyOfShell, robustBounds, type ShellCandidate, shellNearMiss, shellsFromBodies } from '../src/replay/rebuild.ts';

const box = (lo: number[], hi: number[]) => ({ pos: [...lo, hi[0], lo[1], lo[2], ...hi], idx: [0, 1, 2] });
const cand = (program: string, material: number, lo: number[], hi: number[], vertices?: number): ShellCandidate => ({
  step: { proxy: box(lo, hi) },
  info: { material, program, vertices },
  min: lo,
  max: hi,
});

describe('Round 59: a large gap needs the twin body', () => {
  const shell = () => cand('outline', 1, [-0.75, -0.75, -0.75], [2.75, 2.75, 2.75], 11027);
  it('an even but large gap to a body of another vertex count is not a match', () => {
    expect(bodyOfShell(shell(), [cand('normal', 5, [0, 0, 0], [2, 2, 2], 1792)])).toBeNull();
  });
  it('the same gap to the twin is', () => {
    const twin = cand('normal', 5, [0, 0, 0], [2, 2, 2], 11027);
    expect(bodyOfShell(shell(), [twin])?.body).toBe(twin);
  });
  it('a tight shell (every gap under 5% of the size) still takes a body of any count, as in Round 57', () => {
    const body = cand('normal', 5, [0, 0, 0], [2, 2, 2], 1792);
    const tight = cand('outline', 1, [-0.05, -0.05, -0.05], [2.05, 2.05, 2.05], 3206);
    expect(bodyOfShell(tight, [body])?.body).toBe(body);
  });
  it('records which body a shell follows, and the near miss names the twin rule', () => {
    const twin = cand('normal', 5, [0, 0, 0], [2, 2, 2], 11027);
    const s = shell();
    shellsFromBodies([twin, s]);
    expect(s.info.shellOf).toEqual({ material: 5, offset: 0.75, program: 'normal', vertices: 11027, sameCount: true });
    expect(shellNearMiss(shell(), [cand('normal', 5, [0, 0, 0], [2, 2, 2], 1792)])).toContain('needs a body with the same vertex count');
  });
  it("without a twin, Round 57's pick: tight gaps only, the smallest summed distance from the offset", () => {
    const shell = cand('outline', 1, [-0.05, -0.05, -0.05], [10.05, 10.05, 10.05], 55921);
    // R57's body: gaps 0.05 everywhere; a looser body (allowed by Round 58) with gaps up to 0.45; a far one (offset 3.8)
    const r57 = cand('normal', 5, [0, 0, 0], [10, 10, 10], 1792);
    const loose = cand('normal', 6, [0.2, 0.3, 0.4], [9.6, 9.7, 9.8], 900);
    const far = cand('Material_5511', 7, [3.8, 3.8, 3.8], [6.2, 6.2, 6.2], 300);
    const m = bodyOfShell(shell, [far, loose, r57]);
    expect(m?.body).toBe(r57);
    expect(m?.offset).toBeCloseTo(0.05, 6);
  });
  it('percentile bounds ignore one stray vertex (the 3206 shell: +55.8 on one side only)', () => {
    const P: number[][] = [];
    for (let i = 0; i < 400; i++) P.push([(i % 20) / 19, Math.floor(i / 20) / 19, (i % 7) / 6]);
    P.push([0.5, 0.5, 56]);
    const ids = P.map((_, i) => i);
    const r = robustBounds(ids, (v) => P[v]);
    expect(r.max[2]).toBeLessThanOrEqual(1);
    expect(r.min[0]).toBe(0);
    // under 100 vertices: plain min and max
    expect(robustBounds([0, 400], (v) => P[v]).max[2]).toBe(56);
  });
  it('a stray vertex no longer hides the twin, and the thinnest tight body wins (Round 60: percentiles only for the twin)', () => {
    const body = cand('normal', 5, [0, 0, 0], [10, 10, 10], 3206);
    const thick = cand('normal', 6, [0.4, 0.4, 0.4], [9.6, 9.6, 9.6], 900);
    const shell = cand('outline', 1, [-0.45, -0.45, -0.45], [10.45, 10.45, 65.8], 3206);
    shell.rmax = [10.45, 10.45, 10.45];
    const m = bodyOfShell(shell, [thick, body]);
    expect(m?.body).toBe(body);
    expect(m?.offset).toBeCloseTo(0.45, 6);
  });
  it('the near miss says same count or different count', () => {
    const lone = cand('outline', 1, [0, 0, 0], [1, 1, 1], 3206);
    expect(shellNearMiss(lone, [cand('normal', 5, [5, 5, 5], [6, 6, 6], 1792)])).toContain('1792 vertices, different count');
    expect(shellNearMiss(lone, [cand('normal', 5, [5, 5, 5], [6, 6, 6], 3206)])).toContain('3206 vertices, same count');
  });
});
