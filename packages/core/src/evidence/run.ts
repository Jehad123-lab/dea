import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { currentTimings } from '../timings.ts';
import type { EventSink, RunMeta } from '../types.ts';
import { redactText } from './secrets.ts';

/** Where runs live. `DEA_HOME` overrides; default is ./.dea in the current folder. */
export function deaHome(): string {
  return resolve(process.env.DEA_HOME ?? '.dea');
}

export function runsDir(): string {
  return join(deaHome(), 'runs');
}

function slugHost(url: string): string {
  try {
    return new URL(url).hostname
      .replace(/^www\./, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .slice(0, 40);
  } catch {
    return 'site';
  }
}

/** Sortable, readable, hard to guess: 20261103-083012-threejs-org-9f2c41ab */
export function newRunId(url: string, now = new Date()): string {
  const t = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${t}-${slugHost(url)}-${randomBytes(4).toString('hex')}`;
}

const RUN_ID = /^[0-9]{8}-[0-9]{6}-[a-z0-9-]+-[0-9a-f]{8}$/i;

export function isRunId(id: string): boolean {
  return RUN_ID.test(id);
}

/** One run folder. Everything written goes through here so secrets are stripped on the way out. */
export class RunWriter {
  readonly id: string;
  readonly dir: string;
  readonly files: Record<string, string> = {};

  /** live events for UIs; frames carry base64 data only when `frameData` is true */
  readonly emit: EventSink;
  readonly frameData: boolean;

  constructor(id: string, root = runsDir(), emit?: EventSink, opts: { frameData?: boolean } = {}) {
    this.id = id;
    this.dir = join(root, id);
    this.emit = (e) => {
      try {
        emit?.(e);
      } catch {
        /* a listener's error never breaks a run */
      }
    };
    this.frameData = opts.frameData ?? false;
  }

  async init(): Promise<this> {
    await mkdir(this.dir, { recursive: true });
    const t = currentTimings();
    if (t && !t.dir) t.dir = this.dir;
    await writeFile(join(this.dir, 'progress.md'), `# Progress for run ${this.id}\n\n`);
    return this;
  }

  path(name: string): string {
    return join(this.dir, name);
  }

  async progress(line: string): Promise<void> {
    const at = new Date().toISOString();
    await appendFile(this.path('progress.md'), `- ${at} ${redactText(line)}\n`);
    this.emit({ type: 'step', runId: this.id, step: redactText(line), at });
  }

  async json(name: string, data: unknown, role = name): Promise<string> {
    const p = this.path(name);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, `${redactText(JSON.stringify(data, null, 2))}\n`);
    this.files[role] = name;
    return p;
  }

  async text(name: string, text: string, role = name): Promise<string> {
    const p = this.path(name);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, redactText(text));
    this.files[role] = name;
    return p;
  }

  async bytes(name: string, data: Uint8Array, role = name): Promise<string> {
    const p = this.path(name);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, data);
    this.files[role] = name;
    if (/\.(jpe?g|png)$/i.test(name)) {
      this.emit({
        type: 'frame',
        runId: this.id,
        file: name,
        mime: /png$/i.test(name) ? 'image/png' : 'image/jpeg',
        ...(this.frameData ? { data: Buffer.from(data).toString('base64') } : {}),
        at: new Date().toISOString(),
      });
    }
    return p;
  }
}

export interface RunSummary {
  id: string;
  kind: RunMeta['kind'];
  url: string;
  title: string;
  startedAt: string;
  dir: string;
}

/** Newest first. */
export async function listRuns(root = runsDir(), limit = 50): Promise<RunSummary[]> {
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const out: RunSummary[] = [];
  for (const id of names.filter(isRunId).sort().reverse()) {
    try {
      const meta = JSON.parse(await readFile(join(root, id, 'run.json'), 'utf8')) as { meta: RunMeta };
      out.push({ id, kind: meta.meta.kind, url: meta.meta.url, title: meta.meta.title, startedAt: meta.meta.startedAt, dir: join(root, id) });
    } catch {
      /* unfinished run */
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Resolve "latest", a full id, or a unique prefix/suffix to a run folder. Refuses paths. */
export async function resolveRun(ref: string, root = runsDir()): Promise<string> {
  if (ref.includes('/') || ref.includes('\\') || ref.includes('..')) throw new Error(`Not a run id: ${ref}`);
  const runs = await listRuns(root, 10_000);
  if (!runs.length) throw new Error(`No runs yet in ${root}. Run "dea inspect <url>" first.`);
  if (ref === 'latest' || ref === '') return runs[0].dir;
  const exact = runs.find((r) => r.id === ref);
  if (exact) return exact.dir;
  const partial = runs.filter((r) => r.id.startsWith(ref) || r.id.endsWith(ref));
  if (partial.length === 1) return partial[0].dir;
  if (partial.length > 1) throw new Error(`"${ref}" matches ${partial.length} runs; use more of the id.`);
  throw new Error(`No run "${ref}" in ${root}.`);
}

export async function readRun<T = unknown>(dir: string): Promise<T> {
  await stat(dir);
  return JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')) as T;
}

export interface PruneResult {
  /** runs that were removed, or would be with dryRun */
  removed: Array<{ id: string; startedAt: string; bytes: number }>;
  kept: number;
  bytes: number;
  dryRun: boolean;
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await folderBytes(p);
    else total += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/**
 * Remove run folders older than `olderThanDays`, always keeping the newest `keep` runs and any folder with a
 * KEEP file in it. Only folders whose name is a run id are touched. Dry run unless `dryRun` is false.
 */
export async function pruneRuns(opts: { olderThanDays: number; keep?: number; dryRun?: boolean; now?: Date }, root = runsDir()): Promise<PruneResult> {
  if (!(opts.olderThanDays >= 0)) throw new Error('olderThanDays must be a number of days, 0 or more.');
  const dryRun = opts.dryRun !== false;
  const keep = Math.max(0, opts.keep ?? 5);
  const cutoff = (opts.now ?? new Date()).getTime() - opts.olderThanDays * 86_400_000;
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return { removed: [], kept: 0, bytes: 0, dryRun };
  }
  const ids = names.filter(isRunId).sort().reverse();
  const removed: PruneResult['removed'] = [];
  let kept = 0;
  for (const [i, id] of ids.entries()) {
    const dir = join(root, id);
    const pinned = await stat(join(dir, 'KEEP')).then(
      () => true,
      () => false,
    );
    // the id starts with the UTC start time (20261103-083012), so age needs no file read
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
    const started = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Number.POSITIVE_INFINITY;
    if (i < keep || pinned || started >= cutoff) {
      kept++;
      continue;
    }
    const bytes = await folderBytes(dir);
    if (!dryRun) await rm(dir, { recursive: true, force: true });
    removed.push({ id, startedAt: new Date(started).toISOString(), bytes });
  }
  return { removed, kept, bytes: removed.reduce((a, r) => a + r.bytes, 0), dryRun };
}
