import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserChoice } from '../browser/open.ts';
import { normalizeUrl } from '../browser/open.ts';
import { decodeCode } from '../code/decode.ts';
import { decodeDesign } from '../design/index.ts';
import { deaHome, newRunId, RunWriter, readRun, resolveRun, runsDir } from '../evidence/run.ts';
import { redactText } from '../evidence/secrets.ts';
import { HandsSession } from '../hands/session.ts';
import { Hub } from '../hub/hub.ts';
import { loadPolicy } from '../safety/policy.ts';
import { stackSite } from '../see/inspect.ts';
import type { EventSink, Fact } from '../types.ts';
import { brainFromEnv, refinePlan, writeAnswer } from './llm.ts';
import { goalTerms, type PlanOptions, planInvestigation } from './planner.ts';
import type { Checkpoint, Claim, EvidenceRef, PlanStep, RunFacts, StepState } from './types.ts';

export interface InvestigateOptions extends PlanOptions {
  browser?: BrowserChoice;
  headless?: boolean;
  runsRoot?: string;
  onProgress?: (s: string) => void;
  onEvent?: EventSink;
  /** use the optional language model when DEA_LLM_* is configured (default true; nothing happens without config) */
  llm?: boolean;
  /** stop after this many steps (tests, and "plan only" with 0) */
  maxSteps?: number;
}

export interface InvestigateResult {
  runId: string;
  dir: string;
  checkpoint: Checkpoint;
  report: string;
}

const now = () => new Date().toISOString();

async function saveCheckpoint(dir: string, cp: Checkpoint): Promise<void> {
  cp.updatedAt = now();
  await writeFile(join(dir, 'checkpoint.json'), `${redactText(JSON.stringify(cp, null, 2))}\n`);
}

export async function readCheckpoint(ref: string, root = runsDir()): Promise<{ dir: string; cp: Checkpoint }> {
  const dir = await resolveRun(ref, root);
  const cp = JSON.parse(await readFile(join(dir, 'checkpoint.json'), 'utf8')) as Checkpoint;
  return { dir, cp };
}

/** Create the run folder, the plan and the first checkpoint. Nothing is opened yet. */
export async function prepareInvestigation(url: string, goal: string, o: InvestigateOptions = {}): Promise<{ dir: string; cp: Checkpoint; writer: RunWriter }> {
  const target = normalizeUrl(url);
  let plan = planInvestigation(target, goal, o);
  const brain = o.llm === false ? null : brainFromEnv();
  if (brain) plan = await refinePlan(brain, plan).catch(() => plan);
  const writer = await new RunWriter(newRunId(target), o.runsRoot ?? runsDir(), o.onEvent).init();
  const cp: Checkpoint = {
    schema: 'dea.checkpoint/1',
    runId: writer.id,
    goal,
    url: target,
    plan,
    steps: plan.steps.map((s) => ({ id: s.id, kind: s.kind, status: 'todo' })),
    status: 'running',
    createdAt: now(),
    updatedAt: now(),
    options: { browser: o.browser, maxPages: o.maxPages, llm: Boolean(brain) },
  };
  await saveCheckpoint(writer.dir, cp);
  // a provisional run.json so the run is listed (and resumable) from its first second
  await writeFile(
    join(writer.dir, 'run.json'),
    `${JSON.stringify({ meta: { schema: 'dea.run/1', id: writer.id, kind: 'investigate', url: target, finalUrl: target, title: goal, status: null, startedAt: cp.createdAt, finishedAt: '', files: { checkpoint: 'checkpoint.json' }, warnings: [] }, facts: [] }, null, 2)}\n`,
  );
  await writer.progress(`plan (${plan.by}): ${plan.steps.map((s) => s.kind).join(' → ')}`);
  return { dir: writer.dir, cp, writer };
}

/** Start a run and return at once; the work continues in a detached process that survives the caller. */
export async function investigateInBackground(
  url: string,
  goal: string,
  o: InvestigateOptions & { launcher: string[] },
): Promise<{ runId: string; dir: string; pid: number }> {
  const { dir, cp } = await prepareInvestigation(url, goal, o);
  const child = spawn(o.launcher[0], [...o.launcher.slice(1), 'investigate', '--resume', cp.runId, ...(o.browser ? ['--browser', o.browser] : [])], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DEA_HOME: process.env.DEA_HOME ?? deaHome() },
    windowsHide: true,
  });
  child.unref();
  cp.pid = child.pid;
  await saveCheckpoint(dir, cp);
  return { runId: cp.runId, dir, pid: child.pid ?? 0 };
}

/** Run (or resume) an investigation to the end: every step checkpointed, then the proven report. */
export async function runInvestigation(ref: { url: string; goal: string } | { resume: string }, o: InvestigateOptions = {}): Promise<InvestigateResult> {
  let dir: string;
  let cp: Checkpoint;
  let writer: RunWriter;
  if ('resume' in ref) {
    ({ dir, cp } = await readCheckpoint(ref.resume, o.runsRoot ?? runsDir()));
    writer = new RunWriter(cp.runId, join(dir, '..'), o.onEvent);
    cp.status = 'running';
    cp.pid = process.pid;
    await writer.progress(`resuming at ${cp.steps.find((s) => s.status !== 'done' && s.status !== 'skipped')?.id ?? 'the report'}`);
  } else {
    ({ dir, cp, writer } = await prepareInvestigation(ref.url, ref.goal, o));
    cp.pid = process.pid;
  }
  const say = async (s: string) => {
    o.onProgress?.(s);
    await writer.progress(s);
  };
  const childOpts = { browser: o.browser ?? (cp.options.browser as BrowserChoice | undefined), headless: o.headless ?? true, runsRoot: join(dir, '..') };
  let ran = 0;
  for (const st of cp.steps) {
    if (st.status === 'done' || st.status === 'skipped') continue;
    if (o.maxSteps !== undefined && ran >= o.maxSteps) {
      cp.status = 'stopped';
      await saveCheckpoint(dir, cp);
      return { runId: cp.runId, dir, checkpoint: cp, report: '' };
    }
    const step = cp.plan.steps.find((s) => s.id === st.id) as PlanStep;
    st.status = 'doing';
    st.startedAt = now();
    delete st.error;
    await saveCheckpoint(dir, cp);
    await say(`${st.id}: ${step.does}`);
    try {
      await runStep(step, st, cp, dir, childOpts, say);
      st.status = 'done';
    } catch (e) {
      st.status = 'failed';
      st.error = (e as Error).message.split('\n')[0].slice(0, 300);
      await say(`${st.id} failed: ${st.error}`);
    }
    st.finishedAt = now();
    ran++;
    await saveCheckpoint(dir, cp);
  }
  await say('writing the proven report');
  const report = await writeReport(cp, dir, o);
  cp.status = cp.steps.every((s) => s.status === 'failed') ? 'failed' : 'done';
  delete cp.pid;
  await saveCheckpoint(dir, cp);
  writer.emit({ type: 'run.finished', runId: cp.runId, dir, summary: `investigation ${cp.status}`, at: now() });
  return { runId: cp.runId, dir, checkpoint: cp, report };
}

async function runStep(
  step: PlanStep,
  st: StepState,
  cp: Checkpoint,
  dir: string,
  childOpts: { browser?: BrowserChoice; headless: boolean; runsRoot: string },
  say: (s: string) => Promise<void>,
): Promise<void> {
  const url = cp.url;
  switch (step.kind) {
    case 'stack': {
      const r = await stackSite(url, childOpts);
      st.childRun = r.runId;
      st.summary = r.run.stack.map((h) => `${h.name}${h.version ? ` ${h.version}` : ''}`).join(', ') || 'nothing recognised';
      return;
    }
    case 'design': {
      const r = await decodeDesign(url, childOpts);
      st.childRun = r.runId;
      st.summary = r.summary.split('\n').slice(0, 6).join(' · ');
      return;
    }
    case 'code':
    case 'api': {
      const r = await decodeCode(url, step.kind === 'api' ? { ...childOpts, unpack: false, vulns: false } : childOpts, step.kind);
      st.childRun = r.runId;
      st.summary = r.summary.split('\n').slice(0, 10).join(' · ');
      return;
    }
    case 'pages': {
      const max = Number(step.with?.max ?? 5);
      const host = new URL(url).hostname;
      const base = loadPolicy(deaHome());
      if (base.allowedDomains.length && !base.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`)))
        throw new Error(`${host} is not in your policy's allowedDomains, so DEA did not visit it`);
      // read-only hands: restricted mode, this site only; looking and scrolling are the only actions
      const policy = { ...base, mode: 'restricted' as const, allowedDomains: [host], source: `${base.source} + investigation (restricted, ${host} only)` };
      const hands = await HandsSession.start({ ...childOpts, policy, shots: false }, url);
      st.childRun = hands.writer.id;
      const pages: Array<Record<string, unknown>> = [];
      try {
        const first = await hands.goto(url);
        if (!first.ok) throw new Error(first.error ?? first.reason ?? 'could not open the page');
        const o1 = await hands.outline();
        const home = (o1.data ?? {}) as { links?: Array<{ url: string; label: string }> } & Record<string, unknown>;
        pages.push({ url: hands.page.url(), ...home, links: undefined, linkCount: home.links?.length ?? 0 });
        const terms = goalTerms(cp.goal);
        const ranked = (home.links ?? [])
          .map((l) => ({ ...l, score: terms.filter((t) => `${l.url} ${l.label}`.toLowerCase().includes(t)).length * 10 - l.url.split('/').length }))
          .sort((a, b) => b.score - a.score);
        for (const l of ranked.slice(0, max - 1)) {
          await say(`reading ${l.url}`);
          const g = await hands.goto(l.url);
          if (!g.ok) {
            pages.push({ url: l.url, error: g.error ?? g.reason });
            continue;
          }
          await hands.scroll({ by: 1800 }).catch(() => null);
          const o2 = await hands.outline();
          const d = (o2.data ?? {}) as Record<string, unknown>;
          pages.push({ url: hands.page.url(), ...d, links: undefined, linkCount: Array.isArray(d.links) ? d.links.length : 0 });
        }
      } finally {
        await hands.close();
      }
      st.data = pages;
      st.summary = `${pages.length} page(s) read: ${pages
        .map((p) => String(p.title ?? p.url))
        .join(' | ')
        .slice(0, 300)}`;
      return;
    }
    case 'hub': {
      const app = String(step.with?.app);
      const tool = String(step.with?.tool);
      // the report is written first, so a resumed run sends the same text
      const report = await writeReport(cp, dir, {});
      const fill = (v: unknown): unknown =>
        typeof v === 'string'
          ? v
              .replaceAll('{{report}}', report)
              .replaceAll('{{title}}', `DEA: ${cp.goal}`.slice(0, 120))
              .replaceAll('{{url}}', cp.url)
              .replaceAll('{{run}}', cp.runId)
          : Array.isArray(v)
            ? v.map(fill)
            : v && typeof v === 'object'
              ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
              : v;
      const hub = new Hub();
      try {
        const r = await hub.call('dea-brain', app, tool, fill(step.with?.args ?? {}) as Record<string, unknown>);
        const text = (r.content ?? []).map((c) => (c as { text?: string }).text ?? `[${c.type}]`).join('\n');
        if (r.isError) throw new Error(text.slice(0, 300));
        st.summary = `sent to ${app}.${tool}: ${text.slice(0, 200)}`;
        st.data = { app, tool, answer: text.slice(0, 2000) };
      } finally {
        await hub.close();
      }
      return;
    }
  }
}

// ---------------------------------------------------------------- the proven report

const MARK = { Verified: '✔', Inferred: '≈', Unknown: '?' } as const;

async function childFacts(cp: Checkpoint, dir: string): Promise<RunFacts[]> {
  const out: RunFacts[] = [];
  for (const st of cp.steps) {
    if (!st.childRun || st.kind === 'pages' || st.kind === 'hub') continue;
    try {
      const doc = await readRun<{ facts: Fact[] }>(join(dir, '..', st.childRun));
      out.push({ run: st.childRun, kind: st.kind, facts: doc.facts ?? [] });
    } catch {
      /* a child run that never finished: its step says so */
    }
  }
  return out;
}

const FILE_OF: Record<string, string> = { stack: 'run.json', design: 'design.md', code: 'explain.md', api: 'api.md' };

/** Build claims (each citing evidence), optionally a model-written answer checked against them, and report.md. */
export async function writeReport(cp: Checkpoint, dir: string, o: InvestigateOptions): Promise<string> {
  const runs = await childFacts(cp, dir);
  const terms = goalTerms(cp.goal);
  const evidence: EvidenceRef[] = [];
  const claims: Claim[] = [];
  const cite = (run: string, file: string, pointer: string, excerpt?: string) => {
    const hit = evidence.find((e) => e.run === run && e.pointer === pointer);
    if (hit) return hit.id;
    const id = `E${evidence.length + 1}`;
    evidence.push({ id, run, file, pointer, ...(excerpt ? { excerpt: excerpt.slice(0, 120) } : {}) });
    return id;
  };
  const seen = new Set<string>();
  for (const r of runs) {
    for (const f of r.facts) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      const relevant =
        terms.some((t) => `${f.key} ${f.claim}`.toLowerCase().includes(t)) || /^(stack|page\.title|design\.(font|color|motion)|code\.)/.test(f.key);
      if (!relevant) continue;
      const ids = (f.evidence.length ? f.evidence.slice(0, 2) : [{ source: 'dom' as const, pointer: f.key, excerpt: undefined as string | undefined }]).map(
        (e) => cite(r.run, FILE_OF[r.kind] ?? 'run.json', `${e.source}: ${e.pointer}`, e.excerpt),
      );
      claims.push({ id: `C${claims.length + 1}`, text: f.claim, label: f.label, cites: ids, from: r.kind, ...(f.why ? { why: f.why } : {}) });
    }
  }
  const pagesStep = cp.steps.find((s) => s.kind === 'pages' && s.status === 'done');
  const pages = (pagesStep?.data ?? []) as Array<{
    url: string;
    title?: string;
    headings?: string[];
    description?: string;
    words?: number;
    forms?: number;
    canvases?: number;
    error?: string;
  }>;
  for (const p of pages) {
    if (p.error) continue;
    const id = cite(pagesStep?.childRun ?? cp.runId, 'actions.jsonl', `outline of ${p.url}`, p.headings?.[0]);
    claims.push({
      id: `C${claims.length + 1}`,
      text: `${p.url} — "${p.title ?? ''}": ${p.headings?.slice(0, 3).join('; ') || 'no headings'}${p.forms ? `; ${p.forms} form(s)` : ''}${p.canvases ? `; ${p.canvases} canvas` : ''} (${p.words ?? 0} words).`,
      label: 'Verified',
      cites: [id],
      from: 'pages',
    });
  }
  for (const st of cp.steps.filter((s) => s.status === 'failed'))
    claims.push({
      id: `C${claims.length + 1}`,
      text: `The ${st.kind} step could not finish, so its part of the goal is not answered.`,
      label: 'Unknown',
      cites: [],
      from: st.kind,
      why: st.error,
    });

  // the order a reader wants: what was proven, then what is likely, then what is open
  const order = { Verified: 0, Inferred: 1, Unknown: 2 } as const;
  claims.sort((a, b) => order[a.label] - order[b.label]);

  let written = '';
  const brain = o.llm === false || !cp.options.llm ? null : brainFromEnv();
  if (brain && claims.length) {
    try {
      const a = await writeAnswer(brain, cp.goal, claims.slice(0, 60), new Set(evidence.map((e) => e.id)));
      if (a.text)
        written = `${a.text}${a.dropped ? `\n\n_${a.dropped} sentence(s) from the language model were removed because they cited no DEA evidence._` : ''}`;
    } catch (e) {
      written = `_The language model could not answer (${(e as Error).message}); the claims below are DEA's own._`;
    }
  }

  const L: string[] = [];
  L.push(
    `# Investigation: ${cp.goal}`,
    '',
    `${cp.url} · run ${cp.runId} · ${cp.status === 'running' ? 'finished' : cp.status} ${now().slice(0, 16).replace('T', ' ')} UTC`,
    '',
  );
  L.push(
    `Every line below cites evidence [E#] from DEA's own runs (see the index at the end). ✔ Verified = seen directly · ≈ Inferred = strong signal · ? Unknown = could not tell.`,
    '',
  );
  if (written) L.push('## Answer (written by the language model from the claims below; uncited sentences removed)', '', written, '');
  L.push('## What DEA found', '');
  if (!claims.length) L.push('? Nothing relevant was found. Check the steps below.');
  for (const c of claims.slice(0, 120))
    L.push(
      `- ${MARK[c.label]} ${c.text}${c.cites.length ? ` ${c.cites.map((x) => `[${x}]`).join('')}` : ''}${c.why && c.label !== 'Verified' ? ` — ${c.why}` : ''}`,
    );
  if (claims.length > 120) L.push(`- … ${claims.length - 120} more in claims.json`);
  L.push(
    '',
    '## How DEA worked it out',
    '',
    `Plan by ${cp.plan.by === 'llm' ? 'the language model (checked against DEA’s steps)' : 'DEA’s rules (no language model)'}: ${cp.plan.reasons.join('; ')}.`,
    '',
  );
  L.push('| step | what | status | run | result |', '|---|---|---|---|---|');
  for (const st of cp.steps) {
    const step = cp.plan.steps.find((s) => s.id === st.id);
    L.push(
      `| ${st.id} | ${step?.does ?? st.kind} | ${st.status} | ${st.childRun ?? '–'} | ${(st.error ?? st.summary ?? '').replace(/\|/g, '/').slice(0, 160)} |`,
    );
  }
  const deep = cp.steps.filter((s) => s.childRun && (s.kind === 'code' || s.kind === 'design'));
  if (deep.length) {
    L.push('', 'Go deeper:');
    for (const s of deep)
      L.push(`- ${s.kind === 'code' ? 'Code teardown' : 'Design decode'}: \`dea report ${s.childRun} ${s.kind === 'code' ? '--explain' : '--design'}\``);
  }
  L.push('', '## Evidence index', '', '| id | run | file | what | excerpt |', '|---|---|---|---|---|');
  for (const e of evidence)
    L.push(
      `| ${e.id} | ${e.run} | ${e.file} | ${e.pointer.replace(/\|/g, '/').slice(0, 100)} | ${(e.excerpt ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`,
    );
  const md = `${L.join('\n')}\n`;
  await writeFile(join(dir, 'report.md'), redactText(md));
  await writeFile(join(dir, 'claims.json'), `${redactText(JSON.stringify({ goal: cp.goal, claims, evidence }, null, 2))}\n`);
  await writeFile(
    join(dir, 'run.json'),
    `${JSON.stringify(
      {
        meta: {
          schema: 'dea.run/1',
          id: cp.runId,
          kind: 'investigate',
          url: cp.url,
          finalUrl: cp.url,
          title: cp.goal,
          status: null,
          startedAt: cp.createdAt,
          finishedAt: now(),
          files: { report: 'report.md', checkpoint: 'checkpoint.json', claims: 'claims.json' },
          warnings: [],
        },
        facts: claims.map((c) => ({ key: c.id, claim: c.text, value: null, label: c.label, evidence: c.cites.map((id) => ({ source: 'dom', pointer: id })) })),
      },
      null,
      2,
    )}\n`,
  );
  return md;
}

/** Status for CLIs and MCP: steps, whether a background process is still alive, and the report once done. */
export async function investigationStatus(
  ref: string,
  root = runsDir(),
): Promise<{ cp: Checkpoint; alive: boolean | null; report: string | null; progress: string }> {
  const { dir, cp } = await readCheckpoint(ref, root);
  let alive: boolean | null = null;
  if (cp.pid && cp.status === 'running') {
    try {
      process.kill(cp.pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
  }
  const report = cp.status === 'done' || cp.status === 'failed' ? await readFile(join(dir, 'report.md'), 'utf8').catch(() => null) : null;
  const progress = (await readFile(join(dir, 'progress.md'), 'utf8').catch(() => '')).split('\n').slice(-8).join('\n');
  return { cp, alive, report, progress };
}
