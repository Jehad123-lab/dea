import type { Brain, Claim, InvestigationPlan, StepKind } from './types.ts';

/**
 * The optional language model. Off unless DEA_LLM_BASE_URL and DEA_LLM_MODEL are set (any OpenAI-compatible
 * endpoint: Ollama at http://localhost:11434/v1 is free and local). DEA_LLM_API_KEY is sent only if set.
 * DEA never needs it: plans and reports work without it; with it, plans are tuned and the answer reads better,
 * and every sentence it writes must cite DEA's evidence or it is dropped.
 */
export function brainFromEnv(env: NodeJS.ProcessEnv = process.env): Brain | null {
  const baseUrl = env.DEA_LLM_BASE_URL?.replace(/\/+$/, '');
  const model = env.DEA_LLM_MODEL;
  if (!baseUrl || !model) return null;
  const key = env.DEA_LLM_API_KEY;
  return {
    kind: 'openai-compatible',
    baseUrl,
    model,
    async complete(system, user, opts = {}) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 1200,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`language model answered HTTP ${res.status}`);
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return j.choices?.[0]?.message?.content ?? '';
    },
  };
}

const KINDS: StepKind[] = ['stack', 'design', 'code', 'api', 'pages'];

/** Let the model choose which of DEA's steps answer the goal. Anything outside DEA's step list is ignored. */
export async function refinePlan(brain: Brain, plan: InvestigationPlan): Promise<InvestigationPlan> {
  const raw = await brain.complete(
    'You plan website investigations for DEA. Reply with JSON {"steps":[...]} choosing only from: stack, design, code, api, pages. Pick the fewest steps that answer the goal.',
    `Goal: ${plan.goal}\nURL: ${plan.url}`,
    { json: true, maxTokens: 200 },
  );
  let kinds: StepKind[] = [];
  try {
    kinds = ((JSON.parse(raw) as { steps?: string[] }).steps ?? []).filter((k): k is StepKind => KINDS.includes(k as StepKind));
  } catch {
    return plan;
  }
  if (!kinds.length) return plan;
  if (!kinds.includes('stack')) kinds.unshift('stack');
  const keep = plan.steps.filter((s) => kinds.includes(s.kind) || s.kind === 'hub');
  const have = new Set(keep.map((s) => s.kind));
  const order: StepKind[] = ['stack', 'pages', 'design', 'motion', 'assets', 'code', 'api', 'hub'];
  const added = kinds.filter((k) => !have.has(k)).map((kind) => ({ id: `s-${kind}`, kind, does: `Run ${kind} (chosen by the language model).` }));
  const steps = [...keep, ...added].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).map((s, i) => ({ ...s, id: `s${i + 1}-${s.kind}` }));
  return { ...plan, by: 'llm', reasons: [...plan.reasons, `language model chose: ${kinds.join(', ')}`], steps };
}

/**
 * A short written answer from the model, built ONLY from DEA's claims. Each sentence must end with citations like
 * [E3]; sentences citing nothing, or an id DEA did not give it, are removed.
 */
export async function writeAnswer(brain: Brain, goal: string, claims: Claim[], validIds: Set<string>): Promise<{ text: string; dropped: number }> {
  const facts = claims.map((c) => `- (${c.label}) ${c.text} [${c.cites.join('][')}]`).join('\n');
  const raw = await brain.complete(
    'Answer the goal in at most 8 short sentences using ONLY the facts given. End every sentence with the evidence ids it rests on, like [E2][E5]. Say "Inferred" for inferred facts. If the facts do not answer something, say so. Never invent.',
    `Goal: ${goal}\n\nFacts:\n${facts}`,
    { maxTokens: 700 },
  );
  return checkCitations(raw, validIds);
}

/** Keep only sentences that cite at least one known evidence id. */
export function checkCitations(text: string, validIds: Set<string>): { text: string; dropped: number } {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?](?:\s*\[E\d+\])*)\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
  let dropped = 0;
  const kept = sentences.filter((s) => {
    const ids = [...s.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]);
    const ok = ids.length > 0 && ids.every((id) => validIds.has(id));
    if (!ok) dropped++;
    return ok;
  });
  return { text: kept.join(' '), dropped };
}
