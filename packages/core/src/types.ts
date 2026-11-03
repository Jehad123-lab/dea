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
  kind: 'inspect' | 'stack' | 'design';
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
