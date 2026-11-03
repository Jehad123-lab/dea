// The local library: decode once, reuse in every project. Kits made by `dea extract` are saved under ~/.dea/library/<name>
// (or $DEA_LIBRARY), indexed by what is inside them (site, shaders, uniforms, eases, colours, fonts, tags) so you can
// search them and copy one into a new project.

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { resolveRun } from '../evidence/run.ts';

/** dea-kit.json: written into every extract, so a kit describes itself wherever it is copied. */
export interface KitManifest {
  url: string;
  extractedAt: string;
  target: string;
  title?: string;
  score: number | null;
  shaders: Array<{ name: string; uniforms: string[]; drivers: Record<string, string> }>;
  eases: string[];
  colors: string[];
  fonts: string[];
  techniques: string[];
  provenance: string;
}

export interface LibraryEntry extends Omit<KitManifest, 'provenance'> {
  name: string;
  tags: string[];
  savedAt: string;
  dir: string;
}

export function libraryHome(): string {
  return resolve(process.env.DEA_LIBRARY ?? join(homedir(), '.dea', 'library'));
}

const safeName = (n: string) =>
  n
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 60) || 'kit';

async function readIndex(): Promise<LibraryEntry[]> {
  try {
    return JSON.parse(await readFile(join(libraryHome(), 'index.json'), 'utf8')) as LibraryEntry[];
  } catch {
    return [];
  }
}

async function writeIndex(items: LibraryEntry[]): Promise<void> {
  await mkdir(libraryHome(), { recursive: true });
  await writeFile(join(libraryHome(), 'index.json'), `${JSON.stringify(items, null, 2)}\n`);
}

/** A kit folder from a run id/folder (its extract/ folder) or a plain folder that holds dea-kit.json. */
export async function kitDir(ref: string): Promise<string> {
  const direct = resolve(ref);
  if (existsSync(join(direct, 'dea-kit.json'))) return direct;
  if (existsSync(join(direct, 'extract', 'dea-kit.json'))) return join(direct, 'extract');
  const run = await resolveRun(ref).catch(() => null);
  if (run && existsSync(join(run, 'extract', 'dea-kit.json'))) return join(run, 'extract');
  throw new Error(`No extracted kit at "${ref}". Give an extract run id, its folder, or a folder with dea-kit.json (made by dea extract).`);
}

/** Save a kit in the library (copied, so the run can be deleted). Same name replaces the old one. */
export async function libraryAdd(ref: string, o: { name?: string; tags?: string[] } = {}): Promise<LibraryEntry> {
  const src = await kitDir(ref);
  const kit = JSON.parse(await readFile(join(src, 'dea-kit.json'), 'utf8')) as KitManifest;
  const name = safeName(o.name ?? new URL(kit.url).hostname.replace(/^www\./, ''));
  const dest = join(libraryHome(), name);
  if (resolve(src) !== resolve(dest)) {
    await rm(dest, { recursive: true, force: true });
    await mkdir(libraryHome(), { recursive: true });
    await cp(src, dest, {
      recursive: true,
      filter: (p) => !/[\\/](node_modules|dist|\.vite)([\\/]|$)/.test(p),
    });
  }
  const { provenance: _p, ...rest } = kit;
  const entry: LibraryEntry = {
    ...rest,
    name,
    tags: [...new Set((o.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))],
    savedAt: new Date().toISOString(),
    dir: dest,
  };
  const items = (await readIndex()).filter((e) => e.name !== name);
  await writeIndex([...items, entry]);
  return entry;
}

export async function libraryList(): Promise<LibraryEntry[]> {
  return readIndex();
}

/** Words that make a kit match, with what they matched: site, name, tags, shaders, uniforms, drivers, eases, colours, fonts. */
export function scoreEntry(e: LibraryEntry, query: string): { score: number; matched: string[] } {
  const terms = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 1);
  const fields: Array<[string, string[], number]> = [
    ['name', [e.name], 3],
    ['site', [e.url, e.title ?? ''], 3],
    ['tag', e.tags, 3],
    ['technique', e.techniques ?? [], 2],
    ['shader', e.shaders.map((s) => s.name), 2],
    ['uniform', e.shaders.flatMap((s) => s.uniforms), 1],
    ['driver', e.shaders.flatMap((s) => Object.entries(s.drivers).map(([u, d]) => `${u} ${d}`)), 1],
    ['ease', e.eases, 1],
    ['colour', e.colors, 1],
    ['font', e.fonts, 1],
    ['target', [e.target], 1],
  ];
  let score = 0;
  const matched: string[] = [];
  for (const t of terms) {
    let hit = false;
    for (const [label, vals, w] of fields) {
      const stem = t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
      const v = vals.find((x) => x.toLowerCase().includes(t) || x.toLowerCase().includes(stem));
      if (v) {
        score += w;
        if (!hit) matched.push(`${label}: ${v.slice(0, 60)}`);
        hit = true;
      }
    }
    if (!hit) return { score: 0, matched: [] };
  }
  return { score, matched };
}

export async function librarySearch(query: string): Promise<Array<LibraryEntry & { score: number; matched: string[] }>> {
  return (await readIndex())
    .map((e) => ({ ...e, ...scoreEntry(e, query) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Copy a saved kit into a folder to start a project from it. The folder must be new or empty unless force is set. */
export async function libraryUse(name: string, dest: string, o: { force?: boolean } = {}): Promise<{ entry: LibraryEntry; dir: string; files: number }> {
  const entry = (await readIndex()).find((e) => e.name === name || e.name === safeName(name));
  if (!entry) throw new Error(`No kit named "${name}" in the library. See: dea library list`);
  const out = resolve(dest);
  if (existsSync(out) && (await stat(out)).isDirectory() && (await readdir(out)).length && !o.force)
    throw new Error(`${out} is not empty. Pick a new folder or add --force.`);
  await mkdir(out, { recursive: true });
  await cp(entry.dir, out, { recursive: true, force: true });
  let files = 0;
  const count = async (d: string) => {
    for (const x of await readdir(d, { withFileTypes: true })) x.isDirectory() ? await count(join(d, x.name)) : files++;
  };
  await count(out);
  return { entry, dir: out, files };
}

export async function libraryRemove(name: string): Promise<boolean> {
  const items = await readIndex();
  const e = items.find((x) => x.name === name);
  if (!e) return false;
  if (basename(resolve(e.dir, '..')) === basename(libraryHome()) || resolve(e.dir).startsWith(libraryHome())) await rm(e.dir, { recursive: true, force: true });
  await writeIndex(items.filter((x) => x.name !== name));
  return true;
}
