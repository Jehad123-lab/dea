import type { Page, Response } from 'playwright';

/** What a bot-protection wall looks like from the outside: the page's own words and the response that carried them. */
export interface WallEvidence {
  status: number | null;
  headers: Record<string, string>;
  title: string;
  /** visible text, first few thousand characters */
  text: string;
  /** how much visible text the whole page has */
  textLength: number;
  /** element / frame / script markers read from the DOM (ids, iframe hosts, script hosts) */
  markers: string[];
}

export interface BotWall {
  vendor: string;
  reason: string;
}

/** Thrown when the site answers with a bot-protection wall instead of its pages. */
export class BotProtectionError extends Error {
  readonly vendor: string;
  readonly url: string;
  constructor(url: string, wall: BotWall, status: number | null) {
    super(
      `Blocked by bot protection (${wall.vendor}): ${new URL(url).host} answered ${status ?? 'a page'} with a challenge instead of its content (${wall.reason}). ` +
        `DEA does not get past bot protection (no bypass, no captcha solving), so nothing was captured and no kit was written: the block page is not the site. ` +
        `If you own the site, allow DEA's browser in your protection settings or point DEA at a staging copy.`,
    );
    this.name = 'BotProtectionError';
    this.vendor = wall.vendor;
    this.url = url;
  }
}

const VENDORS: Array<{ vendor: string; header?: RegExp; marker?: RegExp; text?: RegExp }> = [
  { vendor: 'PerimeterX / HUMAN', header: /^x-px-/i, marker: /px-captcha|perimeterx|px-cdn|px-cloud|\/px\//i, text: /press\s*(&|and)\s*hold|px-captcha/i },
  {
    vendor: 'Cloudflare',
    header: /^cf-mitigated$/i,
    marker: /challenge-platform|cf-challenge|cf-browser-verification|turnstile|challenge-form/i,
    text: /just a moment|checking your browser|attention required|verify you are human|enable javascript and cookies to continue/i,
  },
  { vendor: 'DataDome', marker: /captcha-delivery\.com|datadome/i, text: /datadome/i },
  { vendor: 'Akamai Bot Manager', marker: /akam\/|_abck|akamaihd.*bm/i, text: /access denied.*akamai|reference #\d+\.[0-9a-f]+/i },
  { vendor: 'Imperva / Incapsula', marker: /_incapsula_resource|incap_ses|imperva/i, text: /incapsula incident id/i },
  { vendor: 'Kasada', marker: /ips\.js|kpsdk|kasada/i },
  { vendor: 'hCaptcha / reCAPTCHA wall', marker: /hcaptcha\.com\/captcha|google\.com\/recaptcha\/api2\/anchor/i, text: /i am not a robot|select all images/i },
];

const GENERIC_TEXT =
  /(access (to this page )?(has been )?denied|are you a (human|robot)|unusual traffic|automated (queries|access|requests)|request (has been )?blocked|pardon our interruption|verify (that )?you are (a )?human|bot (check|detected|protection)|suspicious activity|too many requests)/i;

/**
 * Decide whether the page DEA is looking at is a bot-protection wall. A wall is a challenge page: a known vendor's
 * markers or headers together with little real content, or a blocking status with the vendor's header, or the generic
 * wording of a block page on a page with almost no text. A site that merely loads a bot-protection script
 * (most large sites do) is not a wall: it must also be missing its content.
 */
export function classifyBotWall(ev: WallEvidence): BotWall | null {
  const thin = ev.textLength < 1200;
  const blocking = ev.status === 403 || ev.status === 429 || ev.status === 503 || ev.status === 401 || ev.status === 202;
  const hay = `${ev.title}\n${ev.text}`;
  for (const v of VENDORS) {
    const headerHit = v.header ? Object.keys(ev.headers).find((k) => v.header?.test(k)) : undefined;
    const markerHit = v.marker ? ev.markers.find((m) => v.marker?.test(m)) : undefined;
    const textHit = v.text ? v.text.exec(hay)?.[0] : undefined;
    if (headerHit && blocking) return { vendor: v.vendor, reason: `response header ${headerHit} on a ${ev.status}` };
    if (textHit && thin) return { vendor: v.vendor, reason: `challenge wording "${textHit.trim().slice(0, 40)}"` };
    if (markerHit && thin && (blocking || textHit || ev.textLength < 400))
      return { vendor: v.vendor, reason: `challenge marker ${markerHit.slice(0, 50)} on a page with ${ev.textLength} characters of text` };
  }
  if (thin && blocking) {
    const g = GENERIC_TEXT.exec(hay)?.[0];
    if (g) return { vendor: 'unknown bot protection', reason: `status ${ev.status} and block-page wording "${g.trim().slice(0, 40)}"` };
  }
  if (thin && GENERIC_TEXT.test(ev.title)) return { vendor: 'unknown bot protection', reason: `block-page title "${ev.title.slice(0, 60)}"` };
  if (blocking && ev.textLength < 150 && ev.markers.some((m) => /captcha/i.test(m)))
    return { vendor: 'captcha wall', reason: `status ${ev.status} and a captcha on an empty page` };
  return null;
}

/** Read what the wall check needs from the live page. Never throws. */
export async function readWallEvidence(page: Page, response: Response | null): Promise<WallEvidence> {
  const headers: Record<string, string> = {};
  try {
    for (const [k, v] of Object.entries(response ? await response.allHeaders() : {})) headers[k.toLowerCase()] = String(v);
  } catch {}
  const dom = await page
    .evaluate(() => {
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      const markers: string[] = [];
      for (const el of Array.from(document.querySelectorAll('[id],[class]')).slice(0, 4000)) {
        const s = `${el.id ?? ''} ${typeof el.className === 'string' ? el.className : ''}`;
        if (/captcha|challenge|px-|cf-|incapsula|datadome|turnstile/i.test(s)) markers.push(s.trim().slice(0, 80));
        if (markers.length > 12) break;
      }
      for (const el of Array.from(document.querySelectorAll('iframe[src],script[src],noscript'))) {
        const s = (el as HTMLIFrameElement).src || el.textContent || '';
        if (/captcha|challenge|px-cdn|perimeterx|datadome|incapsula|kasada|akam|turnstile/i.test(s)) markers.push(s.slice(0, 120));
        if (markers.length > 24) break;
      }
      return { title: document.title ?? '', text: text.slice(0, 3000), textLength: text.length, markers };
    })
    .catch(() => ({ title: '', text: '', textLength: 0, markers: [] as string[] }));
  return { status: response?.status() ?? null, headers, ...dom };
}

/** After the page settled: if it is a wall, give a challenge that clears itself a few seconds, then say so. */
export async function assertNotBotWall(page: Page, response: Response | null): Promise<void> {
  let ev = await readWallEvidence(page, response);
  let wall = classifyBotWall(ev);
  if (wall && /just a moment|checking your browser/i.test(`${ev.title} ${ev.text}`)) {
    await page.waitForTimeout(6_000).catch(() => {});
    ev = await readWallEvidence(page, null);
    wall = classifyBotWall({ ...ev, status: response?.status() ?? ev.status });
  }
  if (wall) throw new BotProtectionError(page.url(), wall, ev.status);
}
