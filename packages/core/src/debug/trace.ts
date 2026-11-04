// Live debug where static reading is not enough: trace the WebGL calls a page really makes (shader compiles, every
// uniform it sets with the values over time, texture uploads), each with the call stack of the code that made it, and
// pause the page on CDP breakpoints (a script line, or a WebGL call such as texImage2D or a named uniform) to read the
// caller's local variables. From the value series DEA infers what drives each uniform: a clock, the scroll, the
// pointer, the viewport, or an animation of its own.

import type { SourceMapConsumer } from 'source-map-js';
import { originOf } from '../assets/chain.ts';
import { programName } from '../assets/roles.ts';
import type { CdpFrame } from '../code/initiator.ts';
import { THREE_BUILTIN_UNIFORMS } from '../design/shaders.ts';
import { type Gap, renderGaps } from '../gaps.ts';
import { collect, type InspectOptions, type RunDoc } from '../see/inspect.ts';

export interface TraceOptions extends InspectOptions {
  /** how long to watch the page after it loads, in ms (default 12 000) */
  ms?: number;
  /**
   * Breakpoints. A WebGL call ("texImage2D", "shaderSource", "linkProgram", "drawElements"), a uniform being set
   * ("uniform:uTime"), or a script position ("url:chunk-abc.js:120" or "url:chunk-abc.js:120:33", 1-based line).
   */
  breakOn?: string[];
  /** pauses recorded per breakpoint (default 3) */
  maxHits?: number;
}

export type Driver =
  | { kind: 'constant' }
  | { kind: 'clock'; perSecond: number; r2: number }
  | { kind: 'scroll'; scale: number; offset: number; r: number }
  | { kind: 'pointer'; axis: 'x' | 'y'; scale: number; offset: number; r: number }
  | { kind: 'viewport'; of: 'width' | 'height' | 'aspect' | 'size' }
  | { kind: 'animated'; min: number; max: number }
  | { kind: 'unknown' };

export interface UniformTrace {
  program: string;
  name: string;
  /** uniform1f, uniform3fv, uniformMatrix4fv ... */
  fn: string;
  calls: number;
  first: number[];
  last: number[];
  min: number;
  max: number;
  /** [ms since the trace started, first component] */
  series: Array<[number, number]>;
  driver: Driver;
  /** the code that set it, first time (mapped through source maps when the site publishes them) */
  setBy: string | null;
  stack: string[];
}

export interface TraceDoc {
  url: string;
  durationMs: number;
  programs: Array<{ id: string; name: string; compiledBy: string | null }>;
  uniforms: UniformTrace[];
  uploads: Array<{ fn: string; texture: string; width: number | null; height: number | null; source: string; by: string | null }>;
  breakpoints: Array<{
    on: string;
    hits: Array<{ frames: string[]; locals: Record<string, string> }>;
    error?: string;
  }>;
  env: Array<[number, number, number, number, number, number]>;
}

/** Runs in the page before any site script: wraps WebGL so every compile, uniform and upload is seen with its caller. */
export const TRACE_INIT_SCRIPT = String.raw`(() => {
  if (window.__DEA_TRACE__) return;
  const T = (window.__DEA_TRACE__ = { t0: performance.now(), programs: {}, uniforms: {}, uploads: [], env: [], breaks: window.__DEA_BREAKS__ || [], hits: {} });
  const now = () => Math.round(performance.now() - T.t0);
  const stackNow = () => { const L = Error.stackTraceLimit; Error.stackTraceLimit = 40; const s = String(new Error().stack || ''); Error.stackTraceLimit = L; return s.split('\n').slice(3, 40).map((x) => x.trim()).filter((x) => x.startsWith('at ')); };
  const brk = (tag) => {
    if (!T.breaks.includes(tag)) return;
    T.hits[tag] = (T.hits[tag] || 0) + 1;
    if (T.hits[tag] > (window.__DEA_MAX_HITS__ || 3)) return;
    debugger; // DEA breakpoint: the caller's frame is one up
  };
  let pN = 0;
  const pid = new WeakMap(), loc = new WeakMap(), src = new WeakMap(), texN = { n: 0 }, tid = new WeakMap(), bound = new WeakMap();
  const P = (gl, p) => { let id = pid.get(p); if (!id) { id = 'p' + ++pN; pid.set(p, id); T.programs[id] = { id, shaders: [], stack: null }; } return id; };
  const wrap = (proto) => {
    if (!proto) return;
    const f = (name, after) => {
      const orig = proto[name];
      if (typeof orig !== 'function') return;
      proto[name] = function () { const r = orig.apply(this, arguments); try { after.call(this, arguments, r); } catch (e) {} return r; };
    };
    f('shaderSource', function (a) { src.set(a[0], String(a[1]).slice(0, 60000)); brk('shaderSource'); });
    f('attachShader', function (a) { const id = P(this, a[0]); const s = src.get(a[1]); if (s) T.programs[id].shaders.push(s); });
    f('linkProgram', function (a) { const id = P(this, a[0]); if (!T.programs[id].stack) T.programs[id].stack = stackNow(); brk('linkProgram'); });
    f('getUniformLocation', function (a, r) { if (r && typeof r === 'object') loc.set(r, { p: P(this, a[0]), n: String(a[1]).replace(/\[0\]$/, '') }); });
    for (const n of ['uniform1f','uniform2f','uniform3f','uniform4f','uniform1i','uniform2i','uniform3i','uniform4i','uniform1ui','uniform1fv','uniform2fv','uniform3fv','uniform4fv','uniform1iv','uniformMatrix3fv','uniformMatrix4fv']) {
      f(n, function (a) {
        const l = a[0] && loc.get(a[0]);
        if (!l) return;
        const key = l.p + '|' + l.n;
        let v;
        if (/Matrix/.test(n)) v = Array.prototype.slice.call(a[2], 0, 16);
        else if (/v$/.test(n)) v = Array.prototype.slice.call(a[1], 0, 16);
        else v = Array.prototype.slice.call(a, 1);
        let u = T.uniforms[key];
        if (!u) { u = T.uniforms[key] = { p: l.p, n: l.n, fn: n, calls: 0, first: v, last: v, min: Infinity, max: -Infinity, series: [], st: stackNow(), lt: -1e9 }; }
        u.calls++; u.last = v;
        const x = +v[0];
        if (x < u.min) u.min = x; if (x > u.max) u.max = x;
        const t = now();
        if (t - u.lt >= 150 && u.series.length < 160) { u.series.push([t, x]); u.lt = t; }
        brk('uniform:' + l.n);
      });
    }
    f('bindTexture', function (a) { bound.set(this, a[1]); });
    const up = function (name) { return function (a) {
      if (a[1] !== 0 || T.uploads.length >= 300) return;
      const tex = bound.get(this); let id = tex && tid.get(tex); if (tex && !id) { id = 't' + ++texN.n; tid.set(tex, id); }
      const s = a[a.length - 1];
      let source = 'pixels', w = null, h = null;
      if (s && typeof s === 'object' && !ArrayBuffer.isView(s)) {
        source = (s.constructor && s.constructor.name) || 'object';
        if (s.currentSrc || s.src) source += ' ' + String(s.currentSrc || s.src).slice(0, 300);
        w = s.naturalWidth || s.videoWidth || s.width || null; h = s.naturalHeight || s.videoHeight || s.height || null;
      } else if (a.length >= 9) { w = a[3]; h = a[4]; }
      if (T.uploads.filter((x) => x.texture === id).length >= 2) return;
      T.uploads.push({ fn: name, texture: id || '?', width: w, height: h, source, stack: stackNow() });
      brk(name);
    }; };
    f('texImage2D', up('texImage2D'));
    f('texSubImage2D', up('texSubImage2D'));
    f('drawElements', function () { brk('drawElements'); });
    f('drawArrays', function () { brk('drawArrays'); });
  };
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  let px = -1, py = -1;
  addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; }, { passive: true, capture: true });
  addEventListener('mousemove', (e) => { px = e.clientX; py = e.clientY; }, { passive: true, capture: true });
  setInterval(() => { if (T.env.length < 400) T.env.push([now(), scrollY, px, py, innerWidth, innerHeight]); }, 150);
})();`;

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

/** Least squares y = a·x + b, with Pearson r. */
export function fit(xs: number[], ys: number[]): { a: number; b: number; r: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!sxx || !syy) return { a: 0, b: my, r: 0 };
  const a = sxy / sxx;
  return { a, b: my - a * mx, r: sxy / Math.sqrt(sxx * syy) };
}

/** The env sample nearest in time to t: [t, scrollY, pointerX, pointerY, width, height]. */
const envAt = (env: TraceDoc['env'], t: number) => {
  let best = env[0];
  for (const e of env) if (Math.abs(e[0] - t) < Math.abs(best[0] - t)) best = e;
  return best;
};

/**
 * What drives a uniform, from its values over time and what the page was doing at the same moments. Inferred: a
 * correlation, not a reading of the code (the "set by" line is where to confirm it).
 */
export function classifyDriver(u: Pick<UniformTrace, 'series' | 'last' | 'min' | 'max'>, env: TraceDoc['env']): Driver {
  const s = u.series.filter(([, v]) => Number.isFinite(v));
  if (!s.length) return { kind: 'unknown' };
  const vs = s.map(([, v]) => v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo;
  const e0 = env.length ? env[env.length - 1] : null;
  if (e0 && u.last.length >= 2 && Math.abs(u.last[0] - e0[4]) < 2 && Math.abs(u.last[1] - e0[5]) < 2) return { kind: 'viewport', of: 'size' };
  if (span <= Math.max(1e-6, Math.abs(hi) * 1e-6)) {
    if (e0 && Math.abs(hi - e0[4]) < 1 && hi > 50) return { kind: 'viewport', of: 'width' };
    if (e0 && Math.abs(hi - e0[5]) < 1 && hi > 50) return { kind: 'viewport', of: 'height' };
    if (e0 && Math.abs(hi - e0[4] / e0[5]) < 0.01) return { kind: 'viewport', of: 'aspect' };
    return { kind: 'constant' };
  }
  if (s.length >= 4) {
    const ts = s.map(([t]) => t / 1000);
    const monotonic = vs.every((v, i) => i === 0 || v >= vs[i - 1] - 1e-9);
    // every explanation that fits, then the best one; on a tie the page input wins over the clock (a clock does not
    // stop when the scroll or the pointer stops, so an input that fits as well is the stronger reading)
    const cands: Array<{ d: Driver; r: number }> = [];
    const c = fit(ts, vs);
    if (monotonic && c.r * c.r > 0.97 && c.a > 0) cands.push({ d: { kind: 'clock', perSecond: round(c.a), r2: round(c.r * c.r) }, r: Math.abs(c.r) - 1e-6 });
    if (env.length >= 4) {
      const at = s.map(([t]) => envAt(env, t));
      const scroll = at.map((e) => e[1]);
      if (Math.max(...scroll) - Math.min(...scroll) > 50) {
        const f = fit(scroll, vs);
        if (Math.abs(f.r) > 0.9) cands.push({ d: { kind: 'scroll', scale: round(f.a), offset: round(f.b), r: round(f.r) }, r: Math.abs(f.r) });
      }
      for (const [axis, i] of [
        ['x', 2],
        ['y', 3],
      ] as const) {
        const p = at.map((e) => e[i]);
        if (p.some((x) => x < 0) || Math.max(...p) - Math.min(...p) < 20) continue;
        const f = fit(p, vs);
        if (Math.abs(f.r) > 0.85) cands.push({ d: { kind: 'pointer', axis, scale: round(f.a), offset: round(f.b), r: round(f.r) }, r: Math.abs(f.r) });
      }
    }
    if (cands.length) return cands.sort((a, b) => b.r - a.r)[0].d;
  }
  return { kind: 'animated', min: round(lo), max: round(hi) };
}

const round = (x: number) => Math.round(x * 10000) / 10000;

export function driverText(d: Driver): string {
  switch (d.kind) {
    case 'constant':
      return 'constant';
    case 'clock':
      return `a clock: +${d.perSecond} per second${Math.abs(d.perSecond - 1) < 0.02 ? ' (seconds)' : Math.abs(d.perSecond - 1000) < 20 ? ' (milliseconds)' : ' (wall time here)'}`;
    case 'scroll':
      return `the scroll: ${d.scale} × scrollY + ${d.offset} (r ${d.r})`;
    case 'pointer':
      return `the pointer ${d.axis}: ${d.scale} × ${d.axis === 'x' ? 'clientX' : 'clientY'} + ${d.offset} (r ${d.r})`;
    case 'viewport':
      return `the viewport ${d.of}`;
    case 'animated':
      return `animated on its own between ${d.min} and ${d.max}`;
    default:
      return 'set once, not enough samples';
  }
}

const frameOf = (l: string): CdpFrame | null => {
  const m = /at (?:(.+?) \()?((?:https?|webpack-internal):[^)\s]+):(\d+):(\d+)\)?/.exec(l);
  return m ? { functionName: m[1] ?? '', url: m[2], lineNumber: Number(m[3]) - 1, columnNumber: Number(m[4]) - 1 } : null;
};

/** Trace a page's WebGL calls (with stacks) and stop on breakpoints. Writes trace.json and trace.md. */
export async function traceWebGL(url: string, opts: TraceOptions = {}): Promise<{ runId: string; dir: string; doc: TraceDoc; md: string; summary: string }> {
  const ms = opts.ms ?? 12_000;
  const breaks = (opts.breakOn ?? []).map((b) => b.trim()).filter(Boolean);
  const glBreaks = breaks.filter((b) => !b.startsWith('url:'));
  const urlBreaks = breaks.filter((b) => b.startsWith('url:'));
  const hits = new Map<string, TraceDoc['breakpoints'][number]>(breaks.map((b) => [b, { on: b, hits: [] }]));
  let raw: any = null;
  let pauses = 0;
  const bpIds = new Map<string, string>();
  const scripts = new Map<string, string>();
  const urlOf = (f: any) => String(f?.url || scripts.get(f?.location?.scriptId) || '');
  const result = await collect(
    url,
    'trace',
    {
      ...opts,
      tree: false,
      beforeGoto: async (page, cdp) => {
        await page.addInitScript({ content: `window.__DEA_BREAKS__ = ${JSON.stringify(glBreaks)}; window.__DEA_MAX_HITS__ = ${opts.maxHits ?? 3};` });
        await page.addInitScript({ content: TRACE_INIT_SCRIPT });
        cdp.on('Debugger.scriptParsed', (e: { scriptId: string; url: string }) => {
          if (scripts.size < 5000) scripts.set(e.scriptId, e.url);
        });
        await cdp.send('Debugger.enable').catch(() => {});
        await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: 16 }).catch(() => {});
        for (const b of urlBreaks) {
          const m = /^url:(.+?):(\d+)(?::(\d+))?$/.exec(b);
          if (!m) {
            (hits.get(b) as { error?: string }).error = 'write it as url:<part of the script URL>:<line>[:<column>]';
            continue;
          }
          const esc = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const r = (await cdp
            .send('Debugger.setBreakpointByUrl', { urlRegex: esc, lineNumber: Number(m[2]) - 1, columnNumber: m[3] ? Number(m[3]) - 1 : undefined })
            .catch((e: Error) => ({ error: e.message }))) as { breakpointId?: string; error?: string };
          if (r.breakpointId) bpIds.set(r.breakpointId, b);
          else (hits.get(b) as { error?: string }).error = r.error ?? 'Chrome refused the breakpoint';
        }
        cdp.on('Debugger.paused', async (e: any) => {
          pauses++;
          try {
            if (pauses > 200) {
              await cdp.send('Debugger.setSkipAllPauses', { skip: true }).catch(() => {});
              return;
            }
            const frames: any[] = e.callFrames ?? [];
            // which breakpoint: a URL one by id, else DEA's own debugger statement inside the WebGL wrapper
            let on = (e.hitBreakpoints ?? []).map((id: string) => bpIds.get(id)).find(Boolean) as string | undefined;
            let caller = 0;
            if (!on && frames[0] && glBreaks.length) {
              const tag = await cdp
                .send('Debugger.evaluateOnCallFrame', {
                  callFrameId: frames[0].callFrameId,
                  expression: 'typeof tag === "string" ? tag : ""',
                  returnByValue: true,
                })
                .then((r: any) => String(r.result?.value ?? ''))
                .catch(() => '');
              on = glBreaks.find((b) => b === tag);
              caller = frames.findIndex((f) => /^https?:/.test(urlOf(f)));
            }
            const slot = on ? hits.get(on) : undefined;
            if (!slot || slot.hits.length >= (opts.maxHits ?? 3)) return;
            const f = frames[Math.max(0, caller)];
            const locals: Record<string, string> = {};
            for (const sc of (f?.scopeChain ?? []).filter((s: any) => s.type === 'local' || s.type === 'closure').slice(0, 2)) {
              const props = (await cdp.send('Runtime.getProperties', { objectId: sc.object.objectId, ownProperties: true }).catch(() => ({ result: [] }))) as {
                result: any[];
              };
              for (const p of props.result.slice(0, 25)) {
                const v = p.value;
                if (!v || p.name in locals) continue;
                locals[p.name] = String(v.type === 'object' ? (v.description ?? v.className ?? 'object') : (v.value ?? v.description ?? v.type)).slice(0, 120);
              }
            }
            slot.hits.push({
              frames: frames
                .slice(Math.max(0, caller), Math.max(0, caller) + 8)
                .map(
                  (x: any) =>
                    `${urlOf(x).split('?')[0].split('/').pop() || '(inline)'}:${x.location.lineNumber + 1}:${x.location.columnNumber + 1}${x.functionName ? ` (${x.functionName})` : ''}`,
                ),
              locals,
            });
          } finally {
            await cdp.send('Debugger.resume').catch(() => {});
          }
        });
        if (opts.beforeGoto) await opts.beforeGoto(page, cdp);
      },
    },
    async (session) => {
      const { page } = session;
      const say = (s: string) => opts.onProgress?.(s);
      say(`tracing WebGL calls for ${Math.round(ms / 1000)} s while DEA scrolls, moves the pointer and resizes`);
      const vp = page.viewportSize() ?? { width: 1440, height: 900 };
      const t0 = Date.now();
      let i = 0;
      while (Date.now() - t0 < ms) {
        const phase = (Date.now() - t0) / ms;
        if (phase < 0.35) await page.waitForTimeout(400);
        else if (phase < 0.6) {
          await page.mouse.move(vp.width * (0.2 + 0.6 * ((i % 12) / 11)), vp.height * (0.3 + 0.4 * ((i % 7) / 6))).catch(() => {});
          await page.waitForTimeout(150);
        } else if (phase < 0.85) {
          await page.mouse.wheel(0, 240).catch(() => {});
          await page.evaluate('window.scrollBy(0, 240)').catch(() => {});
          await page.waitForTimeout(250);
        } else {
          await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
          await page.waitForTimeout(400);
        }
        i++;
      }
      raw = await page.evaluate('window.__DEA_TRACE__ ? JSON.parse(JSON.stringify(window.__DEA_TRACE__)) : null').catch(() => null);
      return undefined;
    },
  );

  // map stacks through source maps
  const mapCache = new Map<string, SourceMapConsumer | null>();
  const texts = new Map<string, string>();
  const fetchText = async (u: string) => {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const t = await r.text();
      return t.length > 15_000_000 ? null : t;
    } catch {
      return null;
    }
  };
  const where = async (stack: string[] | null | undefined) => {
    const frames = (stack ?? []).map(frameOf).filter((f): f is CdpFrame => Boolean(f));
    if (!frames.length) return null;
    const o = await originOf(frames, fetchText, mapCache, texts).catch(() => null);
    return o ? `${o.where}${o.via ? ` via ${o.via}` : ''}` : null;
  };
  const env = (raw?.env ?? []) as TraceDoc['env'];
  const progs = new Map<string, { id: string; name: string; compiledBy: string | null }>();
  for (const p of Object.values((raw?.programs ?? {}) as Record<string, { id: string; shaders: string[]; stack: string[] | null }>)) {
    progs.set(p.id, { id: p.id, name: programName(p.shaders, `program ${p.id.slice(1)}`), compiledBy: await where(p.stack) });
  }
  const uniforms: UniformTrace[] = [];
  const setByCache = new Map<string, string | null>();
  for (const u of Object.values((raw?.uniforms ?? {}) as Record<string, any>)) {
    const sk = (u.st ?? []).join('|');
    if (!setByCache.has(sk)) setByCache.set(sk, await where(u.st));
    const t: UniformTrace = {
      program: progs.get(u.p)?.name ?? u.p,
      name: u.n,
      fn: u.fn,
      calls: u.calls,
      first: (u.first ?? []).map(Number),
      last: (u.last ?? []).map(Number),
      min: Number.isFinite(u.min) ? u.min : 0,
      max: Number.isFinite(u.max) ? u.max : 0,
      series: u.series ?? [],
      driver: { kind: 'unknown' },
      setBy: setByCache.get(sk) ?? null,
      stack: (u.st ?? []).slice(0, 8),
    };
    t.driver = /Matrix/.test(t.fn)
      ? t.min === t.max
        ? { kind: 'constant' }
        : { kind: 'animated', min: round(t.min), max: round(t.max) }
      : classifyDriver(t, env);
    uniforms.push(t);
  }
  // "set by": the WebGL upload happens inside the engine's render call; the line that changes the value is earlier in the
  // same frame. When the site's own code assigns `<name>.value` in a script DEA already read, name that line first.
  const assignedAt = new Map<string, string | null>();
  const assigns = (name: string): string | null => {
    if (assignedAt.has(name)) return assignedAt.get(name) ?? null;
    let found: string | null = null;
    const re = new RegExp(`(?:\\.|\\b)${name.replace(/[^\w$]/g, '')}\\.value\\s*(?:[-+*/]?=)(?!=)`);
    for (const [u, txt] of texts) {
      const m = re.exec(txt);
      if (!m) continue;
      const before = txt.slice(0, m.index);
      const line = before.split('\n').length;
      const col = m.index - before.lastIndexOf('\n') - 1;
      const sm = mapCache.get(u);
      const o = sm ? sm.originalPositionFor({ line, column: col }) : null;
      found = o?.source ? `${o.source.split('/').pop()}:${o.line}` : `${u.split('?')[0].split('/').pop() ?? u}:${line}:${col + 1}`;
      break;
    }
    assignedAt.set(name, found);
    return found;
  };
  for (const t of uniforms) {
    const a = /^[\w$]+$/.test(t.name) ? assigns(t.name) : null;
    if (a) t.setBy = `${a} (assigns .value)${t.setBy ? `; uploaded by ${t.setBy}` : ''}`;
  }

  const uploads: TraceDoc['uploads'] = [];
  for (const x of (raw?.uploads ?? []) as any[])
    uploads.push({ fn: x.fn, texture: x.texture, width: x.width, height: x.height, source: x.source, by: await where(x.stack) });
  const doc: TraceDoc = {
    url,
    durationMs: ms,
    programs: [...progs.values()],
    uniforms,
    uploads,
    breakpoints: [...hits.values()],
    env,
  };
  const md = renderTraceMd(doc, result.run);
  const w = result.writer;
  await w.json('trace.json', doc, 'trace');
  await w.text('trace.md', md, 'traceMd');
  const moving = uniforms.filter((u) => !['constant', 'unknown'].includes(u.driver.kind) && !THREE_BUILTIN_UNIFORMS.has(u.name));
  const summary = [
    `${result.run.page.title || url}`,
    raw
      ? `WebGL trace: ${progs.size} programs compiled, ${uniforms.length} uniforms set (${moving.length} changing), ${uploads.length} texture uploads`
      : 'No WebGL context was created while DEA watched.',
    ...moving.slice(0, 8).map((u) => `  ${u.name} (${u.program}) ← ${driverText(u.driver)}${u.setBy ? `; set by ${u.setBy}` : ''}`),
    ...doc.breakpoints.map((b) => `  break ${b.on}: ${b.error ? b.error : `${b.hits.length} hit(s)${b.hits[0] ? `, first at ${b.hits[0].frames[0]}` : ''}`}`),
  ].join('\n');
  return { runId: result.runId, dir: result.dir, doc, md, summary };
}

export function traceGaps(doc: TraceDoc, site: string): Gap[] {
  const gaps: Gap[] = [];
  if (!doc.uniforms.length && !doc.programs.length)
    gaps.push({
      area: 'assets',
      topic: 'No WebGL calls were seen',
      known: ['✔ DEA wrapped WebGL before any page script ran.'],
      missing: 'Either the page draws with WebGPU or 2D canvas, creates its context in a worker (OffscreenCanvas), or waits for a click before it starts.',
      next: [
        { why: 'see which canvases and contexts exist', command: `dea assets ${site}`, probe: 'assets' },
        { why: 'trace for longer, in a visible browser you can click in', command: `dea trace ${site} --ms 30000 --headed` },
      ],
    });
  const unknown = doc.uniforms.filter((u) => u.driver.kind === 'animated' && !THREE_BUILTIN_UNIFORMS.has(u.name)).slice(0, 6);
  if (unknown.length)
    gaps.push({
      area: 'motion',
      topic: `What drives ${unknown.map((u) => u.name).join(', ')}`,
      known: unknown.map((u) => `✔ ${u.name} moved between ${round(u.min)} and ${round(u.max)}${u.setBy ? `, set by ${u.setBy}` : ''}`),
      missing: 'It changed, but not with the clock, the scroll or the pointer: likely a tween (GSAP, a spring) or an internal state.',
      approximation: { text: 'Animate it between the observed values with a tween until the code is read.' },
      next: unknown.slice(0, 2).map((u) => ({
        why: `pause where ${u.name} is set and read the caller's variables`,
        command: `dea trace ${site} --break uniform:${u.name}`,
      })),
    });
  return gaps;
}

export function renderTraceMd(doc: TraceDoc, run: RunDoc): string {
  const L: string[] = [
    `# Live WebGL trace: ${run.page.title || doc.url}`,
    '',
    `DEA wrapped WebGL before the page's own scripts ran and watched ${Math.round(doc.durationMs / 1000)} s while it waited, moved the pointer, scrolled and scrolled back.`,
    '',
    '✔ Verified = a call DEA saw, with the stack of the code that made it. ≈ Inferred = what drives a uniform, read from how its values moved against the clock, the scroll and the pointer. Clock rates are wall time on the machine that ran the trace: a clock the site advances per frame runs faster on a GPU.',
    '',
  ];
  const byProg = new Map<string, UniformTrace[]>();
  const own = doc.uniforms.filter((u) => !THREE_BUILTIN_UNIFORMS.has(u.name));
  for (const u of own) byProg.set(u.program, [...(byProg.get(u.program) ?? []), u]);
  L.push(
    `## Uniforms, by program`,
    '',
    `${own.length} of the site's own uniforms (${doc.uniforms.length - own.length} three.js built-ins such as matrices left out). "Set by" is the code on the stack when WebGL received the value: on three.js sites that is the render call of the frame loop; the line that changes \`.value\` runs earlier in the same frame.`,
    '',
  );
  for (const [p, us] of byProg) {
    const prog = doc.programs.find((x) => x.name === p);
    L.push(`### ${p}`, '', prog?.compiledBy ? `✔ Compiled by \`${prog.compiledBy}\`` : '', '');
    L.push('| uniform | last value | range | driver (≈) | calls | set by (✔) |', '|---|---|---|---|---|---|');
    for (const u of us.sort((a, b) => b.calls - a.calls).slice(0, 40))
      L.push(
        `| ${u.name} | ${u.last
          .slice(0, 4)
          .map((x) => round(x))
          .join(
            ', ',
          )}${u.last.length > 4 ? ' …' : ''} | ${round(u.min)} … ${round(u.max)} | ${driverText(u.driver)} | ${u.calls} | ${u.setBy ? `\`${u.setBy}\`` : '–'} |`,
      );
    L.push('');
  }
  if (doc.uploads.length) {
    L.push(`## Texture uploads (${doc.uploads.length})`, '', '| texture | call | size | source | by (✔) |', '|---|---|---|---|---|');
    for (const x of doc.uploads.slice(0, 60))
      L.push(`| ${x.texture} | ${x.fn} | ${x.width ?? '?'}×${x.height ?? '?'} | ${x.source.slice(0, 80)} | ${x.by ? `\`${x.by}\`` : '–'} |`);
    L.push('');
  }
  if (doc.breakpoints.length) {
    L.push('## Breakpoints', '');
    for (const b of doc.breakpoints) {
      L.push(`### ${b.on}`, '');
      if (b.error) L.push(`Not set: ${b.error}`, '');
      else if (!b.hits.length) L.push('Never reached while DEA watched.', '');
      b.hits.forEach((h, i) => {
        L.push(`Hit ${i + 1}:`, '', ...h.frames.map((f) => `- ${f}`), '');
        const vars = Object.entries(h.locals);
        if (vars.length) L.push('Local variables of the caller:', '', ...vars.map(([k, v]) => `- \`${k}\` = ${v}`), '');
      });
    }
  }
  L.push(renderGaps(traceGaps(doc, doc.url)));
  return `${L.join('\n')}\n`;
}
