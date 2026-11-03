import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { streamRun } from '../src/events.ts';
import { newRunId, RunWriter } from '../src/evidence/run.ts';
import type { DeaEvent } from '../src/types.ts';

const root = await mkdtemp(join(tmpdir(), 'dea-events-'));
afterAll(() => rm(root, { recursive: true, force: true }));

describe('live events', () => {
  it('streams steps and frames from a run, then ends with the result', async () => {
    const { events, result } = streamRun(async (onEvent) => {
      const w = await new RunWriter(newRunId('https://a.com'), root, onEvent, { frameData: true }).init();
      await w.progress('opening https://a.com');
      await w.bytes('frames/hero-0.jpg', new Uint8Array([0xff, 0xd8, 0xff]));
      onEvent({ type: 'run.finished', runId: w.id, dir: w.dir, summary: 'ok', at: new Date().toISOString() });
      return w.id;
    });
    const seen: DeaEvent[] = [];
    for await (const e of events) seen.push(e);
    expect(seen.map((e) => e.type)).toEqual(['step', 'frame', 'run.finished']);
    const frame = seen[1] as Extract<DeaEvent, { type: 'frame' }>;
    expect(frame.file).toBe('frames/hero-0.jpg');
    expect(frame.data).toBe('/9j/');
    expect(await result).toMatch(/a-com/);
  });

  it('ends the stream when the run fails, and the error reaches result', async () => {
    const { events, result } = streamRun(async () => {
      throw new Error('boom');
    });
    for await (const _ of events) {
      /* drain */
    }
    await expect(result).rejects.toThrow('boom');
  });
});
