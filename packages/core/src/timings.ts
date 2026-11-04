import { AsyncLocalStorage } from 'node:async_hooks';
import { readdirSync, readFileSync } from 'node:fs';

/** One measured stage: wall time from start to end, in ms from the start of the command. */
export interface StageTiming {
  id: number;
  name: string;
  /** id of the enclosing stage */
  parentId: number | null;
  /** the stage this one ran inside (stages can nest and run side by side) */
  parent: string | null;
  startMs: number;
  ms: number;
  ok: boolean;
  /** e.g. "from cache" */
  note?: string;
}

export interface TimingsDoc {
  schema: 'dea.timings/1';
  command: string;
  url: string | null;
  totalMs: number;
  /** stages in the order they started */
  stages: StageTiming[];
  /** wall time per top-level stage name, summed (stages that ran side by side overlap) */
  totals: Record<string, number>;
  /** the largest resident memory of the DEA process itself (MB) */
  peakRssMb: number;
  /** the largest summed resident memory of DEA plus the browsers it started (MB); null where the OS does not expose it */
  peakTreeRssMb: number | null;
  notes: string[];
}

const SAMPLE_MS = 500;

/** Resident memory of a process tree in bytes, read from /proc (Linux). null elsewhere. */
export function treeRss(root = process.pid): number | null {
  let names: string[];
  try {
    names = readdirSync('/proc');
  } catch {
    return null;
  }
  const page = 4096;
  const parent = new Map<number, number>();
  const rss = new Map<number, number>();
  for (const n of names) {
    if (!/^\d+$/.test(n)) continue;
    try {
      const stat = readFileSync(`/proc/${n}/stat`, 'utf8');
      // the command can hold spaces and parentheses: fields after the last ')' are fixed
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      parent.set(Number(n), Number(rest[1]));
      rss.set(Number(n), Number(rest[21]) * page);
    } catch {
      /* the process ended while we read */
    }
  }
  const kids = new Map<number, number[]>();
  for (const [pid, pp] of parent) kids.set(pp, [...(kids.get(pp) ?? []), pid]);
  let total = 0;
  const stack = [root];
  const seen = new Set<number>();
  while (stack.length) {
    const pid = stack.pop() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += rss.get(pid) ?? 0;
    stack.push(...(kids.get(pid) ?? []));
  }
  return total;
}

/** Wall time per stage and peak memory for one command. Cheap enough to be always on; `--timings` prints it. */
export class Timings {
  readonly command: string;
  readonly url: string | null;
  readonly t0 = performance.now();
  readonly stages: StageTiming[] = [];
  readonly notes: string[] = [];
  /** the first run folder written while measuring (where timings.json goes) */
  dir: string | null = null;
  private peakTree = 0;
  private treeOk = true;
  private timer: NodeJS.Timeout | null = null;
  private readonly path = new AsyncLocalStorage<StageTiming>();

  constructor(command: string, url: string | null = null) {
    this.command = command;
    this.url = url;
  }

  /** start sampling the process tree's memory */
  start(): this {
    this.sample();
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
    this.timer.unref();
    return this;
  }

  private sample(): void {
    if (!this.treeOk) return;
    const r = treeRss();
    if (r == null) this.treeOk = false;
    else this.peakTree = Math.max(this.peakTree, r);
  }

  now(): number {
    return performance.now() - this.t0;
  }

  /** time `fn` as a stage; nested calls record their parent; stages may run side by side */
  async stage<T>(name: string, fn: () => Promise<T>, note?: string): Promise<T> {
    const up = this.path.getStore() ?? null;
    const startMs = this.now();
    const row: StageTiming = {
      id: this.stages.length,
      name,
      parentId: up?.id ?? null,
      parent: up?.name ?? null,
      startMs: Math.round(startMs),
      ms: 0,
      ok: true,
      ...(note ? { note } : {}),
    };
    this.stages.push(row);
    try {
      return await this.path.run(row, fn);
    } catch (e) {
      row.ok = false;
      throw e;
    } finally {
      row.ms = Math.round(this.now() - startMs);
    }
  }

  /** start a stage that does not fit in one call; `end()` closes it. `under` nests it inside another open stage. */
  begin(name: string, under?: StageTiming): { row: StageTiming; end: () => void } {
    const up = under ?? this.path.getStore() ?? null;
    const startMs = this.now();
    const row: StageTiming = {
      id: this.stages.length,
      name,
      parentId: up?.id ?? null,
      parent: up?.name ?? null,
      startMs: Math.round(startMs),
      ms: 0,
      ok: true,
    };
    this.stages.push(row);
    return { row, end: () => void (row.ms = Math.round(this.now() - startMs)) };
  }

  /** record a stage that was measured elsewhere */
  record(name: string, startMs: number, ms: number, note?: string): void {
    const up = this.path.getStore() ?? null;
    this.stages.push({
      id: this.stages.length,
      name,
      parentId: up?.id ?? null,
      parent: up?.name ?? null,
      startMs: Math.round(startMs),
      ms: Math.round(ms),
      ok: true,
      ...(note ? { note } : {}),
    });
  }

  /** add a note to the stage running now (e.g. "from cache") */
  note(text: string): void {
    const row = this.path.getStore();
    if (row) row.note = row.note ? `${row.note}; ${text}` : text;
    else this.notes.push(text);
  }

  stop(): TimingsDoc {
    if (this.timer) clearInterval(this.timer);
    this.sample();
    const totals: Record<string, number> = {};
    for (const s of this.stages) if (!s.parent) totals[s.name] = (totals[s.name] ?? 0) + s.ms;
    return {
      schema: 'dea.timings/1',
      command: this.command,
      url: this.url,
      totalMs: Math.round(this.now()),
      stages: this.stages,
      totals,
      peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
      peakTreeRssMb: this.treeOk ? Math.round(this.peakTree / 1048576) : null,
      notes: this.notes,
    };
  }
}

const current = new AsyncLocalStorage<Timings>();

/** run `fn` with `t` as the timings every `timed()` call inside it reports to */
export function withTimings<T>(t: Timings, fn: () => Promise<T>): Promise<T> {
  return current.run(t, fn);
}

export function currentTimings(): Timings | undefined {
  return current.getStore();
}

/** time a stage when a command is measuring; otherwise just run it */
export function timed<T>(name: string, fn: () => Promise<T>, note?: string): Promise<T> {
  const t = current.getStore();
  return t ? t.stage(name, fn, note) : fn();
}

function secs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(0)} s` : `${(ms / 1000).toFixed(1)} s`;
}

/** A plain-text table: each stage indented under its parent, with its wall time. */
export function renderTimings(doc: TimingsDoc): string {
  const lines = [`Timings (${doc.command}${doc.url ? ` ${doc.url}` : ''}): total ${secs(doc.totalMs)}`];
  const byParent = new Map<number | null, StageTiming[]>();
  for (const s of doc.stages) byParent.set(s.parentId, [...(byParent.get(s.parentId) ?? []), s]);
  const walk = (parent: number | null, depth: number) => {
    for (const s of byParent.get(parent) ?? []) {
      const label = `${'  '.repeat(depth + 1)}${s.name}`;
      lines.push(`${label.padEnd(44)} ${secs(s.ms).padStart(8)}  @${secs(s.startMs)}${s.ok ? '' : '  (failed)'}${s.note ? `  ${s.note}` : ''}`);
      if (depth < 4) walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  lines.push(`  peak memory: DEA ${doc.peakRssMb} MB${doc.peakTreeRssMb != null ? `, DEA + browsers ${doc.peakTreeRssMb} MB` : ''}`);
  for (const n of doc.notes) lines.push(`  note: ${n}`);
  return lines.join('\n');
}
