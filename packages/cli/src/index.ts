#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  type BrowserChoice,
  bench,
  benchMd,
  ContentCache,
  canonicalJson,
  canvasLine,
  deaHome,
  decodeAssets,
  decodeCode,
  decodeDesign,
  decodeMotion,
  doctor,
  doctorMd,
  extract,
  fmtMb,
  forgetProfile,
  type InspectOptions,
  type InspectResult,
  inspectSite,
  investigateInBackground,
  investigationStatus,
  judgeSite,
  kitDir,
  libraryAdd,
  libraryHome,
  libraryList,
  libraryRemove,
  librarySearch,
  libraryUse,
  listProfiles,
  listRuns,
  loginSession,
  measureStability,
  parseScoreboardFile,
  planInvestigation,
  pruneRuns,
  RESULT_SCHEMA,
  type RunDoc,
  readRun,
  readRunScores,
  readUrl,
  recordReference,
  renderReport,
  renderTimings,
  researchAnswer,
  researchWeb,
  resolveRun,
  runInvestigation,
  type ScoreboardRow,
  type StepKind,
  scoreboardMd,
  scoreFiles,
  stabilityMd,
  stackSite,
  startBudget,
  Timings,
  traceWebGL,
  webSearch,
  withCache,
  withSharedBrowser,
  withTimings,
  writeFramerExport,
} from '@dea/core';
import { Command, Option } from 'commander';
import { launchers, registerHub } from './hub.ts';
import { registerSession } from './session.ts';

const VERSION = '0.2.0';

interface CommonFlags {
  browser: BrowserChoice;
  headed?: boolean;
  json?: boolean;
  timeout: string;
  home?: string;
  gpuMask: boolean;
  viewport: string;
  timings?: boolean;
}

function common(cmd: Command): Command {
  return cmd
    .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
    .option('--headed', 'show the browser window')
    .option('--json', 'print JSON instead of text')
    .option('--timeout <seconds>', 'page load timeout', '45')
    .option('--home <dir>', 'where runs are saved (default ./.dea, or $DEA_HOME)')
    .option('--viewport <WxH>', 'browser window size', '1440x900')
    .option('--no-gpu-mask', 'do not present a GPU name to the page when WebGL runs in software')
    .option('--timings', 'print the wall time of each stage and the peak memory (always saved as timings.json in the run)');
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

/** set before each command runs: the timings that command reports to (extract keeps its own, one per URL) */
let pendingTimings: { t: Timings; print: boolean } | null = null;

async function run(fn: () => Promise<void>): Promise<void> {
  const pt = pendingTimings;
  pendingTimings = null;
  try {
    if (!pt) await fn();
    else {
      await withTimings(pt.t, fn);
      const doc = pt.t.stop();
      if (pt.t.dir) await writeFile(join(pt.t.dir, 'timings.json'), `${JSON.stringify(doc, null, 2)}\n`).catch(() => {});
      if (pt.print) process.stderr.write(`\n${renderTimings(doc)}\n`);
    }
  } catch (e) {
    process.stderr.write(`dea: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}

const program = new Command('dea')
  .description('DEA decodes any website and proves it: stack, network, page tree and design, every fact labelled Verified, Inferred or Unknown.')
  .version(VERSION);

// every browser command measures its stages (timings.json in the run); --timings also prints them
const MEASURED = new Set(['inspect', 'stack', 'design', 'motion', 'assets', 'trace', 'code', 'score']);
program.hook('preAction', (_cmd, action) => {
  const name = action.name();
  if (!MEASURED.has(name)) return;
  const arg = action.args.find((a) => /^(https?:\/\/|[\w-]+\.[\w.-]+)/i.test(a)) ?? null;
  pendingTimings = { t: new Timings(name, arg).start(), print: Boolean(action.opts().timings) };
});

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
  .command('score')
  .description(
    'score a rebuild against the original: the page score (colour, light layout, edges) and the canvas-only score (SSIM, edges and tones of the WebGL picture with the text hidden)',
  )
  .argument('<original>', 'screenshot of the original (PNG or JPEG)')
  .argument('<rebuild>', 'screenshot of the rebuild, same size')
  .option('--layout <file>', 'layout.json from an extract (names the canvas and the text boxes to hide)')
  .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
  .option('--json', 'print JSON')
  .action((original: string, rebuild: string, flags: { layout?: string; browser: BrowserChoice; json?: boolean }) =>
    run(async () => {
      const layout = flags.layout ? JSON.parse(await readFile(flags.layout, 'utf8')) : null;
      const r = await scoreFiles(original, rebuild, { layout, browser: flags.browser });
      if (flags.json) return void process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      const p = (x: number) => `${Math.round(x * 1000) / 10}%`;
      process.stdout.write(
        `page ${p(r.page.similarity)} (colour ${p(r.page.colour)}, light layout ${p(r.page.layout)}, edges ${p(r.page.edges)})\n${canvasLine(r.canvas)}\n`,
      );
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
    .option('--own-assets', "placeholders instead of the site's images and large meshes; the kit carries none of the site's recorded bytes")
    .option('--from <runs>', 'reuse runs: design=<id>,motion=<id>,assets=<id>,trace=<id>')
    .option('--no-diff', 'skip the visual diff and research loop')
    .option('--rounds <n>', 'research rounds when the rebuild does not match', '3')
    .option('--library <name>', 'save the result in the local library (~/.dea/library)')
    .option('--tag <tags...>', 'tags for the library entry')
    .option('--verify-build', 'run npm install and npm run build in the generated project and report it')
    .option('--no-trace', 'skip the live WebGL trace (uniform values and drivers)')
    .option('--no-replay', "do not record the site's WebGL frames (no capture replay, no editable rebuild)")
    .option('--max-capture-mb <mb>', 'the largest recording kept, after compaction (default 64; 128 when the recording carries a scroll tape)')
    .option('--tape-mb <mb>', 'what the scroll tape may add to the recording (default 64): its stops are spread over the whole page within it')
    .option('--no-research', 'do not search free sources for the techniques found')
    .option('--no-page', 'keep to the first screen: do not read the page below it (the whole page is read by default)')
    .option('--batch <file>', 'extract every URL in a text file (one per line)')
    .option('--reference <image>', 'your own screenshot of the original to compare against (e.g. taken on a machine with a GPU)')
    .option('--reference-ms <ms>', 'watch the original this long for the reference screenshot (default: until the page settles, up to 45 s)')
    .option('--quick', 'rough and fast: 1 recorded frame, no motion/trace/sweep/research/build check (labelled QUICK)')
    .option('--no-cache', "do not read or write DEA's content cache (static files, stage runs, the reference capture)")
    .option('--cache-dir <dir>', 'where the content cache lives (default <home>/cache)')
    .option('--cache-max-mb <mb>', 'size cap of the content cache; the least recently used entries go first', '1024')
    .option('--concurrency <n>', 'decoders run side by side (1 = one after another)', '3')
    .option(
      '--budget <minutes>',
      'run-time budget per site: after it the optional stages are skipped, and 5 minutes later the command stops with exit code 124 (0 = no budget; env DEA_BUDGET_MIN)',
      process.env.DEA_BUDGET_MIN ?? '10',
    )
    .option('--overlap', 'run the decoders while the reference is captured (faster with a GPU; on a CPU-only machine a heavy intro may not finish)'),
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
      replay: boolean;
      research: boolean;
      page: boolean;
      reference?: string;
      referenceMs?: string;
      maxCaptureMb?: string;
      tapeMb?: string;
      quick?: boolean;
      cache: boolean;
      cacheDir?: string;
      cacheMaxMb: string;
      concurrency: string;
      overlap?: boolean;
      budget?: string;
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
      const base = options(flags);
      // one browser and one cache for every URL of the batch
      const cache = flags.cache ? new ContentCache({ dir: flags.cacheDir, maxMb: Number(flags.cacheMaxMb) || 1024 }) : null;
      const t0 = Date.now();
      let hardStop: NodeJS.Timeout | null = null;
      await withCache(cache, () =>
        withSharedBrowser(
          base.browser ?? 'auto',
          base.headless ?? true,
          async () => {
            for (const [i, u] of urls.entries()) {
              // the run-time budget: soft (optional stages are skipped), then hard (the command stops, browsers close with it)
              const budgetMin = Number(flags.budget ?? 10) || 0;
              startBudget(budgetMin);
              if (hardStop) clearTimeout(hardStop);
              if (budgetMin > 0) {
                hardStop = setTimeout(
                  () => {
                    process.stderr.write(`\nStopped: ${u} used its run-time budget of ${budgetMin} min plus 5 min (set --budget 0 to remove the limit).\n`);
                    process.exit(124);
                  },
                  (budgetMin + 5) * 60_000,
                );
                hardStop.unref();
              }
              const r = await extract(u, {
                ...options(flags),
                to: flags.to as 'react' | 'vanilla' | 'framer',
                section: flags.section,
                ownAssets: flags.ownAssets,
                from: urls.length === 1 ? from : undefined,
                noDiff: !flags.diff,
                rounds: Number(flags.rounds),
                reference: flags.reference,
                referenceMs: flags.referenceMs != null ? Number(flags.referenceMs) : undefined,
                quick: flags.quick,
                noCache: !flags.cache,
                cacheDir: flags.cacheDir,
                cacheMaxMb: Number(flags.cacheMaxMb) || 1024,
                concurrency: Math.max(1, Number(flags.concurrency) || 3),
                overlap: flags.overlap,
                library: flags.library ? (urls.length > 1 ? `${flags.library}-${i + 1}` : flags.library) : undefined,
                tags: flags.tag,
                verifyBuild: flags.verifyBuild,
                noTrace: !flags.trace,
                noReplay: !flags.replay,
                maxCaptureMb: Number(flags.maxCaptureMb) || undefined,
                tapeMb: Number(flags.tapeMb) || undefined,
                noResearch: !flags.research,
                noPage: !flags.page,
              });
              if (flags.json)
                rows.push(
                  JSON.stringify({
                    url: u,
                    out: r.out,
                    files: r.files,
                    diff: r.diff && { start: r.diff.start, final: r.diff.final, canvas: r.diff.canvas?.final?.score ?? null },
                    ...(flags.timings && r.timings ? { timings: r.timings } : {}),
                  }),
                );
              else process.stdout.write(`\n${r.summary}\nReport: ${r.dir}/extract.md\n`);
              if (flags.timings && r.timings) process.stderr.write(`\n${renderTimings(r.timings)}\n`);
            }
          },
          { max: Math.max(1, Number(flags.concurrency) || 3) + 1 },
        ),
      );
      if (urls.length > 1 && !flags.json)
        process.stdout.write(`\n${urls.length} URLs in ${Math.round((Date.now() - t0) / 1000)} s (the same browsers reused for all of them)\n`);
      if (flags.json) process.stdout.write(`[${rows.join(',')}]\n`);
    }),
);

const cacheCmd = program.command('cache').description("DEA's content cache: static files, stage runs and reference captures kept between runs");
cacheCmd
  .command('info', { isDefault: true })
  .description('where the cache is and how big')
  .option('--cache-dir <dir>', 'the cache folder (default <home>/cache)')
  .option('--home <dir>', 'DEA home (default ./.dea, or $DEA_HOME)')
  .action((flags: { cacheDir?: string; home?: string }) =>
    run(async () => {
      if (flags.home) process.env.DEA_HOME = flags.home;
      const c = new ContentCache({ dir: flags.cacheDir });
      const p = await c.prune();
      process.stdout.write(
        `${c.dir}: ${p.entries} entries, ${fmtMb(p.bytes)} of ${fmtMb(c.maxBytes)}${p.removed ? ` (${p.removed} old entries removed)` : ''}\n`,
      );
    }),
  );
cacheCmd
  .command('clear')
  .description('delete the cache')
  .option('--cache-dir <dir>', 'the cache folder (default <home>/cache)')
  .option('--home <dir>', 'DEA home (default ./.dea, or $DEA_HOME)')
  .action((flags: { cacheDir?: string; home?: string }) =>
    run(async () => {
      if (flags.home) process.env.DEA_HOME = flags.home;
      const c = new ContentCache({ dir: flags.cacheDir });
      await c.clear();
      process.stdout.write(`cleared ${c.dir}\n`);
    }),
  );

program
  .command('search')
  .description('free web search (DuckDuckGo, MDN, npm, GitHub, Stack Overflow, Wikipedia: no keys) with source, time and evidence on every result')
  .argument('<query...>', 'what to look for')
  .option('--source <names>', 'only these sources, comma separated: duckduckgo, wikipedia, github, npm, mdn, stackexchange, hackernews, searxng')
  .option('--limit <n>', 'results to show', '8')
  .option('--fresh', 'skip the cache and ask the sources again')
  .option('--timeout <seconds>', 'give up on slow sources after this long', '45')
  .option('--json', 'print JSON')
  .action((q: string[], flags: { source?: string; limit: string; fresh?: boolean; timeout: string; json?: boolean }) =>
    run(async () => {
      const r = await webSearch(q.join(' '), {
        sources: flags.source?.split(',').map((x) => x.trim()),
        limit: Number(flags.limit) || 8,
        fresh: flags.fresh,
        timeoutMs: (Number(flags.timeout) || 45) * 1000,
      });
      if (flags.json) return void process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      process.stdout.write(
        `${r.status === 'blocked' ? 'BLOCKED' : r.label.toUpperCase()}  ${r.results.length} results for "${r.query}"${r.status === 'partial' ? `  (partial: ${r.problems.map((p) => `${p.source} ${p.kind}`).join(', ')})` : ''}\n`,
      );
      r.results.forEach((x, i) => {
        process.stdout.write(
          `\n${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet.slice(0, 200)}\n   [${x.source}${x.verified ? '' : ', cached'}${x.license ? `, ${x.license}` : ''}]\n`,
        );
      });
      process.stdout.write(`\nSources: ${r.sources.map((s) => `${s.source} ${s.status}${s.note ? ` (${s.note})` : ''}`).join('; ')}\n${r.evidence}\n`);
    }),
  );

program
  .command('read')
  .description('fetch one public page and print its readable text (robots.txt respected, local addresses refused, bot-checks reported not bypassed)')
  .argument('<url>', 'page to read')
  .option('--max <chars>', 'cut the text here', '12000')
  .option('--links', 'also list the page links')
  .option('--fresh', 'skip the cache')
  .addOption(
    new Option('--render <mode>', 'never = as served; auto = run scripts in DEA’s headless browser only when the page is an empty shell; always')
      .choices(['never', 'auto', 'always'])
      .default('auto'),
  )
  .option('--max-pages <n>', 'PDFs: pages to read', '40')
  .option('--timeout <seconds>', 'give up after this long', '60')
  .option('--json', 'print JSON')
  .action(
    (
      url: string,
      flags: { max: string; links?: boolean; fresh?: boolean; render: 'never' | 'auto' | 'always'; maxPages: string; timeout: string; json?: boolean },
    ) =>
      run(async () => {
        const r = await readUrl(url, {
          maxChars: Number(flags.max) || 12000,
          links: flags.links,
          fresh: flags.fresh,
          render: flags.render,
          maxPages: Number(flags.maxPages) || 40,
          timeoutMs: (Number(flags.timeout) || 60) * 1000,
        });
        if (flags.json) return void process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
        process.stdout.write(
          `${r.title || r.final_url}\n${r.final_url}  [${r.verified ? 'verified' : 'cached'}, ${r.method}, ${r.fetched_at}]\n${r.evidence}\n\n${r.text}\n`,
        );
        for (const l of r.links ?? []) process.stdout.write(`- ${l.text}: ${l.url}\n`);
      }),
  );

program
  .command('research')
  .description(
    'search, read and extract in one call: the passages that answer a question, ranked by plain code, with the trail of every step (no model involved)',
  )
  .argument('<question...>', 'what you want to know')
  .option('--url <url...>', 'read these pages instead of searching')
  .option('--pages <n>', 'pages to open', '3')
  .option('--passages <n>', 'passages to return', '6')
  .option('--source <names>', 'only these search sources, comma separated')
  .addOption(new Option('--render <mode>', 'scripts: never, auto (only empty shells), always').choices(['never', 'auto', 'always']).default('auto'))
  .option('--fresh', 'skip the cache')
  .option('--timeout <seconds>', 'time budget for the whole call', '90')
  .option('--json', 'print the structured answer (the same JSON the MCP tool returns)')
  .action(
    (
      q: string[],
      flags: {
        url?: string[];
        pages: string;
        passages: string;
        source?: string;
        render: 'never' | 'auto' | 'always';
        fresh?: boolean;
        timeout: string;
        json?: boolean;
      },
    ) =>
      run(async () => {
        const r = await researchWeb(q.join(' '), {
          urls: flags.url,
          pages: Number(flags.pages) || 3,
          passages: Number(flags.passages) || 6,
          sources: flags.source?.split(',').map((x) => x.trim()),
          render: flags.render,
          fresh: flags.fresh,
          timeoutMs: (Number(flags.timeout) || 90) * 1000,
        });
        if (flags.json) {
          const a = researchAnswer(r);
          return void process.stdout.write(`${canonicalJson({ schema: RESULT_SCHEMA, tool: 'research', result: a.result, meta: a.meta })}\n`);
        }
        process.stdout.write(`${r.status.toUpperCase()}  ${r.passages.length} passages for "${r.question}"\n`);
        for (const [i, p] of r.passages.entries())
          process.stdout.write(
            `\n${i + 1}. ${p.title || p.url}  (score ${p.score})\n   ${p.url}  @${p.offset}\n   ${p.text.replace(/\s+/g, ' ').slice(0, 400)}\n`,
          );
        process.stdout.write('\nTrail:\n');
        for (const t of r.trail)
          process.stdout.write(
            t.step === 'search'
              ? `  search: ${t.status}, ${t.results} results${t.problems.length ? ` (${t.problems.map((p) => `${p.source} ${p.kind}`).join(', ')})` : ''}\n`
              : t.ok
                ? `  read ${t.url}: ${t.method}, ${t.chars} chars, ${t.passages} passages used\n`
                : `  read ${t.url}: FAILED ${t.error}\n`,
          );
        process.stdout.write(`${r.evidence}\n`);
      }),
  );

common(
  program
    .command('stability')
    .description(
      'how repeatable is the interaction measurement on this site? runs the scripted pointer and scroll on several fresh loads of the ORIGINAL and compares each run with the first: the noise floor of the numbers, with the old fixed wait against the phase-aligned start',
    )
    .argument('<url>', 'site to measure')
    .option('--runs <n>', 'fresh loads, the first being the reference (default 3)', '3')
    .addOption(new Option('--mode <mode>', 'how each later run starts').choices(['both', 'aligned', 'fixed']).default('both'))
    .option('--cap <seconds>', 'longest wait for a scene to settle or reach the reference phase', '90'),
).action((url: string, flags: CommonFlags & { runs: string; mode: 'both' | 'aligned' | 'fixed'; cap: string }) =>
  run(async () => {
    const base = options(flags);
    const out = join(process.env.DEA_HOME ?? '.dea', 'stability', new Date().toISOString().replace(/[:.]/g, '-'));
    const r = await measureStability(url, {
      runs: Number(flags.runs) || 3,
      mode: flags.mode,
      viewport: base.viewport,
      browser: base.browser,
      headless: base.headless,
      capMs: (Number(flags.cap) || 90) * 1000,
      outDir: out,
      onProgress: base.onProgress,
    });
    process.stdout.write(flags.json ? `${JSON.stringify(r, null, 2)}\n` : `\n${stabilityMd(r)}\nSaved in ${out}\n`);
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
      if (e.ownAssets !== true)
        process.stderr.write(
          `Note: this kit carries the site's own recorded files (images, meshes, captured frames). Keep it private, or extract again with --own-assets before you share or publish anything made from it.\n`,
        );
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
          `${x.name}  ${x.target}  ${x.score != null ? `page ${Math.round(x.score * 100)}%  ` : ''}${x.canvasScore != null ? `canvas ${Math.round(x.canvasScore * 100)}%  ` : ''}${x.url}${x.tags.length ? `  #${x.tags.join(' #')}` : ''}\n  shaders: ${x.shaders.map((s) => s.name).join(', ') || 'none'}\n`,
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
        `Copied "${r.entry.name}" (${r.files} files) to ${r.dir}\nNext: cd ${((rel) => (!rel ? '.' : rel.startsWith('..') ? JSON.stringify(r.dir) : rel))(relative(process.cwd(), r.dir))} && npm install && npm run dev\n`,
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

common(
  program
    .command('record')
    .description(
      "take only the slow part of dea extract: the reference screenshot and the site's recorded WebGL frames, kept in the cache; a later dea extract <url> with the same capture options reuses it instead of opening the site again (for slow machines or time-limited boxes)",
    )
    .argument('<url>', 'site to record')
    .option('--section <selector>', 'the same --section you will give dea extract')
    .option('--reference-ms <ms>', 'watch the original this long (default: until the page settles, up to 45 s); give extract the same value')
    .option('--quick', 'rough and fast: 1 recorded frame (give extract --quick too)')
    .option('--no-replay', 'only the screenshot, no WebGL recording (no editable rebuild)')
    .option('--tape-mb <mb>', 'what the scroll tape may add to the recording (default 64); give extract the same value')
    .option('--cache-dir <dir>', 'where the content cache lives (default <home>/cache)')
    .option('--cache-max-mb <mb>', 'size cap of the content cache', '1024'),
).action(
  (
    url: string,
    flags: CommonFlags & { section?: string; referenceMs?: string; quick?: boolean; replay: boolean; tapeMb?: string; cacheDir?: string; cacheMaxMb: string },
  ) =>
    run(async () => {
      const r = await recordReference(url, {
        ...options(flags),
        section: flags.section,
        referenceMs: flags.referenceMs != null ? Number(flags.referenceMs) : undefined,
        quick: flags.quick,
        noReplay: !flags.replay,
        tapeMb: Number(flags.tapeMb) || undefined,
        cacheDir: flags.cacheDir,
        cacheMaxMb: Number(flags.cacheMaxMb) || 1024,
        onProgress: flags.json ? undefined : (s: string) => process.stderr.write(`  · ${s}\n`),
      });
      if (flags.json) return void process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      const what = r.recorded ? 'reference screenshot + recorded WebGL frames' : `reference screenshot only (${r.recordingError})`;
      process.stdout.write(
        `\n${r.reused ? 'Already in the cache' : 'Recorded'}: ${what}, frame at ${Math.round(r.atMs)} ms, ${r.seconds} s\nCache: ${r.cacheDir}\nNext: dea extract ${url}${flags.section ? ` --section "${flags.section}"` : ''}${flags.referenceMs ? ` --reference-ms ${flags.referenceMs}` : ''}${flags.quick ? ' --quick' : ''}${flags.replay ? '' : ' --no-replay'}${flags.tapeMb ? ` --tape-mb ${flags.tapeMb}` : ''} reuses it\n`,
      );
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
  .option(
    '--profile-client <names...>',
    'clients that may use your DEA browser profile (DEA_PROFILE: your own sign-ins); every other client gets a fresh, signed-out browser',
  )
  .action((f: { http?: boolean; host: string; port: string; client: string; newToken?: boolean; allowedHost?: string[]; profileClient?: string[] }) =>
    run(async () => {
      if (!f.http) {
        await import('../../mcp/src/stdio.ts');
        return;
      }
      const { startHttp } = await import('../../mcp/src/http.ts');
      await startHttp({
        host: f.host,
        port: Number(f.port),
        client: f.client,
        newToken: f.newToken,
        prog: 'dea',
        allowedHosts: f.allowedHost,
        profileClients: f.profileClient,
      });
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
  .option('--client <name>', 'the runs of one dea serve --http client (kept in <home>/clients/<name>/runs)')
  .option('--json', 'print JSON')
  .action((flags: { home?: string; client?: string; json?: boolean }) =>
    run(async () => {
      if (flags.home) process.env.DEA_HOME = flags.home;
      if (flags.client) {
        const { clientRunsDir } = await import('../../mcp/src/http.ts');
        process.env.DEA_RUNS_DIR = clientRunsDir(process.env.DEA_HOME ?? deaHome(), flags.client);
      }
      const runs = await listRuns();
      if (flags.json) return void process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
      if (!runs.length) return void process.stdout.write('No runs yet. Try: dea inspect https://threejs.org/examples/webgl_animation_keyframes.html\n');
      for (const r of runs) process.stdout.write(`${r.id}  ${r.kind.padEnd(7)}  ${r.title || r.url}\n`);
    }),
  );

common(
  program
    .command('scoreboard')
    .description("DEA's reference-site scoreboard: the scores reached on known sites against the targets in a sites file; exits 1 when a target is missed")
    .argument('[runs...]', 'extract run ids to score (default: the newest saved extract run of each site in the sites file)')
    .option('--sites <file>', 'the sites file (JSON: { tolerance, sites: [{ url, name, targets: { page, canvas, rebuildPage, rebuildCanvas }, options }] })')
    .option('--extract', 'extract every site in the sites file now instead of reading saved runs (slow: minutes per site)')
    .option('--tolerance <points>', 'how far below a target still holds, in points (default: the file, else 1)')
    .option('--out <file>', 'also write the markdown here')
    .option('--quick', 'with --extract: rough and fast (1 frame); targets are for full runs, so expect misses'),
).action((runs: string[], flags: CommonFlags & { sites?: string; extract?: boolean; tolerance?: string; out?: string; quick?: boolean }) =>
  run(async () => {
    const file = flags.sites ? parseScoreboardFile(await readFile(flags.sites, 'utf8')) : null;
    if (!file && !runs.length) throw new Error('Give a sites file (--sites docs/scoreboard.json) or run ids.');
    if (flags.extract && !file) throw new Error('--extract needs --sites');
    const tolerance = flags.tolerance != null ? Number(flags.tolerance) / 100 : (file?.tolerance ?? 0.01);
    const rows: ScoreboardRow[] = [];
    const failures: Record<string, string> = {};
    const norm = (u: string) => u.replace(/\/+$/, '');
    if (runs.length) {
      for (const ref of runs) {
        const scores = await readRunScores(await resolveRun(ref));
        const site = file?.sites.find((x) => norm(x.url) === norm(scores.url)) ?? { url: scores.url };
        rows.push(judgeSite(site, scores, tolerance));
      }
    } else if (file) {
      const saved = flags.extract ? [] : (await listRuns(undefined, 10_000)).filter((r) => r.kind === 'extract');
      for (const site of file.sites) {
        try {
          let dir: string | undefined;
          if (flags.extract) {
            const r = await extract(site.url, { ...options(flags), quick: flags.quick, ...(site.options ?? {}) });
            dir = r.dir;
          } else dir = saved.find((r) => norm(r.url) === norm(site.url))?.dir;
          if (!dir) {
            failures[site.url] = 'no saved extract run (run dea extract on it, or use --extract)';
            rows.push(judgeSite(site, null, tolerance));
            continue;
          }
          rows.push(judgeSite(site, await readRunScores(dir), tolerance));
        } catch (e) {
          failures[site.url] = (e as Error).message.split('\n')[0].slice(0, 200);
          rows.push(judgeSite(site, null, tolerance));
        }
      }
    }
    const md = scoreboardMd(rows, failures);
    if (flags.out) await writeFile(flags.out, `${md}\n`);
    process.stdout.write(flags.json ? `${JSON.stringify({ tolerance, rows, failures }, null, 2)}\n` : `${md}\n`);
    if (rows.some((r) => r.status === 'regressed' || r.status === 'failed')) process.exitCode = 1;
  }),
);

program
  .command('framer')
  .description("turn an extract's editable rebuild into one Framer code component, plus a folder to host its files")
  .argument('<run>', 'extract run id, run folder, or a kit folder (dea-kit.json)')
  .option('-n, --name <name>', 'component name (default: from the site)')
  .option('--url <url>', 'where the site folder will be hosted, + /rebuild/ (default for the Source control)')
  .option('--three <revision>', 'three.js revision to load from esm.sh, e.g. 170', '170')
  .option('--allow-site-files', 'export a kit made without --own-assets (private tests only)')
  .option('--json', 'print JSON')
  .action((ref: string, flags: { name?: string; url?: string; three: string; allowSiteFiles?: boolean; json?: boolean }) =>
    run(async () => {
      const r = await writeFramerExport(await kitDir(ref), {
        name: flags.name,
        url: flags.url,
        threeRevision: flags.three,
        allowSiteFiles: flags.allowSiteFiles,
      });
      if (flags.json) return void process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      process.stdout.write(
        `Framer component ${r.name}: ${r.file}\nHost this folder (e.g. npx vercel deploy "${r.site}" --prod), then set Source to <url>/rebuild/.\nControls: Source, Poster, Animate, Follow input, Max DPR${r.controls.length ? `, ${r.controls.map((c) => c.uniform).join(', ')}` : ''}\n`,
      );
      if (r.poster) process.stdout.write('Poster: rebuild/poster.png (a still of the rebuild; shown while loading and where WebGL is off)\n');
      if (r.siteFiles) process.stderr.write("Warning: the hosted files include the site's own recorded geometry and textures. Keep it private.\n");
    }),
  );

program
  .command('prune')
  .description('free disk space: remove saved runs older than N days (shows what it would remove unless --yes)')
  .option('--older-than <days>', 'remove runs started more than this many days ago', '30')
  .option('--keep <n>', 'always keep this many newest runs', '5')
  .option('--yes', 'really remove them (without it nothing is deleted)')
  .option('--home <dir>', 'where runs are saved')
  .option('--json', 'print JSON')
  .action((flags: { olderThan: string; keep: string; yes?: boolean; home?: string; json?: boolean }) =>
    run(async () => {
      if (flags.home) process.env.DEA_HOME = flags.home;
      const r = await pruneRuns({ olderThanDays: Number(flags.olderThan), keep: Number(flags.keep), dryRun: !flags.yes });
      if (flags.json) return void process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;
      for (const x of r.removed) process.stdout.write(`${r.dryRun ? 'would remove' : 'removed'}  ${x.id}  ${mb(x.bytes)}\n`);
      process.stdout.write(
        `${r.removed.length} run(s), ${mb(r.bytes)} ${r.dryRun ? 'would be freed. Add --yes to remove them' : 'freed'}; ${r.kept} kept (put a file named KEEP in a run folder to keep it).\n`,
      );
    }),
  );

program
  .command('doctor')
  .description('is this machine ready? Node, the browser, WebGL (a graphics card, or software on the CPU, with a plain warning), free disk space')
  .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
  .option('--headed', 'open the browser with a window (a headless browser can fall back to software WebGL on some PCs)')
  .option('--json', 'print JSON')
  .action((flags: { browser: BrowserChoice; headed?: boolean; json?: boolean }) =>
    run(async () => {
      const r = await doctor({ browser: flags.browser, headless: !flags.headed, home: process.env.DEA_HOME });
      process.stdout.write(flags.json ? `${JSON.stringify(r, null, 2)}\n` : doctorMd(r));
      if (r.checks.some((c) => c.status === 'no')) process.exitCode = 1;
    }),
  );

program
  .command('bench')
  .description(
    'measure this machine’s graphics card with a small built-in scene (and, with a url, a public page’s frame rate) and write dea-bench.json and dea-bench.md: GPU name, browser, OS, CPU, numbers; nothing personal. Software WebGL is labelled and gets no speed numbers',
  )
  .argument('[url]', 'optional public page whose frame rate to measure (idle and while scrolled)')
  .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
  .option('--headed', 'open the browser with a window (use this on a PC with a graphics card)')
  .option('--out <dir>', 'where dea-bench.json and dea-bench.md are written (default: the current folder)')
  .option('--quick', 'a shorter run')
  .option('--json', 'print JSON')
  .action((url: string | undefined, flags: { browser: BrowserChoice; headed?: boolean; out?: string; quick?: boolean; json?: boolean }) =>
    run(async () => {
      const r = await bench({ browser: flags.browser, headless: !flags.headed, url, quick: flags.quick, version: VERSION });
      const dir = flags.out ?? process.cwd();
      await mkdir(dir, { recursive: true });
      const md = benchMd(r);
      await writeFile(join(dir, 'dea-bench.json'), `${JSON.stringify(r, null, 2)}\n`);
      await writeFile(join(dir, 'dea-bench.md'), md);
      process.stdout.write(
        flags.json ? `${JSON.stringify(r, null, 2)}\n` : `${md}\nWritten: ${join(dir, 'dea-bench.json')} and ${join(dir, 'dea-bench.md')}\n`,
      );
    }),
  );

const browserCmd = program
  .command('browser')
  .description('DEA’s own browser profile: log in to a site by hand once, and DEA can read it afterwards (never your everyday browser)');
browserCmd
  .command('login')
  .description(
    'open a visible Edge/Chrome window with a profile that belongs to DEA, so you can sign in by hand; close the window when you are done. DEA never sees your password, and does not read or control that window',
  )
  .argument('[name]', 'profile name (letters, digits, - and _)', 'default')
  .argument('[url]', 'https page to open first')
  .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
  .action((name: string, url: string | undefined, flags: { browser: BrowserChoice }) =>
    run(async () => {
      const r = await loginSession({
        name,
        url,
        browser: flags.browser,
        onOpen: ({ dir, browser }) =>
          process.stdout.write(
            `Opening ${browser} with DEA's own profile "${name}" (${dir}).\nSign in to the sites DEA should be able to read. Type your passwords in that window yourself: DEA does not see them, does not read the window and is not attached to it.\nWhen you are done, close the window. Then: dea session start --profile ${name} <url>\nWaiting for the window to close...\n`,
          ),
      });
      process.stdout.write(
        `Closed after ${r.seconds} s. Profile "${r.name}" saved in ${r.dir}.\nWhat it holds: what the browser keeps after a sign-in (cookies, local storage), encrypted by your operating system account. Delete it any time: dea browser forget ${r.name} --yes\n`,
      );
    }),
  );
browserCmd
  .command('profiles', { isDefault: true })
  .description('the DEA browser profiles on this machine')
  .option('--json', 'print JSON')
  .action((flags: { json?: boolean }) =>
    run(async () => {
      const ps = await listProfiles();
      if (flags.json) return void process.stdout.write(`${JSON.stringify(ps, null, 2)}\n`);
      if (!ps.length) return void process.stdout.write('No DEA browser profiles yet. Make one: dea browser login\n');
      for (const p of ps)
        process.stdout.write(`${p.name}  ${p.sizeMb} MB  last login ${p.lastLoginAt ?? 'never'}  last used ${p.lastUsedAt ?? 'never'}  ${p.dir}\n`);
    }),
  );
browserCmd
  .command('forget')
  .description('delete a DEA browser profile and everything the browser kept in it (the logins too)')
  .argument('<name>', 'profile name')
  .option('--yes', 'really delete it')
  .action((name: string, flags: { yes?: boolean }) =>
    run(async () => {
      if (!flags.yes) throw new Error(`This deletes the profile "${name}" and every login kept in it. Run again with --yes.`);
      process.stdout.write(`Deleted ${await forgetProfile(name)}\n`);
    }),
  );

registerSession(program, run);
registerHub(program, run);

await program.parseAsync();
