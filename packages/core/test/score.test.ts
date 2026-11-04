import { describe, expect, it } from 'vitest';
import { canvasLine, canvasScore, correlation, histogram, type Luma, ssim } from '../src/extract/score.ts';

const make = (w: number, h: number, f: (x: number, y: number) => number, hide?: (x: number, y: number) => boolean): Luma => {
  const l = new Float64Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      l[y * w + x] = f(x, y);
      mask[y * w + x] = hide?.(x, y) ? 1 : 0;
    }
  return { w, h, l, mask };
};

// a soft glow: bright in the middle, dark at the edges (what a particle cloud looks like from far away)
const glow = (x: number, y: number) => 255 * Math.exp(-(((x - 32) / 14) ** 2 + ((y - 24) / 10) ** 2));
// a seeded speckle so tests are repeatable
const rand = (s: number) => {
  let t = s;
  return () => {
    t = (t * 1664525 + 1013904223) % 4294967296;
    return t / 4294967296;
  };
};

describe('canvas-only score', () => {
  it('an image is identical to itself', () => {
    const a = make(64, 48, glow);
    expect(ssim(a, a)).toBeCloseTo(1, 6);
    expect(canvasScore(a, a).score).toBeCloseTo(1, 6);
  });

  it('a flat stand-in scores low against a structured picture, even with the same mean brightness', () => {
    const a = make(64, 48, glow);
    let mean = 0;
    for (const v of a.l) mean += v;
    mean /= a.l.length;
    const flat = make(64, 48, () => mean);
    const s = canvasScore(a, flat);
    expect(s.score).toBeLessThan(0.55);
    expect(s.edges).toBe(0);
  });

  it('a closer picture scores higher than a further one', () => {
    const a = make(64, 48, glow);
    const r = rand(7);
    const near = make(64, 48, (x, y) => glow(x + 1, y) + r() * 10);
    const far = make(64, 48, (x, y) => glow(x + 18, y + 9));
    expect(canvasScore(a, near).score).toBeGreaterThan(canvasScore(a, far).score + 0.1);
  });

  it('text boxes are hidden: what is under them cannot move the score', () => {
    const box = (x: number, y: number) => x >= 4 && x < 30 && y >= 4 && y < 20;
    const a = make(64, 48, glow, box);
    const b = make(64, 48, (x, y) => (box(x, y) ? 255 : glow(x, y)));
    const s = canvasScore(a, b);
    expect(s.score).toBeGreaterThan(0.97);
    expect(s.masked).toBeCloseTo((26 * 16) / (64 * 48), 3);
  });

  it('edge correlation and tone histogram behave at their limits', () => {
    const m = new Uint8Array(4);
    expect(correlation(Float64Array.from([1, 1, 1, 1]), Float64Array.from([2, 2, 2, 2]), m)).toBe(1);
    expect(correlation(Float64Array.from([0, 1, 2, 3]), Float64Array.from([0, 2, 4, 6]), m)).toBeCloseTo(1, 6);
    const black = make(8, 8, () => 0);
    const white = make(8, 8, () => 255);
    expect(histogram(black, white)).toBe(0);
    expect(histogram(black, black)).toBe(1);
  });

  it('prints one line', () => {
    const a = make(64, 48, glow);
    expect(canvasLine(canvasScore(a, a))).toMatch(/^canvas 100% \(SSIM 100%, edges 100%, tones 100%\)$/);
    expect(canvasLine(null)).toMatch(/no canvas/);
  });
});
