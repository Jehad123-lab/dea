import type { Browser } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserPids,
  closeTrackedBrowsers,
  forgetBrowser,
  installBrowserCleanup,
  signalExitCode,
  trackBrowser,
  trackedBrowsers,
} from '../src/browser/lifecycle.ts';

interface Fake {
  browser: Browser;
  closed: boolean;
}

/** A browser that answers CDP with one browser process and one renderer, and closes (or hangs) when asked. */
function fakeBrowser(opts: { hang?: boolean; pids?: number[] } = {}): Fake {
  const state = { closed: false };
  const tracks = opts.pids ?? [4242, 4243];
  const browser = {
    isConnected: () => !state.closed,
    close: async () => {
      if (opts.hang) return new Promise<void>(() => {});
      state.closed = true;
    },
    newBrowserCDPSession: async () => ({
      send: async () => ({ processInfo: tracks.map((id, i) => ({ id, type: i === 0 ? 'browser' : 'renderer' })) }),
      detach: async () => {},
    }),
  } as unknown as Browser;
  return {
    browser,
    get closed() {
      return state.closed;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('browser lifecycle', () => {
  it('closes every browser it was told about and forgets them', async () => {
    const a = fakeBrowser();
    const b = fakeBrowser();
    trackBrowser(a.browser);
    trackBrowser(b.browser);
    expect(trackedBrowsers()).toBe(2);
    const r = await closeTrackedBrowsers(200, () => true);
    expect(r.closed).toBe(2);
    expect(r.killed).toBe(0);
    expect(a.closed && b.closed).toBe(true);
    expect(trackedBrowsers()).toBe(0);
  });

  it('kills the processes of a browser whose close() never returns', async () => {
    const hung = fakeBrowser({ hang: true, pids: [9001, 9002] });
    trackBrowser(hung.browser);
    const killed: number[] = [];
    const r = await closeTrackedBrowsers(50, (pid) => {
      killed.push(pid);
      return true;
    });
    expect(r.killed).toBe(2);
    expect(killed).toEqual([9001, 9002]);
    expect(trackedBrowsers()).toBe(0);
  });

  it('does not track the same browser twice, and forgetBrowser drops one', () => {
    const a = fakeBrowser();
    trackBrowser(a.browser);
    trackBrowser(a.browser);
    expect(trackedBrowsers()).toBe(1);
    forgetBrowser(a.browser);
    expect(trackedBrowsers()).toBe(0);
  });

  it('reads the pids of the browser process first', async () => {
    const b = fakeBrowser({ pids: [7, 8, 9] });
    expect(await browserPids(b.browser)).toEqual([7, 8, 9]);
    const broken = { newBrowserCDPSession: async () => Promise.reject(new Error('no')) } as unknown as Browser;
    expect(await browserPids(broken)).toEqual([]);
  });

  it('maps a signal to the code a shell expects', () => {
    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
    expect(signalExitCode('SIGHUP')).toBe(129);
  });

  it('closes the browsers and exits with the signal code when interrupted', async () => {
    const before = process.listenerCount('SIGINT');
    const b = fakeBrowser();
    trackBrowser(b.browser);
    const exits: number[] = [];
    const remove = installBrowserCleanup({ ms: 200, exit: (code) => exits.push(code) });
    process.emit('SIGINT');
    await vi.waitFor(() => expect(exits).toEqual([130]), { timeout: 3000 });
    expect(b.closed).toBe(true);
    expect(trackedBrowsers()).toBe(0);
    remove();
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('on an uncaught error it closes the browsers and exits 1', async () => {
    const b = fakeBrowser();
    trackBrowser(b.browser);
    const exits: number[] = [];
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const remove = installBrowserCleanup({ ms: 200, exit: (code) => exits.push(code) });
    process.emit('uncaughtException', new Error('stage blew up'));
    await vi.waitFor(() => expect(exits).toEqual([1]), { timeout: 3000 });
    expect(b.closed).toBe(true);
    expect(err).toHaveBeenCalled();
    remove();
  });
});
