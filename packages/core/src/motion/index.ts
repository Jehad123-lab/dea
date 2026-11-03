import { CODE_INIT_SCRIPT } from '../code/hooks.ts';
import { type Gap, renderGaps } from '../gaps.ts';
import { collect, type InspectOptions, type InspectResult, type RunDoc } from '../see/inspect.ts';
import type { Fact } from '../types.ts';
import { describeFit, easeFn, easeNames, type Fit, fitSeries, gsapFor, nameEase, unwrapDegrees } from './fit.ts';
import { MOTION_INIT_SCRIPT } from './hooks.ts';
import { PICK_ELEMENTS, READ_CSS, READ_GSAP, READ_OTHERS } from './read.ts';

export interface GsapNode {
  type: 'timeline' | 'tween' | 'call';
  easeSamples?: number[];
  keyframes?: unknown;
  start: number;
  duration: number;
  mode?: 'to' | 'from' | 'fromTo';
  ease?: string;
  repeat?: number;
  yoyo?: boolean;
  delay?: number;
  stagger?: unknown;
  targets?: string[];
  targetCount?: number;
  to?: Record<string, unknown>;
  from?: Record<string, unknown>;
  labels?: Record<string, number>;
  scrollTrigger?: boolean;
  progress?: number;
  createdAt?: string | null;
  children?: GsapNode[];
}

export interface ScrollTriggerInfo {
  trigger: string;
  start?: string;
  end?: string;
  startPx: number;
  endPx: number;
  scrub?: boolean | number;
  pin?: string;
  snap?: unknown;
  toggleActions?: string;
  animation: string;
  animationTargets?: string[];
}

export interface Recorded {
  what: string;
  kind: 'uniform' | 'element';
  channel: string;
  /** fit while the page sat still (time-driven motion) */
  idle: Fit;
  /** fit while DEA scrolled (scroll-driven motion) */
  scroll: Fit;
  samples: number;
  code: string | null;
}

export interface MotionDoc {
  gsap: {
    source: 'global' | 'hooks' | null;
    version: string | null;
    nodes: number;
    hookTweens: number;
    hookTimelines: number;
    tree: GsapNode[];
    scrollTriggers: ScrollTriggerInfo[];
    scrollTriggerPresent: boolean;
    split: { global: boolean; elements: number; ariaSplit: number };
  } | null;
  css: {
    animations: Array<{
      type: string;
      name?: string;
      target: string;
      duration: number | string;
      delay: number;
      easing: string;
      iterations: number;
      playState: string;
      keyframes: Array<Record<string, unknown>>;
      timeline?: string;
    }>;
    keyframes: Array<{ name: string; css: string }>;
    transitions: Array<{ property: string; duration: string; easing: string; delay: string; count: number; example: string }>;
  } | null;
  others: {
    lottie: Array<Record<string, unknown>>;
    rive: { runtime?: boolean; canvases?: number };
    framer: { attributes?: number; appear?: number; motionOne?: boolean };
    theatre: { core?: boolean; studio?: boolean };
    three: Array<{ object: string; clip: string; seconds: number; tracks: number; trackNames: string[] }>;
  } | null;
  recorded: Recorded[];
  recording: {
    frames: number;
    seconds: number;
    idleFrames: number;
    scrollFrames: number;
    elements: string[];
    uniforms: string[];
    lastValues?: Record<string, number>;
  };
}

export interface MotionResult extends InspectResult {
  motion: MotionDoc;
  motionMd: string;
  timelineJs: string;
  gaps: Gap[];
}

export interface MotionOptions extends InspectOptions {
  /** seconds of recording with the page still (default 3) */
  idleSeconds?: number;
  /** seconds of recording while scrolling (default 6) */
  scrollSeconds?: number;
}

/** Parse a CSS matrix()/matrix3d() into the numbers people animate. */
export function decomposeTransform(t: string): { x: number; y: number; scale: number; rotate: number } | null {
  if (!t || t === 'none') return { x: 0, y: 0, scale: 1, rotate: 0 };
  const m = /matrix(3d)?\(([^)]+)\)/.exec(t);
  if (!m) return null;
  const v = m[2].split(',').map(Number);
  if (m[1]) return { x: v[12], y: v[13], scale: Math.hypot(v[0], v[1], v[2]), rotate: (Math.atan2(v[1], v[0]) * 180) / Math.PI };
  return { x: v[4], y: v[5], scale: Math.hypot(v[0], v[1]), rotate: (Math.atan2(v[1], v[0]) * 180) / Math.PI };
}

/**
 * How everything on the page moves: the GSAP timeline tree and ScrollTriggers (also when GSAP is bundled), CSS
 * animations, transitions and @keyframes, Web Animations, Lottie, Rive, Framer Motion, Theatre.js, three.js clips, and
 * a frame recording of shader uniforms and moving elements, each fitted to the motion that made it, with GSAP code to
 * rebuild it.
 */
export async function decodeMotion(url: string, opts: MotionOptions = {}): Promise<MotionResult> {
  let gsap: MotionDoc['gsap'] = null;
  let css: MotionDoc['css'] = null;
  let others: MotionDoc['others'] = null;
  let frames: Array<{ t: number; y: number; w: number; u: Record<string, number>; e: Array<[string, string]> }> = [];
  let idleEnd = 0;
  let elements: string[] = [];
  const say = (s: string) => opts.onProgress?.(s);
  const ev = <T>(page: import('playwright').Page, src: string, fallback: T) => page.evaluate(src).catch(() => fallback) as Promise<T>;

  const result = await collect(
    url,
    'motion',
    {
      ...opts,
      tree: false,
      beforeGoto: async (page, cdp) => {
        await page.addInitScript({ content: CODE_INIT_SCRIPT });
        await page.addInitScript({ content: MOTION_INIT_SCRIPT });
        if (opts.beforeGoto) await opts.beforeGoto(page, cdp);
      },
    },
    async (session, writer) => {
      const { page } = session;
      await page.waitForTimeout(2500);
      elements = await ev<string[]>(page, PICK_ELEMENTS, []);
      say(`recording ${opts.idleSeconds ?? 3}s with the page still (time-driven motion)`);
      await writer.progress('recording idle motion');
      await page.evaluate('window.__DEA_MOTION__ && (window.__DEA_MOTION__.recording = true)').catch(() => {});
      await page.waitForTimeout((opts.idleSeconds ?? 3) * 1000);
      idleEnd = await ev<number>(page, 'window.__DEA_MOTION__ ? window.__DEA_MOTION__.frames.length : 0', 0);
      say('reading the GSAP timeline tree and ScrollTriggers');
      gsap = await ev(page, READ_GSAP, null);
      say(`recording ${opts.scrollSeconds ?? 6}s while scrolling (scroll-driven motion)`);
      await writer.progress('recording scroll motion');
      const vp = page.viewportSize() ?? { width: 1440, height: 900 };
      await page.mouse.move(vp.width / 2, vp.height / 2).catch(() => {});
      await page.mouse.wheel(0, 240).catch(() => {});
      // the rest in-page: real input waits for each frame, which is slow on a machine without a GPU
      await page
        .evaluate(
          `(async () => { const end = performance.now() + ${(opts.scrollSeconds ?? 6) * 1000}; while (performance.now() < end) {
            const t = document.elementFromPoint(innerWidth / 2, innerHeight / 2) || document.body;
            t.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, deltaMode: 0, bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
            window.scrollBy(0, 240); await new Promise((r) => setTimeout(r, 250)); } })()`,
        )
        .catch(() => {});
      await page.waitForTimeout(600);
      await page.evaluate('window.__DEA_MOTION__ && (window.__DEA_MOTION__.recording = false)').catch(() => {});
      frames = await ev(page, 'window.__DEA_MOTION__ ? window.__DEA_MOTION__.frames : []', []);
      say('reading CSS animations, transitions, Web Animations, Lottie, Rive, Framer Motion, Theatre.js, three.js clips');
      css = await ev(page, READ_CSS, null);
      others = await ev(page, READ_OTHERS, null);
      return undefined;
    },
  );
  const w = result.writer;
  const nameAll = (ns: GsapNode[]) => {
    for (const n of ns) {
      if (!n.ease && n.easeSamples && n.duration > 0) n.ease = nameEase(n.easeSamples);
      if (n.children) nameAll(n.children);
    }
  };
  if (gsap) nameAll((gsap as NonNullable<MotionDoc['gsap']>).tree);
  await w.progress('fitting recorded motion');
  say('fitting the recorded motion to clocks, oscillations, eases and springs');

  const recorded: Recorded[] = [];
  const ts = frames.map((f) => f.t / 1000);
  const idle = frames.slice(0, idleEnd);
  const scr = frames.slice(idleEnd);
  const fitBoth = (get: (f: (typeof frames)[number]) => number | undefined, angle = false) => {
    const pick = (fs: typeof frames) => {
      const rows = fs.map((f) => [f.t / 1000, get(f), f.y, f.w] as const).filter((r) => typeof r[1] === 'number' && Number.isFinite(r[1]));
      const vals = rows.map((r) => r[1] as number);
      return fitSeries(
        rows.map((r) => r[0]),
        angle ? unwrapDegrees(vals) : vals,
        { scroll: rows.map((r) => r[2]), wheel: rows.map((r) => r[3]) },
      );
    };
    return { idle: pick(idle), scroll: pick(scr) };
  };
  const uniforms = [...new Set(frames.flatMap((f) => Object.keys(f.u)))].slice(0, 60);
  for (const u of uniforms) {
    const f = fitBoth((x) => x.u[u]);
    if ((f.idle.kind === 'constant' || f.idle.kind === 'sparse') && (f.scroll.kind === 'constant' || f.scroll.kind === 'sparse')) continue;
    const main = f.scroll.kind === 'scroll-linked' ? f.scroll : f.idle.kind !== 'constant' && f.idle.kind !== 'irregular' ? f.idle : f.scroll;
    recorded.push({ what: u, kind: 'uniform', channel: 'value', ...f, samples: frames.length, code: gsapFor(main, `uniforms.${u}`) });
  }
  elements.forEach((el, i) => {
    for (const ch of ['x', 'y', 'scale', 'rotate', 'opacity'] as const) {
      const f = fitBoth((x) => {
        const e = x.e?.[i];
        if (!e) return undefined;
        if (ch === 'opacity') return Number(e[1]);
        const d = decomposeTransform(e[0]);
        return d ? d[ch] : undefined;
      }, ch === 'rotate');
      if ((f.idle.kind === 'constant' || f.idle.kind === 'sparse') && (f.scroll.kind === 'constant' || f.scroll.kind === 'sparse')) continue;
      const main = f.scroll.kind === 'scroll-linked' ? f.scroll : f.idle.kind !== 'constant' && f.idle.kind !== 'irregular' ? f.idle : f.scroll;
      recorded.push({ what: el, kind: 'element', channel: ch, ...f, samples: frames.length, code: gsapFor(main, `'${el}'`, ch) });
    }
  });

  const doc: MotionDoc = {
    gsap,
    css,
    others,
    recorded,
    recording: {
      frames: frames.length,
      seconds: ts.length ? Math.round((ts[ts.length - 1] - ts[0]) * 10) / 10 : 0,
      idleFrames: idle.length,
      scrollFrames: scr.length,
      elements,
      uniforms,
      lastValues: Object.assign({}, ...frames.map((f) => f.u)),
    },
  };
  const gaps = motionGaps(doc, result.run.meta.finalUrl);
  const timelineJs = gsapModule(doc, result.run.meta.finalUrl);
  const md = renderMotionMd(doc, result.run, gaps);
  await w.json('motion.json', doc, 'motion');
  await w.text('motion.md', md, 'motionMd');
  await w.text('motion/timeline.js', timelineJs, 'motionTimeline');
  await w.json('gaps.json', gaps, 'gaps');

  const facts = motionFacts(doc);
  const run: RunDoc = { ...result.run, facts: [...result.run.facts, ...facts] };
  run.meta.files = { ...w.files, run: 'run.json', progress: 'progress.md' };
  run.meta.finishedAt = new Date().toISOString();
  await w.json('run.json', run, 'run');
  for (const f of facts) w.emit({ type: 'fact', runId: w.id, fact: f });
  const summary = motionSummary(doc, run);
  w.emit({ type: 'run.finished', runId: w.id, dir: w.dir, summary, at: new Date().toISOString() });
  await w.progress('done');
  return { ...result, run, summary, motion: doc, motionMd: md, timelineJs, gaps };
}

const flat = (nodes: GsapNode[], depth = 0, out: Array<GsapNode & { depth: number }> = []) => {
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children) flat(n.children, depth + 1, out);
  }
  return out;
};

function propsText(o?: Record<string, unknown>, code = false): string {
  if (!o) return '';
  const val = (v: unknown): string => {
    if (code && v === 'fn()') return '() => 0 /* a per-target function on the site */';
    if (code && v === '{…}') return '{} /* an object on the site */';
    if (typeof v === 'string') return `'${v.replace(/'/g, "\\'")}'`;
    if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
    return String(v);
  };
  return Object.entries(o)
    .map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${val(v)}`)
    .join(', ');
}

/** A GSAP ease string that GSAP accepts: measured custom curves become their nearest named ease (noted in a comment). */
function codeEase(e: string, samples?: number[]): { ease: string; note: string } {
  if (!e.startsWith('custom') && !e.startsWith('back/elastic')) return { ease: e, note: '' };
  if (e.startsWith('back/elastic')) return { ease: 'back.out(1.7)', note: ` /* measured: ${e} */` };
  let best = { name: 'none', err: Infinity };
  const ps = [0.1, 0.25, 0.5, 0.75, 0.9];
  for (const name of easeNames) {
    const f = easeFn(name);
    const err = samples ? Math.max(...ps.map((p, i) => Math.abs(f(p) - samples[i]))) : 0;
    if (err < best.err) best = { name, err };
  }
  return { ease: best.name, note: ` /* measured curve ${samples?.join(', ')}; nearest named ease */` };
}

const keyframesCode = (k: unknown) =>
  JSON.stringify(k)
    .replace(/"fn\(\)"/g, '() => 0')
    .replace(/"\{…\}"/g, '{}');

export function nodeLine(n: GsapNode): string {
  if (n.type === 'call') return `call a function at ${n.start}s (delayedCall / .call)`;
  if (n.type === 'timeline')
    return `timeline at ${n.start}s, ${n.duration}s${
      n.labels
        ? `, labels ${Object.entries(n.labels)
            .map(([k, v]) => `${k}@${v}`)
            .join(' ')}`
        : ''
    }${n.scrollTrigger ? ', driven by a ScrollTrigger' : ''}${n.repeat ? `, repeat ${n.repeat}` : ''}`;
  return `${n.duration === 0 && n.mode === 'to' ? 'set' : (n.mode ?? 'to')} ${n.targets?.join(', ') ?? '?'}${n.targetCount && n.targetCount > (n.targets?.length ?? 0) ? ` (+${n.targetCount - (n.targets?.length ?? 0)} more)` : ''} at ${n.start}s for ${n.duration}s${n.ease ? `, ${n.ease}` : ''}${n.stagger != null ? `, stagger ${JSON.stringify(n.stagger)}` : ''}${n.repeat ? `, repeat ${n.repeat}${n.yoyo ? ' yoyo' : ''}` : ''}: ${n.from ? `{${propsText(n.from)}} → ` : ''}{${propsText(n.to)}}${n.keyframes ? ` keyframes ${JSON.stringify(n.keyframes).slice(0, 160)}` : ''}${n.scrollTrigger ? ' (ScrollTrigger)' : ''}`;
}

/** A runnable ES module that rebuilds the GSAP timelines and ScrollTriggers DEA read. Element targets keep their selectors; JS objects become placeholders you wire up. */
export function gsapModule(d: MotionDoc, site: string): string {
  const L: string[] = [
    `// Motion rebuilt by DEA from ${site}`,
    '// Verified: every tween, position, duration, ease and ScrollTrigger below was read from the live GSAP instance.',
    '// Targets that were JavaScript objects (three.js uniforms, camera positions) are named `objects[...]`: pass yours in.',
    "import { gsap } from 'gsap';",
    "import { ScrollTrigger } from 'gsap/ScrollTrigger';",
    '',
    'gsap.registerPlugin(ScrollTrigger);',
    '',
    'export function buildMotion(objects = {}) {',
    '  const t = (sel) => (sel.startsWith("{") || /^[A-Z]|uniform/.test(sel) ? objects[sel] ?? {} : sel);',
    '  const timelines = [];',
  ];
  const tl = d.gsap?.tree ?? [];
  let i = 0;
  const emit = (nodes: GsapNode[], parent: string, indent: string) => {
    for (const n of nodes.slice(0, 120)) {
      if (n.type === 'timeline') {
        const name = `tl${++i}`;
        L.push(`${indent}const ${name} = gsap.timeline({ paused: false${n.repeat ? `, repeat: ${n.repeat}` : ''} });`);
        for (const [k, v] of Object.entries(n.labels ?? {})) L.push(`${indent}${name}.addLabel('${k}', ${v});`);
        emit(n.children ?? [], name, indent);
        L.push(parent === 'root' ? `${indent}timelines.push(${name});` : `${indent}${parent}.add(${name}, ${n.start});`);
      } else if (n.type === 'call') {
        L.push(`${indent}// a function call at ${n.start}s (delayedCall/.call): add yours here`);
      } else {
        const tgt =
          (n.targets ?? []).length === 1 ? `t(${JSON.stringify(n.targets?.[0])})` : `[${(n.targets ?? []).map((x) => `t(${JSON.stringify(x)})`).join(', ')}]`;
        const ce = n.ease ? codeEase(n.ease, n.easeSamples) : null;
        const vars = [
          propsText(n.to, true),
          n.keyframes ? `keyframes: ${keyframesCode(n.keyframes)}` : '',
          `duration: ${n.duration}`,
          ce ? `ease: '${ce.ease}'${ce.note}` : '',
          n.stagger != null ? `stagger: ${JSON.stringify(n.stagger)}` : '',
          n.repeat ? `repeat: ${n.repeat}` : '',
          n.yoyo ? 'yoyo: true' : '',
        ]
          .filter(Boolean)
          .join(', ');
        const call =
          n.mode === 'fromTo' ? `fromTo(${tgt}, { ${propsText(n.from, true)} }, { ${vars} }` : `${n.mode === 'from' ? 'from' : 'to'}(${tgt}, { ${vars} }`;
        L.push(parent === 'root' ? `${indent}gsap.${call}${n.delay ? `, delay: ${n.delay}` : ''});` : `${indent}${parent}.${call}, ${n.start});`);
      }
    }
  };
  emit(tl, 'root', '  ');
  for (const s of d.gsap?.scrollTriggers ?? []) {
    L.push(
      `  ScrollTrigger.create({ trigger: ${JSON.stringify(s.trigger)}, start: ${JSON.stringify(s.start ?? `${s.startPx}`)}, end: ${JSON.stringify(s.end ?? `${s.endPx}`)}${s.scrub != null ? `, scrub: ${JSON.stringify(s.scrub)}` : ''}${s.pin ? `, pin: ${JSON.stringify(s.pin)}` : ''}${s.toggleActions ? `, toggleActions: '${s.toggleActions}'` : ''} }); // animates: ${s.animation}${s.animationTargets ? ` ${s.animationTargets.join(', ')}` : ''}`,
    );
  }
  const fitted = d.recorded.filter((r) => r.code);
  if (fitted.length) {
    L.push('', '  // Inferred: motion recorded frame by frame and fitted (no library described it)');
    for (const r of fitted.slice(0, 40)) L.push(...`// ${r.what} ${r.channel}\n${r.code}`.split('\n').map((x) => `  ${r.kind === 'uniform' ? '// ' : ''}${x}`));
  }
  L.push('  return timelines;', '}', '');
  return L.join('\n');
}

export function motionGaps(d: MotionDoc, site: string): Gap[] {
  const gaps: Gap[] = [];
  const g = d.gsap;
  if (g && !g.tree.length && (g.hookTweens || g.version))
    gaps.push({
      area: 'motion',
      topic: 'GSAP is on the page but its timeline tree was empty when read',
      known: [`Verified: GSAP ${g.version ?? '(bundled)'}; ${g.hookTweens} tweens and ${g.hookTimelines} timelines were created while DEA watched`],
      missing: 'the live tree: finished tweens remove themselves (autoRemoveChildren), so a played intro is gone by the time DEA reads',
      approximation: { text: 'the tween calls are still in the code with their literal values; `dea code` lists them with file and line' },
      next: [{ why: 'reads every gsap.to/from/timeline call in the code', command: `dea code ${site}`, probe: 'code' }],
    });
  if (d.others?.rive.runtime || (d.others?.rive.canvases ?? 0) > 0)
    gaps.push({
      area: 'motion',
      topic: 'Rive animation: state machines are not listed',
      known: ['Verified: a Rive runtime or Rive canvas is on the page'],
      missing: 'artboards, animations and state-machine inputs: they live inside the .riv file and need the Rive runtime to list',
      approximation: { text: 'the .riv file is saved by `dea assets`; the frame recording above shows how the canvas region moves' },
      next: [{ why: 'saves the .riv file to open in the Rive editor', command: `dea assets ${site}` }],
    });
  const fps = d.recording.seconds ? d.recording.frames / d.recording.seconds : 0;
  if (d.recording.frames && fps < 10)
    gaps.push({
      area: 'motion',
      topic: `The page drew only ${Math.round(fps * 10) / 10} frames per second here, too few to fit most curves`,
      known: [
        `Verified: ${d.recording.frames} frames in ${d.recording.seconds}s; ${d.recording.uniforms.length} shader uniforms and ${d.recording.elements.length} elements were watched`,
      ],
      missing: 'enough frames: heavy WebGL on a machine without a GPU renders slowly',
      approximation: { text: 'the GSAP tree, CSS animations and code values above do not depend on frame rate; uniform formulas are in the shader decode' },
      next: [
        { why: 'a longer recording collects more frames', command: `dea motion ${site} --idle 15 --scroll 20` },
        { why: 'on a machine with a GPU, a headed browser renders at full speed', command: `dea motion ${site} --headed` },
      ],
    });
  const irregular = d.recorded.filter((r) => r.idle.kind === 'irregular' && r.scroll.kind === 'irregular');
  if (irregular.length)
    gaps.push({
      area: 'motion',
      topic: `${irregular.length} recorded motion(s) did not fit a simple curve`,
      known: irregular.slice(0, 5).map((r) => `Verified: ${r.what} ${r.channel} changes (${describeFit(r.idle)})`),
      missing: 'the formula: noise, physics, or several drivers added together',
      approximation: { text: 'treat them as noise around the mean; the shader decode shows the formula when the value feeds a shader' },
      next: [{ why: 'longer recording separates slow drivers from noise', command: `dea motion ${site} --idle 8 --scroll 12` }],
    });
  if (d.others?.framer.appear && !d.css?.animations.length)
    gaps.push({
      area: 'motion',
      topic: 'Framer appear animations finished before DEA read them',
      known: [`Verified: ${d.others.framer.appear} elements carry data-framer-appear-id`],
      missing: 'their keyframes: Framer runs them once on load',
      approximation: { text: 'Framer appear defaults: opacity 0 → 1 and y 10-40 px, spring' },
      next: [{ why: 'record from the first frame', command: `dea motion ${site} --idle 1` }],
    });
  return gaps;
}

function motionFacts(d: MotionDoc): Fact[] {
  const facts: Fact[] = [];
  if (d.gsap?.tree.length)
    facts.push({
      key: 'motion.gsap.tree',
      claim: `GSAP timeline tree: ${d.gsap.nodes} timelines and tweens${d.gsap.scrollTriggers.length ? `, ${d.gsap.scrollTriggers.length} ScrollTriggers` : ''}.`,
      value: d.gsap.nodes,
      label: 'Verified',
      evidence: [
        { source: 'global', pointer: d.gsap.source === 'global' ? 'gsap.globalTimeline' : 'GSAP instances seen as they were built', excerpt: 'motion.json' },
      ],
    });
  for (const s of (d.gsap?.scrollTriggers ?? []).slice(0, 10))
    facts.push({
      key: `motion.scrolltrigger.${s.trigger}`,
      claim: `ScrollTrigger on ${s.trigger}: ${s.start ?? s.startPx} → ${s.end ?? s.endPx}${s.scrub != null ? `, scrub ${s.scrub}` : ''}${s.pin ? `, pins ${s.pin}` : ''}; animates ${s.animation}.`,
      value: s,
      label: 'Verified',
      evidence: [{ source: 'global', pointer: 'ScrollTrigger.getAll()' }],
    });
  for (const r of d.recorded.slice(0, 20)) {
    const f = r.scroll.kind === 'scroll-linked' ? r.scroll : r.idle;
    if (f.kind === 'constant' || f.kind === 'irregular') continue;
    facts.push({
      key: `motion.recorded.${r.what}.${r.channel}`,
      claim: `${r.what}${r.kind === 'element' ? ` ${r.channel}` : ''} ${describeFit(f)}.`,
      value: f,
      label: 'Inferred',
      why: `fitted to ${r.samples} recorded frames`,
      evidence: [{ source: 'sampling', pointer: r.kind === 'uniform' ? `uniform ${r.what} set each frame` : `computed style of ${r.what}` }],
    });
  }
  return facts;
}

function motionSummary(d: MotionDoc, run: RunDoc): string {
  const L = [`${run.meta.title || run.meta.finalUrl}`];
  if (d.gsap?.tree.length || d.gsap?.version)
    L.push(`GSAP ${d.gsap?.version ?? '(bundled)'}: ${d.gsap?.nodes ?? 0} timelines/tweens, ${d.gsap?.scrollTriggers.length ?? 0} ScrollTriggers`);
  if (d.css) L.push(`CSS: ${d.css.animations.length} running animations, ${d.css.keyframes.length} @keyframes, ${d.css.transitions.length} transition styles`);
  if (d.others?.lottie.length) L.push(`Lottie: ${d.others.lottie.length}`);
  if (d.others?.three.length) L.push(`three.js clips: ${d.others.three.map((c) => `${c.clip} ${c.seconds}s`).join(', ')}`);
  L.push(`Recorded ${d.recording.frames} frames (${d.recording.seconds}s): ${d.recorded.length} moving values`);
  for (const r of d.recorded.slice(0, 6)) {
    const f = r.scroll.kind === 'scroll-linked' ? r.scroll : r.idle.kind !== 'constant' ? r.idle : r.scroll;
    L.push(`  ${r.what}${r.kind === 'element' ? ` ${r.channel}` : ''}: ${describeFit(f)}`);
  }
  return L.join('\n');
}

export function renderMotionMd(d: MotionDoc, run: RunDoc, gaps: Gap[]): string {
  const L: string[] = [
    `# Motion: ${run.meta.title || run.meta.finalUrl}`,
    '',
    `How ${run.meta.finalUrl} moves. ✔ Verified = read from the animation engine itself. ≈ Inferred = recorded frame by frame and fitted to a curve. Runnable rebuild: \`motion/timeline.js\`.`,
    '',
  ];
  const g = d.gsap;
  if (g && (g.tree.length || g.version || g.hookTweens)) {
    L.push(`## GSAP${g.version ? ` ${g.version}` : ''} timeline tree`, '');
    L.push(
      g.tree.length
        ? `✔ Read from ${g.source === 'global' ? '`gsap.globalTimeline`' : 'the GSAP instances DEA saw being built (GSAP is bundled)'}: ${g.nodes} timelines and tweens alive when read; ${g.hookTweens} tweens were created in total.`
        : `✔ GSAP is on the page and ${g.hookTweens} tween(s) were created while DEA watched, but none was alive when DEA read the tree (finished tweens remove themselves). See the gaps below for the path to them.`,
      '',
    );
    for (const n of flat(g.tree).slice(0, 150))
      L.push(`${'  '.repeat(n.depth)}- ${nodeLine(n)}${n.createdAt ? ` _(${n.createdAt.replace(/^at /, '')})_` : ''}`);
    L.push('');
  }
  if (g?.scrollTriggers.length) {
    L.push(`## ScrollTriggers (${g.scrollTriggers.length})`, '', '| trigger | start → end | px | scrub | pin | animates |', '|---|---|---|---|---|---|');
    for (const s of g.scrollTriggers)
      L.push(
        `| ${s.trigger} | ${s.start ?? ''} → ${s.end ?? ''} | ${s.startPx}–${s.endPx} | ${s.scrub ?? ''} | ${s.pin ?? ''} | ${s.animation}${s.animationTargets ? ` (${s.animationTargets.join(', ')})` : ''} |`,
      );
    L.push('');
  }
  if (g && (g.split.global || g.split.ariaSplit))
    L.push(`≈ Split text: ${g.split.global ? 'SplitText is loaded; ' : ''}${g.split.ariaSplit} headings are split into characters or words.`, '');
  const c = d.css;
  if (c?.animations.length) {
    L.push(`## Running CSS animations and Web Animations (${c.animations.length})`, '');
    for (const a of c.animations.slice(0, 40))
      L.push(
        `- ✔ ${a.type} ${a.name ?? ''} on ${a.target}: ${a.duration}ms${a.delay ? ` +${a.delay}ms` : ''}, ${a.easing}, ${a.iterations === Number.POSITIVE_INFINITY || a.iterations == null ? 'infinite' : `${a.iterations}×`}${a.timeline && a.timeline !== 'DocumentTimeline' ? `, on a ${a.timeline} (scroll-driven)` : ''}${a.keyframes.length ? `; keyframes ${JSON.stringify(a.keyframes).slice(0, 200)}` : ''}`,
      );
    L.push('');
  }
  if (c?.keyframes.length) {
    L.push(`## @keyframes in the stylesheets (${c.keyframes.length})`, '', '```css');
    for (const k of c.keyframes.slice(0, 12)) L.push(k.css);
    L.push('```', '');
  }
  if (c?.transitions.length) {
    L.push('## Transitions (hover and state changes)', '');
    for (const t of c.transitions.slice(0, 15))
      L.push(`- ✔ ${t.property} ${t.duration} ${t.easing}${t.delay !== '0s' ? ` delay ${t.delay}` : ''} on ${t.count} element(s), e.g. ${t.example}`);
    L.push('');
  }
  const o = d.others;
  if (o?.lottie.length) {
    L.push('## Lottie', '');
    for (const l of o.lottie)
      L.push(
        `- ✔ ${l.name ?? l.path ?? 'animation'}${l.seconds ? `: ${l.seconds}s at ${l.fps} fps` : ''}${l.layers ? `, ${l.layers} layers` : ''}${l.loop != null ? `, loop ${l.loop}` : ''}${l.path ? ` (${l.path})` : ''}`,
      );
    L.push('');
  }
  if (o?.three.length) {
    L.push('## three.js animation clips', '');
    for (const t of o.three) L.push(`- ✔ ${t.clip} on ${t.object}: ${t.seconds}s, ${t.tracks} tracks (${t.trackNames.join(', ')})`);
    L.push('');
  }
  const eng = [
    o?.rive.runtime || o?.rive.canvases ? 'Rive' : '',
    o?.framer.attributes ? `Framer (${o.framer.attributes} data-framer elements)` : '',
    o?.framer.motionOne ? 'Motion One' : '',
    o?.theatre.core ? 'Theatre.js' : '',
  ].filter(Boolean);
  if (eng.length) L.push(`Other motion engines on the page: ${eng.join(', ')}.`, '');
  if (d.recorded.length) {
    L.push(
      `## Recorded motion (${d.recording.frames} frames over ${d.recording.seconds}s)`,
      '',
      '≈ Each value was read every frame, first with the page still, then while DEA scrolled, and fitted.',
      '',
    );
    for (const r of d.recorded.slice(0, 40)) {
      L.push(
        `- ≈ **${r.what}**${r.kind === 'element' ? ` ${r.channel}` : ' (shader uniform)'}: still: ${describeFit(r.idle)}; scrolling: ${describeFit(r.scroll)}`,
      );
      if (r.code) L.push('', '  ```js', ...r.code.split('\n').map((x) => `  ${x}`), '  ```', '');
    }
    L.push('');
  } else L.push('## Recorded motion', '', `Nothing moved on its own while DEA recorded ${d.recording.frames} frames.`, '');
  const gm = renderGaps(gaps);
  if (gm) L.push(gm);
  return `${L.join('\n')}\n`;
}
