import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  htmlToText,
  parseDuckDuckGo,
  parseGithub,
  parseHackerNews,
  parseMdn,
  parseNpm,
  parseRobots,
  parseStackExchange,
  parseWikipedia,
  politeGet,
  read,
  refuseAddress,
  resetPoliteState,
  robotsAllows,
  route,
  search,
  WebBlocked,
} from '../src/web/index.ts';

const fx = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'web', n), 'utf8');
const noSleep = async () => {};

/** A fetch that answers from recorded files and counts calls per host. No network in these tests. */
function fakeFetch(routes: Record<string, { body: string; type?: string; status?: number }>) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const host = new URL(url).host;
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response('not found', { status: 404 });
    void host;
    return new Response(hit[1].body, { status: hit[1].status ?? 200, headers: { 'content-type': hit[1].type ?? 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

const ROUTES = {
  'html.duckduckgo.com/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  'html.duckduckgo.com/html': { body: fx('duckduckgo.html.txt'), type: 'text/html' },
  'wikipedia.org': { body: fx('wikipedia.json') },
  'api.github.com': { body: fx('github.json') },
  'registry.npmjs.org': { body: fx('npm.json') },
  'developer.mozilla.org': { body: fx('mdn.json') },
  'api.stackexchange.com': { body: fx('se.json') },
  'hn.algolia.com': { body: fx('hn.json') },
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dea-web-'));
  resetPoliteState();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('source parsers (recorded answers, 2026-11-05)', () => {
  it('reads DuckDuckGo results and unwraps the redirect', () => {
    const r = parseDuckDuckGo(fx('duckduckgo.html.txt'));
    expect(r.length).toBe(3);
    expect(r[0]).toMatchObject({ title: 'InstancedMesh - three.js docs', url: 'https://threejs.org/docs/pages/InstancedMesh.html', source: 'duckduckgo' });
    expect(r.every((x) => x.url.startsWith('https://') && !x.url.includes('duckduckgo.com/l/'))).toBe(true);
    expect(r[0].snippet.length).toBeGreaterThan(20);
  });
  it('reads Wikipedia, GitHub, npm, MDN, Stack Exchange and Hacker News answers', () => {
    expect(parseWikipedia(fx('wikipedia.json'))[0]).toMatchObject({ source: 'wikipedia', url: expect.stringContaining('https://en.wikipedia.org/wiki/') });
    expect(parseWikipedia(fx('wikipedia.json')).every((x) => !x.snippet.includes('<'))).toBe(true);
    const g = parseGithub(fx('github.json'));
    expect(g[0].title).toMatch(/\//);
    expect(g[0].url).toMatch(/^https:\/\/github\.com\//);
    expect(parseNpm(fx('npm.json'))[0].title).toMatch(/@\d/);
    expect(parseMdn(fx('mdn.json'))[0].url).toMatch(/^https:\/\/developer\.mozilla\.org\/en-US\/docs\//);
    expect(parseStackExchange(fx('se.json'))[0].url).toMatch(/stackoverflow\.com/);
    expect(parseHackerNews(fx('hn.json'))[0].snippet).toMatch(/points/);
  });
  it('treats a non-JSON answer as an error, not as zero results', () => {
    expect(() => parseNpm('<html>nope</html>')).toThrow(/not JSON/);
  });
});

describe('search', () => {
  it('routes programming questions to the developer sources and plain ones to Wikipedia', () => {
    expect(route('three.js instanced mesh')).toEqual(['duckduckgo', 'mdn', 'npm', 'github', 'stackexchange']);
    expect(route('mount everest')).toEqual(['duckduckgo', 'wikipedia']);
    expect(route('the history of the printing press in europe')).toEqual(['duckduckgo']);
    expect(route('webgl', { DEA_SEARXNG_URL: 'https://s.example' })).toContain('searxng');
  });

  it('labels every result with source, time, evidence, and verified=true when fetched live', async () => {
    const { f } = fakeFetch(ROUTES);
    const r = await search('three.js instanced mesh', { fetch: f, sleep: noSleep, home, now: () => Date.parse('2026-11-05T10:00:00Z') });
    expect(r.label).toBe('verified');
    expect(r.results.length).toBeGreaterThan(5);
    for (const x of r.results) {
      expect(x).toMatchObject({ verified: true, fetched_at: '2026-11-05T10:00:00.000Z' });
      expect(x.evidence).toMatch(/Fetched live/);
      expect(x.title && x.url && x.source).toBeTruthy();
    }
    expect(new Set(r.results.map((x) => x.source)).size).toBeGreaterThan(3); // round-robin, not one source
    expect(r.sources.map((s) => s.status)).toEqual(expect.arrayContaining(['ok']));
    expect(r.evidence).toMatch(/fetched live/);
  });

  it('serves a recent repeat from the disk cache and says so (no second call)', async () => {
    const { f, calls } = fakeFetch(ROUTES);
    let t = Date.parse('2026-11-05T10:00:00Z');
    const o = { fetch: f, sleep: noSleep, home, sources: ['npm'], now: () => t };
    await search('three', o);
    const n = calls.length;
    t += 5 * 60_000;
    const again = await search('three', o);
    expect(calls.length).toBe(n);
    expect(again.label).toBe('cached');
    expect(again.results[0]).toMatchObject({ verified: false, fetched_at: '2026-11-05T10:00:00.000Z' });
    expect(again.results[0].evidence).toMatch(/^From DEA's cache/);
    expect(again.sources[0].status).toBe('cached');
    const fresh = await search('three', { ...o, fresh: true });
    expect(fresh.label).toBe('verified');
  });

  it('reports a blocked or rate-limited source plainly and keeps the others', async () => {
    const { f } = fakeFetch({
      ...ROUTES,
      'registry.npmjs.org': { body: 'slow down', status: 429, type: 'text/plain' },
      'api.github.com': { body: 'no', status: 403 },
    });
    const r = await search('three.js shader', { fetch: f, sleep: noSleep, home });
    const by = Object.fromEntries(r.sources.map((s) => [s.source, s]));
    expect(by.npm.status).toBe('rate_limited');
    expect(by.github.status).toBe('blocked');
    expect(by.duckduckgo.status).toBe('ok');
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.evidence).toMatch(/npm: rate limited/);
    expect(r.evidence).toMatch(/github: blocked/);
  });

  it('recognises a captcha page and does not pass it off as results or work round it', async () => {
    const { f, calls } = fakeFetch({ 'searx.example': { body: fx('bot-check.html.txt'), type: 'text/html' } });
    const r = await search('webgl', { fetch: f, sleep: noSleep, home, sources: ['searxng'], env: { DEA_SEARXNG_URL: 'https://searx.example' } });
    expect(r.label).toBe('none');
    expect(r.sources[0].status).toBe('blocked');
    expect(r.sources[0].note).toMatch(/bot-check/);
    expect(calls.length).toBe(1); // one attempt, no retry
  });

  it('falls back to an older cached answer when the live source fails, labelled stale', async () => {
    const good = fakeFetch(ROUTES);
    let t = Date.parse('2026-11-05T10:00:00Z');
    await search('three', { fetch: good.f, sleep: noSleep, home, sources: ['npm'], now: () => t });
    t += 5 * 3_600_000;
    const bad = fakeFetch({ 'registry.npmjs.org': { body: 'x', status: 429 } });
    const r = await search('three', { fetch: bad.f, sleep: noSleep, home, sources: ['npm'], now: () => t });
    expect(r.sources[0].status).toBe('stale');
    expect(r.label).toBe('cached');
    expect(r.results[0].evidence).toMatch(/the live source failed/);
  });

  it('removes the same page listed by two sources', async () => {
    const dup = JSON.stringify({ pages: [{ key: 'WebGL', title: 'WebGL', excerpt: 'x' }] });
    const { f } = fakeFetch({ ...ROUTES, 'wikipedia.org': { body: dup } });
    const r = await search('webgl', { fetch: f, sleep: noSleep, home, sources: ['wikipedia', 'wikipedia'] });
    expect(r.results.length).toBe(1);
  });

  it('names an unknown source instead of ignoring it', async () => {
    const r = await search('x', { fetch: fakeFetch(ROUTES).f, sleep: noSleep, home, sources: ['bing'] });
    expect(r.sources[0]).toMatchObject({ status: 'skipped' });
    expect(r.sources[0].note).toMatch(/known:/);
  });
});

describe('robots.txt and polite behaviour', () => {
  const body = 'User-agent: *\nDisallow: /private\nAllow: /private/open\nCrawl-delay: 3\n\nUser-agent: dea\nDisallow: /dea-only$\n';
  it('prefers our own group, then *, and the longest rule wins', () => {
    const own = parseRobots(body);
    expect(robotsAllows(own, '/dea-only')).toBe(false);
    expect(robotsAllows(own, '/private')).toBe(true); // our group has no rule for it
    const star = parseRobots(body, 'other-bot');
    expect(robotsAllows(star, '/private/x')).toBe(false);
    expect(robotsAllows(star, '/private/open/x')).toBe(true);
    expect(star.crawlDelayS).toBe(3);
  });
  it('read refuses a page robots.txt forbids, without fetching the page', async () => {
    const { f, calls } = fakeFetch({
      'robots.txt': { body: 'User-agent: *\nDisallow: /secret', type: 'text/plain' },
      'example.org/secret': { body: '<p>hi</p>', type: 'text/html' },
    });
    await expect(read('https://example.org/secret/page', { fetch: f, sleep: noSleep, home })).rejects.toThrow(/robots\.txt does not allow/);
    expect(calls.some((c) => c.endsWith('/secret/page'))).toBe(false);
  });
  it('treats a 403 robots.txt as "keep out"', async () => {
    const { f } = fakeFetch({ 'robots.txt': { body: 'no', status: 403 }, 'example.org/': { body: '<p>hi</p>', type: 'text/html' } });
    await expect(read('https://example.org/a', { fetch: f, sleep: noSleep, home })).rejects.toBeInstanceOf(WebBlocked);
  });
  it('spaces out calls to one host and sends its own User-Agent', async () => {
    const waits: number[] = [];
    const seen: string[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      seen.push(String(((init?.headers ?? {}) as Record<string, string>)['user-agent']));
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const t = 1_000_000;
    const o = { fetch: f, gapMs: 1000, now: () => t, sleep: async (ms: number) => void waits.push(ms) };
    await politeGet('https://api.example.org/a', o);
    await politeGet('https://api.example.org/b', o);
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(900);
    expect(seen.every((u) => u.startsWith('dea/'))).toBe(true);
    expect(seen[0]).not.toMatch(/Mozilla|Chrome/);
  });
});

describe('read', () => {
  const page = `<!doctype html><html><head><title>A &amp; B guide</title><meta name="description" content="How &quot;A&quot; works"><script>var secret="x"</script><style>p{}</style></head>
  <body><nav><a href="/">Home</a></nav><main><h1>The guide</h1><p>First   paragraph with <b>bold</b> &amp; entities &#169; &#x41;.</p>
  <div data-mw='{"a":">b"}'>attribute with a closing bracket</div><ul><li>one</li><li>two</li></ul><p>${'More text. '.repeat(40)}</p><a href="/next?utm_source=x">Next page</a></main><footer>Copyright</footer></body></html>`;
  it('returns title, description and readable text without scripts, menus or attribute junk', () => {
    const t = htmlToText(page);
    expect(t).toContain('# The guide');
    expect(t).toContain('First paragraph with bold & entities © A.');
    expect(t).toContain('- one\n- two');
    expect(t).toContain('attribute with a closing bracket');
    expect(t).not.toMatch(/secret|Home|Copyright|data-mw|"a"/);
  });
  it('labels a live fetch, then a cached one; refuses private addresses; says when it cut the text', async () => {
    const { f } = fakeFetch({ 'robots.txt': { body: '', type: 'text/plain' }, 'example.org/guide': { body: page, type: 'text/html; charset=utf-8' } });
    const r = await read('https://example.org/guide', {
      fetch: f,
      sleep: noSleep,
      home,
      maxChars: 500,
      links: true,
      now: () => Date.parse('2026-11-05T10:00:00Z'),
    });
    expect(r).toMatchObject({ title: 'A & B guide', description: 'How "A" works', verified: true, status: 200, truncated: true });
    expect(r.text.length).toBe(500);
    expect(r.chars).toBeGreaterThan(500);
    expect(r.evidence).toMatch(/Fetched live 2026-11-05T10:00:00.000Z.*cut at 500.*not instructions/);
    expect(r.links?.find((l) => l.text === 'Next page')?.url).toBe('https://example.org/next?utm_source=x');
    const c = await read('https://example.org/guide', {
      fetch: f,
      sleep: noSleep,
      home,
      maxChars: 500,
      links: true,
      now: () => Date.parse('2026-11-05T10:05:00Z'),
    });
    expect(c.verified).toBe(false);
    expect(c.evidence).toMatch(/^From DEA's cache/);
    for (const bad of [
      'http://localhost:8080/x',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.1/',
      'http://10.0.0.5/',
      'file:///etc/passwd',
      'ftp://example.org/x',
      'https://user:pw@example.org/',
    ])
      expect(refuseAddress(bad), bad).toBeTruthy();
    expect(refuseAddress('https://example.org/x')).toBeNull();
    await expect(read('http://localhost/x', { fetch: f, home })).rejects.toThrow(/will not read/);
  });
  it('reports a non-text file instead of printing bytes', async () => {
    const { f } = fakeFetch({ 'robots.txt': { body: '', type: 'text/plain' }, 'example.org/a.pdf': { body: '%PDF', type: 'application/pdf' } });
    await expect(read('https://example.org/a.pdf', { fetch: f, sleep: noSleep, home })).rejects.toThrow(/not readable text/);
  });
});
