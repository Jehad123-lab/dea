// Live input for the replay and the editable rebuild: which uniforms follow the pointer, the scroll and the window
// size, measured on the live site right after the recording, and how (value = scale × input + offset, the input eased
// per frame the way the site eases it).
//
// The probe moves the pointer across the page and back (x, then y), scrolls down and back up, and resizes the window,
// while the recorder notes every float uniform's value at every animation frame beside the pointer position, scroll and
// window size. A uniform that tracks one of those inputs (|r| ≥ 0.9 after the best easing) is mapped to it: Verified,
// because it was measured on the site. A uniform named like an input that the probe could not move (its program was not
// drawn, or the site ignores synthetic events) is mapped from its name and its recorded value: Inferred.

import type { Page } from 'playwright';

/** What the in-page probe returns: per "program|uniform", rows of [ms, v0, v1, ...]; and per frame [ms, scrollY, x, y, w, h] */
export interface ProbeData {
  series: Record<string, number[][]>;
  env: Array<[number, number, number, number, number, number]>;
}

export type InputKind = 'pointer' | 'pointer-velocity' | 'scroll' | 'viewport' | 'clock';

export interface InputMap {
  /** the recording's program id */
  program: number;
  uniform: string;
  /** which component of a vector uniform (0 for a float) */
  component: number;
  kind: InputKind;
  /** pointer: x or y (normalised: clientX / innerWidth, clientY / innerHeight); viewport: width, height or aspect (CSS px) */
  axis?: 'x' | 'y' | 'width' | 'height' | 'aspect';
  /** value = scale × eased input + offset */
  scale: number;
  offset: number;
  /** easing per frame: eased += k × (input − eased); 1 = follows at once */
  k: number;
  /** how well the measured values follow the input (correlation), 1 for a name-based guess */
  r: number;
  source: 'measured' | 'name';
  /** scroll: the range of the input the probe saw (px); live input is held inside it so a value is never extrapolated past what was measured */
  lo?: number;
  hi?: number;
  /** a second pointer axis the value also follows (matrices: both x and y turn the camera): value += scale2 × eased(axis2) */
  axis2?: 'x' | 'y';
  scale2?: number;
}

export interface ProbeReport {
  inputs: InputMap[];
  /** what the probe moved and how many frames it saw */
  frames: number;
  exercised: { pointer: boolean; scroll: boolean; resize: boolean };
  /** uniforms that changed during the probe but match no input (animated on their own) */
  unexplained: string[];
}

const sleep = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Exercise the page (pointer, scroll, resize) while the recorder notes every float uniform per frame. */
export async function probeInputs(page: Page): Promise<ProbeData | null> {
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const started = await page.evaluate('window.__DEA_CAP__ && window.__DEA_CAP__.probeStart ? window.__DEA_CAP__.probeStart() : false').catch(() => false);
  if (!started) return null;
  const { width: w, height: h } = vp;
  try {
    await page.mouse.move(w * 0.5, h * 0.5);
    await sleep(page, 900);
    const tri = (i: number, n: number) => 1 - Math.abs(1 - (2 * i) / n); // 0 → 1 → 0
    const N = 16;
    for (let i = 0; i <= N; i++) {
      await page.mouse.move(w * (0.2 + 0.6 * tri(i, N)), h * 0.5);
      await sleep(page, 160);
    }
    await sleep(page, 500);
    for (let i = 0; i <= N; i++) {
      await page.mouse.move(w * 0.5, h * (0.2 + 0.6 * tri(i, N)));
      await sleep(page, 160);
    }
    await sleep(page, 600);
    // a wheel that moves a fixed stage (a scroll-driven scene) is followed as far as it goes: 8 steps down, then back up
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 250);
      await sleep(page, 350);
    }
    await sleep(page, 900);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -250);
      await sleep(page, 350);
    }
    await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
    await sleep(page, 700);
    await page.setViewportSize({ width: Math.round(w * 0.75), height: h });
    await sleep(page, 1000);
    await page.setViewportSize({ width: Math.round(w * 0.75), height: Math.round(h * 0.7) });
    await sleep(page, 1000);
    await page.setViewportSize(vp);
    await sleep(page, 1000);
  } catch {
    /* whatever the probe saw so far is still read */
  }
  await page.setViewportSize(vp).catch(() => {});
  return (await page.evaluate('window.__DEA_CAP__.probeStop()').catch(() => null)) as ProbeData | null;
}

const EASES = [1, 0.5, 0.3, 0.2, 0.14, 0.1, 0.07, 0.05, 0.035];

function corr(x: number[], y: number[]): { r: number; a: number; b: number } {
  const n = x.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cxy = 0;
  let cxx = 0;
  let cyy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cxy += dx * dy;
    cxx += dx * dx;
    cyy += dy * dy;
  }
  if (cxx <= 1e-12 || cyy <= 1e-12) return { r: 0, a: 0, b: my };
  const a = cxy / cxx;
  return { r: cxy / Math.sqrt(cxx * cyy), a, b: my - a * mx };
}

function ease(s: number[], k: number): number[] {
  if (k >= 1) return s;
  const out = new Array<number>(s.length);
  let e = s[0];
  for (let i = 0; i < s.length; i++) {
    e += k * (s[i] - e);
    out[i] = e;
  }
  return out;
}

const round = (x: number, d = 5) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * Matrices (a model, view or projection matrix, a custom one) noted per draw as "program|name#draw": each of the 16
 * components is fitted to the eased pointer, x and y together (value = a + b × x + c × y), the way a camera that orbits
 * with the pointer moves them. Only fits with |r| ≥ minR count.
 */
function fitMatrix(program: number, uniform: string, rows: number[][], idx: number[], sig: { px: number[]; py: number[] }, minR: number): InputMap[] {
  const out: InputMap[] = [];
  const comps = Math.max(...rows.map((r) => r.length - 1));
  for (let c = 0; c < comps; c++) {
    const pick = rows.map((r, i) => (Number.isFinite(r[c + 1]) && idx[i] >= 0 ? i : -1)).filter((i) => i >= 0);
    if (pick.length < 8) continue;
    const y = pick.map((i) => rows[i][c + 1]);
    const lo = Math.min(...y);
    const hi = Math.max(...y);
    if (hi - lo <= Math.max(1e-6, Math.max(Math.abs(lo), Math.abs(hi)) * 1e-4)) continue;
    let best: { r: number; k: number; a: number; b: number; cc: number } | null = null;
    // the eased pointer starts either where the first sample is or at the centre of the window (a page's pointer state at load)
    for (const [k, start] of [1, 0.5, 0.3, 0.14, 0.05].flatMap(
      (kk) =>
        [
          [kk, 'first'],
          [kk, 'centre'],
        ] as const,
    )) {
      let ex = start === 'first' ? sig.px[idx[pick[0]]] : 0.5;
      let ey = start === 'first' ? sig.py[idx[pick[0]]] : 0.5;
      const X: number[] = [];
      const Y: number[] = [];
      for (const i of pick) {
        ex += k * (sig.px[idx[i]] - ex);
        ey += k * (sig.py[idx[i]] - ey);
        X.push(ex);
        Y.push(ey);
      }
      // least squares for y ≈ a + b X + c Y (normal equations, 3x3)
      const n = y.length;
      const sx = X.reduce((s, v) => s + v, 0);
      const sy = Y.reduce((s, v) => s + v, 0);
      const sz = y.reduce((s, v) => s + v, 0);
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      let sxz = 0;
      let syz = 0;
      for (let i = 0; i < n; i++) {
        sxx += X[i] * X[i];
        syy += Y[i] * Y[i];
        sxy += X[i] * Y[i];
        sxz += X[i] * y[i];
        syz += Y[i] * y[i];
      }
      const M = [
        [n, sx, sy, sz],
        [sx, sxx, sxy, sxz],
        [sy, sxy, syy, syz],
      ];
      for (let i = 0; i < 3; i++) {
        let p = i;
        for (let j = i + 1; j < 3; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
        [M[i], M[p]] = [M[p], M[i]];
        if (Math.abs(M[i][i]) < 1e-12) {
          p = -1;
          break;
        }
        for (let j = 0; j < 3; j++) {
          if (j === i) continue;
          const f = M[j][i] / M[i][i];
          for (let l = i; l < 4; l++) M[j][l] -= f * M[i][l];
        }
      }
      if (Math.abs(M[0][0]) < 1e-12 || Math.abs(M[1][1]) < 1e-12 || Math.abs(M[2][2]) < 1e-12) continue;
      const a = M[0][3] / M[0][0];
      const b = M[1][3] / M[1][1];
      const cc = M[2][3] / M[2][2];
      const mean = sz / n;
      let ssr = 0;
      let sst = 0;
      for (let i = 0; i < n; i++) {
        const f = a + b * X[i] + cc * Y[i];
        ssr += (y[i] - f) ** 2;
        sst += (y[i] - mean) ** 2;
      }
      const r = sst > 0 ? Math.sqrt(Math.max(0, 1 - ssr / sst)) : 0;
      if (!best || r > best.r + 1e-4) best = { r, k, a, b, cc };
    }
    if (!best || best.r < minR) continue;
    const spanX = Math.max(...sig.px) - Math.min(...sig.px);
    const spanY = Math.max(...sig.py) - Math.min(...sig.py);
    const useX = Math.abs(best.b) * spanX > 0.04 * (hi - lo);
    const useY = Math.abs(best.cc) * spanY > 0.04 * (hi - lo);
    if (!useX && !useY) continue;
    const first = useX ? { axis: 'x' as const, scale: best.b } : { axis: 'y' as const, scale: best.cc };
    const m: InputMap = {
      program,
      uniform,
      component: c,
      kind: 'pointer',
      axis: first.axis,
      scale: round(first.scale, 6),
      offset: round(best.a, 6),
      k: best.k,
      r: round(best.r, 4),
      source: 'measured',
    };
    if (useX && useY) {
      m.axis2 = 'y';
      m.scale2 = round(best.cc, 6);
    }
    out.push(m);
  }
  return out;
}

/**
 * A matrix that follows the scroll (a camera on a path): each component fitted to the eased scroll, value = a + b × scroll,
 * the range of the scroll the probe saw kept so live scroll does not run past it.
 */
function fitMatrixScroll(program: number, uniform: string, rows: number[][], idx: number[], scroll: number[], minR: number): InputMap[] {
  const out: InputMap[] = [];
  const comps = Math.max(...rows.map((r) => r.length - 1));
  for (let c = 0; c < comps; c++) {
    const pick = rows.map((r, i) => (Number.isFinite(r[c + 1]) && idx[i] >= 0 ? i : -1)).filter((i) => i >= 0);
    if (pick.length < 8) continue;
    const y = pick.map((i) => rows[i][c + 1]);
    const lo = Math.min(...y);
    const hi = Math.max(...y);
    if (hi - lo <= Math.max(1e-6, Math.max(Math.abs(lo), Math.abs(hi)) * 1e-4)) continue;
    let best: { r: number; k: number; a: number; b: number } | null = null;
    for (const k of EASES) {
      const se = ease(scroll, k);
      const x = pick.map((i) => se[idx[i]]);
      if (Math.max(...x) - Math.min(...x) <= 1e-9) continue;
      const f = corr(x, y);
      if (!best || Math.abs(f.r) > Math.abs(best.r) + 0.002) best = { r: f.r, k, a: f.b, b: f.a };
    }
    if (!best || Math.abs(best.r) < minR) continue;
    out.push({
      program,
      uniform,
      component: c,
      kind: 'scroll',
      scale: round(best.b, 8),
      offset: round(best.a, 6),
      k: best.k,
      r: round(Math.abs(best.r), 4),
      source: 'measured',
      lo: Math.min(...scroll),
      hi: Math.max(...scroll),
    });
  }
  return out;
}

/** Fit every uniform the probe saw move to the input it follows best. */
export function fitInputs(probe: ProbeData, opts: { minR?: number } = {}): ProbeReport {
  const minR = opts.minR ?? 0.9;
  const env = probe.env.filter((e) => e[2] >= 0 || e === probe.env[probe.env.length - 1]);
  const at = new Map(probe.env.map((e, i) => [e[0], i]));
  const sig = {
    px: probe.env.map((e) => (e[2] >= 0 ? e[2] / e[4] : Number.NaN)),
    py: probe.env.map((e) => (e[3] >= 0 ? e[3] / e[5] : Number.NaN)),
    scroll: probe.env.map((e) => e[1]),
    width: probe.env.map((e) => e[4]),
    height: probe.env.map((e) => e[5]),
    aspect: probe.env.map((e) => e[4] / e[5]),
  };
  // fill the pointer before its first event with its first value
  for (const k of ['px', 'py'] as const) {
    const first = sig[k].find((v) => Number.isFinite(v)) ?? 0.5;
    let last = first;
    sig[k] = sig[k].map((v) => (Number.isFinite(v) ? (last = v) : last));
  }
  const vel = (s: number[]) => s.map((v, i) => (i ? v - s[i - 1] : 0));
  const span = (s: number[]) => Math.max(...s) - Math.min(...s);
  const exercised = {
    pointer: span(sig.px) > 0.3 && span(sig.py) > 0.3,
    scroll: span(sig.scroll) > 100,
    resize: span(sig.width) > 50,
  };
  const candidates: Array<{ kind: InputKind; axis?: InputMap['axis']; s: number[] }> = [
    { kind: 'pointer', axis: 'x', s: sig.px },
    { kind: 'pointer', axis: 'y', s: sig.py },
    { kind: 'pointer-velocity', axis: 'x', s: vel(sig.px) },
    { kind: 'pointer-velocity', axis: 'y', s: vel(sig.py) },
    { kind: 'scroll', s: sig.scroll },
    { kind: 'viewport', axis: 'width', s: sig.width },
    { kind: 'viewport', axis: 'height', s: sig.height },
    { kind: 'viewport', axis: 'aspect', s: sig.aspect },
  ];
  const inputs: InputMap[] = [];
  const unexplained: string[] = [];
  for (const [key, rows] of Object.entries(probe.series)) {
    const bar = key.lastIndexOf('|');
    const program = Number(key.slice(0, bar));
    const uniform = key.slice(bar + 1);
    if (!Number.isFinite(program) || rows.length < 8) continue;
    const idx = rows.map((r) => at.get(r[0]) ?? -1);
    if (uniform.includes('#')) {
      const byPointer = exercised.pointer ? fitMatrix(program, uniform, rows, idx, sig, minR) : [];
      const byScroll = exercised.scroll ? fitMatrixScroll(program, uniform, rows, idx, sig.scroll, minR) : [];
      // a component that both follow goes to the closer fit
      for (const m of byPointer) {
        const o = byScroll.find((x) => x.component === m.component);
        if (!o || m.r >= o.r) inputs.push(m);
      }
      for (const m of byScroll) {
        const o = byPointer.find((x) => x.component === m.component);
        if (!o || m.r > o.r) inputs.push(m);
      }
      continue;
    }
    const comps = Math.max(...rows.map((r) => r.length - 1));
    for (let c = 0; c < comps; c++) {
      const vals = rows.map((r) => r[c + 1]);
      const keep = vals.map((v, i) => Number.isFinite(v) && idx[i] >= 0);
      const u = vals.filter((_, i) => keep[i]);
      if (u.length < 8) continue;
      const uSpan = span(u);
      if (uSpan <= Math.max(1e-6, Math.abs(Math.max(...u.map(Math.abs))) * 1e-5)) continue;
      // a value that only grows and follows time is a clock, not an input
      const ts = rows.filter((_, i) => keep[i]).map((r) => r[0] / 1000);
      const mono = u.every((v, i) => i === 0 || v >= u[i - 1] - 1e-9);
      const ct = corr(ts, u);
      if (mono && ct.r * ct.r > 0.97) {
        inputs.push({
          program,
          uniform,
          component: c,
          kind: 'clock',
          scale: round(ct.a / 1000, 8),
          offset: round(ct.b),
          k: 1,
          r: round(ct.r, 4),
          source: 'measured',
        });
        continue;
      }
      let best: { m: InputMap; r: number } | null = null;
      for (const cand of candidates) {
        const sAll = cand.s;
        for (const k of cand.kind === 'viewport' ? [1] : EASES) {
          const se = ease(sAll, k);
          const x = idx.filter((_, i) => keep[i]).map((j) => se[j]);
          if (span(x) <= 1e-9) continue;
          const f = corr(x, u);
          const r = Math.abs(f.r);
          // a tie goes to the input with less easing (listed first)
          if (r >= minR && (!best || r > best.r + 0.002))
            best = {
              r,
              m: {
                program,
                uniform,
                component: c,
                kind: cand.kind,
                axis: cand.axis,
                scale: round(f.a),
                offset: round(f.b),
                k,
                r: round(f.r, 4),
                source: 'measured',
              },
            };
        }
      }
      if (best) {
        if (best.m.kind === 'scroll') {
          best.m.lo = Math.min(...sig.scroll);
          best.m.hi = Math.max(...sig.scroll);
        }
        inputs.push(best.m);
      } else unexplained.push(`${uniform}[${c}] (program ${program})`);
    }
  }
  return { inputs, frames: env.length, exercised, unexplained };
}

const POINTER = /mouse|pointer|cursor|touch/i;
const SCROLL = /scroll/i;
const RES = /resolution|^u?res$|viewport|^uview$|^u_?size$|screen/i;

/**
 * Inputs read from names, for uniforms the probe did not see move: a pointer-named vec2 in 0..1 or -1..1, a scroll-named
 * float, a resolution-named vec2 equal to the canvas size. Inferred: the direction of y and the easing are guesses.
 */
export function inferInputs(
  uniforms: Array<{ program: number; name: string; value: number[] }>,
  canvas: { w: number; h: number },
  measured: InputMap[],
): InputMap[] {
  const out: InputMap[] = [];
  const has = (p: number, n: string) => measured.some((m) => m.program === p && m.uniform === n);
  for (const u of uniforms) {
    if (has(u.program, u.name)) continue;
    const v = u.value;
    if (POINTER.test(u.name) && v.length >= 2 && !/vel|speed|delta|prev|last/i.test(u.name)) {
      const signed = v[0] < -0.001 || v[1] < -0.001;
      const px = v[0] > 2 || v[1] > 2;
      for (const [c, axis] of [
        [0, 'x'],
        [1, 'y'],
      ] as const) {
        const [scale, offset] = px ? [axis === 'x' ? canvas.w : canvas.h, 0] : signed ? (axis === 'x' ? [2, -1] : [-2, 1]) : axis === 'x' ? [1, 0] : [-1, 1];
        out.push({ program: u.program, uniform: u.name, component: c, kind: 'pointer', axis, scale, offset, k: 1, r: 1, source: 'name' });
      }
    } else if (SCROLL.test(u.name) && v.length === 1) {
      out.push({ program: u.program, uniform: u.name, component: 0, kind: 'scroll', scale: 1, offset: 0, k: 1, r: 1, source: 'name' });
    } else if (RES.test(u.name) && v.length >= 2 && Math.abs(v[0] - canvas.w) < 2 && Math.abs(v[1] - canvas.h) < 2) {
      out.push({ program: u.program, uniform: u.name, component: 0, kind: 'viewport', axis: 'width', scale: 1, offset: 0, k: 1, r: 1, source: 'name' });
      out.push({ program: u.program, uniform: u.name, component: 1, kind: 'viewport', axis: 'height', scale: 1, offset: 0, k: 1, r: 1, source: 'name' });
    }
  }
  return out;
}

/** One line per input kind: what is live, from what evidence. */
export function inputsSummary(inputs: InputMap[]): string {
  if (!inputs.length) return 'no uniform follows the pointer, scroll or window size';
  const by = new Map<string, InputMap[]>();
  for (const m of inputs.filter((x) => x.kind !== 'clock')) {
    const k = m.kind === 'pointer-velocity' ? 'pointer' : m.kind;
    by.set(k, [...(by.get(k) ?? []), m]);
  }
  const parts: string[] = [];
  for (const [k, ms] of by) {
    const meas = ms.filter((m) => m.source === 'measured');
    const names = [...new Set(ms.map((m) => m.uniform))];
    parts.push(
      `${k}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''} (${meas.length ? `✔ measured on the site${meas.some((m) => m.k < 1) ? ', eased' : ''}` : '≈ from the name'})`,
    );
  }
  return parts.join(' · ') || 'only clocks';
}
