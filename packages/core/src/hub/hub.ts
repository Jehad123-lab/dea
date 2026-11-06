import type { Client } from '@modelcontextprotocol/client';
import type { Mode } from '../safety/policy.ts';
import { approvalIdOf, consumeApproval, readApproval, requestApproval } from './approvals.ts';
import { writeAudit } from './audit.ts';
import { type Connector, type FetchLike, findConnector, kindOf, toToolInfo } from './builtin/index.ts';
import { connectServer, listAllTools, type ToolInfo } from './client.ts';
import { type Approve, decideCall } from './modes.ts';
import { isDestructive, isReadOnly, logCall, mayCall, overLimit, readHistory, summarizeArgs, visibleTools } from './policy.ts';
import { isEnvVarName, Redactor } from './redact.ts';
import { type HubConfig, hubHome, loadHub, SecretStore, type ServerDef, saveHub } from './store.ts';

/** Names DEA shows AI clients: "<app>__<tool>" (double underscore keeps app names with - or _ readable). */
export const SEP = '__';
export const qualify = (app: string, tool: string) => `${app}${SEP}${tool}`;
export function unqualify(name: string): { app: string; tool: string } | null {
  const i = name.indexOf(SEP);
  return i > 0 ? { app: name.slice(0, i), tool: name.slice(i + SEP.length) } : null;
}

export interface CallResult {
  content: Array<{ type: string; [k: string]: unknown }>;
  isError?: boolean;
  structuredContent?: unknown;
}

export interface HubOptions {
  /**
   * The permission mode every call goes through: restricted (read-only), supervised (a change needs `approve` first),
   * delegated (changes run inside the connector scope). Not set = grants only, as before modes existed (library use).
   */
  mode?: Mode;
  /** asked before a change in supervised mode; without it nobody can be asked and the change is refused */
  approve?: Approve;
  /** environment the connectors read tokens from (default process.env) */
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  /** one call must finish within this many ms (default 60 000); a slower one fails with a plain error, and for a change it says the outcome is unknown */
  callTimeoutMs?: number;
}

export interface HubEvents {
  /** the alert rule paused a client */
  onPause?: (client: string, why: string) => void;
  onStderr?: (app: string, line: string) => void;
}

/**
 * DEA Hub: connects to apps' MCP servers once and lets any AI client use them through DEA, filtered by that client's
 * permissions, with every call logged. Clients never see a token: DEA holds the connections.
 */
export class Hub {
  private conns = new Map<string, Promise<Client>>();
  private tools = new Map<string, ToolInfo[]>();
  readonly secrets: SecretStore;

  constructor(
    readonly home = hubHome(),
    readonly events: HubEvents = {},
    readonly opts: HubOptions = {},
  ) {
    this.secrets = new SecretStore(home);
  }

  config(): Promise<HubConfig> {
    return loadHub(this.home);
  }

  /** A live connection to one app (reused). */
  async client(app: string): Promise<Client> {
    let c = this.conns.get(app);
    if (!c) {
      const cfg = await this.config();
      const def = cfg.mcpServers[app];
      if (!def) throw new Error(`No app called "${app}" in DEA Hub. See: dea hub list`);
      if ('builtin' in def) throw new Error(`${app} is a built-in connector, not an MCP server.`);
      c = connectServer(app, def, { secrets: this.secrets, onStderr: (l) => this.events.onStderr?.(app, l) });
      this.conns.set(app, c);
      c.catch(() => this.conns.delete(app));
    }
    return c;
  }

  async appTools(app: string, refresh = false): Promise<ToolInfo[]> {
    const def = (await this.config()).mcpServers[app];
    if (def && 'builtin' in def) {
      const con = findConnector(def.builtin);
      if (!con) throw new Error(`${app}: DEA has no built-in connector called "${def.builtin}".`);
      return con.tools.map((t) => toToolInfo(t));
    }
    if (!refresh && this.tools.has(app)) return this.tools.get(app) as ToolInfo[];
    const t = await listAllTools(await this.client(app));
    this.tools.set(app, t);
    return t;
  }

  /** Every tool this client may see, across connected apps, as "<app>__<tool>". Apps that fail to connect are reported, not fatal. */
  async toolsFor(client: string): Promise<{ tools: Array<ToolInfo & { app: string; original: string }>; errors: Record<string, string> }> {
    const cfg = await this.config();
    const out: Array<ToolInfo & { app: string; original: string }> = [];
    const errors: Record<string, string> = {};
    const c = cfg.clients[client];
    if (c && !c.enabled) return { tools: [], errors };
    await Promise.all(
      Object.entries(cfg.mcpServers)
        .filter(([, d]) => !d.disabled)
        .map(async ([app]) => {
          try {
            for (const t of visibleTools(cfg, client, app, await this.appTools(app)))
              out.push({ ...t, name: qualify(app, t.name), original: t.name, app, description: `[${app}] ${t.description ?? ''}`.trim() });
          } catch (e) {
            errors[app] = (e as Error).message;
          }
        }),
    );
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { tools: out, errors };
  }

  /** Call an app's tool for a client: grants, scope, permission mode, approval, audit, the call, the history line, the alert rule. */
  async call(client: string, app: string, tool: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const t0 = Date.now();
    const cfg = await this.config(); // re-read each call so "dea hub off" works on a running gateway
    // the person at their own terminal ("cli") is the owner: no grant needed, but mode, scope, approval and audit still apply
    if (client === 'cli' && !cfg.clients.cli) cfg.clients.cli = { enabled: true, apps: {}, defaultLevel: 'full' };
    const def = cfg.mcpServers[app];
    const builtin = def && 'builtin' in def ? def : null;
    const connector = builtin ? findConnector(builtin.builtin) : undefined;
    const bt = connector?.tools.find((t) => t.name === tool);
    const info: Pick<ToolInfo, 'name' | 'annotations'> = bt
      ? toToolInfo(bt, args)
      : ((await this.appTools(app).catch(() => [] as ToolInfo[])).find((t) => t.name === tool) ?? { name: tool });
    const env = this.opts.env ?? process.env;
    const token =
      builtin && connector?.needsToken ? env[builtin.tokenEnv ?? connector.defaultTokenEnv ?? ''] : builtin?.tokenEnv ? env[builtin.tokenEnv] : undefined;
    const redact = new Redactor([token]);
    // anything an MCP server does not mark read-only may change something
    const write = bt ? kindOf(bt, args) === 'write' : !isReadOnly(info);
    const destructive = bt ? write : isDestructive(info);
    const line = { t: new Date().toISOString(), client, app, tool, args: redact.text(summarizeArgs(args)), destructive };
    const blocked = async (why: string, where = `${app}:${tool}`, audit = write): Promise<CallResult> => {
      const w = redact.text(why);
      await logCall({ ...line, ok: false, ms: 0, blocked: w }, this.home);
      if (audit)
        await writeAudit(
          { t: line.t, client, app, tool, where: redact.text(where), mode: this.opts.mode ?? 'unset', stage: 'denied', basis: w, args: line.args },
          this.home,
        ).catch(() => {});
      return { isError: true, content: [{ type: 'text', text: `DEA Hub blocked this call: ${w}` }] };
    };

    const verdict = mayCall(cfg, client, app, info);
    if (!verdict.ok) return blocked(verdict.why);

    // 1) scope: a built-in connector only reaches what it was declared to reach, in every mode
    let where = `${app}:${tool}`;
    if (builtin) {
      if (!connector || !bt) return blocked(`${app} has no tool "${tool}". See: dea hub tools ${app}`, where, false);
      try {
        connector.validateScope(builtin.scope);
      } catch (e) {
        return blocked(`the scope of ${app} is not usable: ${(e as Error).message}`, where, false);
      }
      if (builtin.tokenEnv !== undefined && !isEnvVarName(builtin.tokenEnv))
        return blocked(
          `tokenEnv of ${app} is not the name of an environment variable (a token must never be written there). Remove the app and add it again with --token-env NAME.`,
          where,
          false,
        );
      if (connector.needsToken && !token)
        return blocked(
          `${app} needs a token in the environment variable ${builtin.tokenEnv ?? connector.defaultTokenEnv}, and it is empty here. Set it in the shell that starts DEA (the value is never stored or printed).`,
          where,
          false,
        );
      try {
        const sc = await bt.check(args, builtin.scope);
        if (!sc.ok) return blocked(`outside the scope of ${app}: ${sc.why}`, where);
        where = sc.where;
      } catch (e) {
        return blocked((e as Error).message, where, false);
      }
    }

    // 2) permission mode (changes only; looking is always allowed)
    let basis = write ? 'no permission mode set: grants only' : 'read';
    if (write && this.opts.mode) {
      const mv = decideCall(this.opts.mode, 'write');
      if (!mv.ok) return blocked(mv.why, where);
      if (mv.via === 'approval-needed') {
        const prior = await consumeApproval({ client, app, tool, args }, this.home);
        let yes: boolean | 'unavailable' = false;
        if (prior) yes = true;
        else {
          try {
            yes = this.opts.approve
              ? await this.opts.approve({ client, app, tool, where: redact.text(where), args: line.args, mode: this.opts.mode })
              : 'unavailable';
          } catch {
            yes = false;
          }
        }
        if (yes === 'unavailable') {
          const asked = await readApproval(approvalIdOf(client, app, tool, args), this.home);
          if (asked?.status === 'denied' && Date.parse(asked.expires) > Date.now())
            return blocked(`supervised mode: you declined this change in your terminal (approval ${asked.id}).`, where);
          const rec = await requestApproval({ client, app, tool, where, mode: this.opts.mode, args, redact }, this.home);
          return blocked(
            `supervised mode: this changes something and needs your OK, but nothing here can ask you. It is waiting as approval ${rec.id} (for exactly this change, once, for ten minutes). In a terminal run:  dea hub approve ${rec.id}  then ask again. Or set DEA_MODE=delegated to let calls inside the connector scope run.`,
            where,
          );
        }
        if (yes !== true) return blocked('supervised mode: you did not approve this change.', where);
        basis = prior ? `approved by the user in a terminal (approval ${prior.id})` : 'approved by the user (supervised)';
      } else basis = builtin ? 'delegated, inside the connector scope' : 'delegated, inside the grant';
    }

    // 3) a change DEA cannot record is a change DEA does not make
    if (write) {
      try {
        await writeAudit(
          { t: line.t, client, app, tool, where: redact.text(where), mode: this.opts.mode ?? 'unset', stage: 'intent', basis, args: line.args },
          this.home,
        );
      } catch (e) {
        return blocked(`the audit log could not be written (${redact.text((e as Error).message)}), so the change was not made.`, where, false);
      }
    }
    const finish = async (stage: 'done' | 'failed', error?: string) => {
      if (write)
        await writeAudit(
          {
            t: new Date().toISOString(),
            client,
            app,
            tool,
            where: redact.text(where),
            mode: this.opts.mode ?? 'unset',
            stage,
            basis,
            args: line.args,
            ...(error ? { error: redact.text(error).slice(0, 300) } : {}),
          },
          this.home,
        ).catch(() => {});
    };

    try {
      let r: CallResult;
      const limit = this.opts.callTimeoutMs ?? 60_000;
      const within = <T>(p: Promise<T>): Promise<T> => {
        let timer: NodeJS.Timeout | undefined;
        const slow = new Promise<never>((_ok, no) => {
          timer = setTimeout(
            () =>
              no(
                new Error(
                  `did not finish within ${Math.round(limit / 1000)} s (the time budget for one call).${write ? ' This call changes something: it may or may not have happened, so look before you try again.' : ''}`,
                ),
              ),
            limit,
          );
        });
        return Promise.race([p, slow]).finally(() => clearTimeout(timer));
      };
      if (builtin && bt) {
        const data = await within(bt.run(args, { token, scope: builtin.scope, fetch: this.opts.fetch ?? fetch, redact }));
        const safe = redact.deep(data);
        const text = JSON.stringify(
          {
            ok: true,
            source: `${app} (${builtin.builtin})`,
            fetched_at: new Date().toISOString(),
            verified: true,
            ...(write ? { changed: where } : {}),
            data: safe,
          },
          null,
          2,
        );
        r = { content: [{ type: 'text', text: text.length > 60_000 ? `${text.slice(0, 60_000)}\n[cut at 60000 characters]` : text }] };
      } else r = (await within((async () => (await this.client(app)).callTool({ name: tool, arguments: args }))())) as CallResult;
      await logCall({ ...line, ok: !r.isError, ms: Date.now() - t0, ...(r.isError ? { error: redact.text(firstText(r)) } : {}) }, this.home);
      await finish(r.isError ? 'failed' : 'done', r.isError ? firstText(r) : undefined);
      if (destructive) await this.checkAlert(client);
      return r;
    } catch (e) {
      const msg = redact.text((e as Error).message).slice(0, 300);
      await logCall({ ...line, ok: false, ms: Date.now() - t0, error: msg }, this.home);
      await finish('failed', msg);
      if (destructive) await this.checkAlert(client);
      return { isError: true, content: [{ type: 'text', text: `${app} failed: ${msg}` }] };
    }
  }

  private async checkAlert(client: string): Promise<void> {
    const cfg = await this.config();
    const hist = await readHistory({ client, sinceMs: Date.now() - cfg.alert.minutes * 60_000 }, this.home);
    const { over, count } = overLimit(hist, client, cfg.alert);
    if (!over) return;
    const why = `paused automatically: ${count} changing calls in ${cfg.alert.minutes} min (limit ${cfg.alert.max})`;
    cfg.clients[client] = { ...(cfg.clients[client] ?? { apps: {} }), enabled: false, pausedReason: why, pausedAt: new Date().toISOString() };
    await saveHub(cfg, this.home);
    this.events.onPause?.(client, why);
  }

  async close(): Promise<void> {
    await Promise.all([...this.conns.values()].map(async (c) => (await c.catch(() => null))?.close().catch(() => {})));
    this.conns.clear();
  }
}

export type { Connector, ServerDef };

function firstText(r: CallResult): string {
  const t = r.content?.find((c) => c.type === 'text') as { text?: string } | undefined;
  return (t?.text ?? '').slice(0, 200);
}
