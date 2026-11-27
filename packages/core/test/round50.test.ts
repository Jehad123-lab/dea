import { describe, expect, it } from 'vitest';
import { costFits, OWN_COST_BUDGET_S, ownCostBudget, ownCostLine } from '../src/extract/index.ts';

describe('Round 50: --own-assets-cost time budget', () => {
  it('ownCostBudget: default 240 s, clamped to 30-3600', () => {
    expect(ownCostBudget()).toBe(OWN_COST_BUDGET_S);
    expect(OWN_COST_BUDGET_S).toBe(240);
    expect(ownCostBudget(5)).toBe(30);
    expect(ownCostBudget(99999)).toBe(3600);
    expect(ownCostBudget(Number.NaN)).toBe(240);
    expect(ownCostBudget(120.4)).toBe(120);
  });

  it('costFits: the first variant always runs; another only if the slowest so far still fits', () => {
    expect(costFits(0, 0, 30)).toBe(true);
    expect(costFits(0, 999_999, 30)).toBe(true);
    expect(costFits(100_000, 60_000, 240)).toBe(true);
    expect(costFits(200_000, 60_000, 240)).toBe(false);
  });

  it('ownCostLine lists variants past the budget as not scored', () => {
    const line = ownCostLine(0.8, [
      { what: 'real images', canvas: 0.85, page: 0.9 },
      { what: 'real meshes', canvas: null, page: 0, skipped: 'over the 240 s budget: --own-assets-cost-budget' },
    ]);
    expect(line).toContain('real images: canvas 85% (+5 points)');
    expect(line).toContain('real meshes: not scored (over the 240 s budget: --own-assets-cost-budget)');
  });
});
