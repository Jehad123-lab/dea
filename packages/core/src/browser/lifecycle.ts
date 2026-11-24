// Keeping track of the browsers DEA starts, so a signal or an early exit closes them instead of leaving Chromium
// processes behind. Playwright's driver normally dies with its parent and takes the browser with it, but that is not
// guaranteed (a browser that is still starting, a driver whose pipe stays open, `process.exit` in the middle of a
// stage): DEA then closes its browsers itself, and kills the processes of any that will not close in time.

import type { Browser } from 'playwright';

interface Tracked {
  browser: Browser;
  /** the browser's own process ids, read over CDP when the first close attempt needs them */
  pids: number[];
}

const tracked = new Set<Tracked>();

/** Remember a browser DEA started, so a signal or an early exit can close it. */
export function trackBrowser(browser: Browser): void {
  for (const t of tracked) if (t.browser === browser) return;
  tracked.add({ browser, pids: [] });
}

/** Forget a browser that closed on its own (its session ended). */
export function forgetBrowser(browser: Browser | null | undefined): void {
  if (!browser) return;
  for (const t of tracked) if (t.browser === browser) tracked.delete(t);
}

/** How many browsers DEA has open right now. */
export function trackedBrowsers(): number {
  return tracked.size;
}

/** What a signal means to a command line tool: the shell's 128 + the signal number. */
export function signalExitCode(sig: NodeJS.Signals): number {
  return sig === 'SIGINT' ? 130 : sig === 'SIGHUP' ? 129 : sig === 'SIGTERM' ? 143 : 1;
}

/** Kill a process and its group where there is one; true when the signal was delivered. */
export function killPid(pid: number, signal: NodeJS.Signals = 'SIGKILL'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * The process ids of a running Chromium browser, its own process first, read over CDP's SystemInfo. An empty list when
 * the browser cannot answer (already closed, or not a Chromium browser): then only `browser.close()` can clean up.
 */
export async function browserPids(browser: Browser): Promise<number[]> {
  try {
    const session = await browser.newBrowserCDPSession();
    const info = (await session.send('SystemInfo.getProcessInfo')) as { processInfo?: Array<{ id: number; type: string }> };
    await session.detach().catch(() => {});
    const list = info?.processInfo ?? [];
    const kernel = list.filter((p) => p.type === 'browser');
    return [...kernel.map((p) => p.id), ...list.filter((p) => p.type !== 'browser').map((p) => p.id)];
  } catch {
    return [];
  }
}

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    if (typeof t.unref === 'function') t.unref();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

/**
 * Close every browser DEA has open, giving them `ms` together to close; whatever is still connected after that has its
 * processes killed by pid (and again on `close()` in case the kill raced a driver that was already restarting).
 */
export async function closeTrackedBrowsers(ms = 3000, kill: (pid: number) => boolean = killPid): Promise<{ closed: number; killed: number }> {
  const list = [...tracked];
  if (!list.length) return { closed: 0, killed: 0 };
  // the pids are read while the browsers are still alive: a close that hangs takes the CDP session with it
  await Promise.all(list.map(async (t) => (t.pids = (await within(browserPids(t.browser), Math.max(250, ms / 2))) ?? [])));
  await within(Promise.allSettled(list.map((t) => t.browser.close())), ms);
  let closed = 0;
  let killed = 0;
  for (const t of list) {
    tracked.delete(t);
    if (!t.browser.isConnected()) {
      closed++;
      continue;
    }
    // close() did not return in time: the browser's own process (and its children) end here
    for (const pid of t.pids) if (kill(pid)) killed++;
    await within(t.browser.close(), 1000);
  }
  return { closed, killed };
}

export interface CleanupOptions {
  /** how long the browsers get to close before their processes are killed */
  ms?: number;
  /** called instead of process.exit, for tests */
  exit?: (code: number) => void;
  kill?: (pid: number) => boolean;
}

const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
let installed: { remove: () => void } | null = null;
let stopping = false;

/** True from the moment a signal or an error started the shutdown: stages that fail now fail because of it. */
export function shuttingDown(): boolean {
  return stopping;
}

/**
 * Close DEA's browsers (and kill anything that will not close) when the command is interrupted or fails, then exit with
 * the code the shell expects: 130 for SIGINT, 143 for SIGTERM, 1 for an uncaught error. Installed once; the returned
 * function removes the handlers (tests use it).
 */
export function installBrowserCleanup(opts: CleanupOptions = {}): () => void {
  if (installed) return installed.remove;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const kill = opts.kill ?? killPid;
  const stop = (code: number, why?: string) => {
    if (stopping) return;
    stopping = true;
    if (why) process.stderr.write(why);
    void closeTrackedBrowsers(opts.ms ?? 3000, kill).then(
      () => exit(code),
      () => exit(code),
    );
  };
  const onSignal = (sig: NodeJS.Signals) => () => stop(signalExitCode(sig));
  const handlers: Array<[string, (...a: unknown[]) => void]> = SIGNALS.map((sig) => [sig, onSignal(sig)] as [string, (...a: unknown[]) => void]);
  handlers.push([
    'uncaughtException',
    (e: unknown) => {
      const err = e as Error;
      process.stderr.write(`${err?.stack ?? String(e)}\n`);
      stop(1);
    },
  ]);
  handlers.push([
    'unhandledRejection',
    (e: unknown) => {
      const err = e as Error;
      process.stderr.write(`${err?.stack ?? String(e)}\n`);
      stop(1);
    },
  ]);
  for (const [name, fn] of handlers) process.on(name as NodeJS.Signals, fn as (...a: unknown[]) => void);
  const remove = () => {
    for (const [name, fn] of handlers) process.off(name as NodeJS.Signals, fn as (...a: unknown[]) => void);
    installed = null;
    stopping = false;
  };
  installed = { remove };
  return remove;
}
