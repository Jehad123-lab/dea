import { Budget } from './budget.ts';
import { ageMs, cacheGet, cachePut, webCacheHome } from './cache.ts';
import type { Fetch } from './http.ts';
import { route, runSource, SOURCES, type Source, searxngSource } from './sources.ts';
import { type ResultLabel, type SearchProblem, type SearchResponse, type SearchStatus, type SourceReport, WebBlocked, type WebResult } from './types.ts';

export interface SearchOptions {
  /** source names; default = routed from the question */
  sources?: string[];
  limit?: number;
  /** skip the cache and ask the sources again */
  fresh?: boolean;
  /** how long a cached answer counts as current, ms (default 1 h) */
  ttlMs?: number;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  home?: string;
  now?: () => number;
  env?: Record<string, string | undefined>;
  /** the whole question must be answered within this many ms (default 45 000); slower sources are reported as timed out */
  timeoutMs?: number;
  /** a budget shared with other steps (the research chain) */
  budget?: Budget;
}

export function sourceList(env: Record<string, string | undefined> = process.env): Source[] {
  return [...Object.values(SOURCES), ...(env.DEA_SEARXNG_URL ? [searxngSource(env.DEA_SEARXNG_URL.split(',')[0].trim())] : [])];
}

const normUrl = (u: string) => {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return `${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`.toLowerCase();
  } catch {
    return u;
  }
};

const errNote = (e: unknown) => ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError' ? 'no answer in time' : (e as Error).message);

/**
 * Free web search: asks a few keyless sources at once, labels every result with its source, time and whether it was
 * fetched live now or came from DEA's disk cache, and reports a source that is blocked or limiting plainly. When a source
 * is blocked and an older cached answer exists, that answer is used and says so.
 */
export async function search(query: string, o: SearchOptions = {}): Promise<SearchResponse> {
  const now = o.now ?? Date.now;
  const env = o.env ?? process.env;
  const limit = Math.min(Math.max(o.limit ?? 8, 1), 20);
  const askN = Math.max(limit, 10); // each source is asked for a few more than shown, so a later, larger question can reuse the cache
  const dir = webCacheHome(o.home);
  const ttl = o.ttlMs ?? 3_600_000;
  const all = new Map(sourceList(env).map((s) => [s.name, s]));
  // the order the caller listed the sources in is not part of the question: DEA asks, and interleaves, in its own fixed order
  const order = [...all.keys()];
  const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length);
  const names = [...new Set(o.sources?.length ? o.sources.map((n) => n.trim().toLowerCase()) : route(query, env))].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
  const stamp = new Date(now()).toISOString();
  const reports: SourceReport[] = [];
  const perSource: WebResult[][] = [];
  const budget = o.budget ?? new Budget(o.timeoutMs ?? 45_000);

  const ask = async (name: string, idx: number): Promise<void> => {
    const src = all.get(name);
    const t0 = Date.now();
    if (!src) {
      reports[idx] = { source: name, status: 'skipped', count: 0, ms: 0, note: `unknown source "${name}" (known: ${[...all.keys()].join(', ')})` };
      perSource[idx] = [];
      return;
    }
    const key = `search|${name}|${query.trim().toLowerCase()}`; // not the limit: one cached answer serves any smaller limit
    const hit = await cacheGet<WebResult[]>(dir, key);
    const fresh = !o.fresh && hit && ageMs(hit, now()) < ttl;
    const fromCache = (e: NonNullable<typeof hit>, why: string): WebResult[] =>
      e.value.map((r) => ({
        ...r,
        verified: false,
        evidence: `From DEA's cache (fetched ${e.fetched_at}); ${why}; ${r.evidence.replace(/^(From DEA's cache|Fetched live) [^;]*; (the live source[^;]*; |not asked again[^;]*; )?/, '')}`,
      }));
    if (fresh && hit) {
      reports[idx] = { source: name, status: 'cached', count: hit.value.length, ms: 0, note: `answered ${Math.round(ageMs(hit, now()) / 60000)} min ago` };
      perSource[idx] = fromCache(hit, 'not asked again because it is recent');
      return;
    }
    try {
      const { raw } = await runSource(src, query, askN, o.fetch, o.sleep, budget.signal);
      const at = new Date(now()).toISOString();
      const results: WebResult[] = raw.map((r) => ({ ...r, fetched_at: at, verified: true, evidence: `Fetched live ${at}; ${src.basis}.` }));
      await cachePut(dir, key, results, at);
      reports[idx] = {
        source: name,
        status: 'ok',
        count: results.length,
        ms: Date.now() - t0,
        ...(results.length ? {} : { note: 'the source answered with no results' }),
      };
      perSource[idx] = results;
    } catch (e) {
      const blocked = e instanceof WebBlocked;
      const status = blocked ? e.kind : 'error';
      if (hit) {
        reports[idx] = {
          source: name,
          status: 'stale',
          count: hit.value.length,
          ms: Date.now() - t0,
          note: `${errNote(e)}; showing the cached answer from ${hit.fetched_at}`,
        };
        perSource[idx] = fromCache(hit, `the live source failed: ${errNote(e)}`);
      } else {
        reports[idx] = { source: name, status, count: 0, ms: Date.now() - t0, note: errNote(e) };
        perSource[idx] = [];
      }
    }
  };

  await Promise.all(names.map((name, idx) => ask(name, idx)));

  // a fallback source (the same question through another door) is asked only when the source it stands behind gave nothing
  // usable: blocked, limited, failed, or empty. Sources are consulted in DEA's fixed order, so the answer does not depend on who asked.
  for (const fb of [...all.values()].filter((s) => s.fallbackFor && !names.includes(s.name)).sort((a, b) => rank(a.name) - rank(b.name))) {
    const primaryIdx = names.indexOf(fb.fallbackFor as string);
    if (primaryIdx < 0 || (perSource[primaryIdx]?.length ?? 0) > 0) continue;
    const idx = reports.length;
    await ask(fb.name, idx);
    if (reports[idx])
      reports[idx].note =
        `fallback for ${fb.fallbackFor} (${reports[primaryIdx]?.status}${reports[primaryIdx]?.note ? `: ${reports[primaryIdx].note}` : ''})${reports[idx].note ? `; ${reports[idx].note}` : ''}`;
  }

  // round-robin so one chatty source does not bury the rest; drop repeats of the same page
  const seen = new Set<string>();
  const results: WebResult[] = [];
  for (let i = 0; results.length < limit * 2 && perSource.some((l) => i < l.length); i++)
    for (const l of perSource) {
      const r = l[i];
      if (!r) continue;
      const k = normUrl(r.url);
      if (seen.has(k)) continue;
      seen.add(k);
      results.push(r);
    }
  const final = results.slice(0, Math.max(limit, 1));
  const live = final.filter((r) => r.verified).length;
  const label: ResultLabel = !final.length ? 'none' : live === final.length ? 'verified' : live === 0 ? 'cached' : 'mixed';
  const bad = reports.filter((r) => ['blocked', 'rate_limited', 'error'].includes(r.status));
  const evidence = [
    label === 'verified' && `All ${final.length} results were fetched live at ${stamp}.`,
    label === 'cached' && `All ${final.length} results come from DEA's cache, not from a live fetch.`,
    label === 'mixed' && `${live} of ${final.length} results were fetched live at ${stamp}; the rest come from DEA's cache.`,
    label === 'none' && 'No source returned a result.',
    'Results are what each source listed; snippets are the sources’ own text and the pages were not opened (use read to open one).',
    ...bad.map((b) => `${b.source}: ${b.status.replace('_', ' ')}: ${b.note}.`),
  ]
    .filter(Boolean)
    .join(' ');
  const problems: SearchProblem[] = reports
    .filter((r) => r.status === 'blocked' || r.status === 'rate_limited' || r.status === 'error' || r.status === 'stale')
    .map((r) => ({ source: r.source, kind: r.status as SearchProblem['kind'], why: (r.note ?? '').replace(/; showing the cached answer from .*$/, '') }));
  // a fallback that answered makes its primary's failure a fact about the route, not a hole in the answer
  const status: SearchStatus = !final.length
    ? problems.some((x) => x.kind === 'blocked' || x.kind === 'rate_limited')
      ? 'blocked'
      : 'none'
    : problems.length
      ? 'partial'
      : 'ok';
  return { query: query.trim(), status, problems, label, fetched_at: stamp, results: final, sources: reports, evidence };
}
