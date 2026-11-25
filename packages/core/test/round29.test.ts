import { describe, expect, it } from 'vitest';
import { LOADER_UNHIDE, LOADER_WHY } from '../src/browser/open.ts';
import { FLAT_STILL_MS, PEEL_MAX, PEEL_RETRY_MS, shouldPeel } from '../src/extract/refwait.ts';

describe('Round 29: when to look through a loader', () => {
  const base = { bestFlat: true, flat: true, changedAge: 5_000, elapsed: 40_000, hardCap: 32_500, sincePeel: Infinity, peels: 0 };
  it('a crawling counter (picture keeps changing) is looked through once the watch passes its hard cap', () => {
    expect(shouldPeel(base)).toBe(true);
    expect(shouldPeel({ ...base, elapsed: 20_000 })).toBe(false);
  });
  it('a still flat frame is looked through before the hard cap', () => {
    expect(shouldPeel({ ...base, elapsed: 25_000, changedAge: FLAT_STILL_MS })).toBe(true);
  });
  it('never when a detailed frame is kept or the current frame has detail', () => {
    expect(shouldPeel({ ...base, bestFlat: false })).toBe(false);
    expect(shouldPeel({ ...base, flat: false })).toBe(false);
  });
  it('retries are spaced and capped', () => {
    expect(shouldPeel({ ...base, sincePeel: PEEL_RETRY_MS - 1, peels: 1 })).toBe(false);
    expect(shouldPeel({ ...base, sincePeel: PEEL_RETRY_MS, peels: 1 })).toBe(true);
    expect(shouldPeel({ ...base, peels: PEEL_MAX })).toBe(false);
  });
});

describe('Round 29: loader scripts parse', () => {
  it('LOADER_WHY and LOADER_UNHIDE are valid page code', () => {
    expect(() => new Function(`return ${LOADER_WHY}`)).not.toThrow();
    expect(() => new Function(`return ${LOADER_UNHIDE}`)).not.toThrow();
    expect(LOADER_WHY).toContain('no loader-like element');
  });
});
