import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  Client,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { hubHome, type SecretStore, type ServerDef } from './store.ts';

export const HUB_VERSION = '0.1.0';
/** The fixed loopback port DEA registers as its OAuth redirect (servers compare it exactly). DEA_HUB_PORT moves it. */
export const DEFAULT_CALLBACK_PORT = 33418;

export interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
}

/**
 * OAuth for remote MCP servers (MCP authorization spec: protected-resource discovery, dynamic client registration,
 * PKCE). Tokens and the registered client live encrypted in the secret store, keyed by server name.
 */
export class HubOAuth implements OAuthClientProvider {
  private verifier: string | null = null;
  private stateValue = randomBytes(16).toString('hex');
  /** set when the server wants the user to log in */
  authorizationUrl: URL | null = null;

  constructor(
    readonly server: string,
    readonly secrets: SecretStore,
    readonly opts: { port?: number; clientId?: string; scopes?: string[]; onAuthorize?: (url: URL) => void | Promise<void> } = {},
  ) {}

  get redirectUrl(): string {
    return `http://127.0.0.1:${this.opts.port ?? DEFAULT_CALLBACK_PORT}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'DEA',
      client_uri: 'https://github.com/Jehad123-lab/dea',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.opts.scopes?.length ? { scope: this.opts.scopes.join(' ') } : {}),
    } as OAuthClientMetadata;
  }

  state(): string {
    return this.stateValue;
  }

  async clientInformation() {
    const s = await this.secrets.get(this.server);
    if (s.client) return s.client as any;
    // apps without dynamic registration: the user registers their own (free) OAuth app and passes its id
    if (this.opts.clientId) return { client_id: this.opts.clientId } as any;
    return undefined;
  }

  async saveClientInformation(info: unknown) {
    await this.secrets.patch(this.server, (s) => {
      s.client = info;
    });
  }

  async tokens() {
    return (await this.secrets.get(this.server)).tokens as any;
  }

  async saveTokens(tokens: unknown) {
    await this.secrets.patch(this.server, (s) => {
      s.tokens = { ...(tokens as object), saved_at: Date.now() };
    });
  }

  async redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
    await this.opts.onAuthorize?.(url);
  }

  async saveCodeVerifier(v: string) {
    this.verifier = v;
    await this.secrets.patch(this.server, (s) => {
      s.verifier = v;
    });
  }

  async codeVerifier() {
    if (this.verifier) return this.verifier;
    const v = (await this.secrets.get(this.server)).verifier;
    if (!v) throw new Error('No PKCE verifier saved; start the login again.');
    return v;
  }

  async saveDiscoveryState(state: unknown) {
    await this.secrets.patch(this.server, (s) => {
      s.discovery = state;
    });
  }

  async discoveryState() {
    return (await this.secrets.get(this.server)).discovery as any;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    await this.secrets.patch(this.server, (s) => {
      if (scope === 'all' || scope === 'tokens') delete s.tokens;
      if (scope === 'all' || scope === 'client') delete s.client;
      if (scope === 'all' || scope === 'verifier') delete s.verifier;
      if (scope === 'all' || scope === 'discovery') delete s.discovery;
    });
  }
}

/** Wait on the loopback redirect for ?code=…&state=…; answers the browser with a plain page. */
export function waitForCallback(port: number, state: string, timeoutMs = 300_000): { done: Promise<URLSearchParams>; close: () => void; ready: Promise<void> } {
  let server: Server;
  let timer: NodeJS.Timeout;
  const done = new Promise<URLSearchParams>((resolve, reject) => {
    server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const ok = u.searchParams.get('state') === state && u.searchParams.has('code');
      const err = u.searchParams.get('error');
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset=utf-8><title>DEA</title><body style="font:16px system-ui;padding:3em;background:#0b0b0b;color:#eee"><h2>${
          ok ? 'Connected. You can close this tab.' : `Login did not finish${err ? `: ${escapeHtml(err)}` : ''}.`
        }</h2></body>`,
      );
      if (ok) resolve(u.searchParams);
      else
        reject(
          new Error(err ? `The app refused the login: ${err} ${u.searchParams.get('error_description') ?? ''}`.trim() : 'Login callback had the wrong state.'),
        );
    });
    timer = setTimeout(() => reject(new Error('Login timed out (5 minutes).')), timeoutMs);
  });
  const ready = new Promise<void>((resolve, reject) => {
    server.once('error', (e) => reject(new Error(`Port ${port} is busy (${(e as Error).message}); set DEA_HUB_PORT to another port.`)));
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const close = () => {
    clearTimeout(timer);
    server.close();
  };
  done.finally(close).catch(() => {});
  return { done, close, ready };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** ${env:NAME} or $NAME in a config value reads the environment, so configs can be shared without secrets. */
export function expandEnv(v: string): string {
  return v.replace(/\$\{env:([A-Z0-9_]+)\}|\$\{([A-Z0-9_]+)\}/gi, (_m, a, b) => process.env[a ?? b] ?? '');
}

export interface ConnectOptions {
  secrets: SecretStore;
  /** start the browser login when the server asks for it (only `dea hub connect` does) */
  interactive?: boolean;
  onAuthorize?: (url: URL) => void | Promise<void>;
  port?: number;
  /** stderr of stdio servers goes here (default: dropped) */
  onStderr?: (line: string) => void;
}

/** Connect to one app's MCP server (stdio, Streamable HTTP, or legacy SSE) as DEA. */
export async function connectServer(name: string, def: ServerDef, o: ConnectOptions): Promise<Client> {
  const client = new Client({ name: 'dea-hub', version: HUB_VERSION });
  if ('command' in def) {
    const transport = new StdioClientTransport({
      command: expandEnv(def.command),
      args: (def.args ?? []).map(expandEnv),
      env: { ...getDefaultEnvironment(), ...Object.fromEntries(Object.entries(def.env ?? {}).map(([k, v]) => [k, expandEnv(v)])) },
      ...(def.cwd ? { cwd: def.cwd } : {}),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (b: Buffer) => o.onStderr?.(b.toString()));
    await client.connect(transport);
    return client;
  }
  const url = new URL(expandEnv(def.url));
  const sec = await o.secrets.get(name);
  const headers: Record<string, string> = { ...(def.headers ?? {}) };
  for (const h of def.secretHeaders ?? []) if (sec.headers?.[h]) headers[h] = sec.headers[h];
  const port = o.port ?? (Number(process.env.DEA_HUB_PORT) || DEFAULT_CALLBACK_PORT);
  const auth = new HubOAuth(name, o.secrets, { port, clientId: def.oauth?.clientId, scopes: def.oauth?.scopes });
  const useOAuth = !Object.keys(headers).some((h) => h.toLowerCase() === 'authorization');
  const make = () =>
    def.type === 'sse'
      ? new SSEClientTransport(url, { requestInit: { headers }, ...(useOAuth ? { authProvider: auth } : {}) })
      : new StreamableHTTPClientTransport(url, { requestInit: { headers }, ...(useOAuth ? { authProvider: auth } : {}) });
  let transport = make();
  try {
    await client.connect(transport);
    return client;
  } catch (e) {
    if (!(e instanceof UnauthorizedError) && !auth.authorizationUrl) throw e;
    if (!o.interactive) throw new Error(`"${name}" needs you to log in first: run  dea hub connect ${name}`);
  }
  // interactive login: the SDK already registered DEA (if the app allows it) and built the login URL
  const cb = waitForCallback(port, auth.state());
  await cb.ready;
  if (!auth.authorizationUrl) {
    cb.close();
    throw new Error(`"${name}" refused the connection and offered no login.`);
  }
  try {
    await o.onAuthorize?.(auth.authorizationUrl);
    const params = await cb.done;
    await (transport as StreamableHTTPClientTransport).finishAuth(params.get('code') as string);
  } finally {
    cb.close();
  }
  transport = make();
  const fresh = new Client({ name: 'dea-hub', version: HUB_VERSION });
  await fresh.connect(transport);
  return fresh;
}

/** Every tool a server offers (all pages). */
export async function listAllTools(client: Client): Promise<ToolInfo[]> {
  const out: ToolInfo[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await client.listTools(cursor ? { cursor } : {});
    out.push(...(r.tools as ToolInfo[]));
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export { hubHome };
