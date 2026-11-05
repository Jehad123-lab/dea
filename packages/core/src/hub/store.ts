import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The hub's own files live in one folder, ~/.dea by default (DEA_HUB_HOME moves it):
 * - hub.json      apps (MCP servers), AI clients and their permissions, the alert rule. No secrets.
 * - secrets.enc   OAuth tokens, registered client ids, header values. AES-256-GCM, key in hub.key (0600) or $DEA_HUB_KEY.
 * - history.jsonl one line per tool call a client made through the hub (arguments redacted).
 */
export function hubHome(): string {
  return process.env.DEA_HUB_HOME || join(homedir(), '.dea');
}

/** A standard mcpServers entry (Claude Desktop / Cursor shape), plus DEA's few extras. */
export type ServerDef =
  | {
      /** a connector built into DEA (github, vercel, filesystem, http): no MCP server involved */
      builtin: string;
      /** NAME of the environment variable that holds the token; the token itself is never stored */
      tokenEnv?: string;
      /** what the connector may touch; required, nothing outside it is reached in any mode */
      scope: Record<string, unknown>;
      disabled?: boolean;
      note?: string;
    }
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string; disabled?: boolean; note?: string }
  | {
      url: string;
      type?: 'http' | 'streamable-http' | 'sse';
      /** header names whose values sit in secrets.enc (never in this file) */
      secretHeaders?: string[];
      /** plain, non-secret headers */
      headers?: Record<string, string>;
      oauth?: { clientId?: string; scopes?: string[] };
      disabled?: boolean;
      note?: string;
    };

export const LEVELS = ['full', 'read', 'selected', 'off'] as const;
export type Level = (typeof LEVELS)[number];

export interface AppGrant {
  level: Level;
  /** for level "selected": the tool names this client may call */
  tools?: string[];
}

export interface ClientDef {
  /** false = switched off (dea hub off <client>) or paused by the alert rule */
  enabled: boolean;
  pausedReason?: string;
  pausedAt?: string;
  /** what this client may do with each app; apps not listed get `defaultLevel` */
  apps: Record<string, AppGrant>;
  defaultLevel?: Level;
}

export interface HubConfig {
  version: 1;
  mcpServers: Record<string, ServerDef>;
  clients: Record<string, ClientDef>;
  /** pause a client that makes more than `max` destructive calls within `minutes` */
  alert: { max: number; minutes: number };
  /** the level a new client gets on every app until told otherwise */
  defaultLevel: Level;
}

export const DEFAULT_CONFIG: HubConfig = { version: 1, mcpServers: {}, clients: {}, alert: { max: 5, minutes: 10 }, defaultLevel: 'read' };

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
export function checkName(kind: string, name: string): string {
  if (!NAME.test(name)) throw new Error(`${kind} name "${name}" must be letters, digits, - or _ (up to 40), starting with a letter or digit.`);
  return name;
}

export async function loadHub(home = hubHome()): Promise<HubConfig> {
  const raw = await readFile(join(home, 'hub.json'), 'utf8').catch(() => null);
  if (!raw) return structuredClone(DEFAULT_CONFIG);
  const j = JSON.parse(raw) as Partial<HubConfig>;
  return { ...structuredClone(DEFAULT_CONFIG), ...j, alert: { ...DEFAULT_CONFIG.alert, ...(j.alert ?? {}) } } as HubConfig;
}

async function atomicWrite(path: string, data: string | Buffer, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
  await chmod(path, mode).catch(() => {});
}

export async function saveHub(cfg: HubConfig, home = hubHome()): Promise<void> {
  await atomicWrite(join(home, 'hub.json'), `${JSON.stringify(cfg, null, 2)}\n`);
}

/** Read hub.json, change it, write it back. */
export async function updateHub(fn: (cfg: HubConfig) => void | Promise<void>, home = hubHome()): Promise<HubConfig> {
  const cfg = await loadHub(home);
  await fn(cfg);
  await saveHub(cfg, home);
  return cfg;
}

/** Accept a pasted Claude Desktop / Cursor / VS Code config and return its servers. */
export function parseServersConfig(json: string): Record<string, ServerDef> {
  const j = JSON.parse(json) as Record<string, any>;
  const servers = (j.mcpServers ?? j.servers ?? j.mcp?.servers ?? j) as Record<string, any>;
  const out: Record<string, ServerDef> = {};
  for (const [name, d] of Object.entries(servers)) {
    if (!d || typeof d !== 'object') continue;
    checkName('Server', name);
    if (typeof d.command === 'string')
      out[name] = { command: d.command, args: (d.args ?? []).map(String), ...(d.env ? { env: d.env } : {}), ...(d.cwd ? { cwd: d.cwd } : {}) };
    else if (typeof d.url === 'string' || typeof d.serverUrl === 'string') {
      const url = String(d.url ?? d.serverUrl);
      new URL(url);
      out[name] = { url, ...(d.type === 'sse' ? { type: 'sse' as const } : {}), ...(d.headers ? { headers: d.headers } : {}) };
    }
  }
  return out;
}

// ---------------- secrets

interface SecretFile {
  [server: string]: { tokens?: unknown; client?: unknown; headers?: Record<string, string>; verifier?: string; discovery?: unknown };
}

async function key(home: string): Promise<Buffer> {
  const env = process.env.DEA_HUB_KEY;
  if (env) {
    const k = Buffer.from(env, /^[0-9a-f]{64}$/i.test(env) ? 'hex' : 'base64');
    if (k.length !== 32) throw new Error('DEA_HUB_KEY must be 32 bytes, as 64 hex characters or base64.');
    return k;
  }
  const p = join(home, 'hub.key');
  const have = await readFile(p, 'utf8').catch(() => null);
  if (have) return Buffer.from(have.trim(), 'hex');
  const k = randomBytes(32);
  await atomicWrite(p, `${k.toString('hex')}\n`);
  return k;
}

/** Encrypted per-server secrets. Nothing here is ever printed, logged or sent to an AI client. */
export class SecretStore {
  constructor(readonly home = hubHome()) {}

  private get path() {
    return join(this.home, 'secrets.enc');
  }

  async readAll(): Promise<SecretFile> {
    const buf = await readFile(this.path).catch(() => null);
    if (!buf) return {};
    const k = await key(this.home);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const d = createDecipheriv('aes-256-gcm', k, iv);
    d.setAuthTag(tag);
    try {
      return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')) as SecretFile;
    } catch {
      throw new Error(`Could not decrypt ${this.path} (wrong key?). Remove it and connect your apps again.`);
    }
  }

  async writeAll(all: SecretFile): Promise<void> {
    const k = await key(this.home);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', k, iv);
    const body = Buffer.concat([c.update(JSON.stringify(all), 'utf8'), c.final()]);
    await atomicWrite(this.path, Buffer.concat([iv, c.getAuthTag(), body]));
  }

  async get(server: string): Promise<SecretFile[string]> {
    return (await this.readAll())[server] ?? {};
  }

  async patch(server: string, fn: (s: SecretFile[string]) => void): Promise<void> {
    const all = await this.readAll();
    const s = all[server] ?? {};
    fn(s);
    all[server] = s;
    await this.writeAll(all);
  }

  async remove(server: string): Promise<void> {
    const all = await this.readAll();
    delete all[server];
    await this.writeAll(all);
  }
}
