import { deaHome } from '../evidence/run.ts';
import { loadPolicy, MODES, type Mode } from '../safety/policy.ts';

/** What a connector call does: look, or change something somewhere. */
export type CallKind = 'read' | 'write';

export interface ApprovalRequest {
  client: string;
  app: string;
  tool: string;
  /** where the change lands, in plain words: "github Jehad123-lab/dea issue #4", "fs notes/todo.md", "vercel project my-site" */
  where: string;
  /** the arguments, summarised and with secrets hidden */
  args: string;
  mode: Mode;
}

/** Asked in supervised mode before any change. true = go ahead. No callback means nobody can be asked, so the answer is no. */
/** 'unavailable' = this channel cannot show the question at all (different from the person saying no). */
export type Approve = (req: ApprovalRequest) => Promise<boolean | 'unavailable'>;

export type ModeVerdict = { ok: true; via: 'read' | 'delegated' | 'approval-needed' } | { ok: false; why: string };

/**
 * The permission modes applied to connector calls:
 *  - restricted: read-only. A change is refused.
 *  - supervised: reads run; every change needs an explicit OK (the approval callback) first.
 *  - delegated: reads and changes run, but only inside the connector's declared scope (checked separately, before this).
 */
export function decideCall(mode: Mode, kind: CallKind): ModeVerdict {
  if (kind === 'read') return { ok: true, via: 'read' };
  if (mode === 'restricted')
    return {
      ok: false,
      why: 'DEA is in restricted mode, which is read-only. This call changes something. Switch with DEA_MODE=supervised (asks first) or delegated (runs inside the connector scope).',
    };
  if (mode === 'supervised') return { ok: true, via: 'approval-needed' };
  return { ok: true, via: 'delegated' };
}

/**
 * The mode the hub runs in: DEA_MODE if the person set it, else the policy file (`<DEA home>/policy.json`), else supervised.
 * Set by the person in their own environment or file: a tool call can never loosen it.
 */
export function hubMode(env: Record<string, string | undefined> = process.env): Mode {
  const m = env.DEA_MODE as Mode | undefined;
  if (m && MODES.includes(m)) return m;
  if (m) throw new Error(`DEA_MODE must be one of ${MODES.join(', ')}.`);
  return loadPolicy(deaHome()).mode;
}
