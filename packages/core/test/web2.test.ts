import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BudgetExceeded,
  feedKind,
  isPdf,
  looksLikeShell,
  parseDuckDuckGoLite,
  parseFeed,
  passagesOf,
  pdfText,
  rankPassages,
  read,
  research,
  resetPoliteState,
  search,
  terms,
} from '../src/web/index.ts';

import { makePdf } from './fixtures/makepdf.ts';

const fx = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'web', n), 'utf8');
const noSleep = async () => {};
type Route = { body: string | Uint8Array; type?: string; status?: number; hang?: boolean };

/** A fetch that answers from recorded files, counts calls, and can hang until the caller's signal ends it. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response('not found', { status: 404 });
    if (hit[1].hang)
      return new Promise<Response>((_res, rej) => {
        const stop = () => rej(init?.signal?.reason ?? new DOMException('aborted', 'AbortError'));
        if (init?.signal?.aborted) stop();
        else init?.signal?.addEventListener('abort', stop);
      });
    return new Response(hit[1].body as BodyInit, { status: hit[1].status ?? 200, headers: { 'content-type': hit[1].type ?? 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dea-web2-'));
  resetPoliteState();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const DDG = {
  'html.duckduckgo.com/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
  'lite.duckduckgo.com/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
};

describe('search: fallback when DuckDuckGo’s HTML page does not answer (recorded lite page, 2026-11-06)', () => {
  it('reads the lite page', () => {
    const r = parseDuckDuckGoLite(fx('duckduckgo-lite.html.txt'));
    expect(r.length).toBeGreaterThanOrEqual(5);
    expect(r[0]).toMatchObject({ source: 'duckduckgo-lite', url: 'https://webglfundamentals.org/webgl/lessons/webgl-instanced-drawing.html' });
    expect(r.every((x) => /^https:\/\//.test(x.url) && !x.url.includes('duckduckgo.com/l/') && x.snippet.length > 10)).toBe(true);
  });
  it('a blocked HTML page: the lite page answers, and the answer says so (partial, with the reason)', async () => {
    const { f, calls } = fakeFetch({
      ...DDG,
      'html.duckduckgo.com/html': { body: 'no', type: 'text/html', status: 403 },
      'lite.duckduckgo.com/lite': { body: fx('duckduckgo-lite.html.txt'), type: 'text/html' },
    });
    const r = await search('webgl instancing sample', { fetch: f, sleep: noSleep, home, sources: ['duckduckgo'] });
    expect(r.status).toBe('partial');
    expect(r.problems).toEqual([{ source: 'duckduckgo', kind: 'blocked', why: expect.stringContaining('refused') }]);
    expect(r.results.length).toBeGreaterThan(3);
    expect(r.results.every((x) => x.source === 'duckduckgo-lite')).toBe(true);
    expect(r.sources.map((s) => s.source)).toEqual(['duckduckgo', 'duckduckgo-lite']);
    expect(r.sources[1].note).toMatch(/fallback for duckduckgo \(blocked/);
    expect(calls.some((c) => c.includes('lite.duckduckgo.com/lite'))).toBe(true);
  });
  it('an HTML page that answers with nothing also falls back', async () => {
    const { f } = fakeFetch({
      ...DDG,
      'html.duckduckgo.com/html': { body: '<html><body>nothing</body></html>', type: 'text/html' },
      'lite.duckduckgo.com/lite': { body: fx('duckduckgo-lite.html.txt'), type: 'text/html' },
    });
    const r = await search('anything at all here', { fetch: f, sleep: noSleep, home, sources: ['duckduckgo'] });
    expect(r.results[0].source).toBe('duckduckgo-lite');
  });
  it('both blocked: status blocked, no results, each refusal named, nothing bypassed', async () => {
    const { f, calls } = fakeFetch({
      ...DDG,
      'html.duckduckgo.com/html': { body: 'x', type: 'text/html', status: 429 },
      'lite.duckduckgo.com/lite': { body: 'x', type: 'text/html', status: 403 },
    });
    const r = await search('webgl instancing', { fetch: f, sleep: noSleep, home, sources: ['duckduckgo'] });
    expect(r.status).toBe('blocked');
    expect(r.results).toEqual([]);
    expect(r.problems.map((p) => `${p.source}:${p.kind}`)).toEqual(['duckduckgo:rate_limited', 'duckduckgo-lite:blocked']);
    expect(r.evidence).toMatch(/duckduckgo: rate limited/);
    expect(calls.filter((c) => c.includes('duckduckgo.com/html')).length).toBe(1); // no retry loop
  });
  it('a healthy HTML page: the fallback is never asked', async () => {
    const { f, calls } = fakeFetch({ ...DDG, 'html.duckduckgo.com/html': { body: fx('duckduckgo.html.txt'), type: 'text/html' } });
    const r = await search('webgl instancing', { fetch: f, sleep: noSleep, home, sources: ['duckduckgo'] });
    expect(r.status).toBe('ok');
    expect(calls.some((c) => c.includes('lite.duckduckgo.com/lite'))).toBe(false);
  });
  it('a time budget ends slow sources and says so', async () => {
    const { f } = fakeFetch({ ...DDG, 'html.duckduckgo.com/html': { body: '', hang: true }, 'lite.duckduckgo.com/lite': { body: '', hang: true } });
    const t0 = Date.now();
    const r = await search('slow question here', { fetch: f, sleep: noSleep, home, sources: ['duckduckgo'], timeoutMs: 400 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.status).toBe('none');
    expect(r.problems.every((p) => p.kind === 'error' && /no answer in time/.test(p.why))).toBe(true);
  });
});

describe('feeds and sitemaps (recorded 2026-11-06)', () => {
  it('RSS (Hacker News)', () => {
    const f = parseFeed(fx('hn.rss.xml'));
    expect(f?.kind).toBe('rss');
    expect(f?.title).toBe('Hacker News');
    expect(f?.items.length).toBeGreaterThan(10);
    expect(f?.items[0]).toMatchObject({ url: expect.stringMatching(/^https?:\/\//), date: expect.stringContaining('2026') });
  });
  it('Atom (GitHub releases)', () => {
    const f = parseFeed(fx('vite-releases.atom.xml'));
    expect(f?.kind).toBe('atom');
    expect(f?.items.length).toBe(4);
    expect(f?.items[0].url).toMatch(/^https:\/\/github\.com\/vitejs\/vite\/releases\/tag\/v/);
    expect(f?.items[0].title).toMatch(/^v\d/);
  });
  it('sitemap and sitemap index', () => {
    expect(feedKind(fx('sitemap.xml'))).toBe('sitemap');
    expect(parseFeed(fx('sitemap.xml'))?.items[0].url).toBe('https://www.sitemaps.org/');
    const idx = parseFeed(fx('sitemap-index.xml'));
    expect(idx?.kind).toBe('sitemap-index');
    expect(idx?.items[0].url).toContain('sitemap');
  });
  it('a gzipped sitemap (sitemap.xml.gz) is unpacked and listed', async () => {
    const gz = gzipSync(Buffer.from(fx('sitemap.xml')));
    const { f } = fakeFetch({
      'x.test/robots.txt': { body: '', type: 'text/plain', status: 404 },
      'x.test/sitemap.xml.gz': { body: new Uint8Array(gz), type: 'application/gzip' },
    });
    const r = await read('https://x.test/sitemap.xml.gz', { fetch: f, sleep: noSleep, home });
    expect(r.method).toBe('feed');
    expect(r.items?.[0].url).toBe('https://www.sitemaps.org/');
  });
  it('not a feed', () => {
    expect(parseFeed('<html><body>hi</body></html>')).toBeNull();
  });
  it('read returns a feed as a list, method feed', async () => {
    const { f } = fakeFetch({
      'x.test/robots.txt': { body: '', type: 'text/plain', status: 404 },
      'x.test/feed': { body: fx('hn.rss.xml'), type: 'application/rss+xml' },
    });
    const r = await read('https://x.test/feed', { fetch: f, sleep: noSleep, home });
    expect(r.method).toBe('feed');
    expect(r.items?.length).toBeGreaterThan(10);
    expect(r.text.split('\n')[0]).toMatch(/Hacker News \(rss/);
  });
});

describe('PDF', () => {
  it('reads the text layer, page by page', async () => {
    const p = await pdfText(makePdf(['Hello DEA PDF', 'Second line'], 3));
    expect(p.total).toBe(3);
    expect(p.read).toBe(3);
    expect(p.text).toContain('[page 1]\nHello DEA PDF p1');
    expect(p.text).toContain('[page 3]');
  });
  it('read: method pdf, page limit reported', async () => {
    const { f } = fakeFetch({
      'x.test/robots.txt': { body: '', status: 404, type: 'text/plain' },
      'x.test/a.pdf': { body: makePdf(['Findings of the study'], 5), type: 'application/pdf' },
    });
    const r = await read('https://x.test/a.pdf', { fetch: f, sleep: noSleep, home, maxPages: 2 });
    expect(r.method).toBe('pdf');
    expect(r.pages).toEqual({ total: 5, read: 2 });
    expect(r.text).toContain('Findings of the study p2');
    expect(r.text).not.toContain('p3');
    expect(r.warnings?.[0]).toMatch(/first 2 of 5/);
  });
  it('a PDF served as octet-stream is still recognised, and a PDF with no text layer says so', async () => {
    const bytes = makePdf([], 1);
    expect(isPdf(bytes, 'application/octet-stream')).toBe(true);
    const { f } = fakeFetch({
      'x.test/robots.txt': { body: '', status: 404, type: 'text/plain' },
      'x.test/scan': { body: bytes, type: 'application/octet-stream' },
    });
    const r = await read('https://x.test/scan', { fetch: f, sleep: noSleep, home });
    expect(r.method).toBe('pdf');
    expect(r.text).toBe('');
    expect(r.warnings?.join(' ')).toMatch(/no text layer/);
  });
});

describe('render: scripts that build the page', () => {
  const shell = '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
  it('recognises an empty shell and not a real page', () => {
    expect(looksLikeShell(shell, 3)).toBe(true);
    expect(looksLikeShell('<html><body><p>plenty</p></body></html>', 4000)).toBe(false);
    expect(looksLikeShell('<html><body>hi</body></html>', 2)).toBe(false); // no script: nothing a browser would add
  });
  const routes = { 'x.test/robots.txt': { body: '', status: 404, type: 'text/plain' }, 'x.test/app': { body: shell, type: 'text/html' } };
  const fake = async () => ({
    html: '<html><body><main><h1>Built by script</h1><p>This paragraph only exists after the scripts ran, and it is long enough to count as text.</p></main></body></html>',
    finalUrl: 'https://x.test/app',
    refused: 1,
    browser: 'test',
  });
  it('auto: a shell is rendered, and the answer says method rendered', async () => {
    const { f } = fakeFetch(routes);
    const r = await read('https://x.test/app', { fetch: f, sleep: noSleep, home, renderer: fake });
    expect(r.method).toBe('rendered');
    expect(r.text).toContain('Built by script');
    expect(r.warnings?.[0]).toMatch(/refused/);
  });
  it('never: the page as served, no browser asked', async () => {
    const { f } = fakeFetch(routes);
    let asked = false;
    const r = await read('https://x.test/app', { fetch: f, sleep: noSleep, home, render: 'never', renderer: async () => ((asked = true), fake()) });
    expect(asked).toBe(false);
    expect(r.method).toBe('static');
  });
  it('a browser that cannot start: the served page is returned with the reason, not a pretend render', async () => {
    const { f } = fakeFetch(routes);
    const r = await read('https://x.test/app', {
      fetch: f,
      sleep: noSleep,
      home,
      renderer: async () => {
        throw new Error('Could not start a browser.');
      },
    });
    expect(r.method).toBe('static');
    expect(r.warnings?.[0]).toMatch(/rendering was wanted but could not run \(Could not start a browser/);
  });
  it('local addresses are still refused (the render is not a way into your network)', async () => {
    await expect(read('http://127.0.0.1:8080/', { home })).rejects.toThrow(/will not read/);
  });
});

describe('budgets', () => {
  it('read gives up with a plain error when the time budget ends', async () => {
    const { f } = fakeFetch({ 'x.test/robots.txt': { body: '', status: 404, type: 'text/plain' }, 'x.test/slow': { body: '', hang: true } });
    const err = await read('https://x.test/slow', { fetch: f, sleep: noSleep, home, timeoutMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(String(err.message)).toMatch(/did not finish within/);
  });
});

describe('research: search, read, extract', () => {
  const pageA = `<html><head><title>Instancing guide</title></head><body><main><h1>Instancing guide</h1>
<p>Instanced rendering draws many copies of one mesh in a single draw call, which cuts the per-object cost on the CPU. It needs a per-instance attribute buffer.</p>
<p>Unrelated paragraph about cooking pasta with plenty of salt and olive oil for a long time in a big pot.</p></main></body></html>`;
  const pageB = `<html><head><title>Other</title></head><body><main><p>The weather today is mild and the market sells fruit near the river bank every morning of the week, rain or shine.</p><p>Draw calls cost CPU time because each one validates state; instanced rendering reduces how many calls are made.</p></main></body></html>`;
  const routes = {
    ...DDG,
    'html.duckduckgo.com/html': { body: fx('duckduckgo.html.txt'), type: 'text/html' },
    'threejs.org/robots.txt': { body: '', status: 404, type: 'text/plain' },
    'threejs.org/docs': { body: pageA, type: 'text/html' },
    'a.test/robots.txt': { body: '', status: 404, type: 'text/plain' },
    'a.test/guide': { body: pageA, type: 'text/html' },
    'b.test/robots.txt': { body: '', status: 404, type: 'text/plain' },
    'b.test/other': { body: pageB, type: 'text/html' },
  };
  it('terms and passages are plain functions', () => {
    expect(terms('How does instanced rendering work in WebGL?')).toEqual(['instanced', 'rendering', 'webgl', 'work']);
    const ps = passagesOf('# Title\n\nA paragraph that is long enough to be a passage of its own.\n\nshort');
    expect(ps).toHaveLength(1);
    expect(ps[0].text).toContain('# Title\nA paragraph');
  });
  it('urls given: ranked passages with offsets, the trail, and the same answer on a second call in any order', async () => {
    const { f } = fakeFetch(routes);
    const q = 'how does instanced rendering reduce draw calls';
    const a = await research(q, { fetch: f, sleep: noSleep, home, urls: ['https://a.test/guide', 'https://b.test/other'], passages: 3 });
    expect(a.status).toBe('found');
    expect(
      a.passages
        .slice(0, 2)
        .map((p) => p.text)
        .join(' '),
    ).toMatch(/Instanced rendering draws many copies/);
    expect(a.passages.every((p) => p.text.includes('cooking') === false)).toBe(true);
    expect(a.trail.map((t) => t.step)).toEqual(['read', 'read']);
    expect(a.passages[0].offset).toBeGreaterThanOrEqual(0);
    const home2 = mkdtempSync(join(tmpdir(), 'dea-web2b-'));
    try {
      const b = await research(q, { fetch: f, sleep: noSleep, home: home2, urls: ['https://a.test/guide', 'https://b.test/other'], passages: 3 });
      expect(b.passages).toEqual(a.passages);
      expect(b.trail).toEqual(a.trail);
    } finally {
      rmSync(home2, { recursive: true, force: true });
    }
  });
  it('a page that cannot be read is in the trail with its reason, and the status is partial', async () => {
    const { f } = fakeFetch(routes);
    const r = await research('instanced rendering draw calls', { fetch: f, sleep: noSleep, home, urls: ['https://a.test/guide', 'https://c.test/missing'] });
    expect(r.status).toBe('partial');
    expect(r.trail.find((t) => t.step === 'read' && !t.ok)).toMatchObject({ url: 'https://c.test/missing', error: expect.stringContaining('404') });
  });
  it('search first: the search step and the pages it chose are in the trail', async () => {
    const { f } = fakeFetch(routes);
    const r = await research('instanced mesh three.js', { fetch: f, sleep: noSleep, home, sources: ['duckduckgo'], pages: 1 });
    expect(r.trail[0]).toMatchObject({ step: 'search', status: 'ok' });
    expect(r.trail[1]).toMatchObject({ step: 'read', url: 'https://threejs.org/docs/pages/InstancedMesh.html', ok: true });
  });
  it('one page does not fill the whole answer when other pages have something', () => {
    const para = (n: number) => `Instanced rendering paragraph number ${n} says that draw calls are reduced when copies are drawn together.`;
    const pages = [
      { url: 'big', title: 'big', source: 's', text: [1, 2, 3, 4, 5].map(para).join('\n\n') },
      { url: 'small', title: 'small', source: 's', text: 'A different page that mentions instanced rendering and draw calls once.' },
    ];
    const r = rankPassages('instanced rendering draw calls', pages, 4);
    expect(r.filter((p) => p.url === 'big').length).toBeLessThanOrEqual(2);
    expect(r.some((p) => p.url === 'small')).toBe(true);
    expect(rankPassages('instanced rendering draw calls', [pages[0]], 4)).toHaveLength(4); // a single page may use all of them
  });
  it('rank is pure: the same pages and question, the same order', () => {
    const pages = [
      { url: 'u1', title: 't1', source: 's', text: 'Instanced rendering draws copies in one call.\n\nNothing relevant lives here at all, only filler words.' },
      { url: 'u2', title: 't2', source: 's', text: 'Rendering is the process of making images from scenes with many steps.' },
    ];
    const a = rankPassages('instanced rendering', pages, 5);
    expect(a[0].url).toBe('u1');
    expect(rankPassages('instanced rendering', pages, 5)).toEqual(a);
  });
});
