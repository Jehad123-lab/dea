import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Known-vulnerable library check using the retire.js vulnerability repository (Apache-2.0, RetireJS project).
 * The data is downloaded on first use and cached for a day; it is not bundled with DEA.
 */
export const RETIRE_URL = 'https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository-v4.json';

export interface VulnHit {
  library: string;
  version: string;
  /** where the version was read */
  evidence: string;
  vulnerabilities: Array<{ severity: string; summary: string; ids: string[]; below?: string; atOrAbove?: string; info: string[] }>;
}

type Repo = Record<
  string,
  {
    extractors?: { uri?: string[]; filename?: string[]; filecontent?: string[]; hashes?: Record<string, string> };
    vulnerabilities?: Array<{ below?: string; atOrAbove?: string; severity?: string; identifiers?: Record<string, unknown>; info?: string[] }>;
  }
>;

export async function loadRetireRepo(cacheDir: string, opts: { offline?: boolean } = {}): Promise<{ repo: Repo; source: string } | { error: string }> {
  const file = join(cacheDir, 'retire-jsrepository.json');
  try {
    const st = await stat(file);
    if (opts.offline || Date.now() - st.mtimeMs < 24 * 3600_000) return { repo: JSON.parse(await readFile(file, 'utf8')), source: `cache ${file}` };
  } catch {
    /* no cache yet */
  }
  if (opts.offline) return { error: 'no cached vulnerability data and offline' };
  try {
    const res = await fetch(RETIRE_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { error: `could not download the retire.js data (HTTP ${res.status})` };
    const text = await res.text();
    const repo = JSON.parse(text) as Repo;
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, text);
    return { repo, source: RETIRE_URL };
  } catch (e) {
    return { error: `could not download the retire.js data: ${(e as Error).message}` };
  }
}

/** Compare dotted versions ("3.12.0" vs "3.4.1-beta"); pre-release tags sort before the release. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    // a missing part next to a number is a zero: 2.0 = 2.0.0
    const x = pa[i] ?? (/^\d+$/.test(pb[i] ?? '') ? '0' : '');
    const y = pb[i] ?? (/^\d+$/.test(pa[i] ?? '') ? '0' : '');
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (x !== y) {
      if (x === '') return nx || y === '' ? -1 : 1;
      if (y === '') return ny ? 1 : -1;
      if (nx) return 1;
      if (ny) return -1;
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** retire.js patterns wrap the version placeholder in their own group: "/(§§version§§)/jquery(\.min)?\.js" → group 1. */
function versionFrom(re: string, text: string): string | null {
  let r: RegExp;
  try {
    r = new RegExp(re.replace(/§§version§§/g, '[0-9][0-9.a-z_\\-]+'), 'i');
  } catch {
    return null;
  }
  const m = r.exec(text);
  const ver = m?.[1];
  return ver && /^\d/.test(ver) ? ver.replace(/[.-]+$/, '') : null;
}

/** Find libraries and their versions in script URLs and contents, and the known issues for each version. */
export function checkScripts(
  repo: Repo,
  scripts: Array<{ url: string; source: string }>,
  known: Array<{ name: string; version: string | null }> = [],
): VulnHit[] {
  const found = new Map<string, VulnHit>();
  const note = (lib: string, version: string, evidence: string) => {
    const k = `${lib}@${version}`;
    if (found.has(k)) return;
    const vulns = (repo[lib]?.vulnerabilities ?? []).filter(
      (v) => (!v.below || cmpVersion(version, v.below) < 0) && (!v.atOrAbove || cmpVersion(version, v.atOrAbove) >= 0),
    );
    found.set(k, {
      library: lib,
      version,
      evidence,
      vulnerabilities: vulns.map((v) => {
        const ids = v.identifiers ?? {};
        const flat = Object.entries(ids).flatMap(([k2, x]) => (k2 === 'summary' ? [] : Array.isArray(x) ? x.map(String) : [String(x)]));
        return {
          severity: v.severity ?? 'unknown',
          summary: String((ids as any).summary ?? ''),
          ids: flat.slice(0, 6),
          below: v.below,
          atOrAbove: v.atOrAbove,
          info: (v.info ?? []).slice(0, 2),
        };
      }),
    });
  };
  for (const [lib, def] of Object.entries(repo)) {
    const ex = def.extractors ?? {};
    for (const s of scripts) {
      for (const re of ex.uri ?? []) {
        const v = versionFrom(re, s.url);
        if (v) note(lib, v, `script URL ${s.url}`);
      }
      for (const re of ex.filename ?? []) {
        const v = versionFrom(re, s.url.split('/').pop() ?? '');
        if (v) note(lib, v, `file name ${s.url.split('/').pop()}`);
      }
      const head = s.source.length > 4_000_000 ? s.source.slice(0, 4_000_000) : s.source;
      for (const re of ex.filecontent ?? []) {
        const v = versionFrom(re, head);
        if (v) note(lib, v, `text inside ${s.url.split('/').pop()?.split('?')[0]}`);
      }
    }
  }
  const alias: Record<string, string> = { 'three.js': 'three.js', GSAP: 'gsap', jQuery: 'jquery', React: 'react', Vue: 'vue', 'Next.js': 'next.js' };
  for (const k of known) {
    const lib = alias[k.name];
    if (lib && k.version && repo[lib]) note(lib, k.version.replace(/^r(\d+)$/, '0.$1.0'), `DEA stack detection (${k.name} ${k.version})`);
  }
  return [...found.values()].sort((a, b) => b.vulnerabilities.length - a.vulnerabilities.length);
}
