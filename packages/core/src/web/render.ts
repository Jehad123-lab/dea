import { launchBrowser, releaseBrowser } from '../browser/open.ts';
import { refuseAddress, USER_AGENT } from './http.ts';

export interface RenderOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** tests only: the page itself may be on this machine (its own origin only; any other private address is still refused). Never reachable from the CLI or the MCP tools. */
  allowPrivate?: boolean;
  browser?: 'auto' | 'chrome' | 'msedge' | 'chromium';
}

export interface Rendered {
  html: string;
  finalUrl: string;
  /** requests the render refused (private addresses, other schemes) */
  refused: number;
  browser: string;
}

/**
 * The page after its own scripts ran, read in a fresh headless browser with nothing stored in it (no cookies, no logins).
 * Requests to private and local addresses are refused, so a public page cannot use the render to reach into your network.
 * Pictures, fonts and media are not downloaded. The browser is closed whatever happens.
 */
export async function renderHtml(url: string, o: RenderOptions = {}): Promise<Rendered> {
  const timeout = o.timeoutMs ?? 20_000;
  const { browser, channel } = await launchBrowser(o.browser ?? 'auto', true);
  let refused = 0;
  const ownOrigin = new URL(url).origin;
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', async (route) => {
      const req = route.request();
      const u = req.url();
      if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return route.continue();
      if (refuseAddress(u) && !(o.allowPrivate && new URL(u).origin === ownOrigin)) {
        refused++;
        return route.abort('blockedbyclient');
      }
      if (['image', 'media', 'font'].includes(req.resourceType())) return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    const abort = () => void browser.close().catch(() => {});
    o.signal?.addEventListener('abort', abort, { once: true });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForLoadState('networkidle', { timeout: Math.min(6000, timeout) }).catch(() => {});
    // scripts that build the page after the network goes quiet: wait until the text stops growing (at most ~3 s)
    let last = -1;
    for (let i = 0; i < 10; i++) {
      // biome-ignore lint/performance/useDomNodeTextContent: innerText on purpose: visible text only, which is what grows as the page renders
      const n = await page.evaluate(() => document.body?.innerText.length ?? 0).catch(() => 0);
      if (n === last && n > 0) break;
      last = n;
      await page.waitForTimeout(300);
    }
    const html = await page.content();
    const finalUrl = page.url();
    o.signal?.removeEventListener('abort', abort);
    await context.close().catch(() => {});
    return { html, finalUrl, refused, browser: channel };
  } finally {
    await releaseBrowser(browser);
  }
}

/** A page that served almost no text but plenty of script is probably built in the browser. */
export function looksLikeShell(html: string, textChars: number): boolean {
  if (textChars >= 600) return false;
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const root = /<div[^>]+id=["'](root|app|__next|__nuxt|svelte|___gatsby)["']/i.test(html);
  const nojs = /<noscript[^>]*>[\s\S]{0,400}?(enable|requires?)\s+javascript/i.test(html);
  return scripts >= 1 && (root || nojs || textChars < 200);
}
