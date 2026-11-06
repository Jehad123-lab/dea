import { WebBlocked } from './types.ts';

export type Fetch = typeof fetch;

export const WEB_VERSION = '0.1';
export const USER_AGENT = `dea/${WEB_VERSION} (+https://github.com/Jehad123-lab/dea; polite research client)`;

export interface PoliteOptions {
  fetch?: Fetch;
  /** minimum gap between two calls to one host, ms (default 1000) */
  gapMs?: number;
  timeoutMs?: number;
  /** ends the call early (a shared time budget) */
  signal?: AbortSignal;
  maxBytes?: number;
  /** check robots.txt first (pages yes; documented JSON APIs no) */
  robots?: boolean;
  accept?: string;
  headers?: Record<string, string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const lastCall = new Map<string, number>();
const robotsCache = new Map<string, { at: number; rules: RobotsRules }>();
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Forget rate-limit and robots memory (tests). */
export function resetPoliteState(): void {
  lastCall.clear();
  robotsCache.clear();
}

// ---------------------------------------------------------------- robots.txt

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelayS?: number;
}

/** The rules that apply to our agent from a robots.txt body: our own group if there is one, else "*". */
export function parseRobots(body: string, agent = 'dea'): RobotsRules {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[]; delay?: number }> = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (k === 'allow') cur.allow.push(v);
    else if (k === 'disallow') cur.disallow.push(v);
    else if (k === 'crawl-delay') cur.delay = Number(v);
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a))) ?? groups.find((g) => g.agents.includes('*'));
  if (!mine) return { allow: [], disallow: [] };
  return { allow: mine.allow, disallow: mine.disallow.filter((d) => d !== ''), crawlDelayS: Number.isFinite(mine.delay) ? mine.delay : undefined };
}

function ruleMatches(rule: string, path: string): number {
  // * = anything, $ = end; the longest matching rule wins, as in RFC 9309
  const end = rule.endsWith('$');
  const body = end ? rule.slice(0, -1) : rule;
  const re = new RegExp(
    `^${body
      .split('*')
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}${end ? '$' : ''}`,
  );
  return re.test(path) ? body.length : -1;
}

export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best = -1;
  let allowed = true;
  for (const d of rules.disallow) {
    const n = ruleMatches(d, pathAndQuery);
    if (n > best) {
      best = n;
      allowed = false;
    }
  }
  for (const a of rules.allow) {
    const n = ruleMatches(a, pathAndQuery);
    if (n >= best && n >= 0) {
      best = n;
      allowed = true;
    }
  }
  return allowed;
}

// ---------------------------------------------------------------- addresses DEA never reads for an AI

/** localhost, private ranges, link-local (cloud metadata) and non-http schemes: an AI app must not turn `read` into a way into your network. */
export function refuseAddress(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'that is not a web address';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `only http and https addresses can be read (got ${u.protocol})`;
  if (u.username || u.password) return 'addresses with a user name or password in them are not read';
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return `${h} is a local address`;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return `${h} is a private or local address`;
  }
  if (h.includes(':') && (h === '::1' || h === '::' || /^f[cd]/.test(h) || h.startsWith('fe80') || h.startsWith('::ffff:')))
    return `${h} is a private or local address`;
  return null;
}

// ---------------------------------------------------------------- the fetch

const sig = (o: PoliteOptions): AbortSignal =>
  o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(o.timeoutMs ?? 15_000)]) : AbortSignal.timeout(o.timeoutMs ?? 15_000);

const BLOCK_MARKERS = /(antibot|captcha|are you a (robot|human)|unusual traffic|verify you are human|access denied|cf-chl|attention required)/i;

export interface PoliteResponse {
  status: number;
  url: string;
  contentType: string;
  body: string;
  /** the raw bytes (up to maxBytes), for PDFs */
  bytes: Uint8Array;
  truncated: boolean;
}

/**
 * One polite GET: our own User-Agent, a gap between calls to one host, a timeout, a size cap, robots.txt for pages.
 * A refusal (robots, 401/403/418/429/451/503, a captcha page) throws WebBlocked and is reported as it is: DEA does not
 * retry, rotate addresses or solve challenges.
 */
export async function politeGet(url: string, o: PoliteOptions = {}): Promise<PoliteResponse> {
  const f = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? realSleep;
  const u = new URL(url);
  const host = u.host;
  const gap = o.gapMs ?? 1000;
  const wait = (lastCall.get(host) ?? 0) + gap - now();
  lastCall.set(host, Math.max(now(), (lastCall.get(host) ?? 0) + gap));
  if (wait > 0) await sleep(wait);

  if (o.robots) {
    let entry = robotsCache.get(host);
    if (!entry || now() - entry.at > 3_600_000) {
      let rules: RobotsRules = { allow: [], disallow: [] };
      try {
        const r = await f(`${u.protocol}//${host}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: sig(o) });
        if (r.ok) rules = parseRobots((await r.text()).slice(0, 500_000));
        else if (r.status === 401 || r.status === 403) rules = { allow: [], disallow: ['/'] };
      } catch {
        /* no robots.txt reachable: nothing forbids us, the page fetch below shows whether the host answers at all */
      }
      entry = { at: now(), rules };
      robotsCache.set(host, entry);
    }
    if (!robotsAllows(entry.rules, `${u.pathname}${u.search}`))
      throw new WebBlocked('blocked', `${host}'s robots.txt does not allow ${u.pathname}; DEA respects it`);
    if (entry.rules.crawlDelayS && entry.rules.crawlDelayS > 0) lastCall.set(host, now() + Math.min(entry.rules.crawlDelayS, 10) * 1000 - gap);
  }

  const r = await f(url, {
    headers: { 'user-agent': USER_AGENT, accept: o.accept ?? '*/*', 'accept-language': 'en', ...o.headers },
    redirect: 'follow',
    signal: sig(o),
  });
  const contentType = r.headers.get('content-type') ?? '';
  if (r.status === 429)
    throw new WebBlocked(
      'rate_limited',
      `${host} says too many requests (429)${r.headers.get('retry-after') ? `, retry after ${r.headers.get('retry-after')} s` : ''}`,
    );
  if ([401, 403, 418, 451].includes(r.status)) throw new WebBlocked('blocked', `${host} refused the request (${r.status})`);
  if (r.status === 503) throw new WebBlocked('rate_limited', `${host} is unavailable or limiting requests (503)`);
  const max = o.maxBytes ?? 2_000_000;
  const buf = new Uint8Array(await r.arrayBuffer());
  const truncated = buf.length > max;
  const body = new TextDecoder('utf-8', { fatal: false }).decode(truncated ? buf.slice(0, max) : buf);
  if (
    /text\/html/i.test(contentType) &&
    BLOCK_MARKERS.test(body.slice(0, 6000)) &&
    body.length < 60_000 &&
    body
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().length < 1500
  )
    throw new WebBlocked('blocked', `${host} answered with a bot-check page; DEA does not get past those`);
  return { status: r.status, url: r.url || url, contentType, body, bytes: truncated ? buf.slice(0, max) : buf, truncated };
}
