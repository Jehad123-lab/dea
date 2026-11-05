// The whole page, not only the first screen: elements read at a series of scroll stops, merged into document coordinates,
// and the small layer of HTML and script that lays them out again in the kit. Pure functions (no browser) so the rules are tested.

import type { HeroLayout } from './generate.ts';

type Box = HeroLayout['boxes'][number];
type Shape = NonNullable<HeroLayout['shapes']>[number];
type Graphic = NonNullable<HeroLayout['graphics']>[number];

/** a keyframe of an element that moves with scroll: [scroll px, x, document y, width, height, opacity] */
export type PageKey = [number, number, number, number, number, number];

type Moves = {
  /** 1 fixed, 2 sticky (as read at one stop) */
  fx?: number;
  /** a fixed element: shown while the scroll is inside [from, to] (px), at its window position */
  win?: [number, number];
  /** an element that moves relative to the page (parallax, a pinned panel): its box at the scroll positions read */
  kf?: PageKey[];
};

export type PageBox = Box & Moves;
export type PageShape = Shape & Moves;
export type PageGraphic = Graphic & Moves;

/** one scroll stop as the browser read it: boxes are in window coordinates at that scroll */
export interface StopRead {
  /** the scroll position in px (window.scrollY, or the wheel total times the measured ratio on a virtual scroll) */
  s: number;
  docHeight: number;
  /** the page's background colour as read at this stop (body, else html) */
  background?: string | null;
  boxes: Box[];
  shapes?: Shape[];
  graphics?: Graphic[];
}

export interface PageStop {
  y: number;
  docHeight: number;
  boxes: number;
  shapes: number;
  graphics: number;
  /** stable change between this stop's read and the previous one: how much of what is on screen is new (0..1) */
  fresh: number;
}

export interface PageLayer {
  viewport: { width: number; height: number };
  /** the document's height at the end of the read (px) */
  documentHeight: number;
  /** how far the stops reached (px of scroll) */
  extent: number;
  /** the page scrolled by itself (native) or answered only the wheel (virtual): the kit scrolls natively either way */
  mechanism: 'native' | 'wheel';
  /** wheel: page px per wheel px, as measured (null when the page scrolled natively) */
  ratio: number | null;
  /** page px the original scrolls per px of wheel (a smooth-scroll library, or a virtual scroll); the kit's wheel does the same. Null when it is about 1 */
  wheelRatio: number | null;
  stops: PageStop[];
  boxes: PageBox[];
  shapes: PageShape[];
  graphics: PageGraphic[];
  /** the page's background colour at each stop, kept when it differs between stops: [scroll px, colour] (a page that recolours as you scroll) */
  backgrounds: Array<[number, string]>;
  counts: { static: number; fixed: number; moving: number };
  /** what the read could not cover, in words */
  limits: string[];
}

const keyOf = (it: { k?: string }, kind: string): string | null => (it.k ? `${kind}|${it.k}` : null);
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Merge the stops into one page. An element seen at one stop sits at its document position (window y + scroll). One seen at
 * several stops is
 *  - static when its document position agrees at all of them (within 4 px),
 *  - fixed when its window position agrees while the scroll differs (a header, a button): shown at that window position over
 *    the scroll range it was seen in, plus half a step either side,
 *  - moving otherwise (parallax, a pinned or sticky panel): keyframes of its document position over the scroll.
 * The element read with the most opacity is the one kept (a block caught half faded in at one stop is not the block).
 */
export function mergeStops(
  reads: StopRead[],
  viewport: { width: number; height: number },
  o: { mechanism?: 'native' | 'wheel'; ratio?: number | null; wheelRatio?: number | null; limits?: string[] } = {},
): PageLayer {
  const step = reads.length > 1 ? Math.max(1, Math.abs((reads[1]?.s ?? 0) - (reads[0]?.s ?? 0))) : viewport.height;
  type Sight = { s: number; kind: 'box' | 'shape' | 'graphic'; it: Box | Shape | Graphic };
  const sights = new Map<string, Sight[]>();
  const order: string[] = [];
  const add = (kind: 'box' | 'shape' | 'graphic', s: number, it: Box | Shape | Graphic) => {
    const k = keyOf(it, kind);
    if (!k) return;
    let l = sights.get(k);
    if (!l) {
      l = [];
      sights.set(k, l);
      order.push(k);
    }
    l.push({ s, kind, it });
  };
  const stops: PageStop[] = [];
  let prevKeys = new Set<string>();
  for (const r of reads) {
    const here = new Set<string>();
    for (const b of r.boxes) {
      add('box', r.s, b);
      const k = keyOf(b, 'box');
      if (k) here.add(k);
    }
    for (const b of r.shapes ?? []) {
      add('shape', r.s, b);
      const k = keyOf(b, 'shape');
      if (k) here.add(k);
    }
    for (const b of r.graphics ?? []) {
      add('graphic', r.s, b);
      const k = keyOf(b, 'graphic');
      if (k) here.add(k);
    }
    let fresh = 0;
    for (const k of here) if (!prevKeys.has(k)) fresh++;
    stops.push({
      y: Math.round(r.s),
      docHeight: r.docHeight,
      boxes: r.boxes.length,
      shapes: r.shapes?.length ?? 0,
      graphics: r.graphics?.length ?? 0,
      fresh: here.size ? r2(fresh / here.size) : 0,
    });
    prevKeys = here;
  }
  const lastS = reads.length ? (reads[reads.length - 1]?.s ?? 0) : 0;
  const boxes: PageBox[] = [];
  const shapes: PageShape[] = [];
  const graphics: PageGraphic[] = [];
  const counts = { static: 0, fixed: 0, moving: 0 };
  let bottom = 0;
  for (const k of order) {
    const l = sights.get(k) as Sight[];
    const kind = l[0]?.kind as Sight['kind'];
    const first = l[0] as Sight;
    // the sighting kept: most opaque, the latest of equals
    const best = l.reduce((a, b) => ((b.it.opacity ?? 1) >= (a.it.opacity ?? 1) ? b : a), first);
    const docY = (x: Sight) => x.it.y + x.s;
    const flaggedFixed = l.some((x) => (x.it as Moves).fx === 1);
    const spanS = Math.max(...l.map((x) => x.s)) - Math.min(...l.map((x) => x.s));
    const winStable = l.length >= 2 && spanS >= viewport.height * 0.3 && l.every((x) => Math.abs(x.it.y - first.it.y) < 3 && Math.abs(x.it.x - first.it.x) < 3);
    const docStable = l.every((x) => Math.abs(docY(x) - docY(best)) < 4 && Math.abs(x.it.x - best.it.x) < 6);
    let out: Box & Moves;
    if (flaggedFixed || winStable) {
      const from = Math.min(...l.map((x) => x.s)) - step * 0.6;
      const to = Math.max(...l.map((x) => x.s)) + step * 0.6;
      // seen from the first stop to the last: always there
      const always = Math.min(...l.map((x) => x.s)) <= 0 && Math.max(...l.map((x) => x.s)) >= lastS - 1;
      out = { ...(best.it as Box), y: best.it.y, win: always ? [0, Number.POSITIVE_INFINITY] : [Math.max(0, from), to] };
      counts.fixed++;
    } else if (l.length === 1 || docStable) {
      out = { ...(best.it as Box), y: docY(best) };
      counts.static++;
    } else {
      const kf: PageKey[] = l.map((x) => [x.s, x.it.x, docY(x), x.it.w, x.it.h, x.it.opacity ?? 1] as PageKey).sort((a, b) => a[0] - b[0]);
      out = { ...(best.it as Box), y: kf[0]?.[2] ?? docY(best), kf };
      counts.moving++;
    }
    delete out.fx;
    if (!out.win) bottom = Math.max(bottom, out.y + out.h);
    if (kind === 'box') boxes.push(out as PageBox);
    else if (kind === 'shape') shapes.push(out as unknown as PageShape);
    else graphics.push(out as unknown as PageGraphic);
  }
  const docHeight = Math.max(...reads.map((r) => r.docHeight), lastS + viewport.height, 0);
  return {
    viewport,
    documentHeight: Math.round(Math.max(docHeight, Math.min(bottom + 40, docHeight * 1.5))),
    extent: Math.round(lastS),
    mechanism: o.mechanism ?? 'native',
    ratio: o.ratio ?? null,
    wheelRatio: o.wheelRatio && Math.abs(o.wheelRatio - 1) > 0.12 ? Math.round(o.wheelRatio * 1000) / 1000 : null,
    stops,
    boxes,
    shapes,
    graphics,
    // kept only when the colour changed somewhere (a page of one colour needs no script)
    backgrounds:
      new Set(reads.map((r) => r.background ?? '')).size > 1 ? reads.filter((r) => r.background).map((r) => [Math.round(r.s), r.background as string]) : [],
    counts,
    limits: o.limits ?? [],
  };
}

/** How many elements the page layer holds. */
export const pageItemCount = (p: PageLayer | null | undefined): number => (p ? p.boxes.length + p.shapes.length + p.graphics.length : 0);

/** The page layer only helps when the page really has more than the first screen. */
export const pageIsWorthKeeping = (p: PageLayer | null | undefined): boolean =>
  Boolean(p && p.extent >= p.viewport.height * 0.4 && p.stops.length >= 2 && pageItemCount(p) > 0);

/** --own-assets: the site's images and background pictures on the page become placeholders of the same size. */
export function ownAssetsPage(p: PageLayer): PageLayer {
  return {
    ...p,
    graphics: p.graphics.map((g) => ({
      k: g.k,
      zp: g.zp,
      o: g.o,
      kind: 'placeholder' as const,
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      opacity: g.opacity,
      win: g.win,
      kf: g.kf,
    })),
    shapes: p.shapes.map((s) => (/url\(/.test(s.gradient ?? '') ? { ...s, gradient: null, background: 'rgb(128, 128, 128)', bgSize: undefined } : s)),
  };
}

/**
 * The kit's document layer as a HeroLayout the existing placement code can style: the hero's own items first (their key keeps the
 * hero's text and style, their place comes from the page read when it has one), then everything else the page read found.
 */
export function pageAsLayout(l: HeroLayout, p: PageLayer): HeroLayout {
  const byKey = <T extends { k?: string }>(items: T[]) => new Map(items.filter((i) => i.k).map((i) => [i.k as string, i]));
  const mergeKind = <T extends { k?: string; x: number; y: number; w: number; h: number } & Moves>(hero: T[], page: T[]): T[] => {
    const pk = byKey(page);
    const used = new Set<string>();
    const out: T[] = [];
    for (const h of hero) {
      const q = h.k ? pk.get(h.k) : undefined;
      if (q) {
        used.add(h.k as string);
        // the hero's reading is the settled first screen (text, style); where it sits over the scroll is the page read's
        out.push({ ...h, y: q.kf ? q.y : h.y, x: q.kf ? q.x : h.x, ...(q.win ? { win: q.win } : {}), ...(q.kf ? { kf: q.kf } : {}) });
      } else out.push(h);
    }
    for (const q of page) if (!q.k || !used.has(q.k)) out.push(q);
    return out;
  };
  return {
    ...l,
    boxes: mergeKind(l.boxes as unknown as Array<Box & Moves>, p.boxes) as Box[],
    shapes: mergeKind((l.shapes ?? []) as unknown as Array<Shape & Moves>, p.shapes) as Shape[],
    graphics: mergeKind((l.graphics ?? []) as unknown as Array<Graphic & Moves>, p.graphics) as Graphic[],
  };
}
