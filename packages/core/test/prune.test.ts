import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneRuns } from '../src/evidence/run.ts';

const NOW = new Date('2026-11-23T12:00:00Z');

async function makeRun(root: string, id: string, bytes = 10): Promise<string> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'run.json'), 'x'.repeat(bytes));
  return dir;
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe('pruneRuns', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dea-prune-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('is a dry run unless told otherwise, and keeps the newest runs, KEEP folders and anything that is not a run', async () => {
    const old1 = await makeRun(root, '20260901-080000-threejs-org-0000000a', 100);
    const old2 = await makeRun(root, '20260902-080000-lusion-co-0000000b', 50);
    const pinned = await makeRun(root, '20260903-080000-igloo-inc-0000000c');
    await writeFile(join(pinned, 'KEEP'), '');
    const fresh = await makeRun(root, '20261120-080000-threejs-org-0000000d');
    await mkdir(join(root, 'not-a-run'));

    const dry = await pruneRuns({ olderThanDays: 30, keep: 1, now: NOW }, root);
    expect(dry.dryRun).toBe(true);
    expect(dry.removed.map((r) => r.id)).toEqual(['20260902-080000-lusion-co-0000000b', '20260901-080000-threejs-org-0000000a']);
    expect(dry.bytes).toBe(150);
    expect(await exists(old1)).toBe(true);

    const real = await pruneRuns({ olderThanDays: 30, keep: 1, dryRun: false, now: NOW }, root);
    expect(real.removed).toHaveLength(2);
    expect(await exists(old1)).toBe(false);
    expect(await exists(old2)).toBe(false);
    expect(await exists(pinned)).toBe(true);
    expect(await exists(fresh)).toBe(true);
    expect(await exists(join(root, 'not-a-run'))).toBe(true);
  });

  it('keeps the newest N even when they are old, and handles a missing folder', async () => {
    await makeRun(root, '20250101-080000-a-0000000e');
    await makeRun(root, '20250102-080000-b-0000000f');
    const r = await pruneRuns({ olderThanDays: 1, keep: 5, now: NOW }, root);
    expect(r.removed).toHaveLength(0);
    expect(r.kept).toBe(2);
    expect((await pruneRuns({ olderThanDays: 1 }, join(root, 'nope'))).removed).toEqual([]);
  });

  it('refuses a bad day count', async () => {
    await expect(pruneRuns({ olderThanDays: Number.NaN }, root)).rejects.toThrow(/days/);
  });
});
