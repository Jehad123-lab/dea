import { decodeEntities, plain } from './html.ts';
import type { ReadResponse } from './types.ts';

type Item = NonNullable<ReadResponse['items']>[number];

export type FeedKind = 'rss' | 'atom' | 'sitemap' | 'sitemap-index';

const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, x: string) => x);
const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decodeEntities(plain(cdata(m[1]))) : '';
};

/** What kind of feed or sitemap this is, from its first tag (not from the content type: servers label these loosely). */
export function feedKind(body: string): FeedKind | null {
  const head = body.slice(0, 2000);
  if (/<rss\b/i.test(head)) return 'rss';
  if (/<feed\b[^>]*atom/i.test(head) || /<feed\b/i.test(head)) return 'atom';
  if (/<sitemapindex\b/i.test(head)) return 'sitemap-index';
  if (/<urlset\b/i.test(head)) return 'sitemap';
  return null;
}

/** RSS 2.0, Atom, sitemaps and sitemap indexes into one list, in the document's own order. Pure: tested against recorded feeds. */
export function parseFeed(body: string, limit = 200): { kind: FeedKind; title: string; items: Item[]; total: number } | null {
  const kind = feedKind(body);
  if (!kind) return null;
  const items: Item[] = [];
  let total = 0;
  const blocks = (name: string) => [...body.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => m[1]);
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  if (kind === 'rss') {
    for (const b of blocks('item')) {
      total++;
      if (items.length >= limit) continue;
      const url = tag(b, 'link') || tag(b, 'guid');
      items.push({
        title: tag(b, 'title'),
        url,
        ...(tag(b, 'pubDate') ? { date: tag(b, 'pubDate') } : {}),
        ...(tag(b, 'description') ? { summary: clip(tag(b, 'description'), 300) } : {}),
      });
    }
  } else if (kind === 'atom') {
    for (const b of blocks('entry')) {
      total++;
      if (items.length >= limit) continue;
      const links = [...b.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
      const alt = links.find((l) => /rel=["']alternate["']/i.test(l)) ?? links[0] ?? '';
      const url = decodeEntities(/href=["']([^"']+)["']/i.exec(alt)?.[1] ?? '');
      const date = tag(b, 'updated') || tag(b, 'published');
      const summary = tag(b, 'summary') || tag(b, 'content');
      items.push({ title: tag(b, 'title'), url, ...(date ? { date } : {}), ...(summary ? { summary: clip(summary, 300) } : {}) });
    }
  } else {
    for (const b of blocks(kind === 'sitemap' ? 'url' : 'sitemap')) {
      total++;
      if (items.length >= limit) continue;
      const url = tag(b, 'loc');
      const date = tag(b, 'lastmod');
      items.push({ title: url, url, ...(date ? { date } : {}) });
    }
  }
  const head = body.replace(/<(item|entry|url|sitemap)\b[\s\S]*$/i, '');
  return { kind, title: tag(head, 'title') || kind, items, total };
}

/** The feed as plain text, one line per entry. */
export function feedText(f: NonNullable<ReturnType<typeof parseFeed>>): string {
  const head = `${f.title} (${f.kind}, ${f.total} entr${f.total === 1 ? 'y' : 'ies'})`;
  return [head, ...f.items.map((i) => `- ${i.title === i.url ? i.url : `${i.title} — ${i.url}`}${i.date ? ` (${i.date})` : ''}`)].join('\n');
}
