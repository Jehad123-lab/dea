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

export interface SearchResponse {
  query: string;
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
