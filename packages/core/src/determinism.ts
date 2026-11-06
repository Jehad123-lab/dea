// Same inputs, same outputs, whichever AI drives it.
//
// Everything an agent reads from DEA is computed by DEA's code from the inputs (the site, the saved run, the options). The agent
// only chooses commands and options. These helpers make that checkable: one canonical text form (keys in a fixed order, numbers
// rounded), and a split of every result into `result` (a function of the inputs) and `meta` (timestamps, run ids, timings, cache
// state: true, but different on every call). Two clients that call a tool with the same arguments get the same `result` text.

/** The schema name carried by every structured tool answer. */
export const RESULT_SCHEMA = 'dea.result/1';

/** Keys whose values differ from call to call whatever the inputs: they move to `meta`. */
export const VOLATILE_KEYS = [
  'runId',
  'madeAt',
  'fetched_at',
  'at',
  'ms',
  'elapsedMs',
  'startedAt',
  'finishedAt',
  'machine',
  'files',
  'verified',
  'evidence',
  'cacheAge',
  'dir',
] as const;

/** Round every non-integer number to `digits` decimals (scores are measured on a software renderer; the tail digits are noise). */
export function roundDeep<T>(v: T, digits = 3): T {
  const f = 10 ** digits;
  const go = (x: unknown): unknown => {
    if (typeof x === 'number') return Number.isFinite(x) ? (Number.isInteger(x) ? x : Math.round(x * f) / f) : null;
    if (Array.isArray(x)) return x.map(go);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, y]) => [k, go(y)]));
    return x;
  };
  return go(v) as T;
}

/** Same value, every object's keys sorted, undefined dropped, numbers rounded. Arrays keep their order (it is part of the answer). */
export function canonical<T>(v: T, digits = 3): T {
  const go = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(go);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = go(o[k]);
      return out;
    }
    return x;
  };
  return go(roundDeep(v, digits)) as T;
}

/** The one text form of a value: what two clients compare. */
export const canonicalJson = (v: unknown, space = 1, digits = 3): string => JSON.stringify(canonical(v, digits), null, space);

/** Move every volatile key (at any depth) out of a value. `meta` is keyed by the dotted path the value was found at. */
export function splitMeta<T>(v: T, keys: readonly string[] = VOLATILE_KEYS): { stable: T; meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {};
  const set = new Set(keys);
  const go = (x: unknown, path: string): unknown => {
    if (Array.isArray(x)) return x.map((y, i) => go(y, `${path}[${i}]`));
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, y] of Object.entries(x as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        if (set.has(k)) meta[p] = y;
        else out[k] = go(y, p);
      }
      return out;
    }
    return x;
  };
  return { stable: go(v, '') as T, meta: canonical(meta) };
}

export interface Answer<T = unknown> {
  schema: typeof RESULT_SCHEMA;
  tool: string;
  /** the fixed reminder that quoted page content is data */
  note: string;
  result: T;
}

/** A tool answer: the deterministic part and the volatile part, apart. */
export function answer<T>(
  tool: string,
  note: string,
  result: T,
  meta: Record<string, unknown> = {},
): { body: Answer<T>; text: string; meta: Record<string, unknown> } {
  const body: Answer<T> = canonical({ schema: RESULT_SCHEMA, tool, note, result });
  return { body, text: canonicalJson(body), meta: canonical(meta) };
}

/** mean, spread and size of repeated measurements: how DEA reports variance. */
export function variance(xs: number[], digits = 3): { n: number; mean: number | null; sd: number | null; min: number | null; max: number | null } {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return { n: 0, mean: null, sd: null, min: null, max: null };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return roundDeep({ n: v.length, mean, sd, min: Math.min(...v), max: Math.max(...v) }, digits);
}

type Stringy = Record<string, unknown>;

/** Search: what was found is the result; when, from which cache state, and how fast is meta. */
export function searchAnswer(r: {
  query: string;
  status: string;
  problems: Array<{ source: string; kind: string; why: string }>;
  label: string;
  fetched_at: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    source: string;
    fetched_at: string;
    verified: boolean;
    evidence: string;
    license?: string | null;
  }>;
  sources: Array<{ source: string; status: string; count: number; ms: number; note?: string }>;
  evidence: string;
}): { result: Stringy; meta: Stringy } {
  return {
    result: {
      query: r.query,
      status: r.status,
      ...(r.problems.length ? { problems: r.problems } : {}),
      results: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source, ...(x.license ? { license: x.license } : {}) })),
    },
    meta: {
      label: r.label,
      fetched_at: r.fetched_at,
      evidence: r.evidence,
      sources: r.sources,
      results: r.results.map((x) => ({ url: x.url, verified: x.verified, fetched_at: x.fetched_at, evidence: x.evidence })),
    },
  };
}

/** Read: the page's text is the result; status and cache state are meta. */
export function readAnswer(r: {
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
  method: string;
  pages?: { total: number; read: number };
  items?: Array<{ title: string; url: string; date?: string; summary?: string }>;
  warnings?: string[];
}): { result: Stringy; meta: Stringy } {
  return {
    result: {
      url: r.url,
      final_url: r.final_url,
      title: r.title,
      description: r.description,
      text: r.text,
      truncated: r.truncated,
      chars: r.chars,
      content_type: r.content_type,
      method: r.method,
      ...(r.pages ? { pages: r.pages } : {}),
      ...(r.items ? { items: r.items } : {}),
      ...(r.warnings ? { warnings: r.warnings } : {}),
      ...(r.links ? { links: r.links } : {}),
    },
    meta: { status: r.status, fetched_at: r.fetched_at, verified: r.verified, evidence: r.evidence },
  };
}

/** An evidence-ledger answer (the output of queryLedger): the findings are the result; run id, machine and file hashes are meta. */
export function ledgerAnswer(q: Record<string, unknown>): { result: Stringy; meta: Stringy } {
  const { stable, meta } = splitMeta(q);
  return { result: stable as Stringy, meta };
}

/** Research (search, read, extract): the passages and the trail are the result; when and how long are meta. */
export function researchAnswer(r: {
  question: string;
  status: string;
  passages: unknown[];
  trail: unknown[];
  fetched_at: string;
  evidence: string;
  timings: unknown[];
}): { result: Stringy; meta: Stringy } {
  return {
    result: { question: r.question, status: r.status, passages: r.passages, trail: r.trail },
    meta: { fetched_at: r.fetched_at, evidence: r.evidence, timings: r.timings },
  };
}
