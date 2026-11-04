import { describe, expect, it } from 'vitest';
import { currentTimings, renderTimings, Timings, timed, treeRss, withTimings } from '../src/timings.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('timings', () => {
  it('records stages, nesting and side-by-side stages with their parents', async () => {
    const t = new Timings('extract', 'https://example.com').start();
    await withTimings(t, async () => {
      await timed('design', async () => {
        await timed('page load', () => sleep(5));
      });
      await Promise.all([timed('motion', () => sleep(5)), timed('assets', () => sleep(5))]);
      expect(currentTimings()).toBe(t);
    });
    const doc = t.stop();
    const byName = Object.fromEntries(doc.stages.map((s) => [s.name, s]));
    expect(byName['page load'].parent).toBe('design');
    expect(byName['page load'].parentId).toBe(byName.design.id);
    expect(byName.motion.parent).toBeNull();
    expect(Object.keys(doc.totals).sort()).toEqual(['assets', 'design', 'motion']);
    expect(doc.peakRssMb).toBeGreaterThan(0);
    expect(doc.totalMs).toBeGreaterThanOrEqual(10);
    const text = renderTimings(doc);
    expect(text).toMatch(/design/);
    expect(text).toMatch(/ {4}page load/);
  });

  it('marks a failed stage and still rethrows', async () => {
    const t = new Timings('x');
    await expect(withTimings(t, () => timed('boom', () => Promise.reject(new Error('no'))))).rejects.toThrow('no');
    expect(t.stop().stages[0].ok).toBe(false);
  });

  it('begin/end nests a block under an open stage, and timed() is a no-op without a collector', async () => {
    const t = new Timings('x');
    const a = t.begin('render and score');
    const b = t.begin('score the replay', a.row);
    b.end();
    a.end();
    expect(t.stop().stages[1].parentId).toBe(0);
    expect(await timed('nothing', async () => 7)).toBe(7);
  });

  it('reads the process tree memory where /proc exists', () => {
    const r = treeRss();
    if (process.platform === 'linux') expect(r).toBeGreaterThan(0);
    else expect(r === null || r > 0).toBe(true);
  });
});
