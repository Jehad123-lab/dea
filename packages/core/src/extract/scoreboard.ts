import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The reference-site scoreboard: the scores DEA reached on sites it knows, against the targets written down for them.
 * A score that falls more than the tolerance below its target is a regression. Reads only finished extract runs, so
 * it can be built from saved runs offline; `dea scoreboard --sites` makes the runs first.
 */

export interface ScoreTargets {
  /** the kept result's page score (0..1) */
  page?: number;
  /** the kept result's canvas-only score (0..1) */
  canvas?: number;
  /** (b) the editable rebuild alone */
  rebuildPage?: number;
  rebuildCanvas?: number;
}

export interface ScoreboardSite {
  url: string;
  name?: string;
  targets?: ScoreTargets;
  /** passed to extract for this site (e.g. referenceMs, section, quick) */
  options?: Record<string, unknown>;
  /** why this site is on the list */
  why?: string;
}

export interface ScoreboardFile {
  schema?: string;
  /** how far below a target still counts as holding it (default 0.01 = one point) */
  tolerance?: number;
  sites: ScoreboardSite[];
}

export interface RunScores {
  url: string;
  runId: string;
  extractedAt: string | null;
  quick: boolean;
  /** what the kit runs (the best of the results) */
  page: number | null;
  canvas: number | null;
  /** (a) the capture replay, the recorded frames played back */
  replayPage: number | null;
  replayCanvas: number | null;
  /** (b) the editable three.js rebuild */
  rebuildPage: number | null;
  rebuildCanvas: number | null;
  error: string | null;
}

/** 'below target (quick)': a --quick run missed a target set for full runs; shown, never a regression */
export type RowStatus = 'holds' | 'regressed' | 'below target (quick)' | 'no target' | 'no score' | 'failed';

export interface ScoreboardRow {
  name: string;
  url: string;
  status: RowStatus;
  scores: RunScores | null;
  targets: ScoreTargets;
  /** each target that was missed: the metric, the target, the score */
  misses: Array<{ metric: keyof ScoreTargets; target: number; score: number | null }>;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** The scores of one finished extract run, from its extract.json (run folder or the extract.json path). */
export async function readRunScores(runDir: string, runId = runDir.split(/[\\/]/).filter(Boolean).pop() ?? runDir): Promise<RunScores> {
  const file = runDir.endsWith('.json') ? runDir : join(runDir, 'extract.json');
  const e = JSON.parse(await readFile(file, 'utf8')) as {
    url?: string;
    extractedAt?: string;
    quick?: boolean;
    diff?: { final?: number; error?: string; canvas?: { final?: { score?: number } | null } } | null;
    replay?: { canvas?: number | null; page?: number | null; rebuild?: { canvas?: number | null; page?: number | null } | null } | null;
  };
  return {
    url: e.url ?? '',
    runId,
    extractedAt: e.extractedAt ?? null,
    quick: Boolean(e.quick),
    page: num(e.diff?.final),
    canvas: num(e.diff?.canvas?.final?.score),
    replayPage: num(e.replay?.page),
    replayCanvas: num(e.replay?.canvas),
    rebuildPage: num(e.replay?.rebuild?.page),
    rebuildCanvas: num(e.replay?.rebuild?.canvas),
    error: e.diff?.error ?? null,
  };
}

/** Judge one site: every target it has, against the run's scores. A missing score for a set target is a miss. */
export function judgeSite(site: ScoreboardSite, scores: RunScores | null, tolerance = 0.01, failure?: string): ScoreboardRow {
  const targets = site.targets ?? {};
  const name = site.name ?? site.url;
  if (!scores) return { name, url: site.url, status: 'failed', scores: null, targets, misses: [], ...(failure ? {} : {}) };
  const misses: ScoreboardRow['misses'] = [];
  for (const metric of Object.keys(targets) as Array<keyof ScoreTargets>) {
    const target = targets[metric];
    if (target == null) continue;
    const score = scores[metric];
    if (score == null || score < target - tolerance) misses.push({ metric, target, score });
  }
  const any = [scores.page, scores.canvas, scores.rebuildPage, scores.rebuildCanvas].some((x) => x != null);
  const status: RowStatus = misses.length
    ? scores.quick
      ? 'below target (quick)'
      : 'regressed'
    : !Object.keys(targets).length
      ? any
        ? 'no target'
        : 'no score'
      : 'holds';
  return { name, url: site.url, status, scores, targets, misses };
}

const pct = (x: number | null | undefined): string => (x == null ? 'n/a' : `${Math.round(x * 1000) / 10}%`);
/** Two numbers that differ but round to the same text get enough digits to show the difference. */
export function pctPair(score: number | null, target: number): [string, string] {
  if (score == null) return ['n/a', pct(target)];
  for (let d = 1; d <= 6; d++) {
    const f = (x: number) => `${(x * 100).toFixed(d).replace(/\.?0+$/, '')}%`;
    if (f(score) !== f(target)) return [f(score), f(target)];
  }
  // too close to show in digits (float noise): say how far, so a miss never reads as equal
  const gap = Math.abs(target - score);
  return [`${pct(target)} ${score < target ? 'minus' : 'plus'} ${gap.toExponential(1)}`, pct(target)];
}
const cell = (score: number | null, target: number | undefined): string => (target == null ? pct(score) : `${pct(score)} (target ${pct(target)})`);

export function scoreboardMd(rows: ScoreboardRow[], failures: Record<string, string> = {}): string {
  const out = [
    '# DEA scoreboard',
    '',
    'Scores DEA reached on its reference sites. Kept = what the kit runs; (a) = the capture replay (the recorded frames played',
    'back, ground truth); (b) = the editable three.js rebuild. A score more than the tolerance below its target is a regression.',
    '',
    '| Site | Status | Kept page | Kept canvas | (a) canvas | (b) page | (b) canvas | Run |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const s = r.scores;
    out.push(
      `| ${r.name} | ${r.status}${s?.quick ? ' (quick)' : ''} | ${cell(s?.page ?? null, r.targets.page)} | ${cell(s?.canvas ?? null, r.targets.canvas)} | ${pct(s?.replayCanvas)} | ${cell(s?.rebuildPage ?? null, r.targets.rebuildPage)} | ${cell(s?.rebuildCanvas ?? null, r.targets.rebuildCanvas)} | ${s?.runId ?? '-'} |`,
    );
  }
  const bad = rows.filter((r) => r.status === 'regressed');
  const failed = rows.filter((r) => r.status === 'failed');
  out.push('');
  if (bad.length) {
    out.push(`## Regressions (${bad.length})`, '');
    for (const r of bad)
      for (const m of r.misses) {
        const [sc, tg] = pctPair(m.score, m.target);
        out.push(`- ${r.name}: ${m.metric} ${sc}, target ${tg}`);
      }
    out.push('');
  }
  if (failed.length) {
    out.push(`## Did not run (${failed.length})`, '');
    for (const r of failed) out.push(`- ${r.name}: ${failures[r.url] ?? 'no run'}`);
    out.push('');
  }
  const quickMiss = rows.filter((r) => r.status === 'below target (quick)');
  if (quickMiss.length) {
    out.push(`## Below target in --quick runs (${quickMiss.length}, not regressions: targets are for full runs)`, '');
    for (const r of quickMiss)
      for (const m of r.misses) {
        const [sc, tg] = pctPair(m.score, m.target);
        out.push(`- ${r.name}: ${m.metric} ${sc}, target ${tg}`);
      }
    out.push('');
  }
  if (!bad.length && !failed.length) out.push(quickMiss.length ? 'No regressions in full runs.' : 'Every target holds.', '');
  return `${out.join('\n')}`;
}

/** Read and check a sites file. */
export function parseScoreboardFile(text: string): ScoreboardFile {
  const f = JSON.parse(text) as ScoreboardFile;
  if (!Array.isArray(f.sites) || !f.sites.length) throw new Error('the scoreboard file needs a non-empty "sites" list');
  for (const s of f.sites) {
    if (typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) throw new Error(`every site needs an http(s) url (got ${JSON.stringify(s.url)})`);
    for (const [k, v] of Object.entries(s.targets ?? {}))
      if (!['page', 'canvas', 'rebuildPage', 'rebuildCanvas'].includes(k) || typeof v !== 'number' || v < 0 || v > 1)
        throw new Error(`${s.url}: target ${k} must be one of page, canvas, rebuildPage, rebuildCanvas, between 0 and 1`);
  }
  return f;
}
