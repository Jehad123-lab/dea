#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  type BrowserChoice,
  decodeAssets,
  decodeCode,
  decodeDesign,
  decodeMotion,
  extract,
  type InspectOptions,
  type InspectResult,
  inspectSite,
  investigateInBackground,
  investigationStatus,
  libraryAdd,
  libraryHome,
  libraryList,
  libraryRemove,
  librarySearch,
  libraryUse,
  listRuns,
  planInvestigation,
  type RunDoc,
  readRun,
  renderReport,
  resolveRun,
  runInvestigation,
  type StepKind,
  stackSite,
  traceWebGL,
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

common(
  program
    .command('extract')
    .description(
      'decode a site and write what you can USE: design tokens (CSS, Tailwind, W3C), motion as GSAP and CSS, shaders as three.js modules with a scene for React, vanilla or Framer; then a visual diff with research-and-retry',
    )
    .argument('[url]', 'site to extract')
    .option('--to <target>', 'react, vanilla or framer', 'react')
    .option('--section <selector>', 'keep only motion that touches this CSS selector')
    .option('--own-assets', 'write same-size placeholders instead of the site textures')
    .option('--from <runs>', 'reuse runs: design=<id>,motion=<id>,assets=<id>')
    .option('--no-diff', 'skip the visual diff and research loop')
    .option('--rounds <n>', 'research rounds when the rebuild does not match', '3')
    .option('--library <name>', 'save the result in the local library (~/.dea/library)')
    .option('--tag <tags...>', 'tags for the library entry')
    .option('--verify-build', 'run npm install and npm run build in the generated project and report it')
    .option('--no-trace', 'skip the live WebGL trace (uniform values and drivers)')
    .option('--no-research', 'do not search free sources for the techniques found')
    .option('--batch <file>', 'extract every URL in a text file (one per line)')
    .option('--reference <image>', 'your own screenshot of the original to compare against (e.g. taken on a machine with a GPU)')
    .option('--reference-ms <ms>', 'how long to watch the original for the reference screenshot', '45000'),
).action(
  (
    url: string | undefined,
    flags: CommonFlags & {
      to: string;
      section?: string;
      ownAssets?: boolean;
      from?: string;
      diff: boolean;
      rounds: string;
      library?: string;
      batch?: string;
      tag?: string[];
      verifyBuild?: boolean;
      trace: boolean;
      research: boolean;
      reference?: string;
      referenceMs: string;
    },
  ) =>
    run(async () => {
      if (!['react', 'vanilla', 'framer'].includes(flags.to)) throw new Error('--to must be react, vanilla or framer');
      const from = Object.fromEntries(
        (flags.from ?? '')
          .split(',')
          .filter(Boolean)
          .map((kv) => kv.split('=') as [string, string]),
      );
      const urls = flags.batch
        ? (await readFile(flags.batch, 'utf8'))
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith('#'))
        : url
          ? [url]
          : [];
      if (!urls.length) throw new Error('give a URL or --batch <file>');
      const rows: string[] = [];
      for (const [i, u] of urls.entries()) {
        const r = await extract(u, {
          ...options(flags),
          to: flags.to as 'react' | 'vanilla' | 'framer',
          section: flags.section,
          ownAssets: flags.ownAssets,
          from: urls.length === 1 ? from : undefined,
          noDiff: !flags.diff,
          rounds: Number(flags.rounds),
          reference: flags.reference,
          referenceMs: Number(flags.referenceMs),
          library: flags.library ? (urls.length > 1 ? `${flags.library}-${i + 1}` : flags.library) : undefined,
          tags: flags.tag,
          verifyBuild: flags.verifyBuild,
          noTrace: !flags.trace,
          noResearch: !flags.research,
        });
        if (flags.json) rows.push(JSON.stringify({ url: u, out: r.out, files: r.files, diff: r.diff && { start: r.diff.start, final: r.diff.final } }));
        else process.stdout.write(`\n${r.summary}\nReport: ${r.dir}/extract.md\n`);
      }
      if (flags.json) process.stdout.write(`[${rows.join(',')}]\n`);
    }),
);

const library = program
  .command('library')
  .description('decode once, reuse everywhere: kits saved from dea extract, searchable by site, shader, uniform, ease, colour, font or tag');

library
  .command('add')
  .description('save an extracted kit (an extract run id or folder) in the library')
  .argument('<run>', 'extract run id, run folder, or a folder with dea-kit.json')
  .option('-n, --name <name>', 'name for the kit (default: the site host)')
  .option('-t, --tag <tags...>', 'tags to find it by')
  .option('--json', 'print JSON')
  .action((ref: string, flags: { name?: string; tag?: string[]; json?: boolean }) =>
    run(async () => {
      const e = await libraryAdd(ref, { name: flags.name, tags: flags.tag });
      if (flags.json) return void process.stdout.write(`${JSON.stringify(e, null, 2)}\n`);
      process.stdout.write(`Saved "${e.name}" (${e.url}, ${e.target}) in ${e.dir}\n`);
    }),
  );

library
  .command('list', { isDefault: true })
  .description('list the saved kits')
  .option('--json', 'print JSON')
  .action((flags: { json?: boolean }) =>
    run(async () => {
      const items = await libraryList();
      if (flags.json) return void process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
      if (!items.length) return void process.stdout.write(`The library is empty (${libraryHome()}). Save a kit with: dea extract <url> --library <name>\n`);
      for (const x of items)
        process.stdout.write(
          `${x.name}  ${x.target}  ${x.score != null ? `${Math.round(x.score * 100)}% match  ` : ''}${x.url}${x.tags.length ? `  #${x.tags.join(' #')}` : ''}\n  shaders: ${x.shaders.map((s) => s.name).join(', ') || 'none'}\n`,
        );
    }),
  );

library
  .command('search')
  .description('find kits: every word must match the site, name, tags, techniques, shaders, uniforms, drivers, eases, colours or fonts')
  .argument('<query...>', 'words to look for, e.g. "gpgpu particles" or "power3 #e9e7e1"')
  .option('--json', 'print JSON')
  .action((q: string[], flags: { json?: boolean }) =>
    run(async () => {
      const hits = await librarySearch(q.join(' '));
      if (flags.json) return void process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
      if (!hits.length) return void process.stdout.write('No kit matches.\n');
      for (const h of hits) process.stdout.write(`${h.name}  (${h.url})\n  ${h.matched.join(' · ')}\n`);
    }),
  );

library
  .command('use')
  .description('copy a saved kit into a folder to start a project from it')
  .argument('<name>', 'kit name')
  .argument('[dir]', 'destination folder (default ./<name>)')
  .option('--force', 'copy into a folder that is not empty')
  .action((name: string, dir: string | undefined, flags: { force?: boolean }) =>
    run(async () => {
      const r = await libraryUse(name, dir ?? name, { force: flags.force });
      process.stdout.write(
        `Copied "${r.entry.name}" (${r.files} files) to ${r.dir}\nNext: cd ${relative(process.cwd(), r.dir) || '.'} && npm install && npm run dev\n`,
      );
    }),
  );

library
  .command('remove')
  .description('delete a kit from the library')
  .argument('<name>', 'kit name')
  .action((name: string) =>
    run(async () => {
      process.stdout.write((await libraryRemove(name)) ? `Removed "${name}".\n` : `No kit named "${name}".\n`);
    }),
  );

common(
  program
    .command('motion')
    .description(
      'how the page moves: GSAP timeline tree and ScrollTriggers, CSS/WAAPI animations, Lottie, Rive, Framer, three.js clips, plus a frame recording fitted to curves, with a runnable GSAP rebuild',
    )
    .argument('<url>', 'site to read')
    .option('--idle <s>', 'seconds to record with the page still', '3')
    .option('--scroll <s>', 'seconds to record while scrolling', '6'),
).action((url: string, flags: CommonFlags & { idle: string; scroll: string }) =>
  run(async () => {
    const r = await decodeMotion(url, { ...options(flags), idleSeconds: Number(flags.idle), scrollSeconds: Number(flags.scroll) });
    if (flags.json) return void process.stdout.write(`${JSON.stringify(r.motion, null, 2)}\n`);
    process.stdout.write(`\n${r.summary}\n\nReport: ${where(r)}/motion.md   Rebuild: ${where(r)}/motion/timeline.js\n`);
  }),
);

common(
  program
    .command('assets')
    .description(
      'every visual asset the page uses: WebGL textures (with previews and which shader sampler draws each), render targets, models, images, video, Lottie, Rive, fonts',
    )
    .argument('<url>', 'site to read')
    .option('--scroll-steps <n>', 'how far to scroll while watching', '16')
    .option('--no-render-targets', 'do not read back runtime render targets'),
).action((url: string, flags: CommonFlags & { scrollSteps: string; renderTargets: boolean }) =>
  run(async () => {
    const r = await decodeAssets(url, { ...options(flags), scrollSteps: Number(flags.scrollSteps), renderTargets: flags.renderTargets });
    if (flags.json) return void process.stdout.write(`${JSON.stringify(r.assets, null, 2)}\n`);
    process.stdout.write(`\n${r.summary}\n\nReport: ${where(r)}/assets.md   Files: ${where(r)}/assets/\n`);
  }),
);

common(
  program
    .command('trace')
    .description(
      'live debug: trace the WebGL calls a page makes (shader compiles, every uniform with its values over time, texture uploads), each with the code that made it, infer what drives each uniform, and pause on breakpoints to read the caller variables',
    )
    .argument('<url>', 'site to trace')
    .option('--ms <ms>', 'how long to watch after load', '12000')
    .option('--break <what...>', 'texImage2D, shaderSource, linkProgram, drawElements, uniform:<name>, or url:<script>:<line>[:<col>]')
    .option('--max-hits <n>', 'pauses recorded per breakpoint', '3'),
).action((url: string, flags: CommonFlags & { ms: string; break?: string[]; maxHits: string }) =>
  run(async () => {
    const r = await traceWebGL(url, { ...options(flags), ms: Number(flags.ms), breakOn: flags.break, maxHits: Number(flags.maxHits) });
    if (flags.json) return void process.stdout.write(`${JSON.stringify({ ...r.doc, env: undefined }, null, 2)}\n`);
    process.stdout.write(`\n${r.summary}\n\nReport: ${relative(process.cwd(), r.dir).startsWith('..') ? r.dir : relative(process.cwd(), r.dir)}/trace.md\n`);
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
  .option('--only <steps>', 'run exactly these steps: stack,pages,design,motion,assets,code,api')
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
  .command('serve')
  .description('serve DEA to AI apps: stdio by default, or over HTTP with --http (Streamable HTTP MCP, bearer token)')
  .option('--http', 'serve over HTTP: DEA tools at /mcp, DEA Hub at /hub')
  .option('--host <addr>', 'address to listen on (keep 127.0.0.1 unless you know why)', '127.0.0.1')
  .option('--port <n>', 'port', '7341')
  .option('--client <name>', 'who the token is for: DEA Hub uses this client’s permissions and history', 'remote')
  .option('--new-token', 'make a new token for this client (the old one stops working)')
  .option('--allowed-host <names...>', 'Host header names to accept when not on 127.0.0.1 (e.g. dea.example.com)')
  .action((f: { http?: boolean; host: string; port: string; client: string; newToken?: boolean; allowedHost?: string[] }) =>
    run(async () => {
      if (!f.http) {
        await import('../../mcp/src/stdio.ts');
        return;
      }
      const { startHttp } = await import('../../mcp/src/http.ts');
      await startHttp({ host: f.host, port: Number(f.port), client: f.client, newToken: f.newToken, prog: 'dea', allowedHosts: f.allowedHost });
      await new Promise(() => {}); // until Ctrl+C
    }),
  );

program
  .command('token')
  .description('tokens for dea serve --http: make one (shown once), list, or revoke')
  .option('--client <name>', 'which client the token is for', 'remote')
  .option('--list', 'list clients that have a token (hashes only)')
  .option('--revoke', 'delete this client’s token')
  .action((f: { client: string; list?: boolean; revoke?: boolean }) =>
    run(async () => {
      const { createToken, loadTokens, revokeToken, tokenFile } = await import('../../mcp/src/http.ts');
      if (f.list) {
        const t = await loadTokens();
        process.stdout.write(
          t.length ? `${t.map((x) => `${x.client.padEnd(16)} ${x.hint}  made ${x.created}`).join('\n')}\n` : 'No tokens yet. dea serve --http makes one.\n',
        );
        return;
      }
      if (f.revoke) {
        process.stdout.write((await revokeToken(f.client)) ? `Revoked the token for "${f.client}".\n` : `"${f.client}" had no token.\n`);
        return;
      }
      const tok = await createToken(f.client);
      process.stdout.write(`${tok}\n`);
      process.stderr.write(`New token for "${f.client}" (shown once; its hash is in ${tokenFile()}). The old one, if any, no longer works.\n`);
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
