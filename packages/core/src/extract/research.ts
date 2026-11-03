// Research-and-retry: when a rebuild does not match, look things up before giving up. Free, pluggable search
// (DuckDuckGo's HTML page, your own SearXNG, GitHub code search with your token), findings kept with their source,
// values pulled out of them (colours, numbers, font and ease names), tried in the rebuild, kept only when the visual
// diff improves. Only values are taken from findings: no code is copied, and each finding's licence is recorded when
// the source states one.

export interface Finding {
  title: string;
  url: string;
  snippet: string;
  source: string;
  license?: string | null;
}

export interface SearchProvider {
  name: string;
  search(query: string): Promise<Finding[]>;
}

type Fetch = typeof fetch;
const UA = 'Mozilla/5.0 (compatible; dea-research/0.1; +https://github.com/Jehad123-lab/dea)';
const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** DuckDuckGo's no-JavaScript results page. Free, no key. */
export function duckDuckGo(f: Fetch = fetch): SearchProvider {
  return {
    name: 'duckduckgo',
    async search(q) {
      const r = await f(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA } });
      if (!r.ok) throw new Error(`duckduckgo answered ${r.status}`);
      const html = await r.text();
      const out: Finding[] = [];
      const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      for (const m of html.matchAll(re)) {
        let url = m[1];
        const u = /uddg=([^&]+)/.exec(url);
        if (u) url = decodeURIComponent(u[1]);
        if (url.startsWith('//')) url = `https:${url}`;
        out.push({ title: strip(m[2]), url, snippet: strip(m[3]), source: 'duckduckgo' });
        if (out.length >= 8) break;
      }
      return out;
    },
  };
}

/** A SearXNG instance you run or trust (its JSON API must be enabled). */
export function searxng(base: string, f: Fetch = fetch): SearchProvider {
  return {
    name: 'searxng',
    async search(q) {
      const r = await f(`${base.replace(/\/+$/, '')}/search?q=${encodeURIComponent(q)}&format=json`, { headers: { 'user-agent': UA } });
      if (!r.ok) throw new Error(`searxng answered ${r.status}`);
      const j = (await r.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
      return (j.results ?? []).slice(0, 8).map((x) => ({ title: x.title ?? '', url: x.url ?? '', snippet: x.content ?? '', source: 'searxng' }));
    },
  };
}

/** GitHub code search with the user's own token. Records each repository's licence. */
export function githubCode(token: string, f: Fetch = fetch): SearchProvider {
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github.text-match+json', 'user-agent': UA, 'x-github-api-version': '2022-11-28' };
  return {
    name: 'github',
    async search(q) {
      const r = await f(`https://api.github.com/search/code?per_page=5&q=${encodeURIComponent(q)}`, { headers: h });
      if (!r.ok) throw new Error(`github code search answered ${r.status}`);
      const j = (await r.json()) as {
        items?: Array<{ name: string; html_url: string; repository: { full_name: string }; text_matches?: Array<{ fragment: string }> }>;
      };
      const out: Finding[] = [];
      for (const it of (j.items ?? []).slice(0, 5)) {
        let license: string | null = null;
        try {
          const l = await f(`https://api.github.com/repos/${it.repository.full_name}/license`, { headers: h });
          if (l.ok) license = ((await l.json()) as { license?: { spdx_id?: string } }).license?.spdx_id ?? null;
        } catch {
          /* licence unknown */
        }
        out.push({
          title: `${it.repository.full_name}: ${it.name}`,
          url: it.html_url,
          snippet: (it.text_matches ?? [])
            .map((t) => t.fragment)
            .join(' … ')
            .slice(0, 1200),
          source: 'github',
          license,
        });
      }
      return out;
    },
  };
}

/** Space out calls to one provider (default 1.5 s apart): be a polite client of free services. */
export function rateLimited(p: SearchProvider, gapMs = 1500): SearchProvider {
  let last = 0;
  return {
    name: p.name,
    async search(q) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return p.search(q);
    },
  };
}

/** Providers from the environment: DEA_SEARCH=duckduckgo|searxng|github|none (comma list), DEA_SEARXNG_URL, DEA_GITHUB_TOKEN or GITHUB_TOKEN. */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): SearchProvider[] {
  const want = (env.DEA_SEARCH ?? 'duckduckgo')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (want.includes('none')) return [];
  const out: SearchProvider[] = [];
  if (want.includes('duckduckgo')) out.push(rateLimited(duckDuckGo()));
  if (want.includes('searxng') && env.DEA_SEARXNG_URL) out.push(rateLimited(searxng(env.DEA_SEARXNG_URL), 1000));
  const tok = env.DEA_GITHUB_TOKEN ?? env.GITHUB_TOKEN;
  if (want.includes('github') && tok) out.push(rateLimited(githubCode(tok), 2500));
  return out;
}

export interface Knob {
  name: string;
  kind: 'color' | 'number' | 'font' | 'ease';
  /** words that must sit near a value for it to count for this knob (e.g. /background|bg/) */
  near?: RegExp;
  /** sensible range for numbers */
  min?: number;
  max?: number;
}

export interface Hint {
  knob: string;
  value: string | number;
  finding: Finding;
  why: string;
}

const EASE_RE = /\b((?:power[1-4]|sine|expo|circ|back|elastic|bounce)\.(?:inOut|in|out)|none|linear)\b/g;

/** Pull values for each knob out of the findings' text. */
export function analyse(findings: Finding[], knobs: Knob[]): Hint[] {
  const hints: Hint[] = [];
  const seen = new Set<string>();
  const add = (h: Hint) => {
    const k = `${h.knob}=${String(h.value).toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    hints.push(h);
  };
  for (const f of findings) {
    const text = `${f.title} ${f.snippet}`;
    for (const k of knobs) {
      if (k.kind === 'color') {
        for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
          const around = text.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 10);
          if (k.near && !k.near.test(around)) continue;
          let hex = m[1].toLowerCase();
          if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
          add({ knob: k.name, value: `#${hex}`, finding: f, why: `colour ${m[0]} near "${around.trim().slice(-50)}"` });
        }
      } else if (k.kind === 'number') {
        const src = k.near ? k.near.source : k.name;
        for (const m of text.matchAll(new RegExp(`(?:${src})[\\w.]*\\s*[:=]\\s*(?:\\{\\s*value\\s*:\\s*)?(-?\\d*\\.?\\d+)`, 'gi'))) {
          const v = Number(m[1]);
          if (!Number.isFinite(v) || (k.min != null && v < k.min) || (k.max != null && v > k.max)) continue;
          add({ knob: k.name, value: v, finding: f, why: `"${m[0].slice(0, 60)}"` });
        }
      } else if (k.kind === 'font') {
        for (const m of text.matchAll(/font-family\s*:\s*["']?([^;"',)]+)/gi))
          add({ knob: k.name, value: m[1].trim(), finding: f, why: `"${m[0].slice(0, 60)}"` });
      } else if (k.kind === 'ease') {
        for (const m of text.matchAll(EASE_RE)) add({ knob: k.name, value: m[1], finding: f, why: `ease name "${m[1]}"` });
      }
    }
  }
  return hints;
}

export type Params = Record<string, string | number>;

export interface RoundLog {
  round: number;
  queries: string[];
  findings: number;
  errors: string[];
  tried: Array<{ knob: string; value: string | number; score: number; kept: boolean; source: string }>;
  score: number;
}

export interface ResearchResult {
  params: Params;
  start: number;
  best: number;
  rounds: RoundLog[];
  /** findings whose values made the rebuild closer: cite these */
  citations: Array<Finding & { used: string }>;
  stoppedBecause: string;
}

/**
 * Up to `rounds` rounds of: search → analyse → try each value in the rebuild → keep what lowers the visual diff.
 * `render` rebuilds with the given parameters and returns similarity to the original (0..1).
 */
export async function researchLoop(o: {
  params: Params;
  render: (p: Params) => Promise<number>;
  queries: (p: Params, round: number) => string[];
  knobs: Knob[];
  providers: SearchProvider[];
  rounds?: number;
  target?: number;
  maxTriesPerRound?: number;
  onStep?: (s: string) => void;
}): Promise<ResearchResult> {
  const target = o.target ?? 0.92;
  let params = { ...o.params };
  const start = await o.render(params);
  let best = start;
  const rounds: RoundLog[] = [];
  const citations: ResearchResult['citations'] = [];
  const tried = new Set<string>();
  if (start >= target) return { params, start, best, rounds, citations, stoppedBecause: `already ${pct(start)} similar (target ${pct(target)})` };
  if (!o.providers.length) return { params, start, best, rounds, citations, stoppedBecause: 'no search provider configured (DEA_SEARCH=none)' };
  let why = `reached ${o.rounds ?? 3} rounds`;
  for (let round = 1; round <= (o.rounds ?? 3); round++) {
    const qs = o.queries(params, round).slice(0, 3);
    const log: RoundLog = { round, queries: qs, findings: 0, errors: [], tried: [], score: best };
    const findings: Finding[] = [];
    for (const q of qs)
      for (const p of o.providers) {
        o.onStep?.(`research round ${round}: ${p.name} "${q}"`);
        try {
          for (const f of await p.search(q)) if (!findings.some((x) => x.url === f.url)) findings.push(f);
        } catch (e) {
          log.errors.push(`${p.name}: ${(e as Error).message}`);
        }
      }
    log.findings = findings.length;
    const hints = analyse(findings, o.knobs).filter((h) => !tried.has(`${h.knob}=${h.value}`) && params[h.knob] !== h.value);
    let improved = false;
    for (const h of hints.slice(0, o.maxTriesPerRound ?? 8)) {
      tried.add(`${h.knob}=${h.value}`);
      const next = { ...params, [h.knob]: h.value };
      const score = await o.render(next);
      const kept = score > best + 0.002;
      log.tried.push({ knob: h.knob, value: h.value, score, kept, source: h.finding.url });
      if (kept) {
        params = next;
        best = score;
        improved = true;
        citations.push({ ...h.finding, used: `${h.knob} = ${h.value} (${h.why})` });
        o.onStep?.(`kept ${h.knob} = ${h.value}: ${pct(score)} similar`);
      }
    }
    log.score = best;
    rounds.push(log);
    if (best >= target) {
      why = `reached the target (${pct(best)} ≥ ${pct(target)})`;
      break;
    }
    if (!hints.length && !improved && round > 1) {
      why = 'searches found no new values to try';
      break;
    }
  }
  return { params, start, best, rounds, citations, stoppedBecause: why };
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
