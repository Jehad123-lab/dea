// The evidence ledger: what a decode may be built on, as data. Every finding carries its label (Verified, Inferred, Unknown),
// the measurement behind it, how much of the thing was actually exercised (coverage), what limits it, and, for what is not
// known, the probe that would close it. An agent reads `evidence.json` (or asks the MCP tool `get_evidence`) instead of
// parsing prose; a person reads `evidence.md`.
//
// Rules the builder follows (they are the point of the file):
//   1. A label names the strength of the measurement, never of the hope: Verified = measured on the site in this run and
//      compared with the original; Inferred = follows from a recorded value or a name but was not seen to work; Unknown =
//      not measured or not reproduced.
//   2. Absence is never concluded from partial coverage. "No uniform follows the scroll" is Verified only when the scroll
//      was exercised and moved something; when it was not, the finding is Unknown with coverage `not-exercised`.
//   3. A score of a single held frame is recorded as what it is (the recording plays back), not as proof of motion.
//   4. Findings have stable ids inside a run (`<area>.<name>`); a gap links to the findings it follows from.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Gap } from '../gaps.ts';
import type { Label } from '../types.ts';

/** How much of the thing the measurement covered. */
export type Coverage = 'complete' | 'partial' | 'not-exercised';

export interface Finding {
  /** stable inside a run: `<area>.<name>` */
  id: string;
  area: 'scene' | 'input' | 'scroll' | 'page' | 'boot' | 'build' | 'assets' | 'run';
  /** one plain sentence */
  claim: string;
  label: Label;
  /** what was measured, with the numbers (the recording, the probe, the score), so the claim can be checked */
  measurement: string;
  coverage: Coverage;
  /** what limits the claim (one held frame, a scripted subset, a machine without a GPU) */
  limitations: string[];
  /** the probe that would close an Unknown or firm up an Inferred */
  nextProbe?: string;
  /** numbers an agent can use directly */
  data?: Record<string, number | string | boolean | null>;
}

export interface LedgerUnknown {
  id: string;
  topic: string;
  missing: string;
  /** finding ids this unknown follows from */
  follows: string[];
  next: Array<{ why: string; command: string }>;
}

export interface LedgerFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface EvidenceLedger {
  schema: 'dea.evidence/1';
  url: string;
  runId: string;
  madeAt: string;
  mode: 'full' | 'quick';
  /** the machine this was measured on: a software renderer changes timings, never the recorded values */
  machine: string;
  counts: Record<Label, number> & { total: number };
  findings: Finding[];
  unknowns: LedgerUnknown[];
  files: LedgerFile[];
}

/** What the builder reads from a finished extract (a subset of ExtractResult, so it can be tested without a browser). */
export interface LedgerInput {
  url: string;
  runId: string;
  quick: boolean;
  ownAssets: boolean;
  machine?: string;
  diff?: { start: number; final: number; referenceLoader?: boolean; referenceAtMs?: number } | null;
  replay?: {
    frames: number;
    passes: number;
    draws: number;
    programs: number;
    bytes: number;
    canvas: number | null;
    page: number | null;
    shipped: boolean;
    errors: string[];
    clocks?: number;
    inputs?: Array<{ uniform: string; kind: string; source: 'measured' | 'name'; r: number }>;
    scrollTape?: ScrollTapeInfo | null;
    rebuild: null | { canvas: number | null; page: number | null; vsReplay?: number | null; errors: string[] };
  } | null;
  interaction?: {
    replay: { response: number | null } | null;
    rebuild: { response: number | null } | null;
    inputs: Array<{ input: string; status: string; replay: string; rebuild: string; uniforms: string[]; evidence: string }>;
  } | null;
  /** how the fresh load the interaction ran on was brought to the phase of the reference picture */
  phase?: {
    aligned: boolean | null;
    refDiff: number | null;
    bestDiff: number | null;
    waitedMs: number;
    note: string;
    stable: boolean;
    timeDriven: boolean;
  } | null;
  /** the whole page: what was read, and the kit's similarity to the original at each scroll stop */
  pageStops?: {
    views: Record<string, number | null>;
    stops: Array<{ y: number; scores: Record<string, number | null> }>;
    extent: number;
    documentHeight: number;
    elements: number;
    counts: { static: number; fixed: number; moving: number };
    limits: string[];
    mechanism: string;
  } | null;
  map?: PageMapInfo | null;
  boot?: BootInfo | null;
  build?: { ok: boolean; skipped?: string; step?: string } | null;
  gaps: Gap[];
  /** files of the kit with their absolute paths, to be hashed */
  hashFiles?: Array<{ rel: string; abs: string }>;
}

/** What the scroll tape recorded and what its fit found (see replay/scrolltape.ts). */
export interface ScrollTapeInfo {
  stops: number;
  /** the scroll signal at each stop, px of input */
  at: number[];
  /** page: the document scrolls; virtual: the page does not scroll but answers the wheel; none: nothing moved */
  mechanism: 'native' | 'virtual' | 'none';
  /** per stop: how much the picture changed against the first stop (0..1, mean absolute difference of the draw calls' state) */
  changed: number[];
  /** how the kit follows the scroll: curve = uniforms read from a measured curve, frames = recorded frames chosen by scroll */
  mode: 'frames' | 'none';
  /** number of recorded frames kept for it, and the bytes */
  frames: number;
  bytes: number;
  /** buffers the site re-uploaded as scroll changed: how many, and how many were uploaded in full at every stop */
  uploadBuffers: number;
  uploadFull: number;
}

export interface PageMapInfo {
  mechanism: 'native' | 'virtual' | 'none';
  /** the extent the probe scrolled, px */
  extent: number;
  /** extent the document reports (scrollHeight), px; equals the viewport for a virtual scroll */
  documentHeight: number;
  sections: number;
  stops: number;
  /** stops where the set of programs drawing changed against the stop before */
  sceneChanges: number;
  canvases: number;
}

export interface BootInfo {
  /** ms from navigation to: first canvas, first draw, last shader link, last texture upload seen before the reference */
  firstCanvasMs: number | null;
  firstDrawMs: number | null;
  lastLinkMs: number | null;
  programs: number;
  /** programs linked in the last 2 s before the reference: a loader still compiling */
  linkingNearReference: number;
}

/** The boot timeline from the marks the recorder noted in the page (ms since navigation). */
export function bootInfo(b: { canvas: number | null; draw: number | null; links: number[]; armed: number | null } | undefined | null): BootInfo | null {
  if (!b) return null;
  const at = b.armed ?? (b.links.length ? Math.max(...b.links) : 0);
  return {
    firstCanvasMs: b.canvas,
    firstDrawMs: b.draw,
    lastLinkMs: b.links.length ? Math.max(...b.links) : null,
    programs: b.links.length,
    // programs linked in the 2.5 s before the reference frames were taken: a loader still compiling
    linkingNearReference: b.links.filter((t) => t > at - 2500 && t <= at + 500).length,
  };
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Findings from what the run measured. Pure: no I/O. */
export function buildFindings(i: LedgerInput): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);
  const oneFrame = (i.replay?.frames ?? 0) <= 1 || i.quick;

  // ---- the reference itself: a score against a loader frame says nothing
  if (i.diff) {
    if (i.diff.referenceLoader) {
      add({
        id: 'run.reference',
        area: 'run',
        claim: 'The reference screenshot may show a loading screen, so the scores below are against the loader, not the site.',
        label: 'Unknown',
        measurement: `a loader was still visible when the reference was taken${i.diff.referenceAtMs != null ? ` (${Math.round(i.diff.referenceAtMs / 1000)} s)` : ''}`,
        coverage: 'partial',
        limitations: ['every score that uses this reference inherits the doubt'],
        nextProbe: 'dea extract <url> --reference-ms 120000',
      });
    } else {
      add({
        id: 'run.reference',
        area: 'run',
        claim: 'The reference screenshot is the settled site (no loader visible).',
        label: 'Verified',
        measurement: `no loader element was visible at the reference${i.diff.referenceAtMs != null ? ` (${Math.round(i.diff.referenceAtMs / 1000)} s after load)` : ''}`,
        coverage: 'complete',
        limitations: ['a loader that does not use a recognisable element would not be seen'],
      });
    }
  }

  // ---- the scene: replay and rebuild
  const r = i.replay;
  if (r) {
    const hasScore = r.canvas != null || r.page != null;
    add({
      id: 'scene.replay',
      area: 'scene',
      claim: 'The capture replay draws the recorded frame the site drew.',
      label: hasScore ? 'Verified' : 'Inferred',
      measurement: hasScore
        ? `canvas ${r.canvas != null ? pct(r.canvas) : 'n/a'}, page ${r.page != null ? pct(r.page) : 'n/a'} against the reference; ${r.frames} recorded frame(s), ${r.passes} passes, ${r.draws} draws, ${r.programs} programs, ${(r.bytes / 1e6).toFixed(1)} MB`
        : `${r.frames} recorded frame(s), ${r.passes} passes; not scored`,
      coverage: oneFrame ? 'partial' : 'complete',
      limitations: [
        'a replay of one held frame scores near 100% by construction: it shows the recording plays back, not that motion or input is understood',
        ...(r.shipped ? [] : ['scored, but the recorded bytes are not in the kit (--own-assets)']),
        ...(r.errors.length ? [`${r.errors.length} replay error(s): ${r.errors[0].slice(0, 120)}`] : []),
      ],
      data: { canvas: r.canvas, page: r.page, frames: r.frames, passes: r.passes, draws: r.draws, programs: r.programs },
    });
    if (r.rebuild) {
      const rb = r.rebuild;
      add({
        id: 'scene.rebuild',
        area: 'scene',
        claim: 'The editable three.js rebuild draws the same picture as the capture replay.',
        label: rb.canvas != null || rb.page != null ? 'Verified' : 'Inferred',
        measurement: `canvas ${rb.canvas != null ? pct(rb.canvas) : 'n/a'}, page ${rb.page != null ? pct(rb.page) : 'n/a'} against the reference${rb.vsReplay != null ? `; ${pct(rb.vsReplay)} against the replay` : ''}`,
        coverage: oneFrame ? 'partial' : 'complete',
        limitations: [
          'one frame: the same caveat as the replay',
          ...(rb.errors.length ? [`${rb.errors.length} rebuild error(s): ${rb.errors[0].slice(0, 120)}`] : []),
          ...(i.ownAssets ? ['--own-assets: images are placeholders and big meshes are coarse stand-ins (or boxes), so this score is lower by design'] : []),
        ],
        data: { canvas: rb.canvas, page: rb.page, vsReplay: rb.vsReplay ?? null },
      });
    } else {
      add({
        id: 'scene.rebuild',
        area: 'scene',
        claim: 'No editable rebuild was made.',
        label: 'Unknown',
        measurement: 'the rebuild stage produced nothing',
        coverage: 'not-exercised',
        limitations: [],
        nextProbe: 'dea extract <url> (full mode, not --quick)',
      });
    }
  }

  // ---- inputs: what each input does in the kit, on what evidence, and whether the probe even exercised it
  if (i.interaction) {
    for (const v of i.interaction.inputs) {
      const label: Label = v.status === 'verified' ? 'Verified' : v.status === 'inferred' ? 'Inferred' : 'Unknown';
      const frozen = v.status === 'frozen';
      add({
        id: `input.${v.input}`,
        area: 'input',
        claim:
          v.status === 'verified'
            ? `The kit follows the ${v.input} like the site does (replay ${v.replay}, rebuild ${v.rebuild}).`
            : v.status === 'inferred'
              ? `The kit follows the ${v.input} from a uniform's name; it was not measured moving.`
              : frozen
                ? `The site answers the ${v.input}, but the kit plays it as recorded.`
                : `The site's WebGL did not answer the ${v.input} in this probe.`,
        label,
        measurement: v.evidence,
        coverage: v.status === 'not used' ? 'partial' : 'complete',
        limitations:
          v.status === 'not used'
            ? ['absence is only as strong as the probe: a script that cannot reach the input (an intro gate, a virtual scroll) reads the same']
            : ['uniforms followed the input; that does not mean the whole animation is reproduced'],
        nextProbe: frozen ? `look at preview/interaction.jpg for the ${v.input} column and fit the missing driver` : undefined,
        data: { uniforms: v.uniforms.length },
      });
    }
    const resp = (k: 'replay' | 'rebuild') => i.interaction?.[k]?.response ?? null;
    add({
      id: 'input.response',
      area: 'input',
      claim: "How much of the picture's change under scripted pointer and scroll the kit reproduces.",
      label: resp('replay') != null || resp('rebuild') != null ? 'Verified' : 'Unknown',
      measurement: `replay ${resp('replay') != null ? pct(resp('replay') as number) : 'n/a'}, rebuild ${resp('rebuild') != null ? pct(resp('rebuild') as number) : 'n/a'} (mean over the scripted steps of the correlation of where the picture changed)`,
      coverage: 'partial',
      limitations: [
        'a scripted subset of moves, not every interaction the site has',
        'chaotic simulations diverge even when the same draw is replayed, so the number moves between runs',
      ],
      data: { replay: resp('replay'), rebuild: resp('rebuild') },
    });
  } else if (r) {
    add({
      id: 'input.response',
      area: 'input',
      claim: "Whether the kit reproduces the site's response to pointer and scroll is not known.",
      label: 'Unknown',
      measurement: 'the interaction check did not run (quick mode, or it failed)',
      coverage: 'not-exercised',
      limitations: [],
      nextProbe: 'dea extract <url> (full mode)',
    });
  }

  // ---- the phase the interaction ran from (time-driven scenes)
  if (i.phase) {
    const ph = i.phase;
    add({
      id: 'input.phase',
      area: 'input',
      claim:
        ph.aligned === true
          ? 'The scripted interaction started from the same phase of the site as the reference picture.'
          : ph.aligned === false
            ? 'The scripted interaction started from a different phase of the site than the reference picture: its numbers are not comparable run to run.'
            : 'The phase the scripted interaction started from was not compared with a reference.',
      label: ph.aligned === true ? 'Verified' : ph.aligned === false ? 'Unknown' : 'Inferred',
      measurement: ph.note,
      coverage: ph.aligned == null ? 'not-exercised' : 'partial',
      limitations: [
        "the phase is judged on a 64 × 40 grey thumbnail of the window, not on the site's own clock",
        ph.timeDriven
          ? 'the scene kept moving after it was loaded (time-driven), so "the same phase" means the same picture, not the same moment of an internal timeline'
          : 'a scene whose state is not visible in the picture can differ underneath',
      ],
      nextProbe: ph.aligned === false ? 'dea stability <url> --runs 3 (measures how far two runs of the original itself agree)' : undefined,
      data: { aligned: ph.aligned, refDiff: ph.refDiff, bestDiff: ph.bestDiff, waitedMs: ph.waitedMs, stable: ph.stable, timeDriven: ph.timeDriven },
    });
  }

  // ---- the whole page, stop by stop
  if (i.pageStops) {
    const p = i.pageStops;
    const views = Object.entries(p.views).filter(([, v]) => v != null) as Array<[string, number]>;
    const low = p.stops.filter((s) => Object.values(s.scores).every((v) => v == null || v < 0.6));
    const behindLoader = Boolean(i.diff?.referenceLoader);
    add({
      id: 'page.whole',
      area: 'page',
      claim: behindLoader
        ? `The kit contains ${p.elements} elements over ${p.extent} px of ${p.documentHeight} px, but the original was still behind its loading screen when it was photographed, so the per-stop scores compare the kit with a loading screen and say nothing about the match.`
        : `The kit contains the whole page: ${p.elements} elements over ${p.extent} px of ${p.documentHeight} px, placed in document coordinates, and it scrolls.`,
      label: behindLoader ? 'Unknown' : 'Verified',
      measurement: `${p.stops.length} scroll stops read on a fresh load (${p.mechanism} scroll; ${p.counts.static} static, ${p.counts.fixed} fixed, ${p.counts.moving} moving elements); kit against the original's screenshot at each stop, mean similarity: ${views.map(([k, v]) => `${k === 'kit' ? 'kit' : k.replace('__', '')} ${pct(v)}`).join(', ') || 'n/a'}; worst stops: ${[
        ...p.stops,
      ]
        .sort(
          (a, b) =>
            Math.min(...Object.values(a.scores).filter((v): v is number => v != null), 1) -
            Math.min(...Object.values(b.scores).filter((v): v is number => v != null), 1),
        )
        .slice(0, 3)
        .map((s) => `${s.y}px ${pct(Math.min(...Object.values(s.scores).filter((v): v is number => v != null), 1))}`)
        .join(', ')}`,
      coverage: p.limits.length ? 'partial' : 'complete',
      limitations: [
        'the similarity is the coarse page score (colour, light layout, edges at 96 × 60), not a pixel match; read preview/page-stops.jpg',
        "elements are placed absolutely at the width read, not rebuilt as the site's own flex/grid; resizing the window scales, it does not reflow",
        'what happens on click, hover, a menu, a tab or a route change is not read',
        ...p.limits,
      ],
      data: {
        stops: p.stops.length,
        extent: p.extent,
        documentHeight: p.documentHeight,
        elements: p.elements,
        ...Object.fromEntries(views.map(([k, v]) => [`similarity_${k.replace('__', '') || 'kit'}`, v])),
      },
    });
    if (low.length)
      add({
        id: 'page.weak',
        area: 'page',
        claim: `The kit does not match the original at ${low.length} of ${p.stops.length} scroll stops (${low.map((s) => `${s.y}px`).join(', ')}).`,
        label: 'Unknown',
        measurement: `similarity under 60% at those stops; usually a section drawn by a canvas, a video or a script the DOM read does not carry`,
        coverage: 'partial',
        limitations: ['look at preview/page-stops.jpg to see what differs'],
        nextProbe: 'dea extract <url> with the section scrolled into view recorded as its own scene',
      });
  }

  // ---- scroll tape
  const st = r?.scrollTape;
  if (st) {
    const moved = st.changed.length ? Math.max(...st.changed) : 0;
    if (st.mechanism === 'none' || st.stops < 2) {
      add({
        id: 'scroll.tape',
        area: 'scroll',
        claim: 'Scrolling changed nothing the recorder could see on this page.',
        label: 'Verified',
        measurement: `${st.stops} scroll stop(s), mechanism ${st.mechanism}: no draw call, upload or uniform changed between stops`,
        coverage: 'partial',
        limitations: ["only the first screen's canvas was recorded", 'content that loads on a click or past the probed extent is not covered'],
        data: { stops: st.stops },
      });
    } else {
      add({
        id: 'scroll.tape',
        area: 'scroll',
        claim: `The scene changes with scroll (${st.mechanism} scroll); the kit plays ${st.frames} recorded frames chosen by the live scroll.`,
        label: st.mode === 'frames' ? 'Verified' : 'Inferred',
        measurement: `${st.stops} stops over ${Math.round(st.at[st.at.length - 1] ?? 0)} px; the picture's recorded state changed by up to ${pct(moved)} between the first stop and the others; ${(st.bytes / 1e6).toFixed(1)} MB`,
        coverage: 'partial',
        limitations: [
          `stops are ${st.stops} samples of a continuous scroll; the kit shows the nearest recorded one (uniform values and float uploads between neighbours are blended)`,
          st.uploadBuffers
            ? `${st.uploadFull} of ${st.uploadBuffers} buffers the site re-uploads were uploaded in full at every stop; the others are partial uploads and are exact only when scrolling forward`
            : 'no buffer the site re-uploads while scrolling',
          'the recording runs forward once: state the site keeps between stops (history, springs) is not recorded',
        ],
        data: { stops: st.stops, frames: st.frames, bytes: st.bytes, uploadBuffers: st.uploadBuffers, uploadFull: st.uploadFull },
      });
    }
  }

  // ---- page map
  if (i.map) {
    const m = i.map;
    add({
      id: 'page.map',
      area: 'page',
      claim: `The page has ${m.sections} section(s) and ${m.canvases} WebGL canvas(es); its scene changes at ${m.sceneChanges} of ${m.stops} scroll stops.`,
      label: 'Verified',
      measurement: `${m.mechanism} scroll, probed over ${Math.round(m.extent)} px of a ${Math.round(m.documentHeight)} px document, ${m.stops} stops`,
      coverage: m.extent >= m.documentHeight - 1 || m.mechanism === 'virtual' ? 'partial' : 'partial',
      limitations: [
        m.mechanism === 'virtual'
          ? 'a virtual scroll has no document height: the extent is how far the wheel was driven, not the end of the page'
          : 'the extent probed may stop short of the end of the page',
        'routes behind links are not followed',
      ],
      data: { sections: m.sections, stops: m.stops, sceneChanges: m.sceneChanges, canvases: m.canvases, extent: m.extent },
    });
  }

  // ---- boot
  if (i.boot) {
    const b = i.boot;
    add({
      id: 'boot.timeline',
      area: 'boot',
      claim: b.linkingNearReference
        ? `${b.linkingNearReference} shader program(s) were still being linked just before the reference: the frame may not be settled.`
        : 'No shader was being linked just before the reference.',
      label: 'Verified',
      measurement: `first canvas ${b.firstCanvasMs ?? 'n/a'} ms, first draw ${b.firstDrawMs ?? 'n/a'} ms, last link ${b.lastLinkMs ?? 'n/a'} ms, ${b.programs} programs`,
      coverage: 'complete',
      limitations: ["timings are from a machine with a software renderer; their order is real, their size is not a desktop's"],
      data: { ...b },
    });
  }

  // ---- build
  if (i.build) {
    add({
      id: 'build.kit',
      area: 'build',
      claim: i.build.skipped
        ? 'The build was not run.'
        : i.build.ok
          ? 'The generated project installs and builds.'
          : `The generated project failed at ${i.build.step}.`,
      label: i.build.skipped ? 'Unknown' : 'Verified',
      measurement: i.build.skipped ?? (i.build.ok ? 'npm install and npm run build exited 0' : `failed at ${i.build.step}`),
      coverage: i.build.skipped ? 'not-exercised' : 'complete',
      limitations: [],
    });
  }
  return out;
}

const AREA_FOR_GAP: Record<string, string[]> = {
  design: ['scene.', 'input.'],
  motion: ['input.', 'scroll.'],
  assets: ['scene.'],
  code: ['scene.'],
  api: [],
  stack: [],
  pages: ['page.'],
};

/** Gaps become unknowns that name the findings they follow from. */
export function buildUnknowns(gaps: Gap[], findings: Finding[]): LedgerUnknown[] {
  return gaps.map((g, k) => {
    const prefixes = AREA_FOR_GAP[g.area] ?? [];
    const follows = findings.filter((f) => f.label !== 'Verified' && prefixes.some((p) => f.id.startsWith(p))).map((f) => f.id);
    return {
      id: `unknown.${k + 1}`,
      topic: g.topic,
      missing: g.missing,
      follows,
      next: g.next.map((n) => ({ why: n.why, command: n.command })),
    };
  });
}

export async function hashFiles(files: Array<{ rel: string; abs: string }>): Promise<LedgerFile[]> {
  const out: LedgerFile[] = [];
  for (const f of files) {
    try {
      const b = await readFile(f.abs);
      out.push({ path: f.rel, bytes: b.byteLength, sha256: createHash('sha256').update(b).digest('hex') });
    } catch {
      /* a file that is gone is not listed */
    }
  }
  return out;
}

/** What the page map saw that the kit does not contain: sections below the first screen (the kit rebuilds the first screen's DOM). */
function pageUnknowns(i: LedgerInput, findings: Finding[]): LedgerUnknown[] {
  const m = i.map;
  if (i.pageStops) return [];
  if (m?.mechanism !== 'native' || m.sections < 2) return [];
  return [
    {
      id: `unknown.${i.gaps.length + 1}`,
      topic: 'The page below the first screen',
      missing: `the page map saw ${m.sections} sections over ${m.extent} px of scroll; the kit rebuilds the first screen's HTML and the recorded WebGL stops, not those sections, so scrolling the kit past the first screen does not show them`,
      follows: findings.filter((f) => f.id === 'page.map').map((f) => f.id),
      next: [{ why: 'read the rest of the page: its text, fonts and colours per section', command: `dea design ${i.url}` }],
    },
  ];
}

export async function buildLedger(i: LedgerInput): Promise<EvidenceLedger> {
  const findings = buildFindings(i);
  const counts = { Verified: 0, Inferred: 0, Unknown: 0, total: findings.length };
  for (const f of findings) counts[f.label]++;
  return {
    schema: 'dea.evidence/1',
    url: i.url,
    runId: i.runId,
    madeAt: new Date().toISOString(),
    mode: i.quick ? 'quick' : 'full',
    machine: i.machine ?? 'unknown',
    counts,
    findings,
    unknowns: [...buildUnknowns(i.gaps, findings), ...pageUnknowns(i, findings)],
    files: i.hashFiles ? await hashFiles(i.hashFiles) : [],
  };
}

export interface LedgerQuery {
  area?: string;
  label?: Label;
  id?: string;
  /** summary (default): one line per finding; full: every field */
  detail?: 'summary' | 'full';
}

/** Summary first, detail on request: a slice of the ledger, small enough to read in one go. */
export function queryLedger(l: EvidenceLedger, q: LedgerQuery = {}): Record<string, unknown> {
  const pick = l.findings.filter((f) => (!q.area || f.area === q.area) && (!q.label || f.label === q.label) && (!q.id || f.id === q.id));
  const head = { schema: l.schema, url: l.url, runId: l.runId, mode: l.mode, counts: l.counts, machine: l.machine };
  if (q.id && !pick.length) return { ...head, error: `no finding ${q.id}`, ids: l.findings.map((f) => f.id) };
  const unknowns = q.label && q.label !== 'Unknown' ? [] : q.id ? l.unknowns.filter((u) => u.follows.includes(q.id as string)) : l.unknowns;
  if (q.detail === 'full' || q.id) return { ...head, findings: pick, unknowns, files: q.id ? undefined : l.files };
  return {
    ...head,
    findings: pick.map((f) => ({ id: f.id, label: f.label, coverage: f.coverage, claim: f.claim })),
    unknowns: unknowns.map((u) => ({ id: u.id, topic: u.topic, follows: u.follows })),
    hint: 'pass id for one finding with its measurement, limitations and next probe, or detail "full" for everything',
  };
}

const MARK: Record<Label, string> = { Verified: '✔ Verified', Inferred: '≈ Inferred', Unknown: '? Unknown' };

export function renderLedgerMd(l: EvidenceLedger): string {
  const out: string[] = [
    '# Evidence ledger',
    '',
    `${l.url} · run ${l.runId} · ${l.mode} mode · ${l.machine}`,
    '',
    `${l.counts.Verified} verified, ${l.counts.Inferred} inferred, ${l.counts.Unknown} unknown. Each finding names the measurement behind it and how much of the thing it covered.`,
    '',
  ];
  for (const f of l.findings) {
    out.push(`### ${f.id} · ${MARK[f.label]} · coverage: ${f.coverage}`, '', f.claim, '', `- measured: ${f.measurement}`);
    for (const x of f.limitations) out.push(`- limit: ${x}`);
    if (f.nextProbe) out.push(`- next probe: \`${f.nextProbe}\``);
    out.push('');
  }
  if (l.unknowns.length) {
    out.push('## Unknowns', '');
    for (const u of l.unknowns) out.push(`- **${u.id}** ${u.topic}: ${u.missing}${u.follows.length ? ` (follows ${u.follows.join(', ')})` : ''}`);
    out.push('');
  }
  if (l.files.length) out.push('## Files (sha-256)', '', ...l.files.map((f) => `- ${f.path} · ${f.bytes} B · ${f.sha256.slice(0, 16)}…`), '');
  return `${out.join('\n')}\n`;
}

/** Read a saved ledger from an extract run folder. */
export async function readLedger(extractDir: string): Promise<EvidenceLedger | null> {
  try {
    return JSON.parse(await readFile(join(extractDir, 'evidence.json'), 'utf8')) as EvidenceLedger;
  } catch {
    return null;
  }
}
