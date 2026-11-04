import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContentCache, cacheKey, currentCache, withCache } from '../src/cache.ts';
import { pool } from '../src/pool.ts';

const dirs: string[] = [];
const temp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'dea-cache-'));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('content cache', () => {
  it('keeps an entry with its files and hands it back while fresh', async () => {
    const c = new ContentCache({ dir: await temp() });
    const k = cacheKey('capture', 'https://example.com', { w: 1440 });
    expect(await c.get('capture', k)).toBeNull();
    await c.put('capture', k, { made: 'now' }, { 'ref.png': new Uint8Array([1, 2, 3]), 'layout.json': '{}' });
    const d = await c.get('capture', k);
    expect(d).not.toBeNull();
    expect((await readdir(d as string)).sort()).toEqual(['layout.json', 'meta.json', 'ref.png']);
    expect((await c.meta<{ made: string; bytes: number }>('capture', k))?.bytes).toBe(5);
    expect(c.stats.stored).toBe(1);
  });

  it('forgets entries older than the age limit', async () => {
    const c = new ContentCache({ dir: await temp(), ttlHours: 0.01 }); // 36 s
    const k = cacheKey('x');
    await c.put('stage', k, { dir: '/tmp' });
    const real = Date.now;
    Date.now = () => real() + 60_000;
    try {
      expect(await c.get('stage', k)).toBeNull();
      expect((await c.prune()).removed).toBe(1);
    } finally {
      Date.now = real;
    }
  });

  it('keeps under its size cap by dropping the least recently used entries first', async () => {
    const c = new ContentCache({ dir: await temp(), maxMb: 16 });
    const big = new Uint8Array(7 * 1024 * 1024);
    const ks = ['a', 'b', 'c'].map((x) => cacheKey(x));
    for (const [i, k] of ks.entries()) {
      const d = await c.put('http', k, { url: k }, { body: big });
      const t = new Date(Date.now() - (10 - i) * 1000);
      await utimes(join(d, 'meta.json'), t, t);
    }
    await c.get('http', ks[0]); // used now: the newest
    const p = await c.prune();
    expect(p.removed).toBe(1);
    expect(await c.get('http', ks[1])).toBeNull();
    expect(await c.get('http', ks[0])).not.toBeNull();
    expect(await c.get('http', ks[2])).not.toBeNull();
  });

  it('is scoped: withCache sets the cache pages use, null turns it off', async () => {
    const c = new ContentCache({ dir: await temp() });
    expect(currentCache()).toBeNull();
    await withCache(c, async () => {
      expect(currentCache()).toBe(c);
      await withCache(null, async () => expect(currentCache()).toBeNull());
    });
  });
});

describe('pool', () => {
  it('runs at most n jobs at a time and keeps every result', async () => {
    const limit = pool(2);
    let active = 0;
    let peak = 0;
    const job = (v: number) => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return v;
    };
    expect(await Promise.all([1, 2, 3, 4, 5].map((v) => limit(job(v))))).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });
});
