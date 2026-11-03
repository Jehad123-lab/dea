#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  type BrowserChoice,
  decodeCode,
  decodeDesign,
  type InspectOptions,
  type InspectResult,
  inspectSite,
  investigateInBackground,
  investigationStatus,
  listRuns,
  planInvestigation,
  type RunDoc,
  readRun,
  renderReport,
  resolveRun,
  runInvestigation,
  type StepKind,
  stackSite,
} from '@dea/core';
import { Command, Option } from 'commander';
import { launchers, registerHub } from './hub.ts';
import { registerSession } from './session.ts';

const VERSION = '0.1.0';

interface CommonFlags {
  browser: BrowserChoice;
  headed?: boolean;
  json?: boolean;
  timeout: string;
  home?: string;
  gpuMask: boolean;
  viewport: string;
}

function common(cmd: Command): Command {
  return cmd
    .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
    .option('--headed', 'show the browser window')
    .option('--json', 'print JSON instead of text')
    .option('--timeout <seconds>', 'page load timeout', '45')
    .option('--home <dir>', 'where runs are saved (default ./.dea, or $DEA_HOME)')
    .option('--viewport <WxH>', 'browser window size', '1440x900')
    .option('--no-gpu-mask', 'do not present a GPU name to the page when WebGL runs in software');
}

function options(flags: CommonFlags): InspectOptions {
  if (flags.home) process.env.DEA_HOME = flags.home;
  return {
    browser: flags.browser,
    headless: !flags.headed,
    timeoutMs: Number(flags.timeout) * 1000,
    gpuMask: flags.gpuMask,
    viewport: parseViewport(flags.viewport),
    onProgress: flags.json ? undefined : (s) => process.stderr.write(`  · ${s}\n`),
  };
}

function parseViewport(v: string): { width: number; height: number } {
  const m = /^(\d{3,4})x(\d{3,4})$/i.exec(v.trim());
  if (!m) throw new Error(`--viewport must look like 1440x900, got "${v}"`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function where(r: InspectResult): string {
  const rel = relative(process.cwd(), r.dir);
  return rel.startsWith('..') ? r.dir : rel;
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    process.stderr.write(`dea: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}

const program = new Command('dea')
  .description('DEA decodes any website and proves it: stack, network, page tree and design, every fact labelled Verified, Inferred or Unknown.')
  .version(VERSION);

common(program.command('inspect').description('open a site in a real browser and save the evidence').argument('<url>', 'site to inspect')).action(
  (url: string, flags: CommonFlags) =>
    run(async () => {
      const r = await inspectSite(url, options(flags));
      if (flags.json) return void process.stdout.write(`${JSON.stringify({ runId: r.runId, dir: r.dir, facts: r.run.facts }, null, 2)}\n`);
      process.stdout.write(`\n${r.summary}\n\nEvidence saved in ${where(r)}\nRead it: dea report ${r.runId}\n`);
    }),
);

common(program.command('stack').description('what a site is built with, and the proof').argument('<url>', 'site to check')).action(
  (url: string, flags: CommonFlags) =>
    run(async () => {
      const r = await stackSite(url, options(flags));
      if (flags.json) return void process.stdout.write(`${JSON.stringify({ runId: r.runId, stack: r.run.stack }, null, 2)}\n`);
      const out: string[] = ['', `${r.run.meta.title || r.run.meta.finalUrl}`, ''];
      if (!r.run.stack.length) out.push('Nothing DEA recognises was found.');
      for (const h of r.run.stack) {
        out.push(`${h.label === 'Verified' ? '✔' : '≈'} ${h.name}${h.version ? ` ${h.version}` : ''}  (${h.category}, ${h.label})`);
        for (const e of h.evidence.slice(0, 2)) out.push(`    ${e.source}: ${e.pointer.slice(0, 110)}${e.excerpt ? ` = ${e.excerpt.slice(0, 60)}` : ''}`);
        if (h.why) out.push(`    why: ${h.why}`);
      }
      out.push('', `Evidence saved in ${where(r)}`);
      process.stdout.write(`${out.join('\n')}\n`);
    }),
);

common(
  program
    .command('design')
    .description('decode fonts, colours, type scale, motion, scroll and WebGL shaders')
    .argument('<url>', 'site to decode')
    .option('--steps <n>', 'how many scroll steps to sample', '7'),
).action((url: string, flags: CommonFlags & { steps: string }) =>
  run(async () => {
    const r = await decodeDesign(url, { ...options(flags), scrollSteps: Number(flags.steps) });
    if (flags.json)
      return void process.stdout.write(
        `${JSON.stringify({ runId: r.runId, dir: r.dir, facts: r.run.facts.filter((f) => f.key.startsWith('design.')) }, null, 2)}\n`,
      );
    process.stdout.write(`\n${r.summary}\n\nFull decode: ${where(r)}/design.md  (dea report ${r.runId} --design)\n`);
  }),
);

common(
  program
    .command('code')
    .description(
      'how the code works: scripts, source maps, unpacked bundles, GSAP tweens with call sites, shaders, listeners, APIs, known-vulnerable libraries',
    )
    .argument('<url>', 'site to decode')
    .option('--no-unpack', 'do not unpack bundles that have no source map')
    .option('--no-probe-maps', 'do not try <file>.map when a script names no source map')
    .option('--no-vulns', 'skip the known-vulnerability check (it downloads the retire.js data once a day)')
    .option('--max-unpack <kb>', 'skip unpacking bundles bigger than this', '1500')
    .option('--steps <n>', 'how many wheel steps to scroll while watching', '24'),
).action((url: string, flags: CommonFlags & { unpack: boolean; probeMaps: boolean; vulns: boolean; maxUnpack: string; steps: string }) =>
  run(async () => {
    const r = await decodeCode(url, {
      ...options(flags),
      unpack: flags.unpack,
      probeMaps: flags.probeMaps,
      vulns: flags.vulns,
      maxUnpackBytes: Number(flags.maxUnpack) * 1024,
      scrollSteps: Number(flags.steps),
    });
    if (flags.json) return void process.stdout.write(`${JSON.stringify({ runId: r.runId, dir: r.dir, code: r.code }, null, 2)}\n`);
    process.stdout.write(
      `\n${r.summary}\n\nThe teardown: ${where(r)}/explain.md   (dea report ${r.runId} --explain)\nCode details: ${where(r)}/code.md   API: ${where(r)}/api.md, api/openapi.json\n`,
    );
  }),
);

common(
  program
    .command('explain')
    .description('an expert teardown of how a site works, section by section, with real code excerpts (runs dea code and prints explain.md)')
    .argument('<url>', 'site to explain'),
).action((url: string, flags: CommonFlags) =>
  run(async () => {
    const r = await decodeCode(url, options(flags));
    if (flags.json) return void process.stdout.write(`${JSON.stringify({ runId: r.runId, dir: r.dir, explain: r.explainMd }, null, 2)}\n`);
    process.stdout.write(`${r.explainMd}\n\nSaved: ${where(r)}/explain.md\n`);
  }),
);

common(
  program
    .command('api')
    .description('the API a site talks to, as an OpenAPI 3.1 spec (endpoints, methods, params, example shapes; auth kinds only, never values)')
    .argument('<url>', 'site to watch'),
).action((url: string, flags: CommonFlags) =>
  run(async () => {
    const r = await decodeCode(url, { ...options(flags), unpack: false, vulns: false }, 'api');
    if (flags.json) return void process.stdout.write(`${JSON.stringify(JSON.parse(await readFile(join(r.dir, 'api', 'openapi.json'), 'utf8')), null, 2)}\n`);
    process.stdout.write(`${r.apiMd}\nSpec: ${where(r)}/api/openapi.json\n`);
  }),
);

program
  .command('investigate')
  .description(
    'investigate a site toward a goal: DEA plans the steps (stack, pages, design, code, api), runs them with checkpoints, and writes a proven report where every claim cites evidence',
  )
  .argument('[url]', 'site to investigate')
  .option('-g, --goal <text>', 'what you want to know', 'Give me an overview of how this site is built and designed')
  .option('--background', 'start it and return at once; check with dea status <run>')
  .option('--resume <run>', 'continue an investigation from its checkpoint')
  .option('--max-pages <n>', 'internal pages to read (read-only)', '5')
  .option('--only <steps>', 'run exactly these steps: stack,pages,design,code,api')
  .option('--then <app:tool>', 'after the report, send it through DEA Hub (e.g. notion:notion-create-pages); the client name is dea-brain')
  .option(
    '--then-args <json>',
    'arguments for --then; {{report}}, {{title}}, {{url}} and {{run}} are filled in',
    '{"title":"{{title}}","content":"{{report}}"}',
  )
  .option('--plan-only', 'print the plan and stop')
  .option('--no-llm', 'never use a language model, even if DEA_LLM_* is set')
  .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
  .option('--headed', 'show the browser window')
  .option('--home <dir>', 'where runs are saved')
  .option('--json', 'print the checkpoint as JSON at the end')
  .action(
    (
      url: string | undefined,
      f: {
        goal: string;
        background?: boolean;
        resume?: string;
        maxPages: string;
        only?: string;
        then?: string;
        thenArgs: string;
        planOnly?: boolean;
        llm: boolean;
        browser: BrowserChoice;
        headed?: boolean;
        home?: string;
        json?: boolean;
      },
    ) =>
      run(async () => {
        if (f.home) process.env.DEA_HOME = f.home;
        const deliver = f.then
          ? (() => {
              const [app, ...rest] = f.then.split(':');
              if (!app || !rest.length) throw new Error('--then must look like app:tool');
              return { app, tool: rest.join(':'), args: JSON.parse(f.thenArgs) as Record<string, unknown> };
            })()
          : undefined;
        const o = {
          browser: f.browser,
          headless: !f.headed,
          maxPages: Number(f.maxPages),
          only: f.only ? (f.only.split(',').map((s) => s.trim()) as StepKind[]) : undefined,
          deliver,
          llm: f.llm,
          onProgress: f.json ? undefined : (s: string) => process.stderr.write(`  · ${s}\n`),
        };
        if (f.planOnly) {
          const p = planInvestigation(url ?? '', f.goal, o);
          process.stdout.write(`Plan (${p.by}): ${p.reasons.join('; ')}\n${p.steps.map((s) => `  ${s.id}  ${s.does}`).join('\n')}\n`);
          return;
        }
        if (f.background) {
          if (!url) throw new Error('Give a URL to investigate.');
          const l = launchers();
          const r = await investigateInBackground(url, f.goal, { ...o, launcher: [l.node, l.cli] });
          process.stdout.write(`Started ${r.runId} in the background (process ${r.pid}).\nCheck: dea status ${r.runId}\n`);
          return;
        }
        if (!url && !f.resume) throw new Error('Give a URL, or --resume <run>.');
        const r = await runInvestigation(f.resume ? { resume: f.resume } : { url: url as string, goal: f.goal }, o);
        if (f.json) return void process.stdout.write(`${JSON.stringify(r.checkpoint, null, 2)}\n`);
        process.stdout.write(`\n${r.report}\nSaved: ${join(r.dir, 'report.md')}\n`);
      }),
  );

program
  .command('status')
  .description('where an investigation stands (steps, live or not, the report when done)')
  .argument('[run]', 'run id or a unique part of it', 'latest')
  .option('--home <dir>', 'where runs are saved')
  .action((ref: string, f: { home?: string }) =>
    run(async () => {
      if (f.home) process.env.DEA_HOME = f.home;
      const id = ref === 'latest' ? (await listRuns(undefined, 50)).find((x) => x.kind === 'investigate')?.id : ref;
      if (!id) throw new Error('No investigations yet.');
      const s = await investigationStatus(id);
      const mark = { todo: '·', doing: '▶', done: '✔', failed: '✖', skipped: '–' } as const;
      process.stdout.write(
        `${s.cp.runId}  ${s.cp.status}${s.alive === false ? ` (its process is gone: resume with dea investigate --resume ${s.cp.runId})` : ''}\nGoal: ${s.cp.goal}\n${s.cp.steps
          .map((x) => `  ${mark[x.status]} ${x.id.padEnd(12)} ${x.status.padEnd(7)} ${(x.error ?? x.summary ?? '').slice(0, 110)}`)
          .join('\n')}\n${s.report ? `\n${s.report}` : `\nLatest:\n${s.progress}\n`}`,
      );
    }),
  );

program
  .command('report')
  .description('print the report for a run (default: the latest)')
  .argument('[run]', 'run id, a unique part of it, or "latest"', 'latest')
  .option('--design', 'print design.md instead of report.md')
  .option('--explain', 'print explain.md (from dea code / dea explain)')
  .option('--code', 'print code.md')
  .option('--api', 'print api.md')
  .option('--json', 'print run.json')
  .option('--home <dir>', 'where runs are saved')
  .action((ref: string, flags: { design?: boolean; explain?: boolean; code?: boolean; api?: boolean; json?: boolean; home?: string }) =>
    run(async () => {
      if (flags.home) process.env.DEA_HOME = flags.home;
      const dir = await resolveRun(ref);
      const doc = await readRun<RunDoc>(dir);
      if (flags.json) return void process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
      for (const [flag, name] of [
        [flags.explain, 'explain.md'],
        [flags.code, 'code.md'],
        [flags.api, 'api.md'],
      ] as const) {
        if (!flag) continue;
        const md = await readFile(join(dir, name), 'utf8').catch(() => null);
        if (!md) throw new Error(`This run has no ${name}. Run "dea code <url>".`);
        return void process.stdout.write(md);
      }
      if (!['inspect', 'stack', 'design', 'code', 'api'].includes(doc.meta.kind) && !flags.design) {
        return void process.stdout.write(await readFile(join(dir, 'report.md'), 'utf8').catch(() => 'This run has no report yet (still running?).\n'));
      }
      if (flags.design) {
        const md = await readFile(join(dir, 'design.md'), 'utf8').catch(() => null);
        if (!md) throw new Error('This run has no design decode. Run "dea design <url>".');
        return void process.stdout.write(md);
      }
      process.stdout.write(renderReport(doc));
    }),
  );

program
  .command('runs')
  .description('list saved runs, newest first')
  .option('--home <dir>', 'where runs are saved')
  .option('--json', 'print JSON')
  .action((flags: { home?: string; json?: boolean }) =>
    run(async () => {
      if (flags.home) process.env.DEA_HOME = flags.home;
      const runs = await listRuns();
      if (flags.json) return void process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
      if (!runs.length) return void process.stdout.write('No runs yet. Try: dea inspect https://threejs.org/examples/webgl_animation_keyframes.html\n');
      for (const r of runs) process.stdout.write(`${r.id}  ${r.kind.padEnd(7)}  ${r.title || r.url}\n`);
    }),
  );

registerSession(program, run);
registerHub(program, run);

await program.parseAsync();
