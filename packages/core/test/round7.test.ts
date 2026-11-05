import { describe, expect, it } from 'vitest';
import { classifyInputs } from '../src/extract/interaction.ts';
import type { CaptureDoc } from '../src/replay/graph.ts';
import { REPLAY_PLAYER } from '../src/replay/player.ts';
import { multiDrawParts } from '../src/replay/rebuild.ts';
import { REBUILD_RUNNER } from '../src/replay/runner.ts';
import { fitTape, TAPE_RUNTIME } from '../src/replay/tape.ts';

const W = 800;
const H = 400;
const P = (k: number): [number, number] => [0.3 + 0.05 * k, 0.5 - 0.03 * k + 0.01 * k * k];
// a splat the site draws only while the pointer moves: point = pointer (uv, y up), force = step x 6000 (x, y up)
function makeSplatDoc(): { doc: CaptureDoc; bin: Uint8Array } {
  const frames: CaptureDoc['frames'] = [];
  const loc = (n: string) => ({ $: 'loc', p: 3, n });
  for (let f = 0; f < 8; f++) {
    const [x, y] = P(f);
    const [px, py] = f ? P(f - 1) : P(0);
    frames.push({
      state: {} as never,
      cmds: [
        ['useProgram', { $: 'prog', id: 3 }],
        ['uniform2f', loc('point'), x, 1 - y],
        ['uniform3f', loc('color'), (x - px) * 6000, -(y - py) * 6000, 0],
        // the dye splat sets the same uniform again, to a colour that has nothing to do with the pointer
        ['uniform2f', loc('point'), x, 1 - y],
        ['uniform3f', loc('color'), 0.045, 0.15, 0],
        ['uniform1f', loc('radius'), 0.0025],
        ['drawArrays', 5, 0, 4],
      ] as never,
      ms: 0,
      ptr: [x * W, y * H],
    });
  }
  const doc = { canvas: { w: W, h: H, cssW: W, cssH: H, x: 0, y: 0, style: {} }, frames } as unknown as CaptureDoc;
  return { doc, bin: new Uint8Array(0) };
}

describe('pointer-driven uniforms on the tape', () => {
  it('finds the uniform that follows the pointer position and the one that follows its step', () => {
    const { doc, bin } = makeSplatDoc();
    const fit = fitTape(doc, bin, doc.frames, 8);
    const u = fit.uniforms ?? [];
    const point = u.find((x) => x.n === 'point' && x.k === 0);
    const color = u.find((x) => x.n === 'color' && x.k === 0);
    // the second set of `color` in each frame is a constant colour: not pointer-driven
    expect(u.find((x) => x.n === 'color' && x.k === 1)).toBeUndefined();
    expect(point?.kind).toBe('pos');
    expect(point?.space).toBe('uv');
    expect(color?.kind).toBe('delta');
    expect(color?.gx).toBeGreaterThan(0);
    expect(color?.gy).toBeCloseTo(-6000, 0); // y is down on the canvas, up in the site's uniform
    // a constant is not pointer-driven
    expect(u.find((x) => x.n === 'radius')).toBeUndefined();
  });

  it('sets them from the live pointer: position as it is, step times the recorded gain', () => {
    const { doc, bin } = makeSplatDoc();
    const fit = fitTape(doc, bin, doc.frames, 8);
    const create = new Function(`${TAPE_RUNTIME}; return createTape;`)();
    const tape = create({ n: 8, move: 8, still: 0, w: W, h: H, anchors: [], uniforms: fit.uniforms });
    // the live pointer moves right at 0.1 of the canvas per frame, at the height 0.25
    tape.step(0.4, 0.25);
    tape.step(0.5, 0.25);
    const point = tape.uniform(3, 'point', 0) as number[];
    expect(point[0]).toBeCloseTo(0.5, 3);
    expect(point[1]).toBeCloseTo(0.75, 3);
    const color = tape.uniform(3, 'color', 0) as number[];
    // 0.1 of the canvas right x 6000
    expect(color[0]).toBeCloseTo(600, 0);
    expect(color[1]).toBeCloseTo(0, 3);
    expect(color).toHaveLength(3);
    expect(tape.uniform(3, 'radius', 0)).toBeNull();
    expect(tape.uniform(3, 'color', 1)).toBeNull();
  });
});

describe('WEBGL_multi_draw', () => {
  it('becomes one plain draw per range', () => {
    const bin = new Uint8Array(0);
    const draws = multiDrawParts('ext:WEBGL_multi_draw.multiDrawElementsWEBGL', [4, [6, 0, 12], 0, 5123, [0, 100, 200], 0, 3], bin);
    expect(draws).toEqual([
      ['drawElements', 4, 6, 5123, 0],
      ['drawElements', 4, 12, 5123, 200],
    ]);
    const arrays = multiDrawParts('ext:WEBGL_multi_draw.multiDrawArraysInstancedWEBGL', [4, [0, 6], 0, [3, 3], 0, [2, 5], 0, 2], bin);
    expect(arrays).toEqual([
      ['drawArraysInstanced', 4, 0, 3, 2],
      ['drawArraysInstanced', 4, 6, 3, 5],
    ]);
    expect(multiDrawParts('drawArrays', [4, 0, 3], bin)).toBeNull();
  });
});

describe('kit runtimes', () => {
  it('allocate compressed textures with texStorage, and the rebuild binds uniform blocks', () => {
    for (const src of [REPLAY_PLAYER, REBUILD_RUNNER]) {
      expect(src).toContain('IS_COMPRESSED');
      expect(src).toContain('texStorage2D(T.target, nl');
    }
    expect(REBUILD_RUNNER).toContain('uniformBlockBinding');
    expect(REBUILD_RUNNER).toContain('bindBufferRange(UB');
  });

  it('a pointer tape that follows the pointer is reported as a verified pointer input, not frozen', () => {
    const v = classifyInputs([], null, 0, null, { drag: true, n: 2 }).find((x) => x.input === 'pointer');
    expect(v?.status).toBe('verified');
    expect(v?.replay).toBe('live');
    expect(v?.evidence).toContain('button held');
    expect(classifyInputs([], null, 0, null).find((x) => x.input === 'pointer')?.status).not.toBe('verified');
  });
});
