import type { DeaEvent, EventSink } from './types.ts';

/**
 * Turn any DEA command into a live stream, for UIs:
 *
 *   const { events, result } = streamRun((onEvent) => decodeDesign(url, { onEvent, frameData: true }));
 *   for await (const e of events) ui.render(e); // step, frame, fact, warning, run.finished / run.failed
 *   const decoded = await result;
 */
export function streamRun<R>(start: (onEvent: EventSink) => Promise<R>): { events: AsyncIterable<DeaEvent>; result: Promise<R> } {
  const queue: DeaEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const push = (e: DeaEvent) => {
    queue.push(e);
    wake?.();
  };
  const result = start(push).finally(() => {
    done = true;
    wake?.();
  });
  result.catch(() => {}); // the caller sees the error through `result`; the stream just ends
  const events: AsyncIterable<DeaEvent> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length) {
          yield queue.shift() as DeaEvent;
          continue;
        }
        if (done) return;
        await new Promise<void>((r) => {
          wake = r;
        });
        wake = null;
      }
    },
  };
  return { events, result };
}
