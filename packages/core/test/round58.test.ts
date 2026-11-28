import { describe, expect, it } from 'vitest';
import { bodyOfShell, type ShellCandidate, shellNearMiss, shellsFromBodies } from '../src/replay/rebuild.ts';

const box = (lo: number[], hi: number[]) => ({
  pos: [lo[0], lo[1], lo[2], hi[0], lo[1], lo[2], hi[0], hi[1], lo[2], lo[0], hi[1], hi[2]],
  idx: [0, 1, 2, 0, 2, 3],
});
const cand = (program: string, material: number, lo: number[], hi: number[], vertices?: number): ShellCandidate => ({
  step: { proxy: box(lo, hi) },
  info: { material, program, vertices },
  min: lo,
  max: hi,
});

describe('Round 58: outline shells on small objects', () => {
  it('a world-unit offset bigger than 5% of a small object still finds its body', () => {
    // a 2-unit object with a 0.75 shell (keyframes: offset 0.7502): Round 57 needed every gap under 5% of 3.5
    // Round 59: a gap that large needs the twin (the same vertex count)
    const body = cand('normal', 5, [0, 0, 0], [2, 2, 2], 11027);
    const shell = cand('outline', 1, [-0.75, -0.75, -0.75], [2.75, 2.75, 2.75], 11027);
    const m = bodyOfShell(shell, [body, shell]);
    expect(m?.body).toBe(body);
    expect(m?.offset).toBeCloseTo(0.75, 6);
  });
  it('uneven gaps are not a shell of that body (Round 60: on two sides; one wider side is the five-side rule)', () => {
    const body = cand('normal', 5, [0, 0, 0], [2, 2, 2]);
    const shell = cand('outline', 1, [-0.1, -0.1, -0.1], [3.5, 2.6, 2.1]);
    expect(bodyOfShell(shell, [body])).toBeNull();
  });
  it('a body poking out of the shell, or a gap over a quarter of the size, is not one', () => {
    const body = cand('normal', 5, [0, 0, 0], [2, 2, 2]);
    expect(bodyOfShell(cand('outline', 1, [0.2, 0.2, 0.2], [1.8, 1.8, 1.8]), [body])).toBeNull();
    expect(bodyOfShell(cand('outline', 1, [-1.2, -1.2, -1.2], [3.2, 3.2, 3.2]), [body])).toBeNull();
  });
  it('the same vertex count wins over a slightly closer fit', () => {
    const near = cand('normal', 5, [0, 0, 0], [2, 2, 2], 900);
    const twin = cand('normal', 6, [0.01, 0, 0], [2, 2, 2], 3206);
    const shell = cand('outline', 1, [-0.1, -0.1, -0.1], [2.1, 2.1, 2.1], 3206);
    expect(bodyOfShell(shell, [near, twin])?.body).toBe(twin);
  });
  it('counts every outline shell it looked at', () => {
    const seen = { shells: 0 };
    const body = cand('normal', 5, [0, 0, 0], [2, 2, 2], 900);
    const a = cand('outline', 1, [-0.75, -0.75, -0.75], [2.75, 2.75, 2.75], 900);
    const b = cand('outline', 1, [10, 10, 10], [11, 11, 11]);
    expect(shellsFromBodies([body, a, b], seen)).toBe(1);
    expect(seen.shells).toBe(2);
  });
  it('names the near miss: the closest body and the rule it broke', () => {
    const body = cand('alpha_0', 3, [0, 0, 0], [2, 2, 2], 3206);
    const tall = cand('outline', 1, [-0.1, -0.1, -0.1], [2.1, 3.5, 2.1], 3206);
    const miss = shellNearMiss(tall, [body, tall]);
    expect(miss).toContain('material 3 (alpha_0, 3206 vertices, same count)');
    expect(miss).toContain('gaps uneven');
    expect(miss).toContain('top +1.5');
    expect(shellNearMiss(cand('outline', 1, [0, 0, 0], [1, 1, 1]), [])).toBe('no other stand-in to wrap');
  });
  it('shellsFromBodies records the near miss on the shells that found no body', () => {
    const body = cand('normal', 5, [0, 0, 0], [2, 2, 2]);
    const lone = cand('outline', 1, [10, 10, 10], [11, 11, 11]);
    shellsFromBodies([body, lone]);
    expect(lone.info.shellMiss).toContain('material 5');
  });
});
