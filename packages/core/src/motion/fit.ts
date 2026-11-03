// Fit recorded values to the motion that made them: constant, a clock (linear), an oscillation, an eased move
// (with the GSAP ease that matches best), a spring, or noise. Everything here is Inferred by nature.

export type Fit =
  | { kind: 'constant'; value: number }
  | { kind: 'linear'; ratePerSecond: number; r2: number }
  | { kind: 'oscillation'; period: number; amplitude: number; center: number; r2: number }
  | { kind: 'eased'; from: number; to: number; start: number; duration: number; ease: string; error: number }
  | { kind: 'spring'; from: number; to: number; start: number; settle: number; overshoot: number }
  | { kind: 'scroll-linked'; correlation: number; slope: number; with: 'scroll' | 'wheel' }
  | { kind: 'irregular'; mean: number; std: number }
  | { kind: 'sparse'; samples: number };

const EASES: Record<string, (p: number) => number> = {
  none: (p) => p,
  'power1.out': (p) => 1 - (1 - p) ** 2,
  'power2.out': (p) => 1 - (1 - p) ** 3,
  'power3.out': (p) => 1 - (1 - p) ** 4,
  'power4.out': (p) => 1 - (1 - p) ** 5,
  'power1.in': (p) => p ** 2,
  'power2.in': (p) => p ** 3,
  'power3.in': (p) => p ** 4,
  'power1.inOut': (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
  'power2.inOut': (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  'power3.inOut': (p) => (p < 0.5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2),
  'sine.inOut': (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  'sine.out': (p) => Math.sin((p * Math.PI) / 2),
  'expo.out': (p) => (p === 1 ? 1 : 1 - 2 ** (-10 * p)),
  'expo.inOut': (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2),
  'circ.out': (p) => Math.sqrt(1 - (p - 1) ** 2),
};

export const easeNames = Object.keys(EASES);
export const easeFn = (name: string): ((p: number) => number) => EASES[name] ?? EASES.none;

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
function r2(ys: number[], pred: number[]): number {
  const m = mean(ys);
  const ssTot = ys.reduce((s, y) => s + (y - m) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - pred[i]) ** 2, 0);
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}
function corr(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? n / Math.sqrt(da * db) : 0;
}

/** Fit one series. t in seconds (any origin), v the values; scroll/wheel are the page's scroll position at each frame. */
export function fitSeries(t: number[], v: number[], ctx: { scroll?: number[]; wheel?: number[] } = {}): Fit {
  const n = Math.min(t.length, v.length);
  const ts = t.slice(0, n);
  const vs = v.slice(0, n).map(Number);
  if (n < 6 || vs.some((x) => !Number.isFinite(x))) return { kind: 'sparse', samples: n };
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const range = hi - lo;
  if (range <= Math.max(1e-6, Math.abs(hi) * 1e-4)) return { kind: 'constant', value: vs[0] };

  // linked to scroll?
  for (const [name, s] of [
    ['scroll', ctx.scroll],
    ['wheel', ctx.wheel],
  ] as const) {
    if (!s || new Set(s.slice(0, n)).size < 4) continue;
    const c = corr(vs, s.slice(0, n));
    if (Math.abs(c) > 0.95) {
      const ms = mean(s.slice(0, n));
      const mv = mean(vs);
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (s[i] - ms) * (vs[i] - mv);
        den += (s[i] - ms) ** 2;
      }
      return { kind: 'scroll-linked', correlation: Math.round(c * 1000) / 1000, slope: den ? num / den : 0, with: name };
    }
  }

  // a clock: straight line
  const mt = mean(ts);
  const mv = mean(vs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (ts[i] - mt) * (vs[i] - mv);
    den += (ts[i] - mt) ** 2;
  }
  const slope = den ? num / den : 0;
  const lin = ts.map((x) => mv + slope * (x - mt));
  const rl = r2(vs, lin);
  if (rl > 0.995) return { kind: 'linear', ratePerSecond: Math.round(slope * 10000) / 10000, r2: Math.round(rl * 10000) / 10000 };

  // an oscillation: period from mean crossings, sine fit
  const c = (lo + hi) / 2;
  const cross: number[] = [];
  for (let i = 1; i < n; i++) if ((vs[i - 1] - c) * (vs[i] - c) < 0) cross.push(ts[i]);
  if (cross.length >= 4) {
    const gaps = cross.slice(1).map((x, i) => x - cross[i]);
    const period = 2 * mean(gaps);
    let best = { r: -1, phase: 0 };
    for (let k = 0; k < 24; k++) {
      const phase = (k / 24) * 2 * Math.PI;
      const pred = ts.map((x) => c + (range / 2) * Math.sin((2 * Math.PI * x) / period + phase));
      const r = r2(vs, pred);
      if (r > best.r) best = { r, phase };
    }
    if (best.r > 0.85)
      return { kind: 'oscillation', period: Math.round(period * 1000) / 1000, amplitude: range / 2, center: c, r2: Math.round(best.r * 1000) / 1000 };
  }

  // one move from a to b: smooth (few direction changes), then compare with eases; overshoot means a spring
  const a = vs[0];
  const b = vs[n - 1];
  const total = b - a;
  let turns = 0;
  for (let i = 2; i < n; i++) if ((vs[i] - vs[i - 1]) * (vs[i - 1] - vs[i - 2]) < 0) turns++;
  if (Math.abs(total) > range * 0.6 && turns <= Math.max(6, n / 10)) {
    const prog = vs.map((x) => (x - a) / total);
    const i0 = prog.findIndex((p) => p > 0.02);
    const over = Math.max(...prog) - 1;
    if (over > 0.03 && i0 >= 0) {
      let settle = n - 1;
      for (let i = n - 1; i >= 0; i--)
        if (Math.abs(prog[i] - 1) > 0.02) {
          settle = Math.min(n - 1, i + 1);
          break;
        }
      return {
        kind: 'spring',
        from: a,
        to: b,
        start: ts[Math.max(0, i0 - 1)] - ts[0],
        settle: ts[settle] - ts[Math.max(0, i0 - 1)],
        overshoot: Math.round(over * 1000) / 10,
      };
    }
    if (i0 >= 0) {
      const s0 = Math.max(0, i0 - 1);
      const t0 = ts[s0];
      // the end of the move is a parameter too: slow eases approach the end value for a long time
      const e95 = Math.max(
        s0 + 2,
        prog.findIndex((p) => p >= 0.95),
      );
      const ends: number[] = [];
      const span = n - 1 - e95;
      for (let k = 0; k <= Math.min(40, span); k++) ends.push(e95 + Math.round((k * span) / Math.max(1, Math.min(40, span))));
      let best = { ease: 'none', err: Infinity, end: n - 1 };
      for (const i1 of ends) {
        const dur = ts[i1] - t0;
        if (dur <= 0) continue;
        for (const [name, f] of Object.entries(EASES)) {
          let e = 0;
          for (let i = s0; i < n; i++) e += (prog[i] - f(Math.min(1, Math.max(0, (ts[i] - t0) / dur)))) ** 2;
          e = Math.sqrt(e / (n - s0));
          if (e < best.err) best = { ease: name, err: e, end: i1 };
        }
      }
      if (best.err < 0.05)
        return {
          kind: 'eased',
          from: a,
          to: b,
          start: t0 - ts[0],
          duration: Math.round((ts[best.end] - t0) * 1000) / 1000,
          ease: best.ease,
          error: Math.round(best.err * 1000) / 1000,
        };
    }
  }
  const m = mean(vs);
  return { kind: 'irregular', mean: m, std: Math.sqrt(mean(vs.map((x) => (x - m) ** 2))) };
}

export function describeFit(f: Fit): string {
  switch (f.kind) {
    case 'constant':
      return `constant ${round(f.value)}`;
    case 'linear':
      return `a clock: ${f.ratePerSecond >= 0 ? '+' : ''}${round(f.ratePerSecond)} per second`;
    case 'oscillation':
      return `oscillates every ${round(f.period)} s (±${round(f.amplitude)} around ${round(f.center)})`;
    case 'eased':
      return `moves ${round(f.from)} → ${round(f.to)} in ${round(f.duration)} s, closest ease ${f.ease}`;
    case 'spring':
      return `springs ${round(f.from)} → ${round(f.to)}, overshoots ${f.overshoot}% and settles in ${round(f.settle)} s`;
    case 'scroll-linked':
      return `follows the ${f.with === 'scroll' ? 'scroll position' : 'wheel input'} (correlation ${f.correlation}, ${round(f.slope)} per px)`;
    case 'sparse':
      return `only ${f.samples} frame(s) recorded: too few to fit`;
    default:
      return `irregular (mean ${round(f.mean)}, spread ${round(f.std)}): noise or several overlapping drivers`;
  }
}

const round = (x: number) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 1000) / 1000);

/** GSAP code that reproduces a fitted motion on `target` (a uniform's .value or a CSS property). */
export function gsapFor(f: Fit, target: string, prop = 'value'): string | null {
  switch (f.kind) {
    case 'linear':
      return `gsap.ticker.add((time, delta) => { ${target}.${prop} += ${round(f.ratePerSecond)} * (delta / 1000); });`;
    case 'oscillation':
      return `${target}.${prop} = ${round(f.center - f.amplitude)};\ngsap.to(${target}, { ${prop}: ${round(f.center + f.amplitude)}, duration: ${round(f.period / 2)}, ease: 'sine.inOut', repeat: -1, yoyo: true });`;
    case 'eased':
      return `gsap.fromTo(${target}, { ${prop}: ${round(f.from)} }, { ${prop}: ${round(f.to)}, duration: ${round(f.duration)}, delay: ${round(f.start)}, ease: '${f.ease}' });`;
    case 'spring':
      return `gsap.fromTo(${target}, { ${prop}: ${round(f.from)} }, { ${prop}: ${round(f.to)}, duration: ${round(f.settle)}, ease: 'elastic.out(1, 0.5)' }); // a spring: ${f.overshoot}% overshoot`;
    case 'scroll-linked':
      return `gsap.to(${target}, { ${prop}: '+=${round(f.slope * 1000)}', ease: 'none', scrollTrigger: { start: 0, end: '+=1000', scrub: true } }); // ${round(f.slope)} per px of ${f.with}`;
    default:
      return null;
  }
}

/** Name a GSAP ease from its values at p = 0.1, 0.25, 0.5, 0.75, 0.9 (GSAP parses ease strings into functions). */
export function nameEase(samples: number[] | undefined): string | undefined {
  if (samples?.length !== 5) return undefined;
  const ps = [0.1, 0.25, 0.5, 0.75, 0.9];
  let best = { name: '', err: Infinity };
  for (const [name, f] of Object.entries(EASES)) {
    const err = Math.max(...ps.map((p, i) => Math.abs(f(p) - samples[i])));
    if (err < best.err) best = { name, err };
  }
  if (best.err < 0.01) return best.name;
  if (Math.max(...samples) > 1.001) return `back/elastic-like (overshoots to ${Math.max(...samples)})`;
  return `custom (${samples.join(', ')} at 10/25/50/75/90%)`;
}

/** Make an angle series continuous (no jump from 179° to -179°). */
export function unwrapDegrees(v: number[]): number[] {
  const out: number[] = [];
  let off = 0;
  for (let i = 0; i < v.length; i++) {
    if (i > 0) {
      const d = v[i] + off - out[i - 1];
      if (d > 180) off -= 360;
      else if (d < -180) off += 360;
    }
    out.push(v[i] + off);
  }
  return out;
}
