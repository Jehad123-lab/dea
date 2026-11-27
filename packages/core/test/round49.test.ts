import { describe, expect, it } from 'vitest';
import { frameDistance, loopClosed } from '../src/replay/rebuild.ts';
import { REBUILD_RUNNER } from '../src/replay/runner.ts';

const draw = (t: number, model?: number[]): S => ({ op: 'draw', uniforms: { uTime: t, uColor: [1, 0, 0] }, ...(model ? { model } : {}) });
type S = { op?: string; uniforms?: Record<string, unknown>; model?: number[] };
const frame = (t: number): { steps: S[] } => ({ steps: [{ op: 'gl' }, draw(t)] });

describe('Round 49: smooth motion-loop playback', () => {
  it('frameDistance sums the change of draw-step numbers and refuses frames whose steps differ', () => {
    expect(frameDistance(frame(0).steps, frame(0.5).steps)).toBeCloseTo(0.5);
    expect(frameDistance(frame(0).steps, [{ op: 'draw', uniforms: {} } as S])).toBe(Number.POSITIVE_INFINITY);
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1];
    expect(
      frameDistance(
        [draw(0, m)],
        [
          draw(
            0,
            m.map((x, i) => (i === 12 ? 3 : x)),
          ),
        ],
      ),
    ).toBeCloseTo(1);
  });

  it('loopClosed: a whole cycle closes, a slice of a longer animation does not', () => {
    // a ping-pong value that comes back to where it started
    const cycle = [0, 1, 2, 3, 2, 1].map(frame);
    expect(loopClosed(cycle)).toBe(true);
    // a value that keeps rising: last -> first jumps 5 steps
    const ramp = [0, 1, 2, 3, 4, 5].map(frame);
    expect(loopClosed(ramp)).toBe(false);
    expect(loopClosed([frame(0), frame(1)])).toBe(false);
  });

  it('the runner blends between loop frames by elapsed time, matrices as rotations, the wrap only when closed', () => {
    expect(REBUILD_RUNNER).toContain('options.smooth !== false');
    expect(REBUILD_RUNNER).toContain('p.loop.closed || options.smoothWrap');
    expect(REBUILD_RUNNER).toContain('blend = { frame: nx, w: Math.min(1, w) }');
    expect(REBUILD_RUNNER).toContain('qa.slerp(qb, w)');
    expect(REBUILD_RUNNER).toContain('lerpM(step.model, bl.step.model, bl.w)');
    expect(REBUILD_RUNNER).toMatch(/tex\(Sub\)\?Image\[23\]D/);
    // the runner stays a plain template: no stray template-literal holes from the new code
    expect(REBUILD_RUNNER).not.toContain('${');
  });

  it('the runner blends affine 4x4 blocks as rotations and other floats number by number', () => {
    // three.js is not a dependency of core: a stub records which blocks go through decompose/slerp
    const calls: string[] = [];
    class V {
      lerp() {
        calls.push('lerp');
        return this;
      }
    }
    class Q {
      slerp() {
        calls.push('slerp');
        return this;
      }
    }
    class M {
      fromArray() {
        return this;
      }
      decompose() {
        calls.push('decompose');
        return this;
      }
      compose() {
        return this;
      }
      toArray(out: number[], o: number) {
        for (let k = 0; k < 16; k++) out[o + k] = 9;
        return out;
      }
    }
    const THREE = { Quaternion: Q, Vector3: V, Matrix4: M };
    const src = REBUILD_RUNNER.slice(REBUILD_RUNNER.indexOf('  const qa = new THREE.Quaternion()'), REBUILD_RUNNER.indexOf('  const lerpM = '));
    type LerpMats = (a: ArrayLike<number>, b: ArrayLike<number>, w: number, out: number[]) => number[];
    const lerpMats = new Function('THREE', `${src}\n  return lerpMats;`)(THREE) as LerpMats;
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const moved = id.map((x, k) => (k === 12 ? 2 : x));
    // an affine block that moved: decomposed and slerped (the stub writes 9s)
    expect(lerpMats(id, moved, 0.5, new Array(16))[0]).toBe(9);
    expect(calls).toContain('slerp');
    calls.length = 0;
    // an identical block is copied; a non-matrix block and the tail blend number by number
    const a = [...id, ...new Array(16).fill(0).map((_, k) => (k === 3 ? 2 : 0)), 4];
    const b = [...id, ...new Array(16).fill(0).map((_, k) => (k === 3 ? 2 : k === 0 ? 2 : 0)), 8];
    const d = lerpMats(a, b, 0.5, new Array(33));
    expect(d.slice(0, 16)).toEqual(id);
    expect(d[16]).toBe(1);
    expect(d[32]).toBe(6);
    expect(calls).toEqual([]);
  });
});
