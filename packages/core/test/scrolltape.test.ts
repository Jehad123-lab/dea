import { describe, expect, it } from 'vitest';
import type { CaptureDoc, Cmd } from '../src/replay/graph.ts';
import { buildPageMap, fitScrollTape, pageMapMd, SCROLL_RUNTIME, tapeMoved } from '../src/replay/scrolltape.ts';

const f32 = (vals: number[]) => {
  const b = new Uint8Array(new Float32Array(vals).buffer);
  return b;
};

// a tape of `n` frames: each draws program 3; frame uniform `uP` and an instance upload carry the scroll progress
function makeDoc(progress: number[], opts: { drawsOf?: (i: number) => number; program?: (i: number) => number; upload?: (i: number) => number } = {}) {
  const parts: Uint8Array[] = [];
  let off = 0;
  const bin = (vals: number[]) => {
    const b = f32(vals);
    parts.push(b);
    const a = { $: 'bin', o: off, l: b.byteLength, t: 'Float32Array' };
    off += b.byteLength;
    return a;
  };
  const frames = progress.map((p, i) => {
    const cmds: Cmd[] = [
      ['bindBuffer', 34962, { $: 'buf', id: 7 }],
      ['bufferSubData', 34962, 0, bin(opts.upload ? [opts.upload(i), 0, 0, 1] : [p, p * 2, p * 3, 1])],
      ['useProgram', { $: 'prog', id: opts.program ? opts.program(i) : 3 }],
      ['uniform1f', { $: 'loc', p: 3, n: 'uP' }, p],
    ];
    for (let d = 0; d < (opts.drawsOf ? opts.drawsOf(i) : 2); d++) cmds.push(['drawArrays', 4, 0, 6]);
    return { state: null, cmds, ms: 0, ts: i * 16.7 };
  });
  const all = new Uint8Array(off);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.byteLength;
  }
  return { doc: { scrollFrames: frames } as unknown as CaptureDoc, bin: all };
}

describe('scroll tape fit', () => {
  // stops going down at sc 400, 800, 1200 (3 frames each), then home (sc 0)
  const stops = [
    { sc: 400, f0: 0, f1: 2 },
    { sc: 800, f0: 3, f1: 5 },
    { sc: 1200, f0: 6, f1: 8 },
    { sc: 0, f0: 9, f1: 11 },
  ];
  const prog = [0.1, 0.13, 0.13, 0.4, 0.5, 0.5, 0.8, 1, 1, 0.1, 0, 0]; // each stop settles (its last two frames agree); home returns to 0

  it('measures what changed against the top of the page, per stop, sorted by scroll', () => {
    const { doc, bin } = makeDoc(prog);
    const fit = fitScrollTape(doc, bin, { stops });
    expect(fit?.stops.map((s) => s.sc)).toEqual([0, 400, 800, 1200]);
    expect(fit?.stops[0].changed).toBe(0);
    expect(fit?.stops[3].changed).toBeGreaterThan(0.9);
    expect(tapeMoved(fit)).toBe(true);
    expect(fit?.aligned).toBe(true);
  });

  it('a time uniform (a straight line in the frame timestamp over the whole tape) is not read as scroll', () => {
    const { doc, bin } = makeDoc(
      prog.map((_, i) => i * 0.0167),
      { upload: () => 0.5 },
    );
    const fit = fitScrollTape(doc, bin, { stops });
    expect(tapeMoved(fit)).toBe(false);
  });

  it('a scroll that changed nothing is not a tape', () => {
    const { doc, bin } = makeDoc(prog.map(() => 0.5));
    const fit = fitScrollTape(doc, bin, { stops });
    expect(tapeMoved(fit)).toBe(false);
  });

  it('reports whether the re-uploaded buffer is uploaded in full at every stop', () => {
    const { doc, bin } = makeDoc(prog);
    const fit = fitScrollTape(doc, bin, { stops });
    expect(fit?.uploadBuffers).toBe(1);
    expect(fit?.uploadFull).toBe(1);
  });

  it('too few stops: no fit', () => {
    const { doc, bin } = makeDoc([0.1, 0.2]);
    expect(fitScrollTape(doc, bin, { stops: [{ sc: 0, f0: 0, f1: 1 }] })).toBeNull();
  });

  it('page map: scene changes where the programs or the draw count change, sections lead where they are largest', () => {
    const { doc, bin } = makeDoc(prog, { program: (i) => (i >= 6 && i < 9 ? 5 : 3), drawsOf: (i) => (i >= 3 && i < 6 ? 6 : 2) });
    const fit = fitScrollTape(doc, bin, { stops });
    if (!fit) throw new Error('no fit');
    const dom = (heading: string) => ({
      scrollY: 0,
      docHeight: 900,
      viewport: [1440, 900] as [number, number],
      inView: [{ sel: '#s', heading, share: 0.9 }],
      canvases: [{ sel: 'canvas.gl', share: 1 }],
    });
    const map = buildPageMap('https://x.test/', fit, {
      mechanism: 'virtual',
      stops: stops.map((s, i) => ({ ...s, dom: dom(`part ${i}`) })),
    });
    expect(map.stops.map((s) => s.sceneChange)).toEqual([false, false, true, true]);
    expect(map.sceneChanges).toBe(2);
    expect(map.canvases).toEqual(['canvas.gl']);
    expect(map.sections.length).toBeGreaterThan(1);
    expect(pageMapMd(map)).toMatch(/virtual scroll has no document height/);
  });
});

describe('scroll tape runtime', () => {
  // eslint-disable-next-line no-new-func
  const make = (info: unknown) => new Function(`${SCROLL_RUNTIME}; return createScrollTape;`)()(info);
  const info = {
    k: 1,
    stops: [
      { sc: 0, f0: 9, f1: 11 },
      { sc: 400, f0: 0, f1: 2 },
      { sc: 800, f0: 3, f1: 5 },
      { sc: 1200, f0: 6, f1: 8 },
    ],
  };

  it('does nothing until the page is scrolled', () => {
    const t = make(info);
    expect(t.step(0, -1, 100)).toBeNull();
  });

  it('plays the nearest stop and applies the uploads of the stops it skipped, forward', () => {
    const t = make(info);
    const a = t.step(790, -1, 100);
    expect(a.frame).toBe(5);
    // from the top to 800: the whole of stop 400, then the first two frames of 800
    expect(a.catchUp).toEqual([0, 1, 2, 3, 4]);
    const same = t.step(810, -1, 100);
    expect(same.catchUp).toEqual([]);
    const back = t.step(380, -1, 100);
    expect(back.frame).toBe(2);
    expect(back.catchUp).toEqual([0, 1]);
  });

  it('clamps past the last stop and returns to the top stop', () => {
    const t = make(info);
    expect(t.step(5000, -1, 100).frame).toBe(8);
    expect(t.step(-50, -1, 100).frame).toBe(11);
  });

  it('keeps ping-pong parity: a frame of the wrong parity gives way to its neighbour in the same stop', () => {
    const t = make(info);
    // base 100 + frame 5 = 105 (odd); last drawn was odd -> use frame 4
    expect(t.step(800, 1, 100).frame).toBe(4);
    const u = make(info);
    expect(u.step(800, 0, 100).frame).toBe(5);
  });

  it('eases the live scroll before it picks a stop', () => {
    const t = make({ ...info, k: 0.25 });
    const first = t.step(1200, -1, 0);
    expect(first.stop).toBeLessThan(3);
    let last = first;
    for (let i = 0; i < 60; i++) last = t.step(1200, -1, 0);
    expect(last.stop).toBe(3);
  });
});
