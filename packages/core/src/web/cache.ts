import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** DEA's web cache: one small JSON file per question under <home>/web-cache. Nothing secret is ever cached: only public answers. */
export function webCacheHome(home?: string): string {
  return join(home ?? process.env.DEA_HOME ?? process.env.DEA_HUB_HOME ?? join(homedir(), '.dea'), 'web-cache');
}

export interface CacheEntry<T> {
  key: string;
  fetched_at: string;
  value: T;
}

const file = (dir: string, key: string) => join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 40)}.json`);

export async function cacheGet<T>(dir: string, key: string): Promise<CacheEntry<T> | null> {
  try {
    const e = JSON.parse(await readFile(file(dir, key), 'utf8')) as CacheEntry<T>;
    return e.key === key ? e : null;
  } catch {
    return null;
  }
}

export async function cachePut<T>(dir: string, key: string, value: T, at: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const f = file(dir, key);
    const tmp = `${f}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ key, fetched_at: at, value } satisfies CacheEntry<T>));
    await rename(tmp, f);
  } catch {
    /* a cache that cannot be written is only a slower DEA */
  }
}

export const ageMs = (e: { fetched_at: string }, now: number) => now - Date.parse(e.fetched_at);
