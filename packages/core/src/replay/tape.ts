// The pointer tape: the recording continued while the pointer moved along a known path and then stopped (see
// capture.ts recordTape). Frames that the site draws only while the pointer moves (a trail, sparks, a ripple) and the CPU
// uploads that feed them (bufferSubData of the trail's vertices) are in those frames. Playing them needs two things the
// recording alone does not give:
//   (1) which frame to play for the live pointer: the tape's frames while the pointer moves, then its settling frames;
//   (2) where the uploaded points go: the trail's vertices were recorded along the tape's pointer path. A vertex that sits on
//       (or near) that path is anchored to the path: "this point was where the pointer was `age` frames ago, offset from the
//       path by (along, normal)". Live, the point is placed where the live pointer was `age` frames ago, offset the same
//       way in the live path's own frame. A site's CPU history (trail, ribbon, cursor follower) therefore follows the
//       pointer's real path, and nothing about the site's own code has to be known.
// Verified when the uploaded vertices lie on the recorded path in one of the coordinate spaces below; otherwise the tape's
// frames still play (what the site drew), but their points stay where they were recorded.

import { type CaptureDoc, type Cmd, numbers } from './graph.ts';

export type TapeSpace = 'ndc' | 'ndc-flip' | 'uv' | 'uv-flip' | 'px' | 'px-flip';
const SPACES: TapeSpace[] = ['ndc', 'ndc-flip', 'uv', 'uv-flip', 'px', 'px-flip'];

export interface TapeAnchor {
  /** tape-relative frame and command index of the upload */
  f: number;
  c: number;
  buf: number;
  /** floats per vertex, and the coordinate space of the first two */
  stride: number;
  space: TapeSpace;
  /** per vertex: where on the recorded path (fractional tape frame; -1 = leave as recorded), and the offset from the path along and across it, in CSS px */
  tau: number[];
  al: number[];
  no: number[];
}

/**
 * A uniform the site sets only while the pointer moves (a splat's point and force, a ripple's centre): its recorded values
 * follow the recorded pointer, either as a position in one of the coordinate spaces or as the pointer's step since the last
 * frame times a gain. Live, the same uniform is set from the live pointer.
 */
export interface TapeUniform {
  /** program id and uniform name */
  p: number;
  n: string;
  /** which of the frame's sets of this uniform (a splat sets `color` once for the force and once for the dye) */
  k: number;
  kind: 'pos' | 'delta';
  space: TapeSpace;
  /** delta: value = gain x pointer step (fractions of the canvas, y down) */
  gx: number;
  gy: number;
  /** components the call carries; the ones after the first two keep their recorded values */
  rest: number[];
  /** how well the recorded values follow the recorded pointer (0..1) */
  fit: number;
  /** tape frames in which it was set */
  frames: number;
}

export interface TapeFit {
  anchors: TapeAnchor[];
  uniforms?: TapeUniform[];
  /** the recorded pointer path, normalised to the canvas (0..1), per tape frame */
  path: Array<[number, number]>;
  /** buffers examined: id, and how they scored */
  report: Array<{ buf: number; uploads: number; stride: number; space: TapeSpace | null; onPath: number; reason: string }>;
}

const num = (a: unknown): number => (typeof a === 'number' ? a : Number.NaN);

/** where in the canvas (0..1) the pointer was at each tape frame */
export function tapePath(doc: CaptureDoc, frames: CaptureDoc['frames']): Array<[number, number]> {
  const c = doc.canvas;
  const w = c.cssW || c.w;
  const h = c.cssH || c.h;
  let last: [number, number] = [0.5, 0.5];
  return frames.map((f) => {
    if (f.ptr) last = [(f.ptr[0] - c.x) / w, (f.ptr[1] - c.y) / h];
    return last;
  });
}

const toPx = (space: TapeSpace, X: number, Y: number, w: number, h: number): [number, number] => {
  switch (space) {
    case 'ndc':
      return [((X + 1) / 2) * w, ((1 - Y) / 2) * h];
    case 'ndc-flip':
      return [((X + 1) / 2) * w, ((Y + 1) / 2) * h];
    case 'uv':
      return [X * w, (1 - Y) * h];
    case 'uv-flip':
      return [X * w, Y * h];
    case 'px':
      return [X, Y];
    case 'px-flip':
      return [X, h - Y];
  }
};

/** nearest point of a polyline: [distance, fractional segment index, point, unit tangent] */
function nearest(P: Array<[number, number]>, x: number, y: number): { d: number; t: number; px: number; py: number; tx: number; ty: number } {
  let best = { d: Number.POSITIVE_INFINITY, t: 0, px: P[0][0], py: P[0][1], tx: 1, ty: 0 };
  for (let s = 0; s < P.length - 1; s++) {
    const [ax, ay] = P[s];
    const [bx, by] = P[s + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const u = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const px = ax + u * dx;
    const py = ay + u * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < best.d) {
      const l = Math.sqrt(l2) || 1;
      best = { d, t: s + u, px, py, tx: dx / l, ty: dy / l };
    }
  }
  return best;
}

interface Upload {
  f: number;
  c: number;
  buf: number;
  data: Float32Array;
}

/** every bufferSubData with its bytes in the tape frames, with the array buffer bound at the time */
function uploads(bin: Uint8Array, frames: CaptureDoc['frames']): Upload[] {
  const out: Upload[] = [];
  frames.forEach((fr, f) => {
    let bound = fr.state?.arrayBuffer ?? 0;
    fr.cmds.forEach((cmd: Cmd, c: number) => {
      const n = cmd[0];
      if (n === 'bindBuffer' && num(cmd[1]) === 0x8892) {
        const b = cmd[2] as { id?: number } | null;
        bound = b && typeof b === 'object' && 'id' in b ? Number(b.id) : 0;
      } else if (n === 'bufferSubData' && num(cmd[1]) === 0x8892) {
        const d = cmd[3] as { $?: string; o?: number; l?: number } | null;
        if (d?.$ !== 'bin' || d.o == null || !d.l || d.l % 4) return;
        const u8 = bin.subarray(d.o, d.o + d.l);
        const data = new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
        out.push({ f, c, buf: bound, data });
      }
    });
  });
  return out;
}

/**
 * Read the tape: which uploaded buffers carry the pointer's path (and in which space), and anchor their vertices to it.
 * `frames` are the tape frames only; `move` is how many of them had the pointer moving.
 */
export function fitTape(doc: CaptureDoc, bin: Uint8Array, frames: CaptureDoc['frames'], move: number): TapeFit {
  const fit = fitTapeBuffers(doc, bin, frames, move);
  fit.uniforms = fitTapeUniforms(doc, bin, frames, move);
  return fit;
}

function fitTapeBuffers(doc: CaptureDoc, bin: Uint8Array, frames: CaptureDoc['frames'], move: number): TapeFit {
  const path = tapePath(doc, frames);
  const w = doc.canvas.cssW || doc.canvas.w;
  const h = doc.canvas.cssH || doc.canvas.h;
  const P = path.slice(0, Math.max(2, move)).map(([x, y]) => [x * w, y * h] as [number, number]);
  const pathLen = P.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - P[i][0], p[1] - P[i][1]), 0);
  const eps = 0.04 * Math.max(w, h);
  const all = uploads(bin, frames);
  const byBuf = new Map<number, Upload[]>();
  for (const u of all) byBuf.set(u.buf, [...(byBuf.get(u.buf) ?? []), u]);
  const anchors: TapeAnchor[] = [];
  const report: TapeFit['report'] = [];
  if (pathLen < 0.05 * Math.max(w, h))
    return { anchors, path, report: [{ buf: 0, uploads: all.length, stride: 0, space: null, onPath: 0, reason: 'the pointer did not move during the tape' }] };
  for (const [buf, list] of byBuf) {
    // does the content change at all? (a buffer rewritten with the same bytes is not pointer-driven)
    const sig = new Set(
      list.map((u) => {
        let s = 0;
        for (let i = 0; i < u.data.length; i++) s += u.data[i] * ((i % 7) + 1);
        return `${u.data.length}:${s.toFixed(5)}`;
      }),
    );
    if (sig.size < 2) {
      report.push({ buf, uploads: list.length, stride: 0, space: null, onPath: 0, reason: 'unchanged' });
      continue;
    }
    let best: { stride: number; space: TapeSpace; frac: number } | null = null;
    for (const stride of [3, 2, 4]) {
      if (list.some((u) => u.data.length % stride)) continue;
      for (const space of SPACES) {
        let on = 0;
        let tot = 0;
        for (const u of list) {
          for (let i = 0; i < u.data.length; i += stride) {
            const X = u.data[i];
            const Y = u.data[i + 1];
            if (!Number.isFinite(X) || !Number.isFinite(Y) || (Math.abs(X) < 1e-9 && Math.abs(Y) < 1e-9)) continue;
            const [qx, qy] = toPx(space, X, Y, w, h);
            tot++;
            if (nearest(P, qx, qy).d <= eps) on++;
          }
        }
        const frac = tot ? on / tot : 0;
        if (tot >= 4 && (!best || frac > best.frac + 1e-9)) best = { stride, space, frac };
      }
    }
    if (!best || best.frac < 0.8) {
      report.push({
        buf,
        uploads: list.length,
        stride: best?.stride ?? 0,
        space: best?.space ?? null,
        onPath: best ? Math.round(best.frac * 100) / 100 : 0,
        reason: 'the points do not lie on the pointer path',
      });
      continue;
    }
    report.push({
      buf,
      uploads: list.length,
      stride: best.stride,
      space: best.space,
      onPath: Math.round(best.frac * 100) / 100,
      reason: 'anchored to the pointer path',
    });
    for (const u of list) {
      const n = u.data.length / best.stride;
      const tau: number[] = [];
      const al: number[] = [];
      const no: number[] = [];
      for (let k = 0; k < n; k++) {
        const X = u.data[k * best.stride];
        const Y = u.data[k * best.stride + 1];
        if (!Number.isFinite(X) || !Number.isFinite(Y) || (Math.abs(X) < 1e-9 && Math.abs(Y) < 1e-9)) {
          tau.push(-1);
          al.push(0);
          no.push(0);
          continue;
        }
        const [qx, qy] = toPx(best.space, X, Y, w, h);
        const nn = nearest(P, qx, qy);
        const dx = qx - nn.px;
        const dy = qy - nn.py;
        tau.push(Math.round(nn.t * 1000) / 1000);
        al.push(Math.round((dx * nn.tx + dy * nn.ty) * 100) / 100);
        no.push(Math.round((-dx * nn.ty + dy * nn.tx) * 100) / 100);
      }
      anchors.push({ f: u.f, c: u.c, buf, stride: best.stride, space: best.space, tau, al, no });
    }
  }
  return { anchors, path, report };
}

const UNIFORM_CALL = /^uniform[234]f(v)?$/;

/** where the pointer (fractions of the canvas, y down) sits in a coordinate space */
function inSpace(space: TapeSpace, u: number, v: number, w: number, h: number): [number, number] {
  switch (space) {
    case 'ndc':
      return [2 * u - 1, 1 - 2 * v];
    case 'ndc-flip':
      return [2 * u - 1, 2 * v - 1];
    case 'uv':
      return [u, 1 - v];
    case 'uv-flip':
      return [u, v];
    case 'px':
      return [u * w, v * h];
    case 'px-flip':
      return [u * w, (1 - v) * h];
  }
}

/**
 * Find the uniforms the site sets only while the pointer moves, and what in the pointer they follow: a position (the
 * value is where the pointer was, in one of six spaces) or a step (the value is the pointer's movement since the last frame
 * times a gain). Every tape frame is read (under load a frame can see several moves or none). Only uniforms that take at least three different values on the tape are tried;
 * a uniform is kept when its values follow the recorded pointer (position within 3% of the canvas, or step correlation
 * above 0.95 on both components).
 */
export function fitTapeUniforms(doc: CaptureDoc, bin: Uint8Array, frames: CaptureDoc['frames'], _move: number): TapeUniform[] {
  const path = tapePath(doc, frames);
  const w = doc.canvas.cssW || doc.canvas.w;
  const h = doc.canvas.cssH || doc.canvas.h;
  const sets = new Map<string, Array<{ f: number; v: number[] }>>();
  const loc = new Map<string, { p: number; n: string; k: number }>();
  frames.forEach((fr, f) => {
    const occ = new Map<string, number>();
    for (const cmd of fr.cmds as Cmd[]) {
      const name = cmd[0];
      const l = cmd[1] as { $?: string; p?: number; n?: string } | null;
      if (!UNIFORM_CALL.test(name) || l?.$ !== 'loc' || l.p == null || l.n == null) continue;
      const v = name.endsWith('v') ? numbers(cmd[2], bin) : cmd.slice(2).flatMap((x) => numbers(x as never, bin));
      if (v.length < 2 || v.some((x) => !Number.isFinite(x))) continue;
      const base = `${l.p}|${l.n}`;
      const o = occ.get(base) ?? 0;
      occ.set(base, o + 1);
      const k = `${base}#${o}`;
      loc.set(k, { p: l.p, n: l.n, k: o });
      sets.set(k, [...(sets.get(k) ?? []), { f, v }]);
    }
  });
  const out: TapeUniform[] = [];
  for (const [k, list] of sets) {
    const distinct = new Set(
      list.map((e) =>
        e.v
          .slice(0, 2)
          .map((x) => x.toFixed(4))
          .join(','),
      ),
    );
    if (list.length < 3 || distinct.size < 3) continue;
    const { p, n, k: occurrence } = loc.get(k) as { p: number; n: string; k: number };
    const rest = list[0].v.slice(2);
    // position: one of the six spaces, the pointer as of this frame or the one before
    let best: { space: TapeSpace; frac: number } | null = null;
    for (const space of SPACES) {
      for (const lag of [0, 1]) {
        const tol = space.startsWith('px') ? 0.03 * Math.max(w, h) : space.startsWith('ndc') ? 0.06 : 0.03;
        let ok = 0;
        for (const e of list) {
          const q = path[Math.max(0, e.f - lag)];
          const [X, Y] = inSpace(space, q[0], q[1], w, h);
          if (Math.hypot(e.v[0] - X, e.v[1] - Y) <= tol) ok++;
        }
        if (!best || ok / list.length > best.frac) best = { space, frac: ok / list.length };
      }
    }
    if (best && best.frac >= 0.8) {
      out.push({ p, n, k: occurrence, kind: 'pos', space: best.space, gx: 0, gy: 0, rest, fit: Math.round(best.frac * 100) / 100, frames: list.length });
      continue;
    }
    // step: value = gain x (pointer now - pointer one frame ago), per component
    const dx: number[] = [];
    const dy: number[] = [];
    for (const e of list) {
      const a = path[Math.max(0, e.f)];
      const b = path[Math.max(0, e.f - 1)];
      dx.push(a[0] - b[0]);
      dy.push(a[1] - b[1]);
    }
    const gain = (d: number[], y: number[]) => {
      const sxx = d.reduce((s, x) => s + x * x, 0);
      const sxy = d.reduce((s, x, i) => s + x * y[i], 0);
      const syy = y.reduce((s, x) => s + x * x, 0);
      return { g: sxx > 1e-12 ? sxy / sxx : 0, r: sxx > 1e-12 && syy > 1e-12 ? Math.abs(sxy) / Math.sqrt(sxx * syy) : 0 };
    };
    const X = gain(
      dx,
      list.map((e) => e.v[0]),
    );
    const Y = gain(
      dy,
      list.map((e) => e.v[1]),
    );
    if (X.r >= 0.95 && Y.r >= 0.95)
      out.push({
        p,
        n,
        k: occurrence,
        kind: 'delta',
        space: 'uv-flip',
        gx: X.g,
        gy: Y.g,
        rest,
        fit: Math.round(Math.min(X.r, Y.r) * 100) / 100,
        frames: list.length,
      });
  }
  return out;
}

/**
 * The runtime, as source: pasted into the replay player and the rebuild runner (plain functions, no imports).
 * createTape(info) returns null when the recording has no tape, else { step(x, y), place(f, c, floats) }:
 *   step: called once per displayed frame with the live pointer (0..1 of the window); returns the tape frame to play (0-based
 *         within the tape) or -1 to play the rest frames;
 *   place: the floats of an anchored upload, moved onto the live pointer's path (a new Float32Array), or null.
 */
export const TAPE_RUNTIME = String.raw`
function createTape(info) {
  if (!info || !info.n) return null;
  const move = info.move, still = info.still, n = info.n;
  const W = () => (typeof innerWidth === 'number' ? innerWidth : info.w), H = () => (typeof innerHeight === 'number' ? innerHeight : info.h);
  const hist = []; // live pointer positions, one per displayed frame, in CSS px of the recording's canvas box
  const by = new Map();
  for (const a of info.anchors || []) by.set(a.f + ':' + a.c, a);
  const UN = new Map();
  for (const a of info.uniforms || []) UN.set(a.p + '|' + a.n + '#' + a.k, a);
  let active = false, c = 0, sinceStill = 0, last = null, shown = -1;
  // a tape recorded with the button held plays only while the live button is held
  let down = false;
  if (info.drag && typeof addEventListener === 'function') {
    try {
      addEventListener('pointerdown', () => { down = true; }, true);
      addEventListener('pointerup', () => { down = false; }, true);
      addEventListener('pointercancel', () => { down = false; }, true);
    } catch (e) {}
  }
  const toMap = (space, px, py, w, h) => {
    switch (space) {
      case 'ndc': return [(px / w) * 2 - 1, 1 - (py / h) * 2];
      case 'ndc-flip': return [(px / w) * 2 - 1, (py / h) * 2 - 1];
      case 'uv': return [px / w, 1 - py / h];
      case 'uv-flip': return [px / w, py / h];
      case 'px': return [px, py];
      default: return [px, h - py];
    }
  };
  // the live pointer's position age frames before the newest, interpolated; the oldest known past the history
  const at = (age) => {
    const L = hist.length;
    const t = Math.max(0, L - 1 - age);
    const i = Math.floor(t), u = t - i;
    const a = hist[i], b = hist[Math.min(L - 1, i + 1)];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  return {
    info,
    setDown(v) { down = !!v; },
    step(x, y) {
      const w = info.w, h = info.h; // the canvas box the anchors were measured in
      const px = x * w, py = y * h;
      const moved = last && Math.hypot(px - last[0], py - last[1]) > 0.0008 * Math.max(w, h) && (!info.drag || down);
      last = [px, py];
      hist.push([px, py]); if (hist.length > 400) hist.shift();
      if (moved) { c = active ? (c < move ? Math.min(c + 1, move - 1) : move - 1) : 0; active = true; sinceStill = 0; }
      else if (active) { sinceStill++; c = Math.max(c, move - 1) + 1; if (c >= n) { active = false; c = 0; } }
      shown = active ? c : -1;
      return shown;
    },
    // a uniform the site sets only while the pointer moves, from the live pointer: its position, or its step since the last frame
    uniform(p, n, k) {
      const a = UN.get(p + '|' + n + '#' + (k || 0));
      if (!a || !hist.length) return null;
      const w = info.w, h = info.h;
      const now = hist[hist.length - 1], prev = hist.length > 1 ? hist[hist.length - 2] : now;
      if (a.kind === 'pos') { const m = toMap(a.space, now[0], now[1], w, h); return [m[0], m[1]].concat(a.rest); }
      return [a.gx * (now[0] - prev[0]) / w, a.gy * (now[1] - prev[1]) / h].concat(a.rest);
    },
    place(f, ci, data) {
      const a = by.get(f + ':' + ci);
      if (!a || hist.length < 2) return null;
      const w = info.w, h = info.h;
      const out = new Float32Array(data);
      const nv = Math.floor(out.length / a.stride);
      for (let k = 0; k < nv; k++) {
        const tau = a.tau[k];
        if (tau < 0) continue;
        const age = f - tau;
        const p = at(age), p2 = at(age - 0.5), p1 = at(age + 0.5);
        let tx = p2[0] - p1[0], ty = p2[1] - p1[1];
        const l = Math.hypot(tx, ty);
        if (l < 1e-6) { tx = 1; ty = 0; } else { tx /= l; ty /= l; }
        const qx = p[0] + a.al[k] * tx - a.no[k] * ty, qy = p[1] + a.al[k] * ty + a.no[k] * tx;
        const m = toMap(a.space, qx, qy, w, h);
        out[k * a.stride] = m[0]; out[k * a.stride + 1] = m[1];
      }
      return out;
    },
  };
}
`;
