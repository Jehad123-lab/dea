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
  /** keep only findings about this site (a generic CSS tutorial is not evidence of a site's colours) */
  relevant?: (f: Finding) => boolean;
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
    const hints = analyse(o.relevant ? findings.filter(o.relevant) : findings, o.knobs).filter(
      (h) => !tried.has(`${h.knob}=${h.value}`) && params[h.knob] !== h.value,
    );
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

/** A rendering technique DEA recognised in the decoded pipeline, with the evidence and where to learn it. */
export interface Technique {
  id: string;
  name: string;
  evidence: string;
  queries: string[];
  sources: Finding[];
}

const TECHNIQUES: Array<{ id: string; name: string; test: (t: string) => string | null; queries: string[] }> = [
  {
    id: 'gpgpu',
    name: 'GPGPU particle simulation (positions and velocities in float textures, ping-pong render targets)',
    test: (t) => (/\btPos\b/.test(t) && /\btVel\b/.test(t) ? 'samplers tPos and tVel read and written by full-screen passes' : null),
    queries: ['three.js GPGPU particles tutorial codrops', 'three.js GPUComputationRenderer particles position velocity texture'],
  },
  {
    id: 'mipmap-bloom',
    name: 'Mipmap blur bloom (a chain of downsample and upsample passes)',
    test: (t) => (/DownsamplingMaterial/.test(t) && /UpsamplingMaterial/.test(t) ? 'Downsampling and Upsampling passes in the frame' : null),
    queries: ['postprocessing MipmapBlurPass bloom three.js', 'physically based bloom downsample upsample webgl'],
  },
  {
    id: 'smaa',
    name: 'SMAA anti-aliasing',
    test: (t) => (/SMAA/.test(t) ? 'SMAA materials in the frame' : null),
    queries: ['SMAA three.js postprocessing SMAAEffect'],
  },
  {
    id: 'blue-noise',
    name: 'Blue-noise dithering',
    test: (t) => (/blue.?noise|TBlue\b/i.test(t) ? 'a blue-noise texture sampled with gl_FragCoord' : null),
    queries: ['blue noise dithering shader gl_FragCoord banding', 'blue noise texture webgl dithering tutorial'],
  },
  {
    id: 'heightmap',
    name: 'Heightmap terrain (vertex displacement from a texture)',
    test: (t) => (/uniform sampler2D \w*(Hgt|Height|Disp)\w*/i.test(t) ? 'a height texture sampled in a vertex shader' : null),
    queries: ['three.js terrain vertex displacement heightmap shader', 'codrops procedural terrain shader three.js'],
  },
  {
    id: 'ripple-sim',
    name: 'Ripple / wave simulation in a feedback texture',
    test: (t) => (/\btPrev\b/.test(t) && /uTexel/.test(t) ? 'a pass that reads its own previous frame (tPrev) with a texel size' : null),
    queries: ['webgl water ripple simulation shader feedback texture', 'three.js ripple effect render target ping pong'],
  },
  {
    id: 'dissolve',
    name: 'Dissolve / disintegration effect',
    test: (t) => (/uDissolve|uProgress\b.*noise/i.test(t) ? 'a dissolve uniform in a material' : null),
    queries: ['three.js dissolve effect shader noise threshold codrops'],
  },
  {
    id: 'points',
    name: 'Shader-sized point sprites',
    test: (t) => (/gl_PointSize/.test(t) ? 'programs that write gl_PointSize' : null),
    queries: ['three.js custom shader points particles gl_PointSize size attenuation'],
  },
];

const TRUSTED =
  /tympanus\.net\/codrops|discourse\.threejs\.org|threejs\.org|shadertoy\.com|codepen\.io|gsap\.com|github\.com|pmndrs|iquilezles\.org|thebookofshaders\.com|webglfundamentals\.org|maximeheckel\.com|medium\.com/i;

/**
 * The GLSL that actually compiles: drops lines inside `#ifdef` / `#if defined(...)` branches whose macro is not defined.
 * Why: three.js ships every material chunk with its `#ifdef USE_*` guards, so a MeshStandardMaterial declares
 * `uniform sampler2D displacementMap` even when no displacement map is set (keyframes example: a false "heightmap").
 * Defines reset at each `#version` line (one program per block in the joined text). An `#if` DEA cannot evaluate keeps
 * both branches, so this only ever removes code that is certainly off.
 */
export function activeGlsl(text: string): string {
  const defined = new Set<string>();
  // each frame: is this branch on (true/false/null = unknown), has an earlier branch been taken, was the parent on
  const stack: { on: boolean | null; taken: boolean | null; parent: boolean }[] = [];
  const live = () => stack.every((f) => f.on !== false);
  const evalIf = (expr: string): boolean | null => {
    const e = expr.replace(/\/\/.*$/, '').trim();
    if (!/^[\s()!&|]*(defined\s*\(?\s*\w+\s*\)?[\s()!&|]*)+$/.test(e)) return null;
    const js = e.replace(/defined\s*\(?\s*(\w+)\s*\)?/g, (_m, n: string) => (defined.has(n) ? ' true ' : ' false '));
    if (!/^[\s()!&|truefals]*$/.test(js)) return null;
    try {
      return Boolean(new Function(`return (${js});`)());
    } catch {
      return null;
    }
  };
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    const d = m?.[1];
    const arg = (m?.[2] ?? '').trim();
    if (d === 'version') {
      defined.clear();
      stack.length = 0;
    } else if (d === 'ifdef' || d === 'ifndef' || d === 'if') {
      const name = arg.split(/\s/)[0] ?? '';
      const on = d === 'ifdef' ? defined.has(name) : d === 'ifndef' ? !defined.has(name) : evalIf(arg);
      stack.push({ on, taken: on, parent: live() });
      continue;
    } else if (d === 'elif' && stack.length) {
      const f = stack[stack.length - 1] as (typeof stack)[number];
      const v = f.taken === true ? false : f.taken === null ? null : evalIf(arg);
      f.on = v;
      if (v !== false) f.taken = f.taken === null || v === null ? null : true;
      continue;
    } else if (d === 'else' && stack.length) {
      const f = stack[stack.length - 1] as (typeof stack)[number];
      f.on = f.taken === null ? null : !f.taken;
      continue;
    } else if (d === 'endif' && stack.length) {
      stack.pop();
      continue;
    }
    if (!live()) continue;
    if (d === 'define') defined.add(arg.split(/[\s(]/)[0] ?? '');
    else if (d === 'undef') defined.delete(arg.split(/\s/)[0] ?? '');
    out.push(line);
  }
  return out.join('\n');
}

/** Which known techniques the decoded shaders and pipeline show (program names + GLSL, inactive `#ifdef` code left out). */
export function detectTechniques(raw: string): Technique[] {
  const out: Technique[] = [];
  const text = activeGlsl(raw);
  for (const t of TECHNIQUES) {
    const ev = t.test(text);
    if (ev) out.push({ id: t.id, name: t.name, evidence: ev, queries: t.queries, sources: [] });
  }
  return out;
}

/** Look each technique up in the free providers and keep the best sources (tutorial and forum sites first). */
export async function researchTechniques(
  techs: Technique[],
  providers: SearchProvider[],
  o: { perTechnique?: number; onStep?: (s: string) => void } = {},
): Promise<Technique[]> {
  for (const t of techs) {
    const seen = new Set<string>();
    const found: Finding[] = [];
    for (const q of t.queries.slice(0, 2)) {
      for (const p of providers) {
        o.onStep?.(`research: ${p.name} "${q}"`);
        try {
          for (const f of await p.search(q))
            if (f.url && !seen.has(f.url)) {
              seen.add(f.url);
              found.push(f);
            }
        } catch {
          /* one provider failing is fine */
        }
      }
    }
    t.sources = found.sort((a, b) => Number(TRUSTED.test(b.url)) - Number(TRUSTED.test(a.url))).slice(0, o.perTechnique ?? 3);
  }
  return techs;
}
