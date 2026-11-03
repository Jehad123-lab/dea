/** How sure DEA is about a fact. */
export type Label = 'Verified' | 'Inferred' | 'Unknown';

/** Where a fact came from. `pointer` is something a human can check. */
export interface Evidence {
  source:
    | 'global'
    | 'script-url'
    | 'meta'
    | 'header'
    | 'dom'
    | 'har'
    | 'computed-style'
    | 'stylesheet'
    | 'cdp'
    | 'shader'
    | 'webgl'
    | 'screenshot'
    | 'sampling';
  /** e.g. "window.__THREE__", "https://cdn.x.com/gsap.min.js", "network.har entries[12]" */
  pointer: string;
  /** a short excerpt of what was seen */
  excerpt?: string;
}

export interface Fact<T = unknown> {
  /** stable key, e.g. "stack.three" or "design.font.primary" */
  key: string;
  /** one plain sentence a human can read */
  claim: string;
  value: T;
  label: Label;
  evidence: Evidence[];
  /** for Inferred/Unknown: why DEA thinks so, or why it cannot tell */
  why?: string;
}

export interface BrowserInfo {
  name: string;
  version: string;
  headless: boolean;
  channel: string;
}

export interface RunMeta {
  schema: 'dea.run/1';
  id: string;
  kind: 'inspect' | 'stack' | 'design' | 'session' | 'investigate' | 'code' | 'api' | 'assets' | 'motion';
  url: string;
  finalUrl: string;
  title: string;
  status: number | null;
  startedAt: string;
  finishedAt: string;
  browser: BrowserInfo;
  viewport: { width: number; height: number };
  files: Record<string, string>;
  warnings: string[];
}

/**
 * Live progress for UIs (e.g. a future DEA Studio): subscribe with `onEvent` on any command's options,
 * or iterate `streamRun(...)`. Events are plain JSON so they can cross a WebSocket or SSE unchanged.
 */
export type DeaEvent =
  | { type: 'run.started'; runId: string; kind: RunMeta['kind']; url: string; dir: string; at: string }
  | { type: 'step'; runId: string; step: string; at: string }
  | { type: 'frame'; runId: string; file: string; mime: 'image/jpeg' | 'image/png'; data?: string; at: string }
  | { type: 'fact'; runId: string; fact: Fact }
  | { type: 'warning'; runId: string; message: string }
  | { type: 'run.finished'; runId: string; dir: string; summary: string; at: string }
  | { type: 'run.failed'; runId: string | null; error: string; at: string };

export type EventSink = (event: DeaEvent) => void;
