import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listRuns, resolveRun, runsDir, withRunsRoot } from '../src/evidence/run.ts';

const root = await mkdtemp(join(tmpdir(), 'dea-runsroot-'));
afterAll(() => rm(root, { recursive: true, force: true }));

const run = async (dir: string, id: string) => {
  await mkdir(join(dir, id), { recursive: true });
  await writeFile(
    join(dir, id, 'run.json'),
    JSON.stringify({ meta: { id, kind: 'inspect', url: `https://${id}.example/`, title: id, startedAt: '2026-11-24T00:00:00Z' } }),
  );
};

describe('withRunsRoot: one runs folder per caller (dea serve --http clients)', () => {
  it('runsDir, listRuns and "latest" follow the folder inside the call, and only there', async () => {
    const a = join(root, 'a');
    const b = join(root, 'b');
    await run(a, '20261124-000001-alpha-aaaaaaaa');
    await run(b, '20261124-000002-beta-bbbbbbbb');
    const outside = runsDir();
    await withRunsRoot(a, async () => {
      expect(runsDir()).toBe(resolve(a));
      expect((await listRuns()).map((r) => r.id)).toEqual(['20261124-000001-alpha-aaaaaaaa']);
      expect(await resolveRun('latest')).toBe(join(resolve(a), '20261124-000001-alpha-aaaaaaaa'));
      await expect(resolveRun('20261124-000002-beta-bbbbbbbb')).rejects.toThrow(/No run/);
    });
    expect(runsDir()).toBe(outside);
  });

  it('two calls at the same time keep their own folders', async () => {
    const seen = await Promise.all(
      ['a', 'b'].map((n) =>
        withRunsRoot(join(root, n), async () => {
          await new Promise((r) => setTimeout(r, n === 'a' ? 20 : 0));
          return runsDir();
        }),
      ),
    );
    expect(seen).toEqual([resolve(join(root, 'a')), resolve(join(root, 'b'))]);
  });

  it('DEA_RUNS_DIR (a background child) comes before DEA_HOME/runs', () => {
    const before = process.env.DEA_RUNS_DIR;
    process.env.DEA_RUNS_DIR = join(root, 'child');
    try {
      expect(runsDir()).toBe(resolve(join(root, 'child')));
      expect(withRunsRoot(join(root, 'a'), () => runsDir())).toBe(resolve(join(root, 'a')));
    } finally {
      if (before === undefined) delete process.env.DEA_RUNS_DIR;
      else process.env.DEA_RUNS_DIR = before;
    }
  });
});
