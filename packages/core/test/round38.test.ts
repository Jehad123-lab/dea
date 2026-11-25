import { describe, expect, it } from 'vitest';
import { ownCostLine } from '../src/extract/index.ts';

describe('Round 38: --own-assets-cost line', () => {
  it('names each variant with its canvas, its gain over the shipped rebuild, and its page', () => {
    const line = ownCostLine(0.722, [
      { what: "the site's real images, stand-in meshes", canvas: 0.736, page: 0.822 },
      { what: "image colour grids, the site's real meshes", canvas: 0.888, page: 0.928 },
    ]);
    expect(line).toContain('shipped canvas 72.2%');
    expect(line).toContain('canvas 73.6% (+1.4 points), page 82.2%');
    expect(line).toContain('canvas 88.8% (+16.6 points), page 92.8%');
  });

  it('shows a loss with its sign and a missing canvas as n/a', () => {
    const line = ownCostLine(0.8, [
      { what: 'a', canvas: 0.75, page: 0.7 },
      { what: 'b', canvas: null, page: 0.6 },
    ]);
    expect(line).toContain('canvas 75% (-5 points)');
    expect(line).toContain('b: canvas n/a, page 60%');
  });
});
