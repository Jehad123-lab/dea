import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Mode } from '../safety/policy.ts';
import { hubHome } from './store.ts';

/** One line per change a connector call made (or was refused): what, where, when, in which mode. No secrets, ever. */
export interface AuditLine {
  t: string;
  client: string;
  app: string;
  tool: string;
  /** where the change lands, redacted */
  where: string;
  mode: Mode | 'unset';
  /** intent = about to run (written before, so a crash still leaves a trace); done/failed = what happened; denied = refused */
  stage: 'intent' | 'done' | 'failed' | 'denied';
  /** why: approved by the user, delegated within scope, or the refusal reason */
  basis: string;
  args: string;
  error?: string;
}

export const auditPath = (home = hubHome()) => join(home, 'audit.jsonl');

/** Throws when the line cannot be written: a change DEA cannot record is a change DEA does not make. */
export async function writeAudit(line: AuditLine, home = hubHome()): Promise<void> {
  await mkdir(home, { recursive: true });
  await appendFile(auditPath(home), `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

export async function readAudit(opts: { limit?: number; app?: string } = {}, home = hubHome()): Promise<AuditLine[]> {
  const raw = await readFile(auditPath(home), 'utf8').catch(() => '');
  const out: AuditLine[] = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try {
      const a = JSON.parse(l) as AuditLine;
      if (!opts.app || a.app === opts.app) out.push(a);
    } catch {
      /* torn line */
    }
  }
  return opts.limit ? out.slice(-opts.limit) : out;
}
