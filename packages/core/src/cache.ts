import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Route } from 'playwright';
import { deaHome } from './evidence/run.ts';

/**
 * DEA's content cache: what one run downloaded or recorded, kept so the next run of the same URL does not do it again.
 *
 * - `http`: the site's static files (scripts, styles, images, fonts, models, textures, wasm), served to every page DEA
 *   opens, so one run downloads each file once instead of once per stage, and a second run not at all.
 * - `stage`: which earlier run answered a stage (design, motion, assets, trace) for this URL and these options.
 * - `capture`: the reference screenshot, the first screen's layout and the recorded WebGL frames.
 *
 * Every entry has an age limit (24 h unless set) and the whole cache a size cap (1 GB unless set); the oldest entries
 * go first. `--no-cache` neither reads nor writes it.
 */
export interface CacheOptions {
  dir?: string;
  maxMb?: number;
  ttlHours?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  stored: number;
  bytesServed: number;
  bytesStored: number;
  /** stages and captures answered from the cache, with when they were made */
  reused: Array<{ what: string; at: string }>;
}

const MAX_FILE = 64 * 1024 * 1024;
const ASSET_EXT = /\.(js|mjs|css|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|glb|gltf|bin|drc|ktx2?|basis|hdr|exr|wasm|mp3|ogg|m4a|wav|riv|lottie)(\?|$)/i;
const KEEP_HEADERS =
  /^(content-type|access-control-.*|timing-allow-origin|cross-origin-resource-policy|cross-origin-embedder-policy|cache-control|etag|last-modified|vary)$/i;

export function cacheKey(...parts: unknown[]): string {
  return createHash('sha256')
    .update(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\u0000'))
    .digest('hex');
}

export class ContentCache {
  readonly dir: string;
  readonly maxBytes: number;
  readonly ttlMs: number;
  readonly stats: CacheStats = { hits: 0, misses: 0, stored: 0, bytesServed: 0, bytesStored: 0, reused: [] };

  constructor(opts: CacheOptions = {}) {
    this.dir = opts.dir ?? join(deaHome(), 'cache');
    this.maxBytes = Math.max(16, opts.maxMb ?? 1024) * 1024 * 1024;
    this.ttlMs = Math.max(0.01, opts.ttlHours ?? 24) * 3_600_000;
  }

  private entry(ns: string, key: string): string {
    return join(this.dir, ns, key.slice(0, 2), key);
  }

  /** the folder of a fresh entry, or null (missing or older than the age limit) */
  async get(ns: string, key: string): Promise<string | null> {
    const d = this.entry(ns, key);
    try {
      const m = JSON.parse(await readFile(join(d, 'meta.json'), 'utf8')) as { at: number };
      if (Date.now() - m.at > this.ttlMs) return null;
      const now = new Date();
      await utimes(join(d, 'meta.json'), now, now).catch(() => {}); // last use, for the size cap
      return d;
    } catch {
      return null;
    }
  }

  async meta<T>(ns: string, key: string): Promise<(T & { at: number }) | null> {
    const d = await this.get(ns, key);
    if (!d) return null;
    try {
      return JSON.parse(await readFile(join(d, 'meta.json'), 'utf8')) as T & { at: number };
    } catch {
      return null;
    }
  }

  /** write an entry: its files first, meta.json last (an entry without meta.json does not exist) */
  async put(ns: string, key: string, meta: Record<string, unknown>, files: Record<string, string | Uint8Array> = {}): Promise<string> {
    const d = this.entry(ns, key);
    await rm(d, { recursive: true, force: true });
    await mkdir(d, { recursive: true });
    let bytes = 0;
    for (const [name, body] of Object.entries(files)) {
      await writeFile(join(d, name), body);
      bytes += typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
    }
    await writeFile(join(d, 'meta.json'), JSON.stringify({ ...meta, at: Date.now(), bytes }));
    this.stats.stored++;
    this.stats.bytesStored += bytes;
    return d;
  }

  /** serve the site's static files to this context from the cache, and keep what is not there yet */
  async attach(context: BrowserContext): Promise<void> {
    await context.route('**/*', (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const req = route.request();
    const url = req.url();
    const type = req.resourceType();
    const cacheable =
      req.method() === 'GET' &&
      /^https?:/.test(url) &&
      !req.headers().range &&
      (['script', 'stylesheet', 'image', 'font'].includes(type) || (['fetch', 'xhr', 'other', 'media'].includes(type) && ASSET_EXT.test(url)));
    if (!cacheable) return route.fallback();
    const key = cacheKey('http', url);
    const d = await this.get('http', key);
    if (d) {
      try {
        const m = JSON.parse(await readFile(join(d, 'meta.json'), 'utf8')) as { status: number; headers: Record<string, string> };
        const body = await readFile(join(d, 'body'));
        this.stats.hits++;
        this.stats.bytesServed += body.byteLength;
        return await route.fulfill({ status: m.status, headers: m.headers, body });
      } catch {
        /* fall through to the network */
      }
    }
    this.stats.misses++;
    let res: Awaited<ReturnType<Route['fetch']>> | null = null;
    try {
      res = await route.fetch({ timeout: 60_000 });
    } catch {
      return route.fallback().catch(() => {});
    }
    let body: Buffer | null = null;
    try {
      body = await res.body();
    } catch {
      body = null;
    }
    if (!body) return route.fulfill({ response: res }).catch(() => {});
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers())) if (KEEP_HEADERS.test(k)) headers[k] = v;
    const noStore = /no-store/i.test(res.headers()['cache-control'] ?? '');
    if (res.status() === 200 && !noStore && body.byteLength <= MAX_FILE) {
      await this.put('http', key, { url, status: 200, headers }, { body }).catch(() => {});
    }
    await route.fulfill({ status: res.status(), headers, body }).catch(() => {});
  }

  /** keep the cache under its size cap: the least recently used entries go first; expired entries go always */
  async prune(): Promise<{ entries: number; bytes: number; removed: number }> {
    const all: Array<{ dir: string; bytes: number; used: number; at: number }> = [];
    if (!existsSync(this.dir)) return { entries: 0, bytes: 0, removed: 0 };
    for (const ns of await readdir(this.dir).catch(() => [] as string[]))
      for (const p of await readdir(join(this.dir, ns)).catch(() => [] as string[]))
        for (const k of await readdir(join(this.dir, ns, p)).catch(() => [] as string[])) {
          const dir = join(this.dir, ns, p, k);
          try {
            const s = await stat(join(dir, 'meta.json'));
            const m = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { at: number; bytes?: number };
            all.push({ dir, bytes: m.bytes ?? 0, used: s.mtimeMs, at: m.at });
          } catch {
            // an entry left half-written by a crash
            await rm(dir, { recursive: true, force: true }).catch(() => {});
          }
        }
    all.sort((a, b) => a.used - b.used);
    let total = all.reduce((s, e) => s + e.bytes, 0);
    let removed = 0;
    for (const e of all) {
      if (total <= this.maxBytes && Date.now() - e.at <= this.ttlMs) continue;
      await rm(e.dir, { recursive: true, force: true }).catch(() => {});
      total -= e.bytes;
      removed++;
    }
    return { entries: all.length - removed, bytes: total, removed };
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

const current = new AsyncLocalStorage<ContentCache | null>();

/** run `fn` with `cache` as the cache every page DEA opens inside it uses (null: no cache) */
export function withCache<T>(cache: ContentCache | null, fn: () => Promise<T>): Promise<T> {
  return current.run(cache, fn);
}

export function currentCache(): ContentCache | null {
  return current.getStore() ?? null;
}

export function fmtMb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(bytes > 104857600 ? 0 : 1)} MB`;
}
