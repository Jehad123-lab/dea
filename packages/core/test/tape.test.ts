import { describe, expect, it } from 'vitest';
import type { CaptureDoc } from '../src/replay/graph.ts';
import { fitTape, TAPE_RUNTIME } from '../src/replay/tape.ts';

// a synthetic tape: the pointer moves along a curve for 6 frames; every frame the site uploads a ribbon (x, y, side) in NDC
const W = 640;
const H = 360;
const path = (k: number): [number, number] => [0.5 + 0.2 * Math.sin(k * 0.5), 0.5 - 0.04 * k];
function makeDoc(): { doc: CaptureDoc; bin: Uint8Array; truth: Float32Array[] } {
  const frames: CaptureDoc['frames'] = [];
  const parts: Uint8Array[] = [];
  const truth: Float32Array[] = [];
  let off = 0;
  const ndc = (nx: number, ny: number): [number, number] => [nx * 2 - 1, 1 - ny * 2];
  for (let f = 0; f < 6; f++) {
    // the trail so far: f + 1 pairs, one per earlier pointer position, a quarter of a CSS pixel... 0.01 NDC wide
    const data = new Float32Array(40 * 3);
    for (let k = 0; k <= f; k++) {
      const [nx, ny] = path(k);
      const [X, Y] = ndc(nx, ny);
      data.set([X - 0.01, Y, -1, X + 0.01, Y, 1], k * 6);
    }
    truth.push(data);
    const u8 = new Uint8Array(data.buffer);
    parts.push(u8);
    frames.push({
      state: { arrayBuffer: 7 } as never,
      cmds: [
        ['bindBuffer', 0x8892, { $: 'buf', id: 7 }],
        ['bufferSubData', 0x8892, 0, { $: 'bin', o: off, l: u8.length, t: 'Float32Array' }],
      ] as never,
      ms: 0,
      ptr: [path(f)[0] * W, path(f)[1] * H],
    });
    off += u8.length;
  }
  const bin = new Uint8Array(off);
  let o = 0;
  for (const p of parts) {
    bin.set(p, o);
    o += p.length;
  }
  const doc = { canvas: { w: W, h: H, cssW: W, cssH: H, x: 0, y: 0, style: {} }, frames } as unknown as CaptureDoc;
  return { doc, bin, truth };
}

describe('pointer tape', () => {
  it('finds the buffer that carries the pointer path, in NDC, and anchors its vertices', () => {
    const { doc, bin } = makeDoc();
    const fit = fitTape(doc, bin, doc.frames, 6);
    expect(fit.report[0].reason).toBe('anchored to the pointer path');
    expect(fit.report[0].space).toBe('ndc');
    expect(fit.report[0].stride).toBe(3);
    expect(fit.anchors).toHaveLength(6);
    // the head of the last upload is the newest point: age 0
    const a = fit.anchors[5];
    expect(a.tau[10]).toBeCloseTo(5, 1);
    expect(a.tau[0]).toBeCloseTo(0, 1);
    // untouched slots stay as recorded
    expect(a.tau[39]).toBe(-1);
  });

  it('puts the vertices back where they were when the live pointer repeats the recorded path', () => {
    const { doc, bin, truth } = makeDoc();
    const fit = fitTape(doc, bin, doc.frames, 6);
    const create = new Function(`${TAPE_RUNTIME}; return createTape;`)();
    const tape = create({ n: 6, move: 6, still: 0, w: W, h: H, anchors: fit.anchors });
    for (let f = 0; f <= 5; f++) tape.step(path(f)[0], path(f)[1]);
    const placed = tape.place(5, 1, truth[5]) as Float32Array;
    for (let i = 0; i < 12 * 3; i++) expect(placed[i]).toBeCloseTo(truth[5][i], 1);
  });

  it('moves the trail with a different live path (a straight line to the right)', () => {
    const { doc, bin, truth } = makeDoc();
    const fit = fitTape(doc, bin, doc.frames, 6);
    const create = new Function(`${TAPE_RUNTIME}; return createTape;`)();
    const tape = create({ n: 6, move: 6, still: 0, w: W, h: H, anchors: fit.anchors });
    for (let f = 0; f <= 5; f++) tape.step(0.2 + 0.1 * f, 0.8);
    const placed = tape.place(5, 1, truth[5]) as Float32Array;
    // the newest pair sits at the live pointer (0.7, 0.8) -> NDC (0.4, -0.6), the oldest at (0.2, 0.8) -> (-0.6, -0.6)
    expect((placed[5 * 6] + placed[5 * 6 + 3]) / 2).toBeCloseTo(0.4, 1);
    expect((placed[5 * 6 + 1] + placed[5 * 6 + 4]) / 2).toBeCloseTo(-0.6, 1);
    expect((placed[0] + placed[3]) / 2).toBeCloseTo(-0.6, 1);
    // the side offsets stay about one pair apart across the (now horizontal) path: the width follows the live direction
    expect(Math.abs(placed[5 * 6 + 1] - placed[5 * 6 + 4])).toBeGreaterThan(0.005);
  });

  it('plays the tape while the pointer moves, then its settling frames, then the rest frames', () => {
    const create = new Function(`${TAPE_RUNTIME}; return createTape;`)();
    const tape = create({ n: 5, move: 3, still: 2, w: W, h: H, anchors: [] });
    const seq: number[] = [];
    seq.push(tape.step(0.5, 0.5)); // not moving yet
    for (const x of [0.52, 0.54, 0.56, 0.58]) seq.push(tape.step(x, 0.5));
    for (let i = 0; i < 5; i++) seq.push(tape.step(0.58, 0.5));
    expect(seq).toEqual([-1, 0, 1, 2, 2, 3, 4, -1, -1, -1]);
  });

  it('does not anchor a buffer that never changes or does not follow the path', () => {
    const { doc, bin } = makeDoc();
    // the same uploads, all of them the first 24 bytes (static data): nothing changes between frames
    const frames = doc.frames.map((f) => ({
      ...f,
      cmds: f.cmds.map((c) => (c[0] === 'bindBuffer' ? c : ['bufferSubData', 0x8892, 0, { $: 'bin', o: 0, l: 24, t: 'Float32Array' }])),
    })) as CaptureDoc['frames'];
    const fit = fitTape(doc, bin, frames, 6);
    expect(fit.anchors).toHaveLength(0);
    expect(fit.report[0].reason).toBe('unchanged');
  });
});
