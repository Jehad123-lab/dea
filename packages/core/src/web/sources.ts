import { decodeEntities, plain } from './html.ts';
import { type Fetch, politeGet } from './http.ts';
import type { WebResult } from './types.ts';

/** A free, keyless source. `parse` is pure (tested against recorded answers); `url` is where the question goes. */
export interface Source {
  name: string;
  title: string;
  /** page = a results page read like a browser would (robots.txt checked); api = a documented public JSON API */
  kind: 'page' | 'api';
  /** gap between two calls to this host, ms */
  gapMs: number;
  /** what the source is good for, for the source list and the routing */
  about: string;
  url(query: string, limit: number): string;
  parse(body: string, limit: number): Omit<WebResult, 'fetched_at' | 'verified' | 'evidence'>[];
  /** the sentence that goes into each result's evidence note */
  basis: string;
  headers?: Record<string, string>;
  /** asked only when the named source gave nothing usable (blocked, limited, failed or empty): the same question through another door */
  fallbackFor?: string;
}

type Raw = Omit<WebResult, 'fetched_at' | 'verified' | 'evidence'>;
const q = encodeURIComponent;
const json = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('the answer was not JSON');
  }
};
const clip = (s: unknown, n = 300) => {
  const t = typeof s === 'string' ? plain(s) : '';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function parseDuckDuckGo(html: string, limit = 8): Raw[] {
  const out: Raw[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    let url = decodeEntities(m[1]);
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    out.push({ title: plain(m[2]), url, snippet: plain(m[3]), source: 'duckduckgo' });
    if (out.length >= limit) break;
  }
  return out;
}

/** DuckDuckGo's lite page: the same engine through a plainer page, used when the HTML page is blocked or empty. */
export function parseDuckDuckGoLite(html: string, limit = 8): Raw[] {
  const out: Raw[] = [];
  const re =
    /<a\b[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>)?/g;
  for (const m of html.matchAll(re)) {
    let url = decodeEntities(m[1]);
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    out.push({ title: plain(m[2]), url, snippet: plain(m[3] ?? ''), source: 'duckduckgo-lite' });
    if (out.length >= limit) break;
  }
  return out;
}

export function parseWikipedia(body: string, limit = 8): Raw[] {
  const j = json(body) as { pages?: Array<{ key: string; title: string; excerpt?: string; description?: string | null }> };
  return (j.pages ?? []).slice(0, limit).map((p) => ({
    title: p.title,
    url: `https://en.wikipedia.org/wiki/${encodeURI(p.key)}`,
    snippet: [clip(p.description), clip(p.excerpt)].filter(Boolean).join(' — '),
    source: 'wikipedia',
    license: 'CC BY-SA 4.0',
  }));
}

export function parseGithub(body: string, limit = 8): Raw[] {
  const j = json(body) as {
    items?: Array<{
      full_name: string;
      html_url: string;
      description?: string | null;
      stargazers_count?: number;
      language?: string | null;
      license?: { spdx_id?: string | null } | null;
    }>;
  };
  return (j.items ?? []).slice(0, limit).map((r) => ({
    title: r.full_name,
    url: r.html_url,
    snippet: [clip(r.description), [r.language, r.stargazers_count != null ? `${r.stargazers_count} stars` : ''].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join(' — '),
    source: 'github',
    license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : null,
  }));
}

export function parseNpm(body: string, limit = 8): Raw[] {
  const j = json(body) as {
    objects?: Array<{ package: { name: string; version?: string; description?: string; links?: { npm?: string }; license?: string } }>;
  };
  return (j.objects ?? []).slice(0, limit).map(({ package: p }) => ({
    title: `${p.name}${p.version ? `@${p.version}` : ''}`,
    url: p.links?.npm ?? `https://www.npmjs.com/package/${p.name}`,
    snippet: clip(p.description),
    source: 'npm',
    license: p.license ?? null,
  }));
}

export function parseMdn(body: string, limit = 8): Raw[] {
  const j = json(body) as { documents?: Array<{ mdn_url: string; title: string; summary?: string }> };
  return (j.documents ?? []).slice(0, limit).map((d) => ({
    title: d.title,
    url: `https://developer.mozilla.org${d.mdn_url}`,
    snippet: clip(d.summary),
    source: 'mdn',
    license: 'CC BY-SA 2.5',
  }));
}

export function parseStackExchange(body: string, limit = 8): Raw[] {
  const j = json(body) as { items?: Array<{ title: string; link: string; score?: number; is_answered?: boolean; answer_count?: number; tags?: string[] }> };
  return (j.items ?? []).slice(0, limit).map((i) => ({
    title: clip(i.title, 200),
    url: i.link,
    snippet: [i.is_answered ? `answered (${i.answer_count ?? 0})` : 'no accepted answer', `score ${i.score ?? 0}`, (i.tags ?? []).slice(0, 5).join(', ')]
      .filter(Boolean)
      .join(' · '),
    source: 'stackexchange',
    license: 'CC BY-SA',
  }));
}

export function parseHackerNews(body: string, limit = 8): Raw[] {
  const j = json(body) as {
    hits?: Array<{
      title?: string | null;
      story_title?: string | null;
      url?: string | null;
      objectID: string;
      points?: number | null;
      num_comments?: number | null;
    }>;
  };
  return (j.hits ?? [])
    .filter((h) => h.title || h.story_title)
    .slice(0, limit)
    .map((h) => ({
      title: (h.title ?? h.story_title) as string,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: `${h.points ?? 0} points, ${h.num_comments ?? 0} comments on Hacker News (discussion: https://news.ycombinator.com/item?id=${h.objectID})`,
      source: 'hackernews',
    }));
}

export function parseSearxng(body: string, limit = 8): Raw[] {
  const j = json(body) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (j.results ?? [])
    .filter((x) => x.url)
    .slice(0, limit)
    .map((x) => ({ title: clip(x.title, 200), url: x.url as string, snippet: clip(x.content), source: 'searxng' }));
}

export const SOURCES: Record<string, Source> = {
  duckduckgo: {
    name: 'duckduckgo',
    title: 'DuckDuckGo (HTML results page)',
    kind: 'page',
    gapMs: 2000,
    about: 'general web search',
    url: (s) => `https://html.duckduckgo.com/html/?q=${q(s)}`,
    parse: parseDuckDuckGo,
    basis: "listed on DuckDuckGo's results page for this query; the snippet is the search engine's own text and the page itself was not opened",
  },
  'duckduckgo-lite': {
    name: 'duckduckgo-lite',
    title: 'DuckDuckGo (lite results page, fallback)',
    kind: 'page',
    gapMs: 2000,
    about: 'the same web search through DuckDuckGo’s plain page: asked only when the HTML page is blocked, limited or empty',
    url: (s) => `https://lite.duckduckgo.com/lite/?q=${q(s)}`,
    parse: parseDuckDuckGoLite,
    basis: "listed on DuckDuckGo's lite results page for this query; the snippet is the search engine's own text and the page itself was not opened",
    fallbackFor: 'duckduckgo',
  },
  wikipedia: {
    name: 'wikipedia',
    title: 'Wikipedia search API',
    kind: 'api',
    gapMs: 500,
    about: 'concepts and definitions',
    url: (s, n) => `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${q(s)}&limit=${n}`,
    parse: parseWikipedia,
    basis: 'a Wikipedia page title/excerpt from its public search API; the full article was not opened',
  },
  github: {
    name: 'github',
    title: 'GitHub repository search (no token)',
    kind: 'api',
    gapMs: 2500,
    about: 'open-source projects and their licences (10 searches a minute without a token)',
    url: (s, n) => `https://api.github.com/search/repositories?q=${q(s)}&per_page=${n}&sort=stars`,
    parse: parseGithub,
    basis: "a repository from GitHub's public search; the licence is the one GitHub detected, not a legal review",
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  },
  npm: {
    name: 'npm',
    title: 'npm registry search',
    kind: 'api',
    gapMs: 500,
    about: 'JavaScript packages',
    url: (s, n) => `https://registry.npmjs.org/-/v1/search?text=${q(s)}&size=${n}`,
    parse: parseNpm,
    basis: 'a package from the npm registry search; the version is the latest it listed',
  },
  mdn: {
    name: 'mdn',
    title: 'MDN Web Docs search',
    kind: 'api',
    gapMs: 500,
    about: 'web platform documentation (HTML, CSS, JS, WebGL APIs)',
    url: (s, n) => `https://developer.mozilla.org/api/v1/search?q=${q(s)}&locale=en-US&size=${n}`,
    parse: parseMdn,
    basis: "an MDN page summary from MDN's public search; the page itself was not opened",
  },
  stackexchange: {
    name: 'stackexchange',
    title: 'Stack Overflow (Stack Exchange API, no key)',
    kind: 'api',
    gapMs: 1500,
    about: 'programming questions (300 calls a day per address without a key)',
    url: (s, n) => `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${q(s)}&site=stackoverflow&pagesize=${n}`,
    parse: parseStackExchange,
    basis: 'a Stack Overflow question from the Stack Exchange API; answers were not opened',
  },
  hackernews: {
    name: 'hackernews',
    title: 'Hacker News (Algolia API)',
    kind: 'api',
    gapMs: 1000,
    about: 'discussion and links about tech',
    url: (s, n) => `https://hn.algolia.com/api/v1/search?query=${q(s)}&hitsPerPage=${n}&tags=story`,
    parse: parseHackerNews,
    basis: "a story from Hacker News' public search; the linked page was not opened",
  },
};

/** A SearXNG instance YOU run or trust (JSON output enabled): public instances answered 429/418 or a captcha to a script on 2026-11-05, so none is used by default. */
export function searxngSource(base: string): Source {
  const b = base.replace(/\/+$/, '');
  return {
    name: 'searxng',
    title: `SearXNG (${new URL(b).host})`,
    kind: 'api',
    gapMs: 1000,
    about: 'your own meta-search instance',
    url: (s) => `${b}/search?q=${q(s)}&format=json`,
    parse: parseSearxng,
    basis: `a result from the SearXNG instance you configured (${new URL(b).host}); the page itself was not opened`,
  };
}

/** Words that suggest a programming question: route it to the developer sources too. */
const DEV =
  /\b(js|javascript|typescript|css|html|api|webgl|webgpu|three(\.js)?|react|vue|svelte|node|npm|shader|glsl|canvas|dom|function|error|exception|library|framework|package|gsap|vite|webpack|css-in-js|tailwind|regex|async|promise|mcp|cli|git|docker|python|rust|wasm)\b/i;

export function route(query: string, env: Record<string, string | undefined> = process.env): string[] {
  const out = ['duckduckgo'];
  if (DEV.test(query)) out.push('mdn', 'npm', 'github', 'stackexchange');
  else if (query.trim().split(/\s+/).length <= 4) out.push('wikipedia');
  if (env.DEA_SEARXNG_URL) out.push('searxng');
  return out;
}

export async function runSource(
  src: Source,
  query: string,
  limit: number,
  f: Fetch | undefined,
  sleep?: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ raw: Raw[]; body: string }> {
  const r = await politeGet(src.url(query, limit), {
    fetch: f,
    signal,
    sleep,
    gapMs: src.gapMs,
    robots: src.kind === 'page',
    accept: src.kind === 'api' ? 'application/json' : 'text/html',
    headers: src.headers,
  });
  if (r.status >= 400) throw new Error(`${new URL(src.url('x', 1)).host} answered ${r.status}`);
  return { raw: src.parse(r.body, limit), body: r.body };
}
