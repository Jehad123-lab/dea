import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isRunId, listRuns, newRunId, RunWriter, resolveRun } from '../src/evidence/run.ts';

const root = await mkdtemp(join(tmpdir(), 'dea-runs-'));
afterAll(() => rm(root, { recursive: true, force: true }));

describe('run folders', () => {
  it('makes sortable, hard-to-guess ids', () => {
    const id = newRunId('https://www.threejs.org/examples', new Date('2026-11-03T08:30:12Z'));
    expect(id).toMatch(/^20261103-083012-threejs-org-[0-9a-f]{8}$/);
    expect(isRunId(id)).toBe(true);
    expect(isRunId('../../etc')).toBe(false);
  });

  it('writes, lists and resolves runs, and strips secrets on the way out', async () => {
    const w = await new RunWriter(newRunId('https://a.com'), root).init();
    await w.json('run.json', { meta: { kind: 'inspect', url: 'https://a.com', title: 'A', startedAt: 'now' }, note: 'Bearer abcdefghijklmnopqrstu' });
    const saved = await readFile(join(w.dir, 'run.json'), 'utf8');
    expect(saved).not.toContain('abcdefghijklmnopqrstu');
    const runs = await listRuns(root);
    expect(runs[0].id).toBe(w.id);
    expect(await resolveRun('latest', root)).toBe(w.dir);
    expect(await resolveRun(w.id.slice(-8), root)).toBe(w.dir);
    await expect(resolveRun('../secret', root)).rejects.toThrow(/Not a run id/);
  });
});
