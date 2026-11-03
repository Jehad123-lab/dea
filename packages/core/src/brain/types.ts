import type { Fact, Label } from '../types.ts';

/** What an investigation step does. Each kind runs one of DEA's own tools. */
export type StepKind = 'stack' | 'design' | 'code' | 'api' | 'pages' | 'motion' | 'assets' | 'hub';

export interface PlanStep {
  id: string;
  kind: StepKind;
  /** one plain sentence: what this step finds out and why it is in the plan */
  does: string;
  /** step options (e.g. pages: { max: 5 }, hub: { app, tool, args }) */
  with?: Record<string, unknown>;
}

export interface InvestigationPlan {
  goal: string;
  url: string;
  /** who wrote the plan: DEA's rules, or the optional language model (checked against the same step kinds) */
  by: 'rules' | 'llm';
  /** the goal words that chose each step */
  reasons: string[];
  steps: PlanStep[];
}

export interface StepState {
  id: string;
  kind: StepKind;
  status: 'todo' | 'doing' | 'done' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  /** the run a decoder step produced (its own folder, with its own evidence) */
  childRun?: string;
  summary?: string;
  error?: string;
  /** small results kept in the checkpoint (page outlines, a hub call's answer) */
  data?: unknown;
}

/** Written after every step to .dea/runs/<id>/checkpoint.json; `dea investigate --resume <id>` continues from it. */
export interface Checkpoint {
  schema: 'dea.checkpoint/1';
  runId: string;
  goal: string;
  url: string;
  plan: InvestigationPlan;
  steps: StepState[];
  status: 'running' | 'done' | 'failed' | 'stopped';
  /** process id of a background run, so status can tell a live run from a dead one */
  pid?: number;
  createdAt: string;
  updatedAt: string;
  options: { browser?: string; maxPages?: number; llm?: boolean };
}

/** One claim in the final answer, with the evidence it rests on. */
export interface Claim {
  id: string;
  text: string;
  label: Label;
  /** evidence ids from the report's evidence index */
  cites: string[];
  /** where the claim came from */
  from: StepKind | 'llm';
  why?: string;
}

export interface EvidenceRef {
  id: string;
  /** child run id, or this run for page reads */
  run: string;
  file: string;
  pointer: string;
  excerpt?: string;
}

/** Facts read back from a child run, with the run they belong to. */
export interface RunFacts {
  run: string;
  kind: StepKind;
  facts: Fact[];
}

/** An optional language model: any OpenAI-compatible endpoint (a local Ollama/LM Studio, or a hosted one). Off unless configured. */
export interface Brain {
  kind: 'openai-compatible';
  baseUrl: string;
  model: string;
  complete(system: string, user: string, opts?: { json?: boolean; maxTokens?: number }): Promise<string>;
}
