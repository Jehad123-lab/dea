import { type OpenOptions, openSite, type Session } from '../browser/open.ts';
import { shaderFacts, summarizeShaders } from '../design/shaders.ts';
import { newRunId, RunWriter, runsDir } from '../evidence/run.ts';
import { renderReport } from '../report.ts';
import type { EventSink, Fact, RunMeta } from '../types.ts';
import { finishHar, fmtBytes, type NetworkSummary } from './network.ts';
import { type PageSnapshot, pageTree, takeSnapshot } from './snapshot.ts';
import { detectStack, type StackHit, stackFacts } from './stack.ts';

export interface InspectOptions extends OpenOptions {
  /** folder that holds runs (default .dea/runs, or $DEA_HOME/runs) */
  runsRoot?: string;
  /** save the accessibility page tree (default true) */
  tree?: boolean;
  /** called once per step, for CLIs that show progress */
  onProgress?: (step: string) => void;
  /** live events (steps, screenshot frames, facts, warnings, finish) for UIs */
  onEvent?: EventSink;
  /** include base64 image data in frame events (default false: events carry the file name only) */
  frameData?: boolean;
}

export interface RunDoc {
  meta: RunMeta;
  page: Omit<PageSnapshot, 'dea' | 'probes'> & { probes: Record<string, unknown> };
  stack: StackHit[];
  network: NetworkSummary;
  webgl: ReturnType<typeof summarizeShaders> & {
    contexts: PageSnapshot['dea']['contexts'];
    rafCalls: number;
    rafSources: Record<string, number>;
    renderer: string | null;
    gpuMasked: boolean;
  };
  facts: Fact[];
  design?: unknown;
}

export interface InspectResult {
  runId: string;
  dir: string;
  run: RunDoc;
  /** the run folder writer, for commands that add files after collection */
  writer: RunWriter;
  /** short plain-text summary, good for terminals and AI tools */
  summary: string;
}

/** Hook for richer commands (design) to work while the page is still open. */
export type DuringHook = (session: Session, writer: RunWriter) => Promise<{ facts?: Fact[]; design?: unknown } | undefined>;

export async function collect(url: string, kind: RunMeta['kind'], opts: InspectOptions = {}, during?: DuringHook): Promise<InspectResult> {
  const startedAt = new Date().toISOString();
  const writer = await new RunWriter(newRunId(url), opts.runsRoot ?? runsDir(), opts.onEvent, { frameData: opts.frameData }).init();
  const say = (step: string) => {
    opts.onProgress?.(step);
    void writer.progress(step);
  };
  writer.emit({ type: 'run.started', runId: writer.id, kind, url, dir: writer.dir, at: startedAt });
  try {
    return await collectInto(writer, url, kind, opts, say, startedAt, during);
  } catch (e) {
    writer.emit({ type: 'run.failed', runId: writer.id, error: (e as Error).message, at: new Date().toISOString() });
    throw e;
  }
}

async function collectInto(
  writer: RunWriter,
  url: string,
  kind: RunMeta['kind'],
  opts: InspectOptions,
  say: (step: string) => void,
  startedAt: string,
  during?: DuringHook,
): Promise<InspectResult> {
  const rawHar = writer.path('network.raw.har');
  say(`opening ${url}`);
  const session = await openSite(url, { ...opts, harPath: rawHar });
  const viewport = session.page.viewportSize() ?? { width: 1440, height: 900 };
  let snap: PageSnapshot;
  let extra: { facts?: Fact[]; design?: unknown } | undefined;
  const warnings = [...session.warnings];
  try {
    if (during) extra = await during(session, writer);
    say('reading the page');
    snap = await takeSnapshot(session.page);
    if (opts.tree !== false) {
      const tree = await pageTree(session.page).catch((e) => `# page tree unavailable: ${(e as Error).message}`);
      await writer.text('page.aria.yaml', tree, 'pageTree');
    }
  } finally {
    say('closing the browser');
    await session.close();
  }
  say('cleaning the network log');
  const { summary: network, entries } = await finishHar(rawHar, writer.path('network.har'), snap.url);
  writer.files.har = 'network.har';
  say(`network: ${network.requests} requests, ${fmtBytes(network.bytes)}, ${network.redactions} secrets redacted`);

  const stack = detectStack({
    probes: snap.probes,
    meta: snap.meta,
    scripts: snap.scripts.map((s) => s.src),
    requestUrls: entries.map((e) => e.url),
    htmlClass: snap.htmlClass,
    htmlAttrs: snap.htmlAttrs,
    documentHeaders: network.documentHeaders,
    threeRevision: snap.dea.threeRevision,
    reactRenderers: snap.dea.reactRenderers,
    shaderCount: snap.dea.shaders.length + snap.dea.wgsl.length,
    contexts: snap.dea.contexts.length,
  });
  const shaders = summarizeShaders([...snap.dea.shaders, ...snap.dea.wgsl]);
  if (shaders.programs.length || snap.dea.wgsl.length) {
    await writer.json('shaders.json', [...snap.dea.shaders, ...snap.dea.wgsl], 'shaders');
  }

  const facts: Fact[] = [
    {
      key: 'page.title',
      claim: `The page title is "${snap.title}".`,
      value: snap.title,
      label: 'Verified',
      evidence: [{ source: 'dom', pointer: 'document.title' }],
    },
    ...stackFacts(stack),
    {
      key: 'network.total',
      claim: `The page made ${network.requests} requests (${fmtBytes(network.bytes)}).`,
      value: { requests: network.requests, bytes: network.bytes },
      label: 'Verified',
      evidence: [{ source: 'har', pointer: 'network.har', excerpt: `${network.requests} entries` }],
    },
    {
      key: 'fonts.loaded',
      claim: snap.fonts.filter((f) => f.status === 'loaded').length
        ? `Loaded font faces: ${[...new Set(snap.fonts.filter((f) => f.status === 'loaded').map((f) => f.family))].join(', ')}.`
        : 'No web fonts were loaded; the page uses system fonts or fonts drawn in canvas.',
      value: snap.fonts,
      label: 'Verified',
      evidence: [{ source: 'dom', pointer: 'document.fonts', excerpt: `${snap.fonts.length} faces` }],
    },
    ...shaderFacts(shaders, snap.dea.contexts),
    ...(extra?.facts ?? []),
  ];

  const { dea, probes, ...page } = snap;
  const meta: RunMeta = {
    schema: 'dea.run/1',
    id: writer.id,
    kind,
    url,
    finalUrl: snap.url,
    title: snap.title,
    status: session.response?.status() ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    browser: session.info,
    viewport,
    files: {},
    warnings: [
      ...warnings,
      ...(dea.gpuMasked
        ? [
            `This machine renders WebGL in software (${dea.renderer}). DEA told the page a common GPU name so it would show its full 3D instead of a fallback. Run with --no-gpu-mask to see what a GPU-less visitor gets.`,
          ]
        : []),
      ...dea.errors.map((e) => `observer: ${e}`),
    ],
  };
  const run: RunDoc = {
    meta,
    page: { ...page, probes },
    stack,
    network,
    webgl: { ...shaders, contexts: dea.contexts, rafCalls: dea.rafCalls, rafSources: dea.rafSources, renderer: dea.renderer, gpuMasked: dea.gpuMasked },
    facts,
    ...(extra?.design ? { design: extra.design } : {}),
  };
  // the plan's original quick-look file, kept for compatibility
  await writer.json(
    'facts.json',
    {
      title: snap.title,
      three: probes.three ?? dea.threeRevision ?? null,
      gsap: stack.find((h) => h.id === 'gsap')?.version ?? null,
      fonts: snap.fonts.map((f) => `${f.family} ${f.weight} ${f.style}`),
      scripts: snap.scripts.map((s) => s.src),
      shaderCount: dea.shaders.length + dea.wgsl.length,
    },
    'quickFacts',
  );
  await writer.text('report.md', renderReport(run), 'report');
  meta.files = { ...writer.files, run: 'run.json', progress: 'progress.md' };
  await writer.json('run.json', run, 'run');
  for (const fact of facts) writer.emit({ type: 'fact', runId: writer.id, fact });
  for (const message of meta.warnings) writer.emit({ type: 'warning', runId: writer.id, message });
  say('done');
  const summary = summarize(run);
  if (kind !== 'design') writer.emit({ type: 'run.finished', runId: writer.id, dir: writer.dir, summary, at: new Date().toISOString() });
  return { runId: writer.id, dir: writer.dir, run, writer, summary };
}

/** Phase 1: open a site and save what it sees. */
export function inspectSite(url: string, opts: InspectOptions = {}): Promise<InspectResult> {
  return collect(url, 'inspect', opts);
}

/** Same evidence as inspect, framed as a stack answer. */
export function stackSite(url: string, opts: InspectOptions = {}): Promise<InspectResult> {
  return collect(url, 'stack', { ...opts, tree: opts.tree ?? false });
}

export function summarize(run: RunDoc): string {
  const lines: string[] = [];
  lines.push(`${run.meta.title || run.meta.finalUrl}`);
  lines.push(`${run.meta.finalUrl}`);
  lines.push('');
  if (run.stack.length) {
    lines.push('Stack:');
    for (const h of run.stack) lines.push(`  ${h.name}${h.version ? ` ${h.version}` : ''}  [${h.label}] ${h.evidence[0]?.pointer ?? ''}`);
  } else {
    lines.push('Stack: nothing DEA knows was found (plain HTML/CSS, or a bundled app with no markers).');
  }
  lines.push('');
  lines.push(
    `Network: ${run.network.requests} requests, ${fmtBytes(run.network.bytes)}${run.network.redactions ? `, ${run.network.redactions} secrets redacted` : ''}`,
  );
  if (run.webgl.contexts.length || run.webgl.programs.length) {
    lines.push(`WebGL: ${run.webgl.contexts.length} canvas context(s), ${run.webgl.shaderCount} shaders, ${run.webgl.programs.length} unique programs`);
  }
  const loaded = [...new Set(run.page.fonts.filter((f) => f.status === 'loaded').map((f) => f.family))];
  if (loaded.length) lines.push(`Fonts loaded: ${loaded.join(', ')}`);
  for (const w of run.meta.warnings) lines.push(`Note: ${w}`);
  return lines.join('\n');
}
