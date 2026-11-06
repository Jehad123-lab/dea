/** What a web lookup reports. Every result says where it came from, when, and whether this call fetched it live. */

export type SourceStatus = 'ok' | 'cached' | 'stale' | 'blocked' | 'rate_limited' | 'error' | 'skipped';

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  /** which source listed it: duckduckgo, wikipedia, github, npm, mdn, stackexchange, hackernews, searxng */
  source: string;
  /** ISO time the source answered (the cached time for a cached result) */
  fetched_at: string;
  /** true = fetched live during this call; false = served from DEA's disk cache */
  verified: boolean;
  /** plain words on what this result is and is not */
  evidence: string;
  license?: string | null;
}

export interface SourceReport {
  source: string;
  status: SourceStatus;
  count: number;
  ms: number;
  /** why, in plain words, when the status is not ok */
  note?: string;
}

export type ResultLabel = 'verified' | 'cached' | 'mixed' | 'none';

/** ok = every asked source answered; partial = results, but a source was blocked, limited or failed; blocked = nothing, and a source refused us; none = nothing was found and nothing was refused */
export type SearchStatus = 'ok' | 'partial' | 'blocked' | 'none';

export interface SearchProblem {
  source: string;
  kind: 'blocked' | 'rate_limited' | 'error' | 'stale';
  why: string;
}

export interface SearchResponse {
  query: string;
  status: SearchStatus;
  /** which sources failed and why, in DEA's fixed source order (empty when status is ok) */
  problems: SearchProblem[];
  /** verified = every result fetched live now; cached = all from disk; mixed = both; none = no results */
  label: ResultLabel;
  fetched_at: string;
  results: WebResult[];
  sources: SourceReport[];
  evidence: string;
}

export interface ReadResponse {
  url: string;
  final_url: string;
  title: string;
  description: string;
  text: string;
  truncated: boolean;
  chars: number;
  status: number;
  content_type: string;
  fetched_at: string;
  verified: boolean;
  evidence: string;
  links?: Array<{ text: string; url: string }>;
  /** how the text was made: static = the page as served; rendered = after DEA's own headless browser ran the page's scripts; pdf; feed = RSS/Atom/sitemap */
  method: 'static' | 'rendered' | 'pdf' | 'feed';
  /** pdf: pages in the document and pages read */
  pages?: { total: number; read: number };
  /** feed: the entries, in the feed's own order */
  items?: Array<{ title: string; url: string; date?: string; summary?: string }>;
  /** things that did not work and what DEA did instead (a render that could not start, a PDF cut at the page limit) */
  warnings?: string[];
}

/** A source refused or limited us. DEA reports it and does not try another way round it. */
export class WebBlocked extends Error {
  constructor(
    readonly kind: 'blocked' | 'rate_limited',
    message: string,
  ) {
    super(message);
    this.name = 'WebBlocked';
  }
}
