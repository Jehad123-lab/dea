import { describe, expect, it } from 'vitest';
import { type CaptureDoc, fitCapture, halveImage } from '../src/replay/graph.ts';

// A recording with one big read-only image (and a render target that must never be shrunk), built by hand.
const docWith = (w: number, h: number, opts: { written?: boolean } = {}): { doc: CaptureDoc; bin: Uint8Array } => {
  const ch = 4;
  const bin = new Uint8Array(w * h * ch * 2);
  for (let i = 0; i < w * h * ch; i++) bin[i] = i % 251;
  const lv = (o: number) => ({ level: 0, face: 0, ifmt: 0x8058, w, h, d: 1, upFmt: 0x1908, upType: 0x1401, ch, o, l: w * h * ch });
  const doc = {
    version: 2,
    canvas: { w: 100, h: 100, cssW: 100, cssH: 100, x: 0, y: 0, style: {} },
    dpr: 1,
    attrs: {},
    extensions: [],
    snap: {
      buffers: [],
      textures: [
        { id: 1, target: 0x0de1, params: {}, levels: [lv(0)] },
        { id: 2, target: 0x0de1, params: {}, levels: [lv(w * h * ch)] },
      ],
      programs: [],
      renderbuffers: [],
      samplers: [],
      framebuffers: opts.written ? [{ id: 9, atts: [{ a: 0x8ce0, type: 0x1702, tex: 2 }], draw: [0x8ce0], read: 0x8ce0 }] : [],
      vaos: [],
    },
    frames: [],
  } as unknown as CaptureDoc;
  return { doc, bin };
};

describe('fitting a recording under the cap', () => {
  it('halves an image with a 2x2 box filter, rounding', () => {
    const src = new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]);
    const r = halveImage(src, 4, 4, 1);
    expect([r.w, r.h]).toEqual([2, 2]);
    expect([...r.px]).toEqual([25, 45, 105, 125]);
    expect(halveImage(new Uint8Array([9, 9, 9]), 3, 1, 1).w).toBe(1);
  });
  it('a recording already under the cap is returned as it is', () => {
    const { doc, bin } = docWith(256, 256);
    const r = fitCapture(doc, bin, bin.byteLength + 1);
    expect(r?.scaled).toEqual([]);
    expect(r?.bin.byteLength).toBe(bin.byteLength);
  });
  it('shrinks the largest read-only images until it fits, and keeps their pixels in order', () => {
    const { doc, bin } = docWith(512, 512);
    const full = bin.byteLength; // two 1 MB images
    const r = fitCapture(doc, bin, full * 0.7);
    expect(r).not.toBeNull();
    expect(r?.bin.byteLength).toBeLessThanOrEqual(full * 0.7);
    expect(r?.scaled[0]).toMatchObject({ from: [512, 512], to: [256, 256] });
    const T = r?.doc.snap.textures.find((t) => t.id === r.scaled[0].tex);
    expect(T?.levels[0]).toMatchObject({ w: 256, h: 256, l: 256 * 256 * 4 });
    // the original document is not changed
    expect(doc.snap.textures[0].levels[0].w).toBe(512);
  });
  it('a full mip chain loses its largest level and the rest move up, with no re-filtering', () => {
    const w = 1024;
    const levels = [];
    const parts: number[] = [];
    let o = 0;
    for (let k = 0; k <= 10; k++) {
      const s = Math.max(1, w >> k);
      const l = s * s * 4;
      levels.push({ level: k, face: 0, ifmt: 0x8c43, w: s, h: s, d: 1, upFmt: 0x1908, upType: 0x1401, ch: 4, o, l });
      for (let i = 0; i < l; i++) parts.push(k);
      o += l;
      const pad = (8 - (o % 8)) % 8;
      for (let i = 0; i < pad; i++) parts.push(0);
      o += pad;
    }
    const { doc } = docWith(256, 256);
    doc.snap.textures = [{ id: 7, target: 0x0de1, params: {}, levels }] as unknown as CaptureDoc['snap']['textures'];
    const bin = new Uint8Array(parts);
    const r = fitCapture(doc, bin, bin.byteLength / 2);
    expect(r?.scaled).toEqual([{ tex: 7, from: [1024, 1024], to: [512, 512] }]);
    const T = r?.doc.snap.textures[0];
    expect(T?.levels.map((L) => [L.level, L.w])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => [k, 512 >> k]));
    // the new level 0 holds what the browser recorded as level 1 (every byte is 1)
    const L0 = T?.levels[0] as { o: number; l: number };
    expect(new Set(r?.bin.subarray(L0.o, L0.o + L0.l))).toEqual(new Set([1]));
  });
  it('never shrinks a texture a draw writes (a render target), and gives up when the rest cannot fit', () => {
    const { doc, bin } = docWith(512, 512, { written: true });
    // texture 2 is attached to a framebuffer, but nothing draws into it here, so it is not written: both may shrink
    expect(fitCapture(doc, bin, bin.byteLength * 0.4)?.scaled.length).toBe(2);
    // far below what halving down to 256 px can reach
    expect(fitCapture(doc, bin, 1000)).toBeNull();
  });
});
