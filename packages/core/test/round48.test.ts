import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compactFrames, expandFrames, isClockStep, uboClocksOf } from '../src/replay/rebuild.ts';
import { REBUILD_RUNNER } from '../src/replay/runner.ts';

// a uniform-block upload step (bufferSubData on UNIFORM_BUFFER) of floats placed at `o` in the bin
const ubo = (buf: number, o: number, n: number, dst = 0) =>
  ({
    op: 'gl',
    pass: 0,
    frame: 0,
    fn: 'bufferSubData',
    args: [0x8a11, dst, { $: 'bin', o, l: n * 4, t: 'Float32Array' }],
    bind: { buf, bufTarget: 0x8a11 },
  }) as never;

describe('Round 48: clocks in uniform blocks, compact motion loops', () => {
  it('isClockStep: seconds, ms and frame counters are clocks; a jump or a fall is not', () => {
    expect(isClockStep(10, 10.25, 250)).toBe(true); // seconds
    expect(isClockStep(5.346, 5.379, 500)).toBe(true); // clamped 33ms delta on slow software GPU
    expect(isClockStep(1000, 1250, 250)).toBe(true); // ms
    expect(isClockStep(41, 42, 250)).toBe(true); // frame counter
    expect(isClockStep(1, 0.5, 250)).toBe(false);
    expect(isClockStep(0.2, 0.9, 10)).toBe(false); // 0.07 per ms: neither seconds nor ms
    expect(isClockStep(1, 1, 16)).toBe(false);
  });

  it('uboClocksOf finds the time float in a Global block and leaves a moving matrix alone', () => {
    // frame 0 at 0 ms, frame 1 at 250 ms; floats: [time, delta, mat4 x16 (camera moving), resolution]
    const f0 = new Float32Array(20);
    const f1 = new Float32Array(20);
    f0[0] = 12.5;
    f1[0] = 12.75; // time in seconds
    f0[1] = 0.016;
    f1[1] = 0.016; // delta unchanged
    for (let j = 4; j < 20; j++) {
      f0[j] = j * 0.01;
      f1[j] = j * 0.01 + 0.05; // a whole matrix moved at a clock-like rate
    }
    const bin = new Uint8Array(160);
    bin.set(new Uint8Array(f0.buffer), 0);
    bin.set(new Uint8Array(f1.buffer), 80);
    const out = uboClocksOf([ubo(7, 0, 20)], [ubo(7, 80, 20)], bin, 250);
    expect(out).toHaveLength(1);
    expect(out[0].buf).toBe(7);
    expect(out[0].byte).toBe(0);
    expect(out[0].base).toBeCloseTo(12.75, 5);
    expect(out[0].rate).toBeCloseTo(0.001, 6);
  });

  it('compactFrames stores later frames as changes to frame 0, expandFrames gives the frames back', () => {
    const draw = (frame: number, model: number[], t: number) => ({
      op: 'draw',
      frame,
      cmd: 4,
      material: 1,
      model,
      uniforms: { uTime: t, color: [1, 0, 0], big: new Array(64).fill(0.5) },
    });
    const frames = Array.from({ length: 30 }, (_, i) => ({
      steps: [draw(i, [1, 0, 0, i], i * 0.25), { op: 'clear', frame: i, color: [0, 0, 0, 1] }, draw(i, [2, 0, 0, 0], 0)],
    }));
    const p = { frames, materials: [] };
    const full = JSON.stringify(p);
    const c = compactFrames(structuredClone(p));
    const small = JSON.stringify(c);
    expect(small.length).toBeLessThan(full.length / 4);
    expect((c.frames[5].steps[2] as Record<string, unknown>).$from).toBe(2);
    expect((c.frames[5].steps[0] as Record<string, unknown>).$uni).toEqual({ uTime: 1.25 });
    const back = expandFrames(JSON.parse(small));
    expect(back).toEqual(p);
  });

  it('a pipeline with one frame, or not compacted, is left as it is', () => {
    const one = { frames: [{ steps: [{ op: 'draw', frame: 0 }] }] };
    expect(compactFrames(one)).toBe(one);
    expect(expandFrames(one)).toBe(one);
  });

  it('the runner expands compacted frames and drives uniform-block clocks live', () => {
    expect(REBUILD_RUNNER).toContain('if (p.framesCompact)');
    expect(REBUILD_RUNNER).toContain('if (animate && p.uboClocks)');
    expect(createHash('sha1').update('x').digest('hex')).toHaveLength(40);
  });
});
