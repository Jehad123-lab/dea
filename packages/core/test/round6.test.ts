import { describe, expect, it } from 'vitest';
import { type HeroLayout, heroHtml, scrollScript, scrollSpacer, withScroll } from '../src/extract/generate.ts';
import { diffStates, type StepState } from '../src/extract/interaction.ts';
import { holdsOutOfSample } from '../src/replay/inputs.ts';

const state = (o: Partial<StepState>): StepState => ({ frames: 5, draws: 100, verts: 1000, uniforms: [], uploads: [], tex: [], varying: [], ms: 10, ...o });

describe('state diff', () => {
  it('names what moved on the site and not in the kit', () => {
    const site = [
      null,
      state({
        uniforms: [
          { name: 'uMouse', dev: 0.4, sets: 5, comps: 2 },
          { name: 'uTime', dev: 0.2, sets: 5, comps: 1 },
        ],
        uploads: [{ fn: 'bufferSubData', size: 6840, n: 34, distinct: 30 }],
        varying: [{ draw: '9|4|1', sizes: ['24x1', '48x1'] }],
      }),
      null,
      null,
    ];
    const kit = [
      null,
      state({
        uniforms: [
          { name: 'uTime', dev: 0.2, sets: 5, comps: 1 },
          { name: 'uKitOnly', dev: 0.3, sets: 2, comps: 1 },
        ],
      }),
      null,
      null,
    ];
    const d = diffStates(site, kit)[1];
    expect(d.both).toEqual(['uTime']);
    expect(d.onlySite).toEqual(['uMouse']);
    expect(d.onlyKit).toEqual(['uKitOnly']);
    expect(d.uploadsOnlySite).toEqual(['bufferSubData 6840 B ×34 (30 distinct)']);
    expect(d.varyingOnlySite).toEqual(['9|4|1 (24x1,48x1)']);
  });

  it('ignores uniforms that moved by less than a thousandth', () => {
    const d = diffStates([null, state({ uniforms: [{ name: 'a', dev: 0.0004, sets: 3, comps: 1 }] }), null, null], [null, state({}), null, null])[1];
    expect(d.onlySite).toEqual([]);
  });
});

describe('probe control window', () => {
  const n = 40;
  const phase = (i: number) => (i < 20 ? 'sweep1' : i < 28 ? 'control' : 'sweep2');
  const X = Array.from({ length: n }, (_, i) => (i < 20 ? 0.2 + 0.03 * i : i < 28 ? 0.8 : 0.8 - 0.03 * (i - 28)));
  const Y = X.map(() => 0);
  it('accepts a value that follows the pointer through both sweeps and the still window', () => {
    const y = X.map((x) => 3 * x + 1);
    expect(
      holdsOutOfSample(
        X.map((_, i) => phase(i)),
        X,
        Y,
        y,
      ),
    ).toBe(true);
  });
  it('rejects a value that only drifts with time (fits the first sweep, then keeps going)', () => {
    const y = X.map((_, i) => 3 * (0.2 + 0.03 * i) + 1);
    expect(
      holdsOutOfSample(
        X.map((_, i) => phase(i)),
        X,
        Y,
        y,
      ),
    ).toBe(false);
  });
});

const layout = (): HeroLayout => ({
  viewport: { width: 1000, height: 500 },
  boxes: [
    {
      k: 'a>b:1',
      tag: 'h1',
      text: 'We create',
      x: 100,
      y: 100,
      w: 300,
      h: 60,
      fontFamily: 'x',
      fontSize: 40,
      fontWeight: '400',
      letterSpacing: 'normal',
      lineHeight: '48px',
      color: '#fff',
      textTransform: 'none',
      textAlign: 'left',
      opacity: 1,
    },
  ],
  canvas: { x: 0, y: 0, w: 1000, h: 500, radius: '0px' },
});

describe('scroll keyframes of the first screen', () => {
  const scroll = {
    positions: [0, 200, 450],
    items: {
      'a>b:1': [[100, 100, 300, 60, 1, 40], [100, 40, 300, 60, 0.5, 40], null] as Array<[number, number, number, number, number, number] | null>,
      canvas: [
        [0, 0, 1000, 500, 1, 0],
        [50, 20, 900, 450, 1, 0],
        [100, 40, 800, 400, 1, 0],
      ] as Array<[number, number, number, number, number, number] | null>,
      gone: [[1, 1, 1, 1, 1, 0], null, null] as Array<[number, number, number, number, number, number] | null>,
    },
    texts: { 'a>b:1': 'We create 3D visual experiences' },
  };
  it('keeps keyframes only for elements the layout has, and takes the final text of a typed heading', () => {
    const l = withScroll(layout(), scroll);
    expect(Object.keys(l.scroll?.items ?? {}).sort()).toEqual(['a>b:1', 'canvas']);
    expect(l.boxes[0].text).toBe('We create 3D visual experiences');
  });
  it('does not replace text with an unrelated later read', () => {
    const l = withScroll(layout(), { ...scroll, texts: { 'a>b:1': 'Something else entirely' } });
    expect(l.boxes[0].text).toBe('We create');
  });
  it('emits a script that interpolates boxes by scroll, a fixed first screen and room to scroll', () => {
    const l = withScroll(layout(), scroll);
    const html = heroHtml(l);
    expect(html).toContain('data-dea-k="a&gt;b:1"');
    expect(html).toContain('position: fixed; inset: 0');
    expect(html).toContain(`height: ${scrollSpacer(l)}px`);
    expect(scrollSpacer(l)).toBe(450 + 500);
    // run the script against a tiny fake DOM: at scroll 100 the canvas box is halfway between the first two keyframes
    const set: Record<string, string> = {};
    const el = {
      setAttribute: () => {},
      getAttribute: (k: string) => (k === 'data-dea-k' ? 'canvas' : null),
      style: { setProperty: (k: string, v: string) => (set[k] = v) },
    };
    const fakeDoc = { getElementById: () => el, querySelector: () => null, querySelectorAll: () => [el] };
    const g = { window: { scrollY: 100 }, scrollY: 100, document: fakeDoc, addEventListener: () => {} };
    new Function('window', 'document', 'addEventListener', scrollScript(l))(g.window, g.document, g.addEventListener);
    expect(set.left).toBe('2.5vw');
    expect(set.width).toBe('95vw');
  });
  it('takes the later, complete read of a heading that was being revealed word by word', () => {
    const early = layout();
    early.boxes = [{ ...early.boxes[0], text: 'We' }];
    const late = { ...early.boxes[0], text: 'We' };
    const word = { ...early.boxes[0], k: 'a>b:2', text: 'create 3D visual' };
    const l = withScroll(early, { ...scroll, texts: {}, boxesFinal: [late, word] });
    expect(l.boxes.map((b) => b.text)).toEqual(['We', 'create 3D visual']);
    // a later read that lost an early block is not taken
    const l2 = withScroll(early, { ...scroll, texts: {}, boxesFinal: [word] });
    expect(l2.boxes.map((b) => b.text)).toEqual(['We']);
  });
  it('on a page that scrolls by itself the position is the wheel total and no room is added', () => {
    const l = withScroll(layout(), { ...scroll, mode: 'wheel' });
    expect(scrollSpacer(l)).toBe(0);
    expect(heroHtml(l)).not.toContain('position: fixed');
    expect(scrollScript(l)).toContain('"wheel":true');
  });
  it('is empty when nothing moved with scroll', () => {
    expect(scrollScript(layout())).toBe('');
    expect(scrollSpacer(layout())).toBe(0);
  });
});
