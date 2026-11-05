import type { ReadResponse } from './types.ts';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  copy: '©',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Tags and entities out, one line of plain text. */
const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g;

export function plain(s: string): string {
  return decodeEntities(s.replace(TAG, ' ')).replace(/\s+/g, ' ').trim();
}

function meta(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  const c = tag && /content=["']([^"']*)["']/i.exec(tag);
  return c ? decodeEntities(c[1]).trim() : '';
}

const DROP = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'head'];
const CHROME = ['nav', 'footer', 'aside', 'form', 'header'];

function dropBlocks(html: string, tags: string[]): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const t of tags) out = out.replace(new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?</${t}>`, 'gi'), ' ');
  return out;
}

/** The part of the page that is the page: <main>, <article>, [role=main], else the body. */
function mainPart(html: string): string {
  for (const re of [/<main\b[^>]*>([\s\S]*?)<\/main>/i, /<article\b[^>]*>([\s\S]*?)<\/article>/i, /<[a-z]+\b[^>]*role=["']main["'][^>]*>([\s\S]*)/i]) {
    const m = re.exec(html);
    if (m && plain(m[1]).length > 200) return m[1];
  }
  return /<body\b[^>]*>([\s\S]*)/i.exec(html)?.[1] ?? html;
}

/** Readable text from an HTML page: headings as "# ", list items as "- ", paragraphs separated. No scripts, no menus. */
export function htmlToText(html: string): string {
  let h = dropBlocks(html, DROP);
  h = mainPart(h);
  h = dropBlocks(h, CHROME);
  h = h
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${'#'.repeat(Number(n))} ${plain(t)}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|tr|ul|ol|table|pre|blockquote|figure)>/gi, '\n\n')
    .replace(TAG, '');
  return decodeEntities(h)
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pageLinks(html: string, base: string, max = 30): Array<{ text: string; url: string }> {
  const out: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  for (const m of dropBlocks(html, DROP).matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try {
      url = new URL(decodeEntities(m[1]), base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    const text = plain(m[2]);
    if (!text) continue;
    seen.add(url);
    out.push({ text: text.slice(0, 100), url });
    if (out.length >= max) break;
  }
  return out;
}

/** Title, description and readable text of a fetched page. */
export function readHtml(
  html: string,
  baseUrl: string,
  maxChars: number,
  withLinks: boolean,
): Pick<ReadResponse, 'title' | 'description' | 'text' | 'truncated' | 'chars' | 'links'> {
  const title =
    meta(html, 'og:title') || plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '') || plain(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  const description = meta(html, 'og:description') || meta(html, 'description');
  const full = htmlToText(html);
  const truncated = full.length > maxChars;
  return {
    title,
    description,
    text: truncated ? full.slice(0, maxChars) : full,
    truncated,
    chars: full.length,
    ...(withLinks ? { links: pageLinks(html, baseUrl) } : {}),
  };
}
