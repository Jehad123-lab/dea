import { describe, expect, it } from 'vitest';
import { recordFrameCount } from '../src/extract/index.ts';
import { loopTiming } from '../src/replay/rebuild.ts';
import { REBUILD_RUNNER } from '../src/replay/runner.ts';

describe('Round 47: motion that plays (two frames in quick mode, --frames motion loops)', () => {
  it('records two frames by default (quick too: one frame had no clocks), --frames clamped to 2-120', () => {
    expect(recordFrameCount()).toBe(2);
    expect(recordFrameCount(1)).toBe(2);
    expect(recordFrameCount(30)).toBe(30);
    expect(recordFrameCount(500)).toBe(120);
    expect(recordFrameCount(Number.NaN)).toBe(2);
  });

  it('loopTiming: each frame stays up as long as it did on the site; the last takes the median gap', () => {
    expect(loopTiming([{ ts: 0 }, { ts: 16 }, { ts: 50 }, { ts: 66 }])).toEqual([16, 34, 16, 16]);
    // no timestamps: 60 fps
    expect(loopTiming([{}, {}, {}])).toEqual([16.7, 16.7, 16.7]);
    // a stalled frame is capped, a duplicate timestamp takes the median
    expect(loopTiming([{ ts: 0 }, { ts: 1000 }, { ts: 1000 }, { ts: 1020 }])).toEqual([250, 20, 20, 20]);
  });

  it('the rebuild runner plays a motion loop in order instead of holding the last frame (options.loop false holds)', () => {
    expect(REBUILD_RUNNER).toContain('const looping = Boolean(p.loop && options.loop !== false');
    expect(REBUILD_RUNNER).toContain('if (!looping && options.animate !== false && options.steady !== false && RF > 1)');
    expect(REBUILD_RUNNER).toContain('frame = (f + 1) % RF;');
  });
});
