import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openGaps } from '../src/brain/investigate.ts';
import { followUpStep } from '../src/brain/planner.ts';
import type { Checkpoint } from '../src/brain/types.ts';
import type { Gap } from '../src/index.ts';

const root = await mkdtemp(join(tmpdir(), 'dea-gaps-'));
afterAll(() => rm(root, { recursive: true, force: true }));

const gap: Gap = {
  area: 'api',
  topic: 'Which code calls POST api.site.dev/v1/search',
  known: ['Verified: the page sent POST api.site.dev/v1/search (HTTP 200)'],
  missing: 'the line of code that sends it',
  approximation: { text: 'a fetch call', code: "await fetch('https://api.site.dev/v1/search', { method: 'POST' })", lang: 'js' },
  next: [{ why: 'unpack the bundles', command: 'dea code https://site.dev', probe: 'code' }],
};

const cp = (steps: Checkpoint['steps']): Checkpoint => ({
  schema: 'dea.checkpoint/1',
  runId: 'inv',
  goal: 'which API feeds the search',
  url: 'https://site.dev',
  plan: { goal: '', url: '', by: 'rules', reasons: [], steps: [] },
  steps,
  status: 'running',
  createdAt: '',
  updatedAt: '',
  options: {},
});

describe('gaps: the Brain follows them and a deeper run closes them', () => {
  it('reads the gaps a decoder left, and drops them once a later step covering the same area ran', async () => {
    const dir = join(root, 'inv');
    for (const r of ['inv', 'api-run', 'code-run']) await mkdir(join(root, r), { recursive: true });
    await writeFile(join(root, 'api-run', 'gaps.json'), JSON.stringify([gap]));
    await writeFile(join(root, 'code-run', 'gaps.json'), '[]');

    const afterApi = cp([{ id: 's1-api', kind: 'api', status: 'done', childRun: 'api-run' }]);
    const open = await openGaps(afterApi, dir);
    expect(open.map((g) => g.topic)).toEqual([gap.topic]);
    // the probe it names is what the Brain adds as a follow-up step
    const step = followUpStep(
      'code',
      2,
      open.map((g) => g.topic),
    );
    expect(step).toMatchObject({ id: 's2-code', kind: 'code' });
    expect(step.does).toMatch(/Follow-up added by DEA; closes: Which code calls POST/);

    // dea code also maps the API: its (empty) gaps supersede the api step's
    const afterCode = cp([...afterApi.steps, { id: 's2-code', kind: 'code', status: 'done', childRun: 'code-run' }]);
    expect(await openGaps(afterCode, dir)).toEqual([]);
  });
});
