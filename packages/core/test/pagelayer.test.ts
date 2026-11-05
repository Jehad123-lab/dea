import { describe, expect, it } from 'vitest';
import { type HeroLayout, heroHtml, heroJsx, heroStyles } from '../src/extract/generate.ts';
import { mergeStops, ownAssetsPage, pageAsLayout, pageIsWorthKeeping, type StopRead } from '../src/extract/pagelayer.ts';

const vp = { width: 1000, height: 600 };
const box = (k: string, y: number, extra: Record<string, unknown> = {}) => ({
  k,
  tag: 'p',
  text: `text ${k}`,
  x: 100,
  y,
  w: 300,
  h: 40,
  fontFamily: 'Arial',
  fontSize: 20,
  fontWeight: '400',
  letterSpacing: 'normal',
  lineHeight: '24px',
  color: 'rgb(0, 0, 0)',
  textTransform: 'none',
  textAlign: 'left',
  opacity: 1,
  zp: [0],
  o: Number.parseInt(k.replace(/\D/g, '') || '0', 10),
  ...extra,
});

/** a page 2000 px tall read at scroll 0, 480, 960, 1400: a header fixed at the top, a title that scrolls, a card that drifts at half speed */
const reads = (): StopRead[] => {
  const at = (s: number): StopRead => ({
    s,
    docHeight: 2000,
    boxes: [
      box('nav', 10, { fx: 1 }),
      box('title', 100 - s),
      ...(s >= 0 && s <= 600 ? [box('card', 300 - s * 0.5)] : []),
      ...(s >= 480 ? [box('section2', 900 - s)] : []),
      ...(s >= 960 ? [box('footer', 1700 - s)] : []),
    ].filter((b) => b.y > -60 && b.y < 600),
    shapes:
      s >= 480
        ? [{ k: 'panel', x: 0, y: 1000 - s, w: 1000, h: 500, background: 'rgb(240, 240, 240)', gradient: null, border: null, radius: '0px', opacity: 1 }]
        : [],
    graphics: [],
  });
  return [0, 480, 960, 1400].map(at);
};

describe('mergeStops', () => {
  const layer = mergeStops(reads(), vp);
  it('puts an element seen at one stop at its document position (window y + scroll)', () => {
    const f = layer.boxes.find((b) => b.k === 'box|footer'.slice(4) || b.k === 'footer');
    expect(f?.y).toBe(1700);
  });
  it('keeps an element that agrees at every stop as static at its document position', () => {
    const t = layer.boxes.find((b) => b.k === 'section2');
    expect(t?.y).toBe(900);
    expect(t?.kf).toBeUndefined();
    expect(t?.win).toBeUndefined();
  });
  it('calls an element fixed when its window position stays put, and shows it over the whole scroll', () => {
    const n = layer.boxes.find((b) => b.k === 'nav');
    expect(n?.win).toBeDefined();
    expect(n?.win?.[0]).toBe(0);
    expect(n?.y).toBe(10);
  });
  it('gives a drifting element keyframes in document coordinates', () => {
    const c = layer.boxes.find((b) => b.k === 'card');
    expect(c?.kf?.length).toBe(2);
    expect(c?.kf?.[0]?.[2]).toBe(300);
    // at scroll 480 the card sits at window y 60: document y 540
    expect(c?.kf?.[1]?.[2]).toBe(540);
  });
  it('counts what it found and reaches the document height', () => {
    expect(layer.counts.fixed).toBeGreaterThanOrEqual(1);
    expect(layer.counts.moving).toBe(1);
    expect(layer.documentHeight).toBeGreaterThanOrEqual(2000);
    expect(layer.extent).toBe(1400);
    expect(layer.stops).toHaveLength(4);
    expect(pageIsWorthKeeping(layer)).toBe(true);
  });
  it('reports how much of each stop is new', () => {
    expect(layer.stops[0]?.fresh).toBe(1);
    expect(layer.stops[1]?.fresh).toBeGreaterThan(0);
  });
  it('is not worth keeping for a page of one screen', () => {
    const one = mergeStops([{ s: 0, docHeight: 600, boxes: [box('a', 10)], shapes: [], graphics: [] }], vp);
    expect(pageIsWorthKeeping(one)).toBe(false);
  });
  it('keeps the most opaque sighting of an element that faded in', () => {
    const l = mergeStops(
      [
        { s: 0, docHeight: 1500, boxes: [box('h', 500, { opacity: 0.2 })], shapes: [], graphics: [] },
        { s: 400, docHeight: 1500, boxes: [box('h', 100, { opacity: 1 })], shapes: [], graphics: [] },
      ],
      vp,
    );
    expect(l.boxes[0]?.opacity).toBe(1);
  });
});

describe('the page layer in the kit', () => {
  const hero: HeroLayout = { viewport: vp, boxes: [box('title', 100)], canvas: null, background: 'rgb(255, 255, 255)', shapes: [], graphics: [] };
  const withPage: HeroLayout = { ...hero, page: mergeStops(reads(), vp) };
  it('lays the page out in one layer with the height of the document', () => {
    const html = heroHtml(withPage);
    expect(html).toContain('class="dea-page"');
    // 2000 px of a 1000 px wide page is 200 vw
    expect(html).toContain('height: 200vw');
    expect(html).toContain('text footer');
    expect(html).toContain('data-dea-win');
    expect(html).toContain('data-dea-kf');
  });
  it('keeps the hero text and style for an element both reads have, and adds the rest', () => {
    const merged = pageAsLayout(hero, withPage.page as NonNullable<HeroLayout['page']>);
    expect(merged.boxes.filter((b) => b.k === 'title')).toHaveLength(1);
    expect(merged.boxes.map((b) => b.k)).toEqual(expect.arrayContaining(['title', 'footer', 'section2', 'nav', 'card']));
  });
  it('places document items in viewport widths and fixed items in window units', () => {
    const items = heroStyles(pageAsLayout(hero, withPage.page as NonNullable<HeroLayout['page']>), { yUnit: 'vw' });
    const footer = items.find((i) => i.k === 'footer');
    expect(footer?.style.top).toBe('170vw');
    const nav = items.find((i) => i.k === 'nav');
    expect(nav?.style.position).toBe('fixed');
    expect(nav?.style.top).toBe('1.67vh');
  });
  it('writes the same layer for React', () => {
    expect(heroJsx(withPage)).toContain('className="dea-page"');
  });
  it('leaves a layout with no page as it was', () => {
    expect(heroHtml(hero)).not.toContain('dea-page');
  });
  it('--own-assets turns page pictures into placeholders of the same size', () => {
    const p = mergeStops(
      [
        {
          s: 0,
          docHeight: 1500,
          boxes: [],
          shapes: [],
          graphics: [{ k: 'img', kind: 'img', src: 'https://x.test/a.png', x: 0, y: 10, w: 100, h: 100, opacity: 1 }],
        },
        { s: 400, docHeight: 1500, boxes: [box('t', 10)], shapes: [], graphics: [] },
      ],
      vp,
    );
    const o = ownAssetsPage(p);
    expect(o.graphics[0]?.kind).toBe('placeholder');
    expect(o.graphics[0]?.w).toBe(100);
    expect(JSON.stringify(o)).not.toContain('x.test');
  });
});

describe('a page that recolours as you scroll', () => {
  const rd = (s: number, background: string): StopRead => ({ s, docHeight: 1500, background, boxes: [box(`t${s}`, 100)], shapes: [], graphics: [] });
  it('keeps the background at each stop when it differs, and the kit switches it with the scroll', () => {
    const page = mergeStops([rd(0, 'rgb(255, 255, 255)'), rd(400, 'rgb(250, 220, 220)'), rd(800, 'rgb(20, 20, 20)')], vp);
    expect(page.backgrounds).toEqual([
      [0, 'rgb(255, 255, 255)'],
      [400, 'rgb(250, 220, 220)'],
      [800, 'rgb(20, 20, 20)'],
    ]);
    const hero: HeroLayout = { viewport: vp, boxes: [], canvas: null, background: 'rgb(255, 255, 255)', shapes: [], graphics: [], page };
    const html = heroHtml(hero);
    expect(html).toContain('rgb(250, 220, 220)');
    expect(html).toContain('function bg(s)');
  });
  it('keeps nothing for a page of one colour', () => {
    const page = mergeStops([rd(0, 'rgb(1, 2, 3)'), rd(400, 'rgb(1, 2, 3)')], vp);
    expect(page.backgrounds).toEqual([]);
  });
});

describe('a page whose wheel moves it by another amount (smooth scroll)', () => {
  const rd = (s: number): StopRead => ({ s, docHeight: 1500, boxes: [box(`t${s}`, 100)], shapes: [], graphics: [] });
  it('keeps the measured px per wheel px, and the kit moves its page by the same amount', () => {
    const page = mergeStops([rd(0), rd(400)], vp, { wheelRatio: 0.49 });
    expect(page.wheelRatio).toBe(0.49);
    const hero: HeroLayout = { viewport: vp, boxes: [], canvas: null, background: '#fff', shapes: [], graphics: [], page };
    expect(heroHtml(hero)).toContain('var WR = 0.49');
  });
  it('keeps nothing when the wheel moves the page about 1:1', () => {
    expect(mergeStops([rd(0), rd(400)], vp, { wheelRatio: 1.04 }).wheelRatio).toBeNull();
    expect(mergeStops([rd(0), rd(400)], vp).wheelRatio).toBeNull();
    const page = mergeStops([rd(0), rd(400)], vp);
    const hero: HeroLayout = { viewport: vp, boxes: [], canvas: null, background: '#fff', shapes: [], graphics: [], page };
    expect(heroHtml(hero)).toContain('var WR = null');
  });
});
