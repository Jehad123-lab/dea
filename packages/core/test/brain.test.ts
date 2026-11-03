import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Checkpoint, checkCitations, goalTerms, planInvestigation, writeReport } from '../src/index.ts';

describe('brain: planner', () => {
  it('reads the goal for the questions it asks', () => {
    const p = planInvestigation('https://x.dev', 'Which fonts and easing does it use, and what API feeds the projects?');
    expect(p.by).toBe('rules');
    expect(p.steps.map((s) => s.kind)).toEqual(['stack', 'design', 'api']);
    expect(p.reasons.join(' ')).toMatch(/fonts/);
  });

  it('gives a vague goal the full survey and ignores the site’s own name', () => {
    expect(planInvestigation('https://x.dev', 'tell me everything').steps.map((s) => s.kind)).toEqual(['stack', 'pages', 'design', 'code']);
    // "gsap.com" in the goal is the site, not a question about GSAP code
    expect(planInvestigation('https://gsap.com', 'what fonts does gsap.com use').steps.map((s) => s.kind)).toEqual(['stack', 'design']);
  });

  it('adds a hub delivery step last and honours --only', () => {
    const p = planInvestigation('https://x.dev', 'how does the scroll animation work', { deliver: { app: 'notion', tool: 'create', args: {} } });
    expect(p.steps.at(-1)?.kind).toBe('hub');
    expect(planInvestigation('https://x.dev', 'anything', { only: ['api'] }).steps.map((s) => s.kind)).toEqual(['stack', 'api']);
  });

  it('keeps meaningful goal words only', () => {
    expect(goalTerms('What does the pricing page of this site use?')).toEqual(['pricing']);
  });
});

describe('brain: proven answers', () => {
  it('drops model sentences that cite nothing or cite evidence DEA never gave', () => {
    const ids = new Set(['E1', 'E2']);
    const r = checkCitations('The site uses GSAP 3.15 [E1]. It is hosted on Vercel [E2][E1]. It was made in 2019. Fonts are Inter [E9].', ids);
    expect(r.text).toBe('The site uses GSAP 3.15 [E1]. It is hosted on Vercel [E2][E1].');
    expect(r.dropped).toBe(2);
  });

  let root = '';
  afterAll(async () => root && rm(root, { recursive: true, force: true }));

  it('writes a report where every claim cites evidence from the child runs', async () => {
    root = await mkdtemp(join(tmpdir(), 'dea-brain-'));
    const child = '20261103-100000-x-dev-aaaaaaaa';
    await mkdir(join(root, child), { recursive: true });
    await writeFile(
      join(root, child, 'run.json'),
      JSON.stringify({
        meta: { kind: 'stack' },
        facts: [
          {
            key: 'stack.gsap',
            claim: 'GSAP 3.15.0 (animation)',
            value: null,
            label: 'Verified',
            evidence: [{ source: 'global', pointer: 'window.gsap.version', excerpt: '3.15.0' }],
          },
          {
            key: 'stack.react',
            claim: 'React (framework)',
            value: null,
            label: 'Inferred',
            evidence: [{ source: 'script-url', pointer: 'react-abc.js' }],
            why: 'file name only',
          },
          { key: 'misc.unrelated', claim: 'Something unrelated', value: null, label: 'Verified', evidence: [] },
        ],
      }),
    );
    const dir = join(root, '20261103-100100-x-dev-bbbbbbbb');
    await mkdir(dir, { recursive: true });
    const cp: Checkpoint = {
      schema: 'dea.checkpoint/1',
      runId: '20261103-100100-x-dev-bbbbbbbb',
      goal: 'what animation library does it use',
      url: 'https://x.dev/',
      plan: {
        goal: 'g',
        url: 'https://x.dev/',
        by: 'rules',
        reasons: ['"animation" → how it looks'],
        steps: [
          { id: 's1-stack', kind: 'stack', does: 'Detect the stack.' },
          { id: 's2-pages', kind: 'pages', does: 'Read pages.' },
          { id: 's3-code', kind: 'code', does: 'Decode the code.' },
        ],
      },
      steps: [
        { id: 's1-stack', kind: 'stack', status: 'done', childRun: child, summary: 'GSAP' },
        {
          id: 's2-pages',
          kind: 'pages',
          status: 'done',
          childRun: 'hands-run',
          data: [{ url: 'https://x.dev/', title: 'Home', headings: ['h1: Hello'], words: 120 }],
        },
        { id: 's3-code', kind: 'code', status: 'failed', error: 'browser crashed' },
      ],
      status: 'running',
      createdAt: '2026-11-03T10:01:00Z',
      updatedAt: '2026-11-03T10:01:00Z',
      options: {},
    };
    const md = await writeReport(cp, dir, { llm: false });
    expect(md).toContain('✔ GSAP 3.15.0 (animation) [E1]');
    expect(md).toMatch(/≈ React \(framework\) \[E2\] — file name only/);
    expect(md).not.toContain('Something unrelated');
    expect(md).toContain('https://x.dev/ — "Home": h1: Hello');
    expect(md).toMatch(/\? The code step could not finish.*browser crashed/);
    expect(md).toContain('| E1 | 20261103-100000-x-dev-aaaaaaaa | run.json | global: window.gsap.version | 3.15.0 |');
    const claims = JSON.parse(await readFile(join(dir, 'claims.json'), 'utf8'));
    for (const c of claims.claims) if (c.label !== 'Unknown') expect(c.cites.length).toBeGreaterThan(0);
  });
});

describe('brain: optional language model (OpenAI-compatible, off by default)', () => {
  it('is off unless configured, and its plan and answer are checked against DEA’s own steps and evidence', async () => {
    const {
      brainFromEnv,
      refinePlan,
      planInvestigation: plan,
    } = await import('../src/index.ts').then(async (m) => ({ ...m, refinePlan: (await import('../src/brain/llm.ts')).refinePlan }));
    expect(brainFromEnv({})).toBeNull();
    const { createServer } = await import('node:http');
    const seen: any[] = [];
    const srv = createServer(async (req, res) => {
      let b = '';
      for await (const c of req) b += c;
      const body = JSON.parse(b);
      seen.push({ auth: req.headers.authorization, body });
      const content = body.response_format ? JSON.stringify({ steps: ['design', 'hack-the-planet', 'api'] }) : 'Fonts are Mori [E1]. Made in 2019 by aliens.';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as any).port;
    try {
      const brain = brainFromEnv({ DEA_LLM_BASE_URL: `http://127.0.0.1:${port}/v1/`, DEA_LLM_MODEL: 'local-model', DEA_LLM_API_KEY: 'k-123' });
      expect(brain?.model).toBe('local-model');
      const p = await refinePlan(brain as any, plan('https://x.dev', 'tell me everything'));
      expect(p.by).toBe('llm');
      expect(p.steps.map((s) => s.kind)).toEqual(['stack', 'design', 'api']); // unknown step names are ignored, stack kept
      expect(seen[0].auth).toBe('Bearer k-123');
      const { writeAnswer } = await import('../src/brain/llm.ts');
      const a = await writeAnswer(
        brain as any,
        'fonts?',
        [{ id: 'C1', text: 'Fonts: Mori', label: 'Verified', cites: ['E1'], from: 'design' }],
        new Set(['E1']),
      );
      expect(a.text).toBe('Fonts are Mori [E1].');
      expect(a.dropped).toBe(1);
    } finally {
      srv.close();
    }
  });
});
