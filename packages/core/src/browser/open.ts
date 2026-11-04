import { type Browser, type BrowserContext, type CDPSession, chromium, type Page, type Response } from 'playwright';
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

/** Start a browser: your installed Chrome, then Edge, then Playwright's Chromium (or exactly the one asked for). */
export async function launchBrowser(choice: BrowserChoice, headless: boolean): Promise<{ browser: Browser; channel: string }> {
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
      await browser.close().catch(() => {});
      throw new Error(`Could not open ${target}: ${msg}`);
    }
  }
  await timed('network idle wait', () =>
    page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {
      warnings.push('The network never went quiet (normal for sites that stream or poll); DEA waited 8 s and moved on.');
    }),
  );
  await timed('settle wait', () => page.waitForTimeout(opts.settleMs ?? 2_500));

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
      await browser.close().catch(() => {});
    },
  };
}

export function normalizeUrl(url: string): string {
  const u = url.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`;
  const parsed = new URL(withScheme);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Only http and https URLs are supported, got ${parsed.protocol}`);
  return parsed.toString();
}
