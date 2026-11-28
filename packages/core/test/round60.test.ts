import { describe, expect, it } from 'vitest';
import { bodyOfShell, type ShellCandidate, shellNearMiss, shellsFromBodies } from '../src/replay/rebuild.ts';

const box = (lo: number[], hi: number[]) => ({ pos: [...lo, hi[0], lo[1], lo[2], ...hi], idx: [0, 1, 2] });
const cand = (program: string, material: number, lo: number[], hi: number[], vertices: number, rlo?: number[], rhi?: number[]): ShellCandidate => ({
  step: { proxy: box(lo, hi) },
  info: { material, program, vertices },
  min: lo,
  max: hi,
  rmin: rlo,
  rmax: rhi,
});

describe('Round 60: a body passes on either set of bounds', () => {
  // keyframes after Round 59: 0 of 6 shells; Round 57 (min/max only) had 2. Percentiles of two different vertex sets
  // land on different places of the shape, so the shell's 1st percentile can sit inside the body's
  const shell = () => cand('outline', 1, [-0.05, -0.05, -0.05], [10.05, 10.05, 10.05], 55921, [0.5, 0.2, 0.2], [9.5, 9.8, 9.8]);
  const body = () => cand('normal', 5, [0, 0, 0], [10, 10, 10], 55921, [0.1, 0.1, 0.1], [9.9, 9.9, 9.9]);
  it("a body Round 57's min/max rule matched is matched again, at Round 57's offset", () => {
    const b = body();
    const m = bodyOfShell(shell(), [b]);
    expect(m?.body).toBe(b);
    expect(m?.offset).toBeCloseTo(0.05, 5);
  });
  it('the twin passes on percentiles; another count on five min/max sides (the stray-vertex case)', () => {
    const s = cand('outline', 1, [-0.45, -0.45, -0.45], [10.45, 10.45, 65.8], 3206, [-0.45, -0.45, -0.45], [10.45, 10.45, 10.45]);
    const twin = cand('normal', 5, [0, 0, 0], [10, 10, 10], 3206, [0, 0, 0], [10, 10, 10]);
    const other = cand('normal', 5, [0, 0, 0], [10, 10, 10], 1792, [0, 0, 0], [10, 10, 10]);
    expect(bodyOfShell(s, [twin])?.body).toBe(twin);
    // Round 60's five-side rule takes the other count on min/max, with the front open
    expect(bodyOfShell(s, [other])?.open).toBe('front');
  });
  it("keyframes' 55921 shells after Round 59: percentile box 475 wide, the body's 175; min/max still match", () => {
    const s = cand('outline', 1, [-0.75, -0.75, -0.75], [500.75, 500.75, 500.75], 55921, [10, 10, 10], [485, 485, 485]);
    const b = cand('normal', 5, [0, 0, 0], [500, 500, 500], 1792, [160, 160, 160], [335, 335, 335]);
    const m = bodyOfShell(s, [b]);
    expect(m?.body).toBe(b);
    expect(m?.offset).toBeCloseTo(0.75, 5);
  });
  it('the near miss prints both sets of gaps', () => {
    const s = cand('outline', 1, [-3, -3, -3], [13, 13, 13], 300, [-3, -3, -3], [13, 13, 13]);
    const line = shellNearMiss(s, [body()]);
    expect(line).toContain('percentile gaps');
    expect(line).toContain('min/max gaps');
  });
});

describe('Round 60: five sides tight, the sixth only wider', () => {
  // keyframes' 3206 shells: +0.396..+0.499 off the 1792-vertex body on five sides, +55.807 on the front
  const shell = () => cand('outline', 1, [-0.45, -0.5, -0.48], [195.45, 195.46, 251.3], 3206);
  const body = () => cand('normal', 5, [0, 0, 0], [195, 195, 195.5], 1792);
  it('matches, at the offset of the five sides, and records the open side', () => {
    const s = shell();
    const b = body();
    shellsFromBodies([b, s]);
    expect(s.info.shellOf?.material).toBe(5);
    expect(s.info.shellOf?.open).toBe('front');
    expect(s.info.shellOf?.offset ?? 0).toBeGreaterThan(0.4);
    expect(s.info.shellOf?.offset ?? 9).toBeLessThan(0.5);
  });
  it('a tight body on all six sides still wins over a five-side one', () => {
    const full = cand('normal', 6, [0, 0, 0], [195, 195, 250.9], 900);
    const m = bodyOfShell(shell(), [body(), full]);
    expect(m?.body.info.material).toBe(6);
    expect(m?.open).toBeUndefined();
  });
  it("material 7's wrap stays out: a far body with even gaps on five sides is not a shell's body", () => {
    const far = cand('Material_5511', 7, [37.8, 37.8, 37.8], [157.6, 157.6, 157.6], 300);
    expect(bodyOfShell(shell(), [far])).toBeNull();
  });
  it('11027 vs 12782 (keyframes): back +0.248, the rest 11..39 units off, is not a match', () => {
    const s = cand('outline', 1, [0, 0, 0], [522.7, 522.7, 522.7], 11027);
    const b = cand('normal', 5, [17.671, 38.808, 0.248], [508.696, 511.507, 508.663], 12782);
    expect(bodyOfShell(s, [b])).toBeNull();
  });
});
