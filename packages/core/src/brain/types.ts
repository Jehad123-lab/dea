/**
 * Seam for Phase 6 (investigate runs). Nothing here runs yet; these are the shapes the
 * background investigator will write into .dea/runs/<id>/ so a crash can resume.
 */
export interface InvestigationPlan {
  goal: string;
  url: string;
  steps: Array<{ id: string; does: string; status: 'todo' | 'doing' | 'done' | 'failed' }>;
}

export interface Checkpoint {
  runId: string;
  stepId: string;
  at: string;
  /** facts gathered so far; each is re-verified before it is marked Verified in the final answer */
  factKeys: string[];
}

/** Who thinks: an OpenAI-compatible endpoint the user configures, or the calling AI app ("client"). */
export type Brain = { kind: 'client' } | { kind: 'openai-compatible'; baseUrl: string; model: string };
