import { type Browser, type BrowserContext, type CDPSession, chromium, type Page, type Response } from 'playwright';
import { currentCache } from '../cache.ts';
import { timed } from '../timings.ts';
import type { BrowserInfo } from '../types.ts';
import { INIT_SCRIPT, NAME_SHIM } from './init.ts';

export type BrowserChoice = 'auto' | 'chromium' | 'chrome' | 'msedge';

export interface OpenOptions {
  /** auto = your installed Chrome, then Edge, then Playwright's Chromium */
  browser?: BrowserChoice;
  headless?: boolean;
  viewport?: { width: number; height: number };
  /** record a HAR here (written when the session closes) */
  harPath?: string;
  /** navigation timeout */
  timeoutMs?: number;
  /** runs after observers are installed and before navigation (e.g. start CDP listeners) */
  beforeGoto?: (page: Page, cdp: CDPSession) => Promise<void>;
  /** extra settle time after load, for WebGL and intro animations */
  settleMs?: number;
  /**
   * When WebGL runs in software here (no GPU), tell the page a common GPU name so sites that
   * downgrade on software rendering still show their 3D. Default true; always recorded in the run.
   */
  gpuMask?: boolean;
}

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
  info: BrowserInfo;
  response: Response | null;
  warnings: string[];
  close(): Promise<void>;
}

const ARGS = [
  // let WebGL run on machines with no GPU (software rendering) and on blocklisted GPUs
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--hide-scrollbars',
  // Chrome's own wheel smoothing would look like a smooth-scroll library; turn it off so any easing DEA sees is the site's
  '--disable-smooth-scrolling',
];

/** One browser kept open for a whole command (every stage, every --batch URL): each stage gets its own context. */

/**
 * Run `fn` with a small pool of browsers shared by every `launchBrowser` / `openSite` inside it: a stage borrows an
 * idle browser (or a new one while the pool is under `max`), and closing its session closes only its context. One
 * browser per stage running side by side, because each browser draws WebGL in a single GPU process: stages sharing one
 * browser would queue behind each other's frames. Nested calls reuse the outer pool. The browsers close when the
 * outermost call ends.
 */
export async function withSharedBrowser<T>(choice: BrowserChoice, headless: boolean, fn: () => Promise<T>, opts: { max?: number } = {}): Promise<T> {
  const key = `${choice}|${headless}`;
  if (shared?.key === key && shared.pool.some((b) => b.browser.isConnected())) return fn();
  const outer = shared;
  const first = await timed('browser launch', () => startBrowser(choice, headless));
  const pool: Pooled[] = [{ ...first, users: 0 }];
  shared = { key, pool, max: Math.max(1, opts.max ?? 4) };
  try {
    return await fn();
  } finally {
    shared = outer;
    await Promise.all(pool.map((b) => b.browser.close().catch(() => {})));
  }
}

interface Pooled {
  browser: Browser;
  channel: string;
  users: number;
}
let shared: { key: string; pool: Pooled[]; max: number } | null = null;

/** How many browsers the shared pool holds right now (0 outside withSharedBrowser). */
export function sharedBrowsers(): number {
  return shared?.pool.length ?? 0;
}

/** Is this one of the browsers `withSharedBrowser` keeps open? (then close the context, not the browser) */
export function isShared(browser: Browser | null | undefined): boolean {
  return Boolean(browser && shared?.pool.some((b) => b.browser === browser));
}

/** Hand a browser back: a pooled one stays open for the next stage, any other is closed. */
export async function releaseBrowser(browser: Browser | null | undefined): Promise<void> {
  if (!browser) return;
  const p = shared?.pool.find((b) => b.browser === browser);
  if (p) p.users = Math.max(0, p.users - 1);
  else await browser.close().catch(() => {});
}

/** Start a browser, or borrow one from the shared pool when a command keeps one open (see withSharedBrowser). */
export async function launchBrowser(choice: BrowserChoice, headless: boolean): Promise<{ browser: Browser; channel: string }> {
  if (shared && shared.key === `${choice}|${headless}`) {
    const live = shared.pool.filter((b) => b.browser.isConnected());
    let pick = live.find((b) => b.users === 0);
    if (!pick && live.length < shared.max) {
      const s = shared;
      const b = await startBrowser(choice, headless);
      pick = { ...b, users: 0 };
      s.pool.push(pick);
    }
    pick ??= live.sort((a, b) => a.users - b.users)[0];
    if (pick) {
      pick.users++;
      return { browser: pick.browser, channel: pick.channel };
    }
  }
  return startBrowser(choice, headless);
}

/** Start a browser: your installed Chrome, then Edge, then Playwright's Chromium (or exactly the one asked for). */
async function startBrowser(choice: BrowserChoice, headless: boolean): Promise<{ browser: Browser; channel: string }> {
  const order: Array<'chrome' | 'msedge' | 'chromium'> = choice === 'auto' ? ['chrome', 'msedge', 'chromium'] : [choice];
  const errors: string[] = [];
  for (const channel of order) {
    try {
      const browser = await chromium.launch({
        headless,
        args: ARGS,
        ...(channel === 'chromium' ? {} : { channel }),
      });
      return { browser, channel };
    } catch (e) {
      errors.push(`${channel}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(`Could not start a browser.\n${errors.join('\n')}\nInstall Chrome or Edge, or run: npx playwright install chromium`);
}

/** DEA's page observers (WebGL, shaders, rAF, library probes). Installed before any page script runs. */
export async function installObservers(context: BrowserContext, gpuMask?: boolean): Promise<void> {
  await context.addInitScript({ content: NAME_SHIM });
  if (gpuMask === false) await context.addInitScript({ content: 'window.__DEA_GPU_MASK__ = false;' });
  await context.addInitScript({ content: INIT_SCRIPT });
}

export function browserInfo(browser: Browser, channel: string, headless: boolean): BrowserInfo {
  return {
    name: channel === 'msedge' ? 'Microsoft Edge' : channel === 'chrome' ? 'Google Chrome' : 'Chromium',
    version: browser.version(),
    headless,
    channel,
  };
}

/** Open a URL in a real browser with DEA's observers installed. */
export async function openSite(url: string, opts: OpenOptions = {}): Promise<Session> {
  const target = normalizeUrl(url);
  const headless = opts.headless ?? true;
  const viewport = opts.viewport ?? { width: 1440, height: 900 };
  const { browser, channel } = await timed('browser launch', () => launchBrowser(opts.browser ?? 'auto', headless));
  const warnings: string[] = [];
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: false,
    ...(opts.harPath ? { recordHar: { path: opts.harPath, content: 'omit' as const, mode: 'full' as const } } : {}),
  });
  await installObservers(context, opts.gpuMask);
  await currentCache()?.attach(context);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(opts.timeoutMs ?? 45_000);
  if (opts.beforeGoto) await opts.beforeGoto(page, cdp);

  let response: Response | null = null;
  try {
    response = await timed('page load', () => page.goto(target, { waitUntil: 'load', timeout: opts.timeoutMs ?? 45_000 }));
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    if (/Timeout/i.test(msg) && page.url() !== 'about:blank') {
      warnings.push(`The page did not finish loading in time; DEA read what had loaded. (${msg})`);
    } else {
      await context.close().catch(() => {});
      await releaseBrowser(browser);
      throw new Error(`Could not open ${target}: ${msg}`);
    }
  }
  await timed('network idle wait', async () => {
    const r = await quietOrDrawing(page, 8_000);
    if (r === 'timeout') warnings.push('The network never went quiet (normal for sites that stream or poll); DEA waited 8 s and moved on.');
  });
  await timed('settle wait', () => settle(page, opts.settleMs ?? 2_500));

  const info = browserInfo(browser, channel, headless);
  let closed = false;
  return {
    browser,
    context,
    page,
    cdp,
    info,
    response,
    warnings,
    async close() {
      if (closed) return;
      closed = true;
      await context.close().catch(() => {}); // writes the HAR
      await releaseBrowser(browser);
    },
  };
}

/**
 * Wait for the network to go quiet, or, on a page that is already drawing WebGL frames (a 3D site often streams or
 * polls forever), until it has drawn 20 frames and at least 2.5 s have passed since load. Never longer than `maxMs`.
 */
export async function quietOrDrawing(page: Page, maxMs: number): Promise<'idle' | 'drawing' | 'timeout'> {
  const t0 = Date.now();
  let done = false;
  const idle = page
    .waitForLoadState('networkidle', { timeout: maxMs })
    .then(() => 'idle' as const)
    .catch(() => 'timeout' as const);
  const drawing = (async () => {
    const read = () =>
      page
        .evaluate('window.__DEA__ ? [window.__DEA__.contexts.length, window.__DEA__.raf.calls] : [0, 0]')
        .then((v) => v as [number, number])
        .catch(() => [0, 0] as [number, number]);
    const [, raf0] = await read();
    while (!done && Date.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 250));
      const [contexts, raf] = await read();
      if (contexts && raf - raf0 >= 20 && Date.now() - t0 >= 2_500) return 'drawing' as const;
    }
    return 'timeout' as const;
  })();
  const r = await Promise.race([idle, drawing]);
  done = true;
  return r === 'timeout' ? await idle : r;
}

/**
 * Let the page settle after the network went quiet: a page with no WebGL waits a short beat; a page with WebGL waits
 * until it has drawn a few animation frames (its first real frames), never longer than `maxMs`.
 */
/** Is a loading screen covering the page? A visible progressbar or busy element, or a big element named like a loader. */
export const LOADER_VISIBLE = `(() => {
  const big = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && r.width * r.height > innerWidth * innerHeight * 0.4; };
  for (const el of document.querySelectorAll('[role=progressbar],[aria-busy=true]')) { const cs = getComputedStyle(el); if (cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && el.getBoundingClientRect().width > 0) { const v = el.getAttribute('aria-valuenow'); if (v == null || +v < (+el.getAttribute('aria-valuemax') || 100)) return true; } }
  for (const el of document.querySelectorAll('[class*=loader i],[id*=loader i],[class*=preload i],[id*=preload i],[class*=loading i]')) if (big(el)) return true;
  return false;
})()`;

export async function settle(page: Page, maxMs: number): Promise<void> {
  const t0 = Date.now();
  const read = () =>
    page
      .evaluate('window.__DEA__ ? [window.__DEA__.contexts.length, window.__DEA__.raf.calls] : [0, 0]')
      .then((v) => v as [number, number])
      .catch(() => [0, 0] as [number, number]);
  const [, raf0] = await read();
  const minMs = Math.min(maxMs, 800);
  // a WebGL page behind a loading screen is not settled until the loader is gone (up to 15 s)
  const loaderCap = Math.max(maxMs, 15_000);
  while (Date.now() - t0 < loaderCap) {
    await page.waitForTimeout(250);
    if (Date.now() - t0 < minMs) continue;
    const [contexts, raf] = await read();
    if (!contexts && Date.now() - t0 >= minMs) return;
    if (Date.now() - t0 < Math.min(maxMs, 2_500)) continue;
    if (raf - raf0 < 12 && Date.now() - t0 < maxMs) continue;
    if (!(await page.evaluate(LOADER_VISIBLE).catch(() => false))) return;
  }
}

export function normalizeUrl(url: string): string {
  const u = url.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
  const parsed = new URL(withScheme);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Only http and https URLs are supported, got ${parsed.protocol}`);
  return parsed.toString();
}
