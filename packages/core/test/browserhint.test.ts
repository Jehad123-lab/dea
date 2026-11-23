import { describe, expect, it } from 'vitest';
import { browserStartHint } from '../src/browser/open.ts';

describe('browserStartHint: what to do when no browser starts', () => {
  it('names the missing system libraries and how to install them', () => {
    const h = browserStartHint([
      'browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n/x/chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file',
      'browserType.launch: ... error while loading shared libraries: libXdamage.so.1: cannot open ... error while loading shared libraries: libatk-1.0.so.0: x',
    ]);
    expect(h).toContain('libatk-1.0.so.0, libXdamage.so.1');
    expect(h).toContain('npx playwright install-deps chromium');
    expect(h).toContain('LD_LIBRARY_PATH');
  });
  it("says the same for Playwright's own missing-dependencies message", () => {
    expect(browserStartHint(['Host system is missing dependencies to run browsers.'])).toContain('install-deps');
  });
  it('otherwise asks for a browser', () => {
    expect(browserStartHint(["Executable doesn't exist at /x/chrome"])).toBe('Install Chrome or Edge, or run: npx playwright install chromium');
  });
});
