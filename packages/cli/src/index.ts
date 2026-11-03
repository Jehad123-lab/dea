#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  type BrowserChoice,
  type InspectOptions,
  type InspectResult,
  inspectSite,
  listRuns,
  readRun,
  renderReport,
  resolveRun,
  type RunDoc,
  stackSite,
} from '@dea/core';
import { Command, Option } from 'commander';

const VERSION = '0.1.0';

interface CommonFlags {
  browser: BrowserChoice;
  headed?: boolean;
  json?: boolean;
  timeout: string;
  home?: string;
  gpuMask: boolean;
}

function common(cmd: Command): Command {
  return cmd
    .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
    .option('--headed', 'show the browser window')
    .option('--json', 'print JSON instead of text')
    .option('--timeout <seconds>', 'page load timeout', '45')
    .option('--home <dir>', 'where runs are saved (default ./.dea, or $DEA_HOME)')
    .option('--no-gpu-mask', 'do not present a GPU name to the page when WebGL runs in software');
}

function options(flags: CommonFlags): InspectOptions {
  if (flags.home) process.env.DEA_HOME = flags.home;
  return {
    browser: flags.browser,
    headless: !flags.headed,
    timeoutMs: Number(flags.timeout) * 1000,
    gpuMask: flags.gpuMask,
    onProgress: flags.json ? undefined : (s) => process.stderr.write(`  · ${s}\n`),
  };
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

program
  .command('report')
  .description('print the report for a run (default: the latest)')
  .argument('[run]', 'run id, a unique part of it, or "latest"', 'latest')
  .option('--design', 'print design.md instead of report.md')
  .option('--json', 'print run.json')
  .option('--home <dir>', 'where runs are saved')
  .action((ref: string, flags: { design?: boolean; json?: boolean; home?: string }) =>
    run(async () => {
      if (flags.home) process.env.DEA_HOME = flags.home;
      const dir = await resolveRun(ref);
      const doc = await readRun<RunDoc>(dir);
      if (flags.json) return void process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
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

await program.parseAsync();
