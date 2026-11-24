import { statfs } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import type { Browser } from 'playwright';
import { type BrowserChoice, browserStartHint, launchBrowser, releaseBrowser } from './open.ts';

/**
 * Is WebGL drawing on a graphics card, or in software on the CPU? Read from the browser itself: the renderer string a page can
 * read (WEBGL_debug_renderer_info) and the browser's own GPU report (CDP SystemInfo.getInfo). Used by `dea doctor` and `dea bench`.
 *
 * Nothing here is fetched from the network and nothing personal is read: the report holds the graphics card's name, the browser's
 * version, the operating system's name and architecture, the CPU model and count, and the memory size. No host name, no user
 * name, no paths, no addresses, no environment.
 */

/** The renderer strings of software WebGL: SwiftShader (Chrome's own), llvmpipe and softpipe (Mesa), Windows' basic driver. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;

export type GpuKind = 'hardware' | 'software' | 'none';

/** Hardware or software, from the renderer string (and the browser's own word when it has one). */
export function classifyRenderer(renderer: string | null | undefined, cdpWebgl?: string | null): GpuKind {
  if (!renderer) return 'none';
  if (SOFTWARE.test(renderer)) return 'software';
  if (cdpWebgl && /software/i.test(cdpWebgl)) return 'software';
  return 'hardware';
}

/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)" → { vendor, device, backend }. Plain strings stay as they are. */
export function parseAngle(renderer: string): { vendor: string | null; device: string; backend: string | null } {
  const m = /^ANGLE \((.*)\)$/.exec(renderer.trim());
  if (!m) return { vendor: null, device: renderer.trim(), backend: null };
  const parts = m[1].split(',').map((x) => x.trim());
  if (parts.length >= 3) {
    const backend = parts[parts.length - 1].replace(/\s*\(.*$/, '').trim() || null;
    const device = parts
      .slice(1, -1)
      .join(', ')
      .replace(/\s+(Direct3D\d*\w*|OpenGL).*$/i, '')
      .replace(/\s+(vs_\d.*)$/i, '');
    return { vendor: parts[0] || null, device: device || parts[1], backend };
  }
  return { vendor: null, device: m[1], backend: null };
}

export interface GpuProbe {
  /** the browser that ran the probe */
  browser: { channel: string; version: string; headless: boolean };
  webgl: { webgl2: boolean; webgl1: boolean };
  renderer: string | null;
  vendor: string | null;
  /** the card as the ANGLE string names it (null when the renderer is a plain string) */
  device: string | null;
  backend: string | null;
  kind: GpuKind;
  /** what the browser's own GPU report says (CDP SystemInfo): devices by name, and the state of WebGL and compositing */
  report: { devices: string[]; webgl: string | null; webgl2: string | null; compositing: string | null; rasterization: string | null } | null;
  limits: { maxTextureSize: number | null; maxVertexAttribs: number | null; maxDrawBuffers: number | null; floatTextures: boolean; antialias: boolean | null };
  extensions: number;
}

/** Runs in the page: a WebGL context on a fresh canvas, its renderer string and limits. */
export const PROBE_SCRIPT = `(() => {
  const out = { webgl2: false, webgl1: false, renderer: null, vendor: null, maxTextureSize: null, maxVertexAttribs: null, maxDrawBuffers: null, floatTextures: false, antialias: null, extensions: 0 };
  const c = document.createElement('canvas');
  let gl = null;
  try { gl = c.getContext('webgl2', { antialias: true }); if (gl) out.webgl2 = true; } catch (e) {}
  if (!gl) { try { gl = c.getContext('webgl', { antialias: true }) || c.getContext('experimental-webgl'); if (gl) out.webgl1 = true; } catch (e) {} }
  if (!gl) return out;
  if (out.webgl2) { try { out.webgl1 = !!document.createElement('canvas').getContext('webgl'); } catch (e) {} }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  out.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  out.vendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
  out.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  out.maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
  try { out.maxDrawBuffers = out.webgl2 ? gl.getParameter(gl.MAX_DRAW_BUFFERS) : null; } catch (e) {}
  out.floatTextures = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('WEBGL_color_buffer_float') || gl.getExtension('OES_texture_float'));
  try { const a = gl.getContextAttributes(); out.antialias = a ? !!a.antialias : null; } catch (e) {}
  out.extensions = (gl.getSupportedExtensions() || []).length;
  return out;
})()`;

/** Ask the browser itself what its GPU process found (a Chromium-family browser answers; anything else gives null). */
async function browserReport(browser: Browser): Promise<GpuProbe['report']> {
  try {
    const cdp = await browser.newBrowserCDPSession();
    const info = (await cdp.send('SystemInfo.getInfo' as never)) as {
      gpu?: { devices?: Array<{ vendorString?: string; deviceString?: string }>; featureStatus?: Record<string, string> };
    };
    await cdp.detach().catch(() => {});
    const f = info.gpu?.featureStatus ?? {};
    return {
      devices: (info.gpu?.devices ?? []).map((d) => [d.vendorString, d.deviceString].filter(Boolean).join(' ').trim()).filter(Boolean),
      webgl: f.webgl ?? null,
      webgl2: f.webgl2 ?? null,
      compositing: f.gpu_compositing ?? null,
      rasterization: f.rasterization ?? null,
    };
  } catch {
    return null;
  }
}

/** Open the browser, read the WebGL renderer and the browser's own GPU report, close it. */
export async function probeGpu(o: { browser?: BrowserChoice; headless?: boolean } = {}): Promise<GpuProbe> {
  const headless = o.headless !== false;
  const { browser, channel } = await launchBrowser(o.browser ?? 'auto', headless);
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('about:blank');
    const p = (await page.evaluate(PROBE_SCRIPT)) as {
      webgl2: boolean;
      webgl1: boolean;
      renderer: string | null;
      vendor: string | null;
      maxTextureSize: number | null;
      maxVertexAttribs: number | null;
      maxDrawBuffers: number | null;
      floatTextures: boolean;
      antialias: boolean | null;
      extensions: number;
    };
    const report = await browserReport(browser);
    await context.close().catch(() => {});
    const a = p.renderer ? parseAngle(p.renderer) : null;
    return {
      browser: { channel, version: browser.version(), headless },
      webgl: { webgl2: p.webgl2, webgl1: p.webgl1 },
      renderer: p.renderer,
      vendor: p.vendor,
      device: a?.device ?? null,
      backend: a?.backend ?? null,
      kind: classifyRenderer(p.renderer, report?.webgl),
      report,
      limits: {
        maxTextureSize: p.maxTextureSize,
        maxVertexAttribs: p.maxVertexAttribs,
        maxDrawBuffers: p.maxDrawBuffers,
        floatTextures: p.floatTextures,
        antialias: p.antialias,
      },
      extensions: p.extensions,
    };
  } finally {
    await releaseBrowser(browser);
  }
}

/** What the person is told when there is no graphics card behind WebGL. Plain, with what to try. */
export function softwareWarning(): string[] {
  return [
    'WebGL is running in SOFTWARE (on the CPU), not on a graphics card.',
    'DEA still captures, rebuilds and scores sites this way, but scenes draw at a few frames a second here, a time-driven scene lands in another phase on each load, and sites that check for a GPU may show a simpler version.',
    'Frame rates and timings from this machine are not a speed measure of a site or of a kit; DEA prints none as one.',
    'To use a real GPU: update the graphics driver, make sure the browser has hardware acceleration on (Edge/Chrome: Settings → System → "Use graphics acceleration when available", then open edge://gpu or chrome://gpu and look for "Hardware accelerated"), and run with --headed.',
  ];
}

export interface Machine {
  os: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  memoryGb: number;
  node: string;
}

/** The machine, without anything personal: no host name, user name, paths or addresses. */
export function machineInfo(): Machine {
  const c = cpus();
  return {
    os: platform(),
    osRelease: release(),
    arch: arch(),
    cpuModel: (c[0]?.model ?? 'unknown').replace(/\s+/g, ' ').trim(),
    cpuCount: c.length,
    memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
  };
}

export interface DoctorCheck {
  id: string;
  title: string;
  status: 'ok' | 'limited' | 'no';
  note: string;
  /** what to do about it, when DEA knows (printed under the line) */
  fix?: string;
}

export interface DoctorReport {
  schema: 'dea.doctor/1';
  checks: DoctorCheck[];
  gpu: GpuProbe | null;
  machine: Machine;
  /** the lines to show when the GPU is software (empty otherwise) */
  warnings: string[];
}

/** DEA's own readiness: Node, the browser, WebGL (hardware or software), room on the disk. Starts a browser. */
export async function doctor(o: { browser?: BrowserChoice; headless?: boolean; home?: string; minNode?: number } = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const machine = machineInfo();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const want = o.minNode ?? 24;
  checks.push({
    id: 'node',
    title: 'Node.js',
    status: nodeMajor >= want ? 'ok' : 'limited',
    note: nodeMajor >= want ? `${process.version}` : `${process.version}; DEA asks for Node ${want} or newer and may misbehave on this one`,
  });
  let gpu: GpuProbe | null = null;
  try {
    gpu = await probeGpu({ browser: o.browser, headless: o.headless });
    checks.push({
      id: 'browser',
      title: 'browser',
      status: 'ok',
      note: `${gpu.browser.channel} ${gpu.browser.version}${gpu.browser.headless ? ' (headless)' : ' (window)'} starts`,
    });
    if (gpu.kind === 'none')
      checks.push({ id: 'webgl', title: 'WebGL', status: 'no', note: 'this browser gave no WebGL context: DEA cannot record or replay WebGL here' });
    else {
      const name = gpu.device ?? gpu.renderer ?? 'unknown';
      checks.push({
        id: 'webgl',
        title: 'WebGL',
        status: gpu.kind === 'hardware' ? 'ok' : 'limited',
        note: `${gpu.webgl.webgl2 ? 'WebGL 2' : 'WebGL 1'}; ${gpu.kind === 'hardware' ? 'hardware' : 'SOFTWARE'} renderer: ${name}${gpu.backend ? ` (${gpu.backend})` : ''}`,
      });
    }
  } catch (e) {
    const message = (e as Error).message;
    checks.push({
      id: 'browser',
      title: 'browser',
      status: 'no',
      note: message.split('\n').slice(0, 2).join(' ').slice(0, 300),
      fix: browserStartHint([message]),
    });
  }
  try {
    const s = await statfs(o.home ?? process.cwd());
    const gb = Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10;
    checks.push({
      id: 'disk',
      title: 'free disk space',
      status: gb >= 2 ? 'ok' : 'limited',
      note: `${gb} GB free${gb >= 2 ? '' : ' (a long extract keeps runs and captures: 2 GB or more is comfortable)'}`,
    });
  } catch {
    /* an unreadable disk is not a finding */
  }
  return { schema: 'dea.doctor/1', checks, gpu, machine, warnings: gpu?.kind === 'software' ? softwareWarning() : [] };
}

export function doctorMd(r: DoctorReport): string {
  const mark = (s: DoctorCheck['status']) => (s === 'ok' ? 'ok     ' : s === 'limited' ? 'limited' : 'NO     ');
  const out: string[] = ['DEA doctor', ''];
  for (const c of r.checks) {
    out.push(`  ${mark(c.status)} ${c.title}: ${c.note}`);
    if (c.fix) for (const line of c.fix.split('\n')) out.push(`          ${line}`);
  }
  const m = r.machine;
  out.push('', `  machine: ${m.os} ${m.osRelease} ${m.arch}, ${m.cpuCount} × ${m.cpuModel}, ${m.memoryGb} GB`);
  if (r.gpu?.report?.devices.length)
    out.push(
      `  the browser's GPU report: ${r.gpu.report.devices.join('; ')} (webgl: ${r.gpu.report.webgl ?? '?'}, compositing: ${r.gpu.report.compositing ?? '?'})`,
    );
  if (r.warnings.length) {
    out.push('', 'WARNING');
    for (const w of r.warnings) out.push(`  ${w}`);
  } else if (r.gpu?.kind === 'hardware') out.push('', '  A graphics card is in use. `dea bench` measures it and writes a small file you can share.');
  return `${out.join('\n')}\n`;
}

// ---- the bench --------------------------------------------------------------------------------------------------------

export interface BenchTimings {
  /** a full-window pixel shader, drawn and finished (readPixels) frame after frame: median and slowest 10% in ms */
  fillMedianMs: number;
  fillP90Ms: number;
  fillFrames: number;
  /** many small draws with a uniform change each: ms per 1000 draws */
  drawsMsPer1000: number;
  /** a 2048 × 2048 texture upload: median ms */
  uploadMs: number;
  /** the page's own animation-frame rate for two seconds (the display's refresh rate when the card is idle) */
  rafFps: number;
}

export interface BenchSite {
  url: string;
  /** frames per second of the page while idle and while scrolling a few screens; null when software (labelled) */
  idleFps: number | null;
  scrollFps: number | null;
}

/** Runs in the page: the synthetic scene. Resolves with timings; `budgetMs` caps each part. */
export const BENCH_SCRIPT = `(async (budgetMs) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720; document.body.appendChild(c);
  const gl = c.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' }) || c.getContext('webgl', { antialias: false });
  if (!gl) return null;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const v2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const vs = v2 ? '#version 300 es\\nin vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }' : 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
  const body = 'precision highp float; uniform float t; uniform vec2 r; ' + (v2 ? 'out vec4 o;' : '') +
    ' void main(){ vec2 u = gl_FragCoord.xy / r; float a = 0.; for (int i = 0; i < 48; i++) { a += sin(u.x * float(i) + t) * cos(u.y * float(i) - t) / float(i + 1); u = u.yx + vec2(a * .01, 0.); } ' +
    (v2 ? 'o' : 'gl_FragColor') + ' = vec4(.5 + .5 * sin(a * 6.), .5 + .5 * cos(a * 4.), u.x, 1.); }';
  const fs = (v2 ? '#version 300 es\\n' : '') + body;
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return { error: 'the benchmark shader did not link: ' + String(gl.getProgramInfoLog(pr)).slice(0, 200) };
  gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const ut = gl.getUniformLocation(pr, 't'); gl.uniform2f(gl.getUniformLocation(pr, 'r'), 1280, 720);
  const px = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  // a full-window shader
  for (let i = 0; i < 3; i++) { gl.uniform1f(ut, i); gl.drawArrays(gl.TRIANGLES, 0, 3); finish(); }
  const fill = []; const t0 = performance.now();
  while (fill.length < 120 && (fill.length < 3 || performance.now() - t0 < budgetMs)) { const a = performance.now(); gl.uniform1f(ut, fill.length * .1); gl.drawArrays(gl.TRIANGLES, 0, 3); finish(); fill.push(performance.now() - a); }
  // many small draws: a uniform change and a draw, a thousand times
  gl.viewport(0, 0, 64, 64);
  const dr = []; const t1 = performance.now();
  while (dr.length < 5 && (dr.length < 1 || performance.now() - t1 < budgetMs)) { const a = performance.now(); for (let i = 0; i < 1000; i++) { gl.uniform1f(ut, i); gl.drawArrays(gl.TRIANGLES, 0, 3); } finish(); dr.push(performance.now() - a); }
  gl.viewport(0, 0, 1280, 720);
  // a big texture upload
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); const data = new Uint8Array(2048 * 2048 * 4);
  const up = []; const t2 = performance.now();
  while (up.length < 5 && (up.length < 1 || performance.now() - t2 < budgetMs)) { const a = performance.now(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2048, 2048, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); finish(); up.push(performance.now() - a); }
  // the page's own animation-frame rate
  let frames = 0; const t3 = performance.now();
  await new Promise((res) => { const f = () => { frames++; if (performance.now() - t3 >= 2000) res(null); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const rafFps = frames / ((performance.now() - t3) / 1000);
  c.remove();
  return { fillMedianMs: median(fill), fillP90Ms: pct(fill, 0.9), fillFrames: fill.length, drawsMsPer1000: median(dr), uploadMs: median(up), rafFps };
})`;

/** Frames per second of the page in front of us for `ms` (animation frames counted; the page keeps running). */
const FPS_SCRIPT = (ms: number) =>
  `new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; const dt = performance.now() - t0; if (dt >= ${ms}) res(n / (dt / 1000)); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`;

export interface BenchResult {
  schema: 'dea.bench/1';
  /** facts that do not change run to run on one machine */
  result: {
    gpu: { renderer: string | null; device: string | null; backend: string | null; kind: GpuKind; webgl2: boolean; browser: string; headless: boolean };
    machine: Machine;
    /** why timings are absent, or null when they are there */
    timingsNote: string | null;
    /** the synthetic scene drew and finished frames (true even in software) */
    drew: boolean;
  };
  /** measured numbers (they change from run to run by nature): only a hardware GPU gets them */
  meta: {
    at: string;
    dea: string;
    timings: BenchTimings | null;
    site: BenchSite | null;
    label: string;
  };
}

export const SOFTWARE_LABEL = 'software render, not a speed measure';

export function benchLabel(kind: GpuKind): string {
  return kind === 'hardware' ? 'hardware GPU: numbers are from this machine and this run' : kind === 'software' ? SOFTWARE_LABEL : 'no WebGL';
}

/**
 * The bench: the GPU probe, then a small synthetic scene (a full-window shader, many small draws, a big texture upload, the
 * animation-frame rate), then (with a url) the frame rate of that public page idle and while scrolling. Timings are kept only
 * when a hardware GPU is in use; software rendering is labelled and its numbers are dropped.
 */
export async function bench(
  o: { browser?: BrowserChoice; headless?: boolean; url?: string; quick?: boolean; version?: string; viewport?: { width: number; height: number } } = {},
): Promise<BenchResult> {
  const headless = o.headless !== false;
  const probe = await probeGpu({ browser: o.browser, headless });
  let timings: BenchTimings | null = null;
  let site: BenchSite | null = null;
  let drew = false;
  if (probe.kind !== 'none') {
    const { browser } = await launchBrowser(o.browser ?? 'auto', headless);
    try {
      const context = await browser.newContext({ viewport: o.viewport ?? { width: 1280, height: 720 } });
      const page = await context.newPage();
      await page.goto('about:blank');
      const budget = o.quick || probe.kind === 'software' ? 800 : 2500;
      const t = (await page.evaluate(`(${BENCH_SCRIPT})(${budget})`)) as (BenchTimings & { error?: string }) | null;
      drew = Boolean(t && !t.error && t.fillFrames > 0);
      if (drew && t && probe.kind === 'hardware') timings = round(t);
      if (o.url && probe.kind === 'hardware') {
        await page.goto(o.url, { waitUntil: 'load', timeout: 60_000 }).catch(() => null);
        await page.waitForTimeout(4000);
        const idle = (await page.evaluate(FPS_SCRIPT(3000)).catch(() => null)) as number | null;
        const scrollTask = (async () => {
          for (let i = 0; i < 12; i++) {
            await page.mouse.wheel(0, 250).catch(() => {});
            await page.waitForTimeout(250);
          }
        })();
        const sc = (await page.evaluate(FPS_SCRIPT(3000)).catch(() => null)) as number | null;
        await scrollTask;
        site = { url: o.url, idleFps: idle == null ? null : Math.round(idle * 10) / 10, scrollFps: sc == null ? null : Math.round(sc * 10) / 10 };
      }
      await context.close().catch(() => {});
    } finally {
      await releaseBrowser(browser);
    }
  }
  return {
    schema: 'dea.bench/1',
    result: {
      gpu: {
        renderer: probe.renderer,
        device: probe.device,
        backend: probe.backend,
        kind: probe.kind,
        webgl2: probe.webgl.webgl2,
        browser: `${probe.browser.channel} ${probe.browser.version}`,
        headless,
      },
      machine: machineInfo(),
      timingsNote: timings ? null : probe.kind === 'hardware' ? 'the synthetic scene did not finish' : benchLabel(probe.kind),
      drew,
    },
    meta: { at: new Date().toISOString(), dea: o.version ?? 'unknown', timings, site, label: benchLabel(probe.kind) },
  };
}

const round = (t: BenchTimings): BenchTimings => ({
  fillMedianMs: r2(t.fillMedianMs),
  fillP90Ms: r2(t.fillP90Ms),
  fillFrames: t.fillFrames,
  drawsMsPer1000: r2(t.drawsMsPer1000),
  uploadMs: r2(t.uploadMs),
  rafFps: Math.round(t.rafFps * 10) / 10,
});
const r2 = (x: number) => Math.round(x * 100) / 100;

export function benchMd(r: BenchResult): string {
  const g = r.result.gpu;
  const m = r.result.machine;
  const out: string[] = [
    '# DEA bench',
    '',
    `- date: ${r.meta.at}`,
    `- DEA: ${r.meta.dea}`,
    `- GPU: ${g.device ?? g.renderer ?? 'none'}${g.backend ? ` (${g.backend})` : ''}: **${g.kind}**`,
    `- browser: ${g.browser}${g.headless ? ' (headless)' : ' (window)'}`,
    `- machine: ${m.os} ${m.osRelease} ${m.arch}, ${m.cpuCount} × ${m.cpuModel}, ${m.memoryGb} GB, Node ${m.node}`,
    '',
  ];
  if (r.meta.timings) {
    const t = r.meta.timings;
    out.push(
      'Numbers from this machine (verified: measured now, by this run; they change a little every run):',
      '',
      '| test | result |',
      '|---|---|',
      `| full-window shader, drawn and finished (1280 × 720) | median ${t.fillMedianMs} ms, slowest 10% ${t.fillP90Ms} ms (${t.fillFrames} frames) |`,
      `| 1000 small draws with a uniform change each | ${t.drawsMsPer1000} ms |`,
      `| 2048 × 2048 texture upload | ${t.uploadMs} ms |`,
      `| the page's animation-frame rate | ${t.rafFps} fps (the display's refresh rate when the card is idle) |`,
      '',
    );
    if (r.meta.site) out.push(`Page ${r.meta.site.url}: ${r.meta.site.idleFps ?? 'n/a'} fps idle, ${r.meta.site.scrollFps ?? 'n/a'} fps while scrolled.`, '');
  } else {
    out.push(
      `No speed numbers: ${r.result.timingsNote ?? r.meta.label}.`,
      r.result.drew ? 'The synthetic scene drew and finished frames, so WebGL works here.' : 'The synthetic scene did not draw.',
      '',
    );
    if (g.kind === 'software') out.push(...softwareWarning(), '');
  }
  out.push(
    'This file holds the GPU name, browser version, OS name and architecture, CPU model and count, memory size and the numbers above. It holds no host name, user name, path, address or login.',
    '',
  );
  return out.join('\n');
}
