import { describe, expect, it } from 'vitest';
import { GL_ON_SCREEN } from '../src/browser/open.ts';
import { keepWatching, POST_LOADER_GL_FULL_MS, POST_LOADER_GL_QUICK_MS, postLoaderGlWait } from '../src/extract/refwait.ts';

describe('Round 30: wait for WebGL after a loading screen', () => {
  const base = { loaderSeen: true, bestFlat: false, glOnScreen: false, quick: true };
  it('a page that showed a loader and has no drawing canvas yet waits', () => {
    expect(postLoaderGlWait(base)).toBe(POST_LOADER_GL_QUICK_MS);
    expect(postLoaderGlWait({ ...base, quick: false })).toBe(POST_LOADER_GL_FULL_MS);
  });
  it('no wait without a loader, with a drawing canvas, or with a flat reference', () => {
    expect(postLoaderGlWait({ ...base, loaderSeen: false })).toBe(0);
    expect(postLoaderGlWait({ ...base, glOnScreen: true })).toBe(0);
    expect(postLoaderGlWait({ ...base, bestFlat: true })).toBe(0);
  });
  it('GL_ON_SCREEN is valid page code', () => {
    expect(() => new Function(`return ${GL_ON_SCREEN}`)).not.toThrow();
  });
});

describe('Round 30: a visible loader over a flat frame holds the watch', () => {
  const w = { elapsed: 96_000, ms: 13_000, hardCap: 32_500, longCap: 180_000, loader: true, pctAge: 70_000, bestFlat: true, changedAge: 30_000, quick: true };
  it('a paused counter does not end the watch while the loader is up and only flat frames exist', () => {
    expect(keepWatching(w)).toBe(true);
    expect(keepWatching({ ...w, elapsed: 180_001 })).toBe(false);
    expect(keepWatching({ ...w, loader: false })).toBe(false);
  });
});
