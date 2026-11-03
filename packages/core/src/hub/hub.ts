import type { Client } from '@modelcontextprotocol/client';
import { connectServer, listAllTools, type ToolInfo } from './client.ts';
import { isDestructive, logCall, mayCall, overLimit, readHistory, summarizeArgs, visibleTools } from './policy.ts';
import { type HubConfig, hubHome, loadHub, SecretStore, saveHub } from './store.ts';

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
      c = connectServer(app, def, { secrets: this.secrets, onStderr: (l) => this.events.onStderr?.(app, l) });
      this.conns.set(app, c);
      c.catch(() => this.conns.delete(app));
    }
    return c;
  }

  async appTools(app: string, refresh = false): Promise<ToolInfo[]> {
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

  /** Call an app's tool for a client: permission check, the call, the history line, the alert rule. */
  async call(client: string, app: string, tool: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const t0 = Date.now();
    const cfg = await this.config(); // re-read each call so "dea hub off" works on a running gateway
    const info: Pick<ToolInfo, 'name' | 'annotations'> = (await this.appTools(app).catch(() => [] as ToolInfo[])).find((t) => t.name === tool) ?? {
      name: tool,
    };
    const destructive = isDestructive(info);
    const verdict = mayCall(cfg, client, app, info);
    const line = { t: new Date().toISOString(), client, app, tool, args: summarizeArgs(args), destructive };
    if (!verdict.ok) {
      await logCall({ ...line, ok: false, ms: 0, blocked: verdict.why }, this.home);
      return { isError: true, content: [{ type: 'text', text: `DEA Hub blocked this call: ${verdict.why}` }] };
    }
    try {
      const r = (await (await this.client(app)).callTool({ name: tool, arguments: args })) as CallResult;
      await logCall({ ...line, ok: !r.isError, ms: Date.now() - t0, ...(r.isError ? { error: firstText(r) } : {}) }, this.home);
      if (destructive) await this.checkAlert(client);
      return r;
    } catch (e) {
      await logCall({ ...line, ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 200) }, this.home);
      if (destructive) await this.checkAlert(client);
      return { isError: true, content: [{ type: 'text', text: `${app} failed: ${(e as Error).message}` }] };
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

function firstText(r: CallResult): string {
  const t = r.content?.find((c) => c.type === 'text') as { text?: string } | undefined;
  return (t?.text ?? '').slice(0, 200);
}
