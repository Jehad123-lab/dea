import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactText } from '../evidence/secrets.ts';
import type { ToolInfo } from './client.ts';
import { hideQuerySecrets } from './redact.ts';
import { type AppGrant, type ClientDef, type HubConfig, hubHome, type Level } from './store.ts';

/** MCP's own rule: a tool is read-only only if it says so; a tool that is not read-only is destructive unless it says it is not. */
export function isReadOnly(t: { annotations?: ToolInfo['annotations'] }): boolean {
  return t.annotations?.readOnlyHint === true;
}
export function isDestructive(t: { annotations?: ToolInfo['annotations'] }): boolean {
  if (isReadOnly(t)) return false;
  return t.annotations?.destructiveHint !== false;
}

export function clientOf(cfg: HubConfig, client: string): ClientDef {
  return cfg.clients[client] ?? { enabled: true, apps: {} };
}

export function grantFor(cfg: HubConfig, client: string, app: string): AppGrant {
  const c = clientOf(cfg, client);
  return c.apps[app] ?? { level: c.defaultLevel ?? cfg.defaultLevel };
}

export type Verdict = { ok: true } | { ok: false; why: string };

/** May this AI client call this app's tool? The single gate every proxied call goes through. */
export function mayCall(cfg: HubConfig, client: string, app: string, tool: Pick<ToolInfo, 'name' | 'annotations'>): Verdict {
  const c = clientOf(cfg, client);
  if (!c.enabled)
    return {
      ok: false,
      why: `${client} is switched off in DEA Hub${c.pausedReason ? ` (${c.pausedReason})` : ''}. Turn it back on with: dea hub on ${client}`,
    };
  const server = cfg.mcpServers[app];
  if (!server || server.disabled) return { ok: false, why: `${app} is not connected in DEA Hub.` };
  const g = grantFor(cfg, client, app);
  const levelWhy = (l: Level) => `${client} has "${l}" access to ${app}`;
  switch (g.level) {
    case 'full':
      return { ok: true };
    case 'read':
      return isReadOnly(tool)
        ? { ok: true }
        : { ok: false, why: `${levelWhy('read')}; ${tool.name} can change things. Allow it with: dea hub allow ${client} ${app} full` };
    case 'selected':
      return g.tools?.includes(tool.name)
        ? { ok: true }
        : {
            ok: false,
            why: `${levelWhy('selected')} and ${tool.name} is not on its list. Add it with: dea hub allow ${client} ${app} selected --tools ${[...(g.tools ?? []), tool.name].join(',')}`,
          };
    default:
      return { ok: false, why: `${levelWhy('off')}.` };
  }
}

/** The tools a client is shown for an app: exactly the ones it may call. */
export function visibleTools(cfg: HubConfig, client: string, app: string, tools: ToolInfo[]): ToolInfo[] {
  return tools.filter((t) => mayCall(cfg, client, app, t).ok);
}

// ---------------- history

export interface HistoryLine {
  t: string;
  client: string;
  app: string;
  tool: string;
  /** argument names and short, redacted values; never secrets, never long content */
  args: string;
  ok: boolean;
  destructive: boolean;
  ms: number;
  error?: string;
  /** set when the hub refused the call itself */
  blocked?: string;
}

const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|auth|cookie|session|credential|private|otp|pin|card|cvc|cvv|ssn/i;

/** A one-line summary of tool arguments for the history: keys, short values, secrets hidden. */
export function summarizeArgs(args: unknown, depth = 0): string {
  if (args === null || args === undefined) return '';
  if (typeof args === 'string') return JSON.stringify(hideQuerySecrets(redactText(args.length > 60 ? `${args.slice(0, 57)}...` : args)));
  if (typeof args === 'number' || typeof args === 'boolean') return String(args);
  if (Array.isArray(args))
    return depth > 1
      ? `[${args.length}]`
      : `[${args
          .slice(0, 3)
          .map((a) => summarizeArgs(a, depth + 1))
          .join(', ')}${args.length > 3 ? `, +${args.length - 3}` : ''}]`;
  if (typeof args === 'object') {
    if (depth > 1) return '{…}';
    return `{${Object.entries(args as Record<string, unknown>)
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${SECRET_KEY.test(k) ? '[hidden]' : summarizeArgs(v, depth + 1)}`)
      .join(', ')}}`;
  }
  return typeof args;
}

export async function logCall(line: HistoryLine, home = hubHome()): Promise<void> {
  await mkdir(home, { recursive: true });
  await appendFile(join(home, 'history.jsonl'), `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

export async function readHistory(opts: { client?: string; app?: string; limit?: number; sinceMs?: number } = {}, home = hubHome()): Promise<HistoryLine[]> {
  const raw = await readFile(join(home, 'history.jsonl'), 'utf8').catch(() => '');
  const out: HistoryLine[] = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try {
      const h = JSON.parse(l) as HistoryLine;
      if (opts.client && h.client !== opts.client) continue;
      if (opts.app && h.app !== opts.app) continue;
      if (opts.sinceMs && Date.parse(h.t) < opts.sinceMs) continue;
      out.push(h);
    } catch {
      /* a torn line from a crash: skip it */
    }
  }
  return opts.limit ? out.slice(-opts.limit) : out;
}

/** The alert rule: more than `max` destructive calls in `minutes` → this client should be paused. */
export function overLimit(history: HistoryLine[], client: string, rule: { max: number; minutes: number }, now = Date.now()): { over: boolean; count: number } {
  const since = now - rule.minutes * 60_000;
  const count = history.filter((h) => h.client === client && h.destructive && !h.blocked && Date.parse(h.t) >= since).length;
  return { over: count > rule.max, count };
}
