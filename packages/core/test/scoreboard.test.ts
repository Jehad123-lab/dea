import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pctPair } from '../src/extract/scoreboard.ts';
import { judgeSite, parseScoreboardFile, readRunScores, scoreboardMd } from '../src/index.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dea-board-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = async (body: unknown) => {
  await writeFile(join(dir, 'extract.json'), JSON.stringify(body));
  return readRunScores(dir, 'run-1');
};

describe('scoreboard', () => {
  it('reads the kept, (a) and (b) scores from extract.json', async () => {
    const s = await run({
      url: 'https://lusion.co',
      extractedAt: '2026-11-24T00:00:00Z',
      diff: { final: 0.95, canvas: { final: { score: 0.9 } } },
      replay: { canvas: 0.99, page: 0.97, rebuild: { canvas: 0.93, page: 0.95 } },
    });
    expect(s).toMatchObject({
      url: 'https://lusion.co',
      runId: 'run-1',
      page: 0.95,
      canvas: 0.9,
      replayCanvas: 0.99,
      rebuildPage: 0.95,
      rebuildCanvas: 0.93,
      quick: false,
    });
  });
  it('an older run without the replay block still gives the kept scores', async () => {
    const s = await run({ url: 'https://x.test', diff: { final: 0.8 } });
    expect(s.page).toBe(0.8);
    expect(s.canvas).toBeNull();
    expect(s.rebuildCanvas).toBeNull();
  });
  it('holds within the tolerance, regresses below it, and a missing score for a set target is a miss', async () => {
    const s = await run({ url: 'https://a.test', diff: { final: 0.945, canvas: { final: { score: 0.9 } } } });
    expect(judgeSite({ url: 'https://a.test', targets: { page: 0.95 } }, s).status).toBe('holds');
    const bad = judgeSite({ url: 'https://a.test', targets: { page: 0.95, canvas: 0.93 } }, s);
    expect(bad.status).toBe('regressed');
    expect(bad.misses).toEqual([{ metric: 'canvas', target: 0.93, score: 0.9 }]);
    expect(judgeSite({ url: 'https://a.test', targets: { rebuildCanvas: 0.9 } }, s).misses[0]).toMatchObject({ metric: 'rebuildCanvas', score: null });
    expect(judgeSite({ url: 'https://a.test' }, s).status).toBe('no target');
    expect(judgeSite({ url: 'https://a.test', name: 'A' }, null).status).toBe('failed');
  });
  it('the markdown names regressions and sites that did not run', async () => {
    const s = await run({ url: 'https://a.test', diff: { final: 0.5 } });
    const md = scoreboardMd(
      [judgeSite({ url: 'https://a.test', name: 'A', targets: { page: 0.9 } }, s), judgeSite({ url: 'https://b.test', name: 'B' }, null)],
      { 'https://b.test': 'timed out' },
    );
    expect(md).toContain('| A | regressed | 50% (target 90%)');
    expect(md).toContain('- A: page 50%, target 90%');
    expect(md).toContain('- B: timed out');
    expect(md).not.toContain('Every target holds');
  });
  it('a quick run below a full-run target is shown, not counted as a regression', async () => {
    const s = await run({ url: 'https://a.test', quick: true, diff: { final: 0.9 } });
    const row = judgeSite({ url: 'https://a.test', name: 'A', targets: { page: 0.95 } }, s);
    expect(row.status).toBe('below target (quick)');
    const md = scoreboardMd([row]);
    expect(md).toContain('Below target in --quick runs (1');
    expect(md).toContain('No regressions in full runs.');
    expect(md).not.toContain('## Regressions');
  });
  it('a miss too small to see at one decimal gets enough digits to show it', async () => {
    expect(pctPair(0.9999999999999999, 1)[0]).not.toBe(pctPair(0.9999999999999999, 1)[1]);
    expect(pctPair(0.5, 0.9)).toEqual(['50%', '90%']);
    const s = await run({ url: 'https://a.test', diff: { final: 0.9999999999999999 } });
    const md = scoreboardMd([judgeSite({ url: 'https://a.test', name: 'A', targets: { page: 1 } }, s, 0)]);
    expect(md).toContain('- A: page 100% minus 1.1e-16, target 100%');
  });
  it('checks the sites file', () => {
    expect(parseScoreboardFile('{"sites":[{"url":"https://a.test","targets":{"page":0.9}}]}').sites).toHaveLength(1);
    expect(() => parseScoreboardFile('{"sites":[]}')).toThrow(/non-empty/);
    expect(() => parseScoreboardFile('{"sites":[{"url":"a.test"}]}')).toThrow(/http/);
    expect(() => parseScoreboardFile('{"sites":[{"url":"https://a.test","targets":{"page":95}}]}')).toThrow(/between 0 and 1/);
    expect(() => parseScoreboardFile('{"sites":[{"url":"https://a.test","targets":{"speed":0.5}}]}')).toThrow(/one of/);
  });
});
