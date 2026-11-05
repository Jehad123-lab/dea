// The scroll tape: the recording continued while the page was scrolled, a stop at a time (capture.ts recordScrollTape).
//
// Why frames and not only uniforms: a scroll-driven scene is not always a linear function of the scroll. A site that eases
// its scroll in JavaScript, steps a timeline, or moves hundreds of instances on the CPU puts the result into the GPU as
// buffer and texture uploads and non-linear uniform values; a straight-line fit of each uniform to the scroll (replay/inputs.ts)
// cannot follow that. The tape records what the site actually did at each stop (every draw, every upload), and the replay
// and the rebuild play the stop nearest to the live, eased scroll, with the uploads of the stops in between applied first so
// a buffer the site only re-uploads when it changes holds the right bytes.
//
// What is verified and what is not (the evidence ledger says so too):
//   verified   the recorded stops: their scroll signal, their frames, what changed between them (read from the recording)
//   inferred   the picture between two stops (the nearest stop is shown; uniform values and float uploads are blended)
//   unknown    state the site keeps between stops (history, springs) and anything past the probed extent

import { type Arg, type CaptureDoc, type Cmd, numbers } from './graph.ts';

export interface ScrollStopFit {
  sc: number;
  /** the wheel input at the stop (what the kit is keyed by) */
  wh: number;
  f0: number;
  f1: number;
  /** share of the recorded uniform and upload commands that differ from the top of the page (0..1) */
  changed: number;
  /** programs that drew in the settled frame, and the number of draws */
  programs: number[];
  draws: number;
}

export interface ScrollTapeFit {
  stops: ScrollStopFit[];
  /** every stop's settled frame has the same command sequence (names and order): uniforms and uploads can be blended */
  aligned: boolean;
  /** buffers the site re-uploaded during the tape, and how many of them in full at every stop */
  uploadBuffers: number;
  uploadFull: number;
  /** easing per frame for the live scroll before it picks a stop */
  k: number;
  /** wheel px per px of the page's own scroll (1 for a virtual scroll): a kit page that scrolls natively is converted with it */
  ratio: number;
  /** bytes of the tape's uploads in the recording */
  bytes: number;
}

const UPLOADS = new Set(['bufferSubData', 'bufferData', 'texSubImage2D', 'texSubImage3D', 'texImage2D', 'texImage3D', 'compressedTexSubImage2D']);
const DRAW = /^(draw|ext:.*\.draw)/;
const isUniform = (n: string) => n.startsWith('uniform');
const id = (a: Arg | undefined, kind: string): number => (a && typeof a === 'object' && !Array.isArray(a) && a.$ === kind ? Number(a.id) : -1);

function fnv(bin: Uint8Array, o: number, l: number): number {
  let h = 2166136261;
  const stride = l > 65536 ? 4 : 1;
  for (let i = 0; i < l; i += stride) h = Math.imul(h ^ bin[o + i], 16777619);
  return h >>> 0;
}

/** A command's payload as a comparable key: uniform values, or the hash of the uploaded bytes. null when it carries none. */
function payloadKey(c: Cmd, bin: Uint8Array): string | null {
  const name = c[0];
  if (isUniform(name))
    return numbers(c.slice(2) as Arg, bin)
      .map((x) => (Number.isFinite(x) ? Math.round(x * 500) / 500 : 0))
      .join(',');
  if (UPLOADS.has(name)) {
    for (const a of c.slice(1)) {
      if (a && typeof a === 'object' && !Array.isArray(a) && a.$ === 'bin') return `${a.l}:${fnv(bin, Number(a.o), Number(a.l))}`;
    }
    return 'none';
  }
  return null;
}

/**
 * Command indices (of the settled frames, which line up when the site draws the same way at every stop) whose first number is a
 * straight line of the frame's own timestamp over every frame of the tape: a time uniform, not a scroll-driven value.
 */
export function clockCommands(frames: NonNullable<CaptureDoc['scrollFrames']>, stops: Array<{ f0: number; f1: number }>): Set<number> {
  const out = new Set<number>();
  const ref = frames[stops[0].f1];
  if (!ref) return out;
  const ts = frames.map((f) => (typeof f.ts === 'number' ? f.ts : Number.NaN));
  if (ts.filter(Number.isFinite).length < 6) return out;
  for (let i = 0; i < ref.cmds.length; i++) {
    const name = ref.cmds[i][0];
    if (!/^uniform[1-4]f$/.test(name)) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let f = 0; f < frames.length; f++) {
      const c = frames[f].cmds[i];
      if (!c || c[0] !== name || typeof c[2] !== 'number' || !Number.isFinite(ts[f])) continue;
      xs.push(ts[f]);
      ys.push(c[2] as number);
    }
    if (xs.length < 6) continue;
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let k = 0; k < n; k++) {
      sxy += (xs[k] - mx) * (ys[k] - my);
      sxx += (xs[k] - mx) ** 2;
      syy += (ys[k] - my) ** 2;
    }
    if (sxx > 0 && syy > 1e-12 && (sxy * sxy) / (sxx * syy) > 0.9995) out.add(i);
  }
  return out;
}

/** Fit the tape: what changed at each stop, which programs drew, whether the frames line up, how the uploads behave. */
export function fitScrollTape(
  doc: CaptureDoc,
  bin: Uint8Array,
  meta: { stops: Array<{ sc: number; wh?: number; f0: number; f1: number }> },
): ScrollTapeFit | null {
  const frames = doc.scrollFrames ?? [];
  const stops = meta.stops.filter((s) => s.f1 < frames.length && s.f0 <= s.f1);
  if (stops.length < 2) return null;
  const ordered = [...stops].sort((a, b) => (a.wh ?? a.sc) - (b.wh ?? b.sc) || a.sc - b.sc);
  const top = ordered[0];
  const keysOf = (f: number) => frames[f].cmds.map((c) => payloadKey(c, bin));
  const topKeys = keysOf(top.f1);
  // a clock is a value that is a straight line in time across the whole tape, scroll or not (a time uniform); it says nothing
  // about where the scroll is, so it is left out of "what changed"
  const clock = clockCommands(frames, ordered);
  const topNames = frames[top.f1].cmds.map((c) => c[0]).join('|');
  let aligned = true;
  const fit: ScrollStopFit[] = ordered.map((s) => {
    const cmds = frames[s.f1].cmds;
    if (cmds.map((c) => c[0]).join('|') !== topNames) aligned = false;
    const keys = keysOf(s.f1);
    let n = 0;
    let diff = 0;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] == null || clock.has(i)) continue;
      n++;
      if (keys[i] !== (topKeys[i] ?? null)) diff++;
    }
    const programs = new Set<number>();
    let draws = 0;
    let cur = -1;
    for (const c of cmds) {
      if (c[0] === 'useProgram') cur = id(c[1], 'prog');
      else if (DRAW.test(c[0])) {
        draws++;
        if (cur >= 0) programs.add(cur);
      }
    }
    return {
      sc: s.sc,
      wh: s.wh ?? s.sc,
      f0: s.f0,
      f1: s.f1,
      changed: n ? Math.round((diff / n) * 1000) / 1000 : 0,
      programs: [...programs].sort((a, b) => a - b),
      draws,
    };
  });
  // buffer uploads: per buffer, the byte ranges uploaded in each stop's frames; "full" when every stop uploads the same ranges
  const perBuf = new Map<number, Array<Set<string>>>();
  ordered.forEach((s, si) => {
    for (let f = s.f0; f <= s.f1; f++) {
      let bound = -1;
      for (const c of frames[f].cmds) {
        if (c[0] === 'bindBuffer' && Number(c[1]) === 34962) bound = id(c[2], 'buf');
        else if (c[0] === 'bufferSubData' && bound >= 0) {
          const d = c.find((a) => a && typeof a === 'object' && !Array.isArray(a) && a.$ === 'bin') as { l: number } | undefined;
          const arr = perBuf.get(bound) ?? ordered.map(() => new Set<string>());
          arr[si].add(`${Number(c[2])}:${d ? d.l : 0}`);
          perBuf.set(bound, arr);
        }
      }
    }
  });
  let full = 0;
  for (const arr of perBuf.values()) {
    const first = [...arr[0]].sort().join('|');
    if (first && arr.every((s) => [...s].sort().join('|') === first)) full++;
  }
  let bytes = 0;
  for (const f of frames)
    for (const c of f.cmds) for (const a of c.slice(1)) if (a && typeof a === 'object' && !Array.isArray(a) && a.$ === 'bin') bytes += Number(a.l);
  const last = ordered[ordered.length - 1];
  const ratio = last.sc > 0 && (last.wh ?? 0) > 0 ? Math.round(((last.wh ?? last.sc) / last.sc) * 1000) / 1000 : 1;
  return { stops: fit, aligned, uploadBuffers: perBuf.size, uploadFull: full, k: 0.25, bytes, ratio };
}

/** Does the tape show anything that changed with the scroll? */
export const tapeMoved = (fit: ScrollTapeFit | null): boolean => !!fit && fit.stops.some((s) => s.changed > 0.001);

/**
 * The runtime, as source: pasted into the replay player and the rebuild runner (plain functions, no imports).
 * createScrollTape(info) returns null when the recording has no scroll tape, else { step(x, lastParity, base) } where x is the
 * live scroll signal (px of input). step returns null while the page has not been scrolled, else
 *   { frame, catchUp }: the tape-relative frame to draw, and tape-relative frames whose uploads (not draws) run first.
 * `base` is the absolute index of tape frame 0, `lastParity` the parity of the frame drawn last (-1 none): a ping-pong
 * simulation needs the frames to alternate, so a frame of the wrong parity gives way to its neighbour in the same stop.
 */
export const SCROLL_RUNTIME = String.raw`
function createScrollTape(info) {
  if (!info || !info.stops || info.stops.length < 2) return null;
  const stops = info.stops.slice().sort((a, b) => (a.wh != null ? a.wh : a.sc) - (b.wh != null ? b.wh : b.sc));
  const key = (s) => (s.wh != null ? s.wh : s.sc);
  const k = info.k || 0.25;
  let eased = 0, touched = false, cur = 0, curSet = false;
  const nearest = (x) => { let b = 0; for (let i = 1; i < stops.length; i++) if (Math.abs(key(stops[i]) - x) < Math.abs(key(stops[b]) - x)) b = i; return b; };
  return {
    info,
    get position() { return eased; },
    step(x, lastParity, base) {
      eased += k * (x - eased);
      if (Math.abs(x - eased) < 0.5) eased = x;
      if (!touched && Math.abs(eased) < 1) return null;
      touched = true;
      const b = nearest(eased);
      const S = stops[b];
      const catchUp = [];
      if (!curSet) { curSet = true; cur = 0; }
      if (b !== cur) {
        // forward: every stop in between uploads in full; the stop shown contributes all but its last frame
        if (b > cur) for (let i = cur + 1; i < b; i++) for (let f = stops[i].f0; f <= stops[i].f1; f++) catchUp.push(f);
        for (let f = S.f0; f < S.f1; f++) catchUp.push(f);
        cur = b;
      }
      // between two stops: the next stop in the direction of the live scroll, and how far along (blend only when the frames line up)
      let blend = null, partner = null;
      if (info.aligned) {
        const n = eased >= key(S) ? b + 1 : b - 1;
        if (n >= 0 && n < stops.length) {
          const w = Math.abs(eased - key(S)) / (Math.abs(key(stops[n]) - key(S)) || 1);
          if (w > 0.02 && w <= 1) { partner = stops[n]; blend = { frame: partner.f1, w }; }
        }
      }
      let f = S.f1;
      if (lastParity != null && lastParity >= 0 && (base + f) % 2 === lastParity && f - 1 >= S.f0) f = f - 1;
      if (blend && f !== S.f1) blend = partner.f1 - 1 >= partner.f0 ? { frame: partner.f1 - 1, w: blend.w } : null;
      return { frame: f, catchUp, stop: b, blend };
    },
  };
}
`;

/** One scroll stop of the page map: what was in view and which programs drew. */
export interface MapStop {
  i: number;
  sc: number;
  scrollY: number | null;
  /** programs drawing at this stop, and whether the set differs from the stop before */
  programs: number[];
  draws: number;
  changed: number;
  sceneChange: boolean;
  sections: Array<{ sel: string; heading: string; share: number }>;
  canvases: Array<{ sel: string; share: number }>;
}

export interface MapSection {
  sel: string;
  heading: string;
  /** first and last stop index (by scroll) where it is the largest section in view, or null if it never leads */
  leads: [number, number] | null;
  /** the stops where it is in view at all */
  stops: number[];
  /** programs that draw at the stops where it leads */
  programs: number[];
}

export interface PageMapDoc {
  schema: 'dea.page-map/1';
  url: string;
  mechanism: 'native' | 'virtual' | 'none';
  extent: number;
  documentHeight: number;
  viewport: [number, number];
  stops: MapStop[];
  sections: MapSection[];
  canvases: string[];
  sceneChanges: number;
}

/** The page map from the fit and the DOM read at each stop. Pure. */
export function buildPageMap(
  url: string,
  fit: ScrollTapeFit,
  meta: {
    mechanism: 'native' | 'virtual';
    stops: Array<{
      sc: number;
      f0: number;
      f1: number;
      dom?: { scrollY: number; docHeight: number; viewport: [number, number]; inView: MapStop['sections']; canvases: MapStop['canvases'] } | null;
    }>;
  },
): PageMapDoc {
  const byKey = new Map(meta.stops.map((s) => [`${s.sc}:${s.f1}`, s]));
  const stops: MapStop[] = fit.stops.map((s, i) => {
    const dom = byKey.get(`${s.sc}:${s.f1}`)?.dom ?? null;
    return {
      i,
      sc: s.sc,
      scrollY: dom?.scrollY ?? null,
      programs: s.programs,
      draws: s.draws,
      changed: s.changed,
      sceneChange: false,
      sections: dom?.inView ?? [],
      canvases: dom?.canvases ?? [],
    };
  });
  stops.forEach((s, i) => {
    if (!i) return;
    const prev = stops[i - 1];
    const samePrograms = prev.programs.join() === s.programs.join();
    const drawsClose = Math.abs(prev.draws - s.draws) <= Math.max(1, prev.draws * 0.25);
    s.sceneChange = !samePrograms || !drawsClose;
  });
  const sections = new Map<string, MapSection>();
  for (const s of stops) {
    s.sections.forEach((x, rank) => {
      const key = `${x.sel}|${x.heading}`;
      const m = sections.get(key) ?? { sel: x.sel, heading: x.heading, leads: null, stops: [], programs: [] };
      m.stops.push(s.i);
      if (rank === 0) {
        m.leads = m.leads ? [m.leads[0], s.i] : [s.i, s.i];
        for (const p of s.programs) if (!m.programs.includes(p)) m.programs.push(p);
      }
      sections.set(key, m);
    });
  }
  const last = meta.stops.map((s) => s.dom).find((d) => d);
  const canvases = [...new Set(stops.flatMap((s) => s.canvases.map((c) => c.sel)))];
  const ext = stops.length ? Math.max(...stops.map((s) => s.sc)) : 0;
  return {
    schema: 'dea.page-map/1',
    url,
    mechanism: stops.some((s) => s.changed > 0.001) || meta.mechanism === 'native' ? meta.mechanism : 'virtual',
    extent: ext,
    documentHeight: last?.docHeight ?? 0,
    viewport: last?.viewport ?? [0, 0],
    stops,
    sections: [...sections.values()],
    canvases,
    sceneChanges: stops.filter((s) => s.sceneChange).length,
  };
}

export function pageMapMd(m: PageMapDoc): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const gl = m.stops.some((s) => s.programs.length || s.draws);
  const out: string[] = [
    '# Page map',
    '',
    `${m.url} · ${m.mechanism} scroll · probed ${Math.round(m.extent)} px${m.mechanism === 'native' ? ` of ${Math.round(m.documentHeight)} px` : ' of wheel input (a virtual scroll has no document height)'} · ${m.stops.length} stops · ${m.canvases.length} canvas(es)`,
    '',
    gl
      ? 'Each stop is a recorded scroll position. ✔ Verified: the programs and draw counts are read from the recorded frame at that stop; the sections in view are read from the DOM then. A scene change means the set of programs (or the draw count by more than a quarter) differs from the stop before.'
      : 'Each stop is a scroll position of a fresh load. ✔ Verified: the sections and canvases in view are read from the DOM at that stop. No WebGL was recorded, so there are no programs or draws.',
    '',
    gl
      ? '| stop | scroll | programs | draws | changed vs top | scene change | in view (largest first) | canvases |'
      : '| stop | scroll | in view (largest first) | canvases |',
    gl ? '|---|---|---|---|---|---|---|---|' : '|---|---|---|---|',
  ];
  for (const s of m.stops) {
    const view = s.sections.map((x) => `${x.sel}${x.heading ? ` “${x.heading}”` : ''} ${pct(x.share)}`).join('; ') || 'n/a';
    const cv = s.canvases.map((c) => `${c.sel} ${pct(c.share)}`).join('; ') || 'none';
    out.push(
      gl
        ? `| ${s.i} | ${Math.round(s.sc)} | ${s.programs.join(', ') || 'none'} | ${s.draws} | ${pct(s.changed)} | ${s.sceneChange ? 'yes' : ''} | ${view} | ${cv} |`
        : `| ${s.i} | ${Math.round(s.sc)} | ${view} | ${cv} |`,
    );
  }
  if (m.sections.length) {
    out.push('', '## Sections', '');
    for (const s of m.sections)
      out.push(
        `- \`${s.sel}\`${s.heading ? ` “${s.heading}”` : ''}: in view at stops ${s.stops.join(', ')}${s.leads ? `; leads at ${s.leads[0] === s.leads[1] ? s.leads[0] : `${s.leads[0]}–${s.leads[1]}`} with programs ${s.programs.join(', ') || 'none'}` : ''}`,
      );
  }
  out.push(
    '',
    '## Limits',
    '',
    '- The probe scrolled a fixed number of stops; a page longer than that is covered only as far as the extent above.',
    '- Only the busiest WebGL canvas is recorded; other canvases are listed but their draws are not in the stops.',
    '- Pages behind links (routes) are not followed.',
    '',
  );
  return out.join('\n');
}
