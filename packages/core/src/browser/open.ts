import { type Browser, type BrowserContext, type CDPSession, chromium, type Page, type Response } from 'playwright';
import { currentCache } from '../cache.ts';
import { timed } from '../timings.ts';
import type { BrowserInfo } from '../types.ts';
import { INIT_SCRIPT, NAME_SHIM } from './init.ts';
import { forgetBrowser, trackBrowser } from './lifecycle.ts';
import { assertNotBotWall } from './wall.ts';

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
  /** Round 33: the page's renderer crashed (software WebGL running out of memory); later calls on the page fail */
  readonly crashed?: boolean;
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
    await Promise.all(
      pool.map(async (b) => {
        await b.browser.close().catch(() => {});
        forgetBrowser(b.browser);
      }),
    );
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
  else {
    await browser.close().catch(() => {});
    forgetBrowser(browser);
  }
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
  const full: string[] = [];
  for (const channel of order) {
    try {
      const browser = await chromium.launch({
        headless,
        args: ARGS,
        ...(channel === 'chromium' ? {} : { channel }),
      });
      trackBrowser(browser);
      return { browser, channel };
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`${channel}: ${msg.split('\n')[0]}`);
      full.push(msg);
    }
  }
  throw new Error(`Could not start a browser.\n${errors.join('\n')}\n${browserStartHint(full)}`);
}

/**
 * What to do when no browser starts. The usual case on a fresh Linux box or container: Chromium is downloaded but the
 * system libraries it links against are not installed, and Playwright only says "browser has been closed".
 */
export function browserStartHint(messages: string[]): string {
  const all = messages.join('\n');
  const libs = [...new Set([...all.matchAll(/error while loading shared libraries: ([^\s:]+)/g)].map((m) => m[1]))];
  if (libs.length || /missing dependencies|Host system is missing/i.test(all))
    return [
      `The browser is installed but this system is missing libraries it needs${libs.length ? ` (${libs.join(', ')})` : ''}.`,
      'Install them with: npx playwright install-deps chromium   (needs sudo; on Debian/Ubuntu it runs apt-get)',
      'Without sudo: apt-get download the packages that hold those files, unpack them with dpkg-deb -x into a folder, and',
      'point LD_LIBRARY_PATH at the folders holding the .so files. dea doctor shows the result.',
    ].join('\n');
  return 'Install Chrome or Edge, or run: npx playwright install chromium';
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
  // Round 33: a renderer crash shows up later as "Target page, context or browser has been closed" on an unrelated call;
  // record it when it happens so the report and the retry can say what actually went wrong
  let crashed = false;
  page.on('crash', () => {
    crashed = true;
    warnings.push("The page's renderer crashed (likely out of memory with software WebGL); DEA kept what it had read before.");
  });
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

  try {
    await assertNotBotWall(page, response);
  } catch (e) {
    await context.close().catch(() => {});
    await releaseBrowser(browser);
    throw e;
  }

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
    get crashed() {
      return crashed;
    },
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
/**
 * Helpers shared by the loader checks (run in the page). Round 28: a bare-counter layer is any ancestor covering 40% of the
 * viewport (fixed, absolute, or a plain 100vh block: jehaduddin.vercel.app's "28" in --no-replay was missed when it sat in
 * normal flow), but never one that holds the site's main canvas or real text (lusion.co's first screen was a false positive).
 */
const LOADER_HELPERS = `
  const area = innerWidth * innerHeight;
  const shown = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && el.getBoundingClientRect().width > 0; };
  const bigCanvas = (a) => [...a.querySelectorAll('canvas')].some((c) => { const r = c.getBoundingClientRect(); return r.width * r.height > area * 0.4; });
  const big = (el) => { const r = el.getBoundingClientRect(); return shown(el) && r.width * r.height > area * 0.4; };
  const textLen = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().length;
  const counterOf = (el) => { if (el.children.length > 3) return null; const t = (el.textContent || '').replace(/\\s+/g, '').trim(); const m = t.length <= 5 ? /^(\\d{1,3})%?$/.exec(t) : null; return m && +m[1] <= 100 ? +m[1] : null; };
  const counterLayer = (el) => {
    for (let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const r = a.getBoundingClientRect();
      if (r.width * r.height <= area * 0.4) continue;
      if (textLen(a) > 60 || bigCanvas(a)) return null;
      return a;
    }
    return null;
  };
  const named = () => [...document.querySelectorAll('[class*=loader i],[id*=loader i],[class*=preload i],[id*=preload i],[class*=loading i]')].filter((el) => el !== document.body && el !== document.documentElement && big(el) && !bigCanvas(el) && textLen(el) <= 200);
  const counters = () => { const out = []; for (const el of document.querySelectorAll('body *')) { const v = counterOf(el); if (v === null || !shown(el)) continue; const layer = counterLayer(el); if (layer) out.push({ el, v, layer }); } return out; };
`;

/** Is a loading screen covering the page? A visible progressbar or busy element, a big element named like a loader, or a bare
 * 0-100 counter alone on a big layer (Round 27/28). A named or counter layer that holds the main canvas or real text is the page. */
export const LOADER_VISIBLE = `(() => {${LOADER_HELPERS}
  for (const el of document.querySelectorAll('[role=progressbar],[aria-busy=true]')) { if (shown(el)) { const v = el.getAttribute('aria-valuenow'); if (v == null || +v < (+el.getAttribute('aria-valuemax') || 100)) return true; } }
  if (named().length) return true;
  return counters().length > 0;
})()`;

/**
 * How far a loading screen says it is, 0 to 100, or null when it shows no number (runs in the page): an ARIA progress value, or the
 * largest "42%" / "042" counter shown inside an element named like a loader, or a bare counter on a big layer. Read twice, a
 * rising number says the loader is working.
 */
export const LOADER_PROGRESS = `(() => {${LOADER_HELPERS}
  let best = null;
  const take = (v) => { if (Number.isFinite(v) && v >= 0 && v <= 100 && (best === null || v > best)) best = v; };
  for (const el of document.querySelectorAll('[role=progressbar]')) { const v = el.getAttribute('aria-valuenow'); if (v != null) take(+v / ((+el.getAttribute('aria-valuemax') || 100) / 100)); }
  for (const el of document.querySelectorAll('[class*=loader i],[id*=loader i],[class*=preload i],[id*=preload i],[class*=loading i],[class*=progress i],[class*=counter i],[class*=percent i]')) {
    if (!shown(el)) continue;
    const t = (el.textContent || '').trim(); if (t.length > 12) continue;
    const m = /^(\\d{1,3})\\s?%?$/.exec(t); if (m) take(+m[1]);
  }
  if (best === null) for (const c of counters()) take(c.v);
  return best;
})()`;

/**
 * Round 28: hide the layers a stalled loader sits on (runs in the page) and return how many were hidden. jehaduddin.vercel.app's
 * counter crawls 63 -> 64 and stalls on software WebGL while the page behind it is already laid out, so a reference taken
 * through the loader shows the site instead of a black screen. The page is told nothing; only the cover is hidden.
 */
export const LOADER_HIDE = `(() => {${LOADER_HELPERS}
  const layers = new Set([...named(), ...counters().map((c) => c.layer)]);
  for (const el of document.querySelectorAll('[role=progressbar],[aria-busy=true]')) { let a = el; while (a.parentElement && a.parentElement !== document.body && !big(a)) a = a.parentElement; if (big(a) && !bigCanvas(a) && textLen(a) <= 200) layers.add(a); }
  for (const el of layers) { el.style.setProperty('visibility', 'hidden', 'important'); el.style.setProperty('opacity', '0', 'important'); el.style.setProperty('pointer-events', 'none', 'important'); el.setAttribute('data-dea-hidden-loader', ''); }
  return layers.size;
})()`;

/** Round 29: undo LOADER_HIDE (a look through the loader showed a flat page too, so the loader goes back and the watch goes on). */
export const LOADER_UNHIDE = `(() => {
  const els = document.querySelectorAll('[data-dea-hidden-loader]');
  for (const el of els) { el.style.removeProperty('visibility'); el.style.removeProperty('opacity'); el.style.removeProperty('pointer-events'); el.removeAttribute('data-dea-hidden-loader'); }
  return els.length;
})()`;

/**
 * Round 29: why the loader check says what it says (runs in the page), as one short line for the timings log: which rule matched,
 * or why the loader-like candidates were turned down. --no-replay on jehaduddin.vercel.app kept its "36" preloader with
 * referenceLoader false and nothing said why.
 */
export const LOADER_WHY = `(() => {${LOADER_HELPERS}
  const d = (el) => { const r = el.getBoundingClientRect(); const id = el.id ? '#' + el.id : ''; const c = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''; return el.tagName.toLowerCase() + id + c + ' (' + Math.round((r.width * r.height * 100) / area) + '% cover, ' + textLen(el) + ' chars)'; };
  const why = [];
  for (const el of document.querySelectorAll('[role=progressbar],[aria-busy=true]')) why.push((shown(el) ? 'progressbar ' : 'hidden progressbar ') + d(el));
  for (const el of document.querySelectorAll('[class*=loader i],[id*=loader i],[class*=preload i],[id*=preload i],[class*=loading i]')) {
    if (el === document.body || el === document.documentElement) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const reason = cs.display === 'none' ? 'display none' : cs.visibility === 'hidden' ? 'visibility hidden' : +cs.opacity <= 0.05 ? 'opacity ' + cs.opacity : r.width * r.height <= area * 0.4 ? 'covers under 40%' : bigCanvas(el) ? 'holds the main canvas' : textLen(el) > 200 ? 'too much text' : null;
    why.push((reason ? 'named, rejected (' + reason + ') ' : 'named loader ') + d(el));
    if (why.length > 5) break;
  }
  for (const el of document.querySelectorAll('body *')) {
    const v = counterOf(el); if (v === null) continue;
    if (!shown(el)) { why.push('counter ' + v + ' not shown ' + d(el)); continue; }
    const layer = counterLayer(el);
    why.push(layer ? 'counter ' + v + ' on ' + d(layer) : 'counter ' + v + ' rejected (no big layer without canvas or text) ' + d(el));
    if (why.length > 8) break;
  }
  return why.length ? why.join('; ') : 'no loader-like element';
})()`;

/**
 * Round 30: is a WebGL canvas on the first screen and drawing? (runs in the page) A context exists, a visible canvas covers 10% of
 * the viewport, and the page's animation frames keep coming (the raf count is returned so two reads can tell).
 */
export const GL_ON_SCREEN = `(() => {
  const D = window.__DEA__;
  if (!D || !D.contexts || !D.contexts.length) return -1;
  const area = innerWidth * innerHeight;
  const ok = [...document.querySelectorAll('canvas')].some((c) => { const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && r.width * r.height > area * 0.1 && r.bottom > 0 && r.top < innerHeight; });
  return ok ? D.raf.calls : -1;
})()`;

/**
 * Wait for a loading screen to finish. Software WebGL loads slowly, so a fixed wait either gives up on a loader that is still
 * moving or waits on one that is stuck: this waits while the loader shows progress (a rising counter, or a picture that keeps
 * changing) and gives up after `stuckMs` without any, or at `maxMs`. Returns how it ended, so a report can say it.
 */
export async function waitForLoader(
  page: Page,
  o: { maxMs?: number; stuckMs?: number; pollMs?: number; changed?: () => Promise<number> } = {},
): Promise<{ gone: boolean; waitedMs: number; progress: number | null; reason: 'gone' | 'stuck' | 'cap' }> {
  const maxMs = o.maxMs ?? 420_000;
  const stuckMs = o.stuckMs ?? 60_000;
  const poll = o.pollMs ?? 2_500;
  const t0 = Date.now();
  let last: number | null = null;
  let moved = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (!(await page.evaluate(LOADER_VISIBLE).catch(() => false))) return { gone: true, waitedMs: Date.now() - t0, progress: last, reason: 'gone' };
    const p = (await page.evaluate(LOADER_PROGRESS).catch(() => null)) as number | null;
    if (p !== null && (last === null || p > last)) moved = Date.now();
    if (p !== null) last = p;
    if (o.changed && (await o.changed().catch(() => 0)) > 0) moved = Date.now();
    if (Date.now() - moved > stuckMs) return { gone: false, waitedMs: Date.now() - t0, progress: last, reason: 'stuck' };
    await page.waitForTimeout(poll);
  }
  return { gone: false, waitedMs: Date.now() - t0, progress: last, reason: 'cap' };
}

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
