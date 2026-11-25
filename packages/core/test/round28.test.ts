import { describe, expect, it } from 'vitest';
import { LOADER_HIDE, LOADER_PROGRESS, LOADER_VISIBLE } from '../src/browser/open.ts';
import { keepWatching, PCT_STALL_MS, QUICK_LOADER_CAP_MS } from '../src/extract/refwait.ts';

describe('Round 28: quick mode follows a crawling loader counter', () => {
  const base = {
    elapsed: 120_000,
    ms: 13_000,
    hardCap: 32_500,
    longCap: Math.max(32_500, QUICK_LOADER_CAP_MS),
    loader: true,
    pctAge: 20_000,
    bestFlat: true,
    changedAge: 40_000,
    quick: true,
  };
  it('a counter that went up within the stall window keeps the watch going past the hard cap', () => {
    expect(keepWatching(base)).toBe(true);
  });
  it('stops at the quick loader cap', () => {
    expect(keepWatching({ ...base, elapsed: QUICK_LOADER_CAP_MS + 1 })).toBe(false);
  });
  it('a counter stuck longer than the stall window does not buy time once the flat extra wait is spent', () => {
    expect(keepWatching({ ...base, pctAge: PCT_STALL_MS + 1 })).toBe(false);
  });
  it('a detailed frame with no loader stops at the base length', () => {
    expect(keepWatching({ ...base, loader: false, bestFlat: false })).toBe(false);
  });
});

describe('Round 28: loader scripts are valid page code', () => {
  for (const [name, src] of [
    ['LOADER_VISIBLE', LOADER_VISIBLE],
    ['LOADER_PROGRESS', LOADER_PROGRESS],
    ['LOADER_HIDE', LOADER_HIDE],
  ] as const) {
    it(`${name} parses`, () => {
      expect(() => new Function(`return ${src}`)).not.toThrow();
      expect(src).toContain('counterLayer');
    });
  }
  it('the counter regex is escaped for the page (\\d, not d)', () => {
    expect(LOADER_VISIBLE).toContain('/^(\\d{1,3})%?$/');
  });
});
