import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Mode } from '../safety/policy.ts';
import { SECRET_KEY } from './policy.ts';
import type { Redactor } from './redact.ts';
import { hubHome } from './store.ts';

/**
 * Approvals that happen outside the AI.
 *
 * Supervised mode asks the person before any change. When the AI app can show a question (MCP elicitation), the question
 * goes through it. When it cannot, the change is NOT refused for good: DEA writes a pending approval for exactly that change
 * and tells the AI its id. The person approves it in a terminal (`dea hub approve <id>`: it shows the change and needs a
 * keyboard, so an AI app that only has MCP tools cannot press it), and the AI asks again. An approval is for one exact call
 * (same client, app, tool and arguments), works once, and ends after ten minutes.
 *
 * Honest limit: this keeps an AI that has only MCP tools from approving for itself. An AI with unrestricted shell access to
 * your account can edit these files too, and DEA cannot protect you from that (nothing running as you can).
 */
export const APPROVAL_TTL_MS = 10 * 60_000;

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'used';

export interface ApprovalRecord {
  id: string;
  client: string;
  app: string;
  tool: string;
  where: string;
  mode: Mode;
  /** the arguments as the person will read them: secrets hidden, long values cut at 400 characters */
  preview: string;
  /** hash of the exact arguments: the approval is for these and no others */
  argsHash: string;
  status: ApprovalStatus;
  created: string;
  decided?: string;
  expires: string;
}

const dirOf = (home = hubHome()) => join(home, 'approvals');
const fileOf = (id: string, home?: string) => join(dirOf(home), `${id}.json`);

/** Keys sorted at every depth, so the same arguments in any key order are the same call. */
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
    );
  return v;
}

export const argsHashOf = (args: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(stable(args ?? {})))
    .digest('hex');

/** The same call gets the same id on every ask, whichever AI asks. */
export const approvalIdOf = (client: string, app: string, tool: string, args: unknown): string =>
  createHash('sha256')
    .update(`${client}\n${app}\n${tool}\n${argsHashOf(args)}`)
    .digest('hex')
    .slice(0, 10);

/** Arguments for a person to read before saying yes: more than the one-line history summary, with secrets hidden. */
export function previewArgs(args: unknown, redact: Redactor): string {
  const hide = (v: unknown, depth = 0): unknown => {
    if (typeof v === 'string') return redact.text(v.length > 400 ? `${v.slice(0, 400)}… [${v.length} characters]` : v);
    if (depth > 6 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => hide(x, depth + 1));
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEY.test(k) ? '[hidden]' : hide(x, depth + 1)]));
  };
  return JSON.stringify(hide(args), null, 1).slice(0, 2000);
}

async function write(r: ApprovalRecord, home?: string): Promise<void> {
  await mkdir(dirOf(home), { recursive: true, mode: 0o700 });
  const f = fileOf(r.id, home);
  const tmp = `${f}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(r, null, 1), { mode: 0o600 });
  await rename(tmp, f);
}

export async function readApproval(id: string, home?: string): Promise<ApprovalRecord | null> {
  if (!/^[0-9a-f]{10}$/.test(id)) return null;
  try {
    return JSON.parse(await readFile(fileOf(id, home), 'utf8')) as ApprovalRecord;
  } catch {
    return null;
  }
}

/** Ask for approval of one change. Asking again for the same change returns the same record (and refreshes it when it ended). */
export async function requestApproval(
  req: { client: string; app: string; tool: string; where: string; mode: Mode; args: unknown; redact: Redactor },
  home?: string,
  now = Date.now(),
): Promise<ApprovalRecord> {
  const id = approvalIdOf(req.client, req.app, req.tool, req.args);
  const old = await readApproval(id, home);
  if (old && (old.status === 'pending' || old.status === 'approved') && Date.parse(old.expires) > now) return old;
  const r: ApprovalRecord = {
    id,
    client: req.client,
    app: req.app,
    tool: req.tool,
    where: req.redact.text(req.where),
    mode: req.mode,
    preview: previewArgs(req.args, req.redact),
    argsHash: argsHashOf(req.args),
    status: 'pending',
    created: new Date(now).toISOString(),
    expires: new Date(now + APPROVAL_TTL_MS).toISOString(),
  };
  await write(r, home);
  return r;
}

/** The person's answer, from their terminal. Only a pending, unexpired approval can be decided. */
export async function decideApproval(id: string, answer: 'approved' | 'denied', home?: string, now = Date.now()): Promise<ApprovalRecord> {
  const r = await readApproval(id, home);
  if (!r) throw new Error(`There is no approval ${id}. See: dea hub approvals`);
  if (r.status !== 'pending') throw new Error(`Approval ${id} is already ${r.status}.`);
  if (Date.parse(r.expires) <= now) throw new Error(`Approval ${id} ended (it lasts ten minutes). Ask the AI to try again and a new one is made.`);
  const next: ApprovalRecord = { ...r, status: answer, decided: new Date(now).toISOString(), expires: new Date(now + APPROVAL_TTL_MS).toISOString() };
  await write(next, home);
  return next;
}

/** Is this exact change approved? If so it is used up now: one approval, one change. */
export async function consumeApproval(
  req: { client: string; app: string; tool: string; args: unknown },
  home?: string,
  now = Date.now(),
): Promise<ApprovalRecord | null> {
  const id = approvalIdOf(req.client, req.app, req.tool, req.args);
  const r = await readApproval(id, home);
  if (r?.status !== 'approved' || Date.parse(r.expires) <= now || r.argsHash !== argsHashOf(req.args)) return null;
  const used: ApprovalRecord = { ...r, status: 'used' };
  await write(used, home);
  return used;
}

/** Pending approvals (newest first); finished ones older than a day are swept. */
export async function listApprovals(home?: string, now = Date.now()): Promise<ApprovalRecord[]> {
  const out: ApprovalRecord[] = [];
  for (const f of await readdir(dirOf(home)).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue;
    const r = await readApproval(f.slice(0, -5), home);
    if (!r) continue;
    if (now - Date.parse(r.expires) > 86_400_000) {
      await rm(fileOf(r.id, home), { force: true });
      continue;
    }
    out.push(r);
  }
  return out.sort((a, b) => b.created.localeCompare(a.created));
}
