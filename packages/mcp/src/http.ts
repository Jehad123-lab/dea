// DEA over Streamable HTTP: the DEA tools at /mcp and the DEA Hub gateway at /hub, behind a bearer token.
// Bound to 127.0.0.1 unless told otherwise. Same policy, permissions and history as stdio: the same code runs.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type Server as NodeServer, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Hub, hubMode, type Mode, withRunsRoot } from '@dea/core';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  type McpHttpHandler,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import { createGateway } from './gateway.ts';
import { createServer, newServerState, type ServerState } from './server.ts';

// ------------------------------------------------------------------------------------------------ tokens

export interface TokenEntry {
  /** the AI client this token speaks for: its DEA Hub permissions and history apply */
  client: string;
  /** sha256 of the token; the token itself is shown once and never stored */
  sha256: string;
  /** first characters, so you can tell tokens apart */
  hint: string;
  created: string;
}

/** Where tokens live: $DEA_SERVE_HOME, else ~/.dea (never the project folder, so they are not committed by accident). */
/** The runs folder of one `dea serve --http` client: <home>/clients/<client>/runs (the name made safe for a folder). */
export function clientRunsDir(home: string, client: string): string {
  const safe =
    client
      .replace(/[^A-Za-z0-9_.-]+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 64) || '_';
  return join(home, 'clients', safe, 'runs');
}

/** May this client's hands tools open the owner's DEA browser profile? Only when the owner named it. */
export function profileAllowed(client: string, profileClients?: string[]): boolean {
  return Boolean(profileClients?.includes(client));
}

export function serveHome(): string {
  return process.env.DEA_SERVE_HOME ?? join(homedir(), '.dea');
}
export const tokenFile = (home = serveHome()) => join(home, 'remote-tokens.json');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function loadTokens(home = serveHome()): Promise<TokenEntry[]> {
  try {
    const j = JSON.parse(await readFile(tokenFile(home), 'utf8')) as { tokens?: TokenEntry[] };
    return Array.isArray(j.tokens) ? j.tokens : [];
  } catch {
    return [];
  }
}

async function saveTokens(tokens: TokenEntry[], home: string): Promise<void> {
  const file = tokenFile(home);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ note: 'Hashes of DEA remote tokens. The tokens themselves are never stored.', tokens }, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(file, 0o600).catch(() => {});
}

/** Make a new token for a client (replacing that client's old one). Returns the token: the only time it is visible. */
export async function createToken(client: string, home = serveHome()): Promise<string> {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(client)) throw new Error('Client names use letters, digits, - and _ (max 40).');
  const token = `dea_${randomBytes(32).toString('base64url')}`;
  const tokens = (await loadTokens(home)).filter((t) => t.client !== client);
  tokens.push({ client, sha256: sha(token), hint: `${token.slice(0, 8)}…`, created: new Date().toISOString() });
  await saveTokens(tokens, home);
  return token;
}

export async function revokeToken(client: string, home = serveHome()): Promise<boolean> {
  const tokens = await loadTokens(home);
  const left = tokens.filter((t) => t.client !== client);
  await saveTokens(left, home);
  return left.length !== tokens.length;
}

/** Which client a bearer token belongs to, or null. Constant-time compare on the hashes. */
export function checkToken(header: string | undefined | null, tokens: TokenEntry[]): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  if (!m) return null;
  const got = Buffer.from(sha(m[1] as string), 'hex');
  let who: string | null = null;
  for (const t of tokens) {
    const want = Buffer.from(t.sha256, 'hex');
    if (want.length === got.length && timingSafeEqual(want, got)) who = t.client;
  }
  return who;
}

// ------------------------------------------------------------------------------------------------ server

export interface HttpOptions {
  host?: string;
  port?: number;
  /** where tokens are kept (default ~/.dea) */
  home?: string;
  /** the DEA Hub folder (default $DEA_HUB_HOME or ~/.dea/hub) */
  hubHome?: string;
  /** extra Host header names to accept when bound to a non-loopback address */
  allowedHosts?: string[];
  /**
   * Clients (token names) whose hands tools may open the DEA browser profile in DEA_PROFILE: the owner's own sign-ins.
   * Nobody else gets it: a remote client browses with a fresh, signed-out browser.
   */
  profileClients?: string[];
  /** the permission mode for Hub calls (default: DEA_MODE, policy.json, else supervised). Over HTTP nobody can be asked, so supervised refuses changes. */
  hubMode?: Mode;
  log?: (line: string) => void;
}

export interface HttpServer {
  url: string;
  port: number;
  host: string;
  server: NodeServer;
  close(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/** node:http request → web Request (so the SDK's fetch-style handler can serve it) */
async function toRequest(req: IncomingMessage, base: string): Promise<Request | null> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, v);
  }
  const method = req.method ?? 'GET';
  let body: Uint8Array | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const b = await readBody(req, 4 * 1024 * 1024);
    if (!b) return null;
    body = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  return new Request(new URL(req.url ?? '/', base), { method, headers, body: body as BodyInit | undefined });
}

/** web Response → node:http response, streaming (SSE answers flush as they come) */
async function sendResponse(res: ServerResponse, r: Response): Promise<void> {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(r.status, headers);
  if (!r.body) return void res.end();
  const reader = r.body.getReader();
  res.on('close', () => void reader.cancel().catch(() => {}));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

/**
 * Serve DEA over Streamable HTTP.
 *   POST /mcp   DEA's tools (decode, investigate, hands): the same tools and policy as stdio
 *   POST /hub   DEA Hub: the connected apps' tools, with the permissions of the client the token belongs to
 * Every request needs `Authorization: Bearer <token>` (dea serve token).
 */
export async function serveHttp(o: HttpOptions = {}): Promise<HttpServer> {
  const host = o.host ?? '127.0.0.1';
  const port = o.port ?? 7341;
  const home = o.home ?? serveHome();
  const log = o.log ?? ((s: string) => console.error(s));
  const loopback = LOOPBACK.has(host);

  const hub = new Hub(o.hubHome, { onPause: (c, why) => log(`dea-hub: ${c} ${why}`), onStderr: () => {} }, { mode: o.hubMode ?? hubMode() });
  const states = new Map<string, ServerState>();
  const stateFor = (client: string) => {
    let s = states.get(client);
    if (!s) states.set(client, (s = newServerState()));
    return s;
  };
  const clientOf = (ctx: { authInfo?: { clientId?: string } }) => ctx.authInfo?.clientId ?? 'remote';
  const onerror = (e: Error) => log(`dea serve: ${e.message}`);
  const tools: McpHttpHandler = createMcpHandler(
    (ctx) => createServer({ state: stateFor(clientOf(ctx)), allowProfile: profileAllowed(clientOf(ctx), o.profileClients) }),
    { onerror },
  );
  if (process.env.DEA_PROFILE && !o.profileClients?.length)
    log(`dea serve: DEA_PROFILE (${process.env.DEA_PROFILE}) is not used over HTTP; name the clients that may use it with --profile-client`);
  const gateway: McpHttpHandler = createMcpHandler((ctx) => createGateway(clientOf(ctx), hub, { closeHub: false }), { onerror });

  const server = createHttpServer(async (req, res) => {
    const t0 = Date.now();
    let who: string | null = null;
    const path = (req.url ?? '/').split('?')[0];
    try {
      who = checkToken(req.headers.authorization, await loadTokens(home)); // read each time: a revoke works at once
      if (!who) {
        req.resume();
        return json(
          res,
          401,
          { error: 'unauthorized', message: 'DEA needs "Authorization: Bearer <token>". Make one with: dea serve token' },
          { 'www-authenticate': 'Bearer realm="dea"' },
        );
      }
      const request = await toRequest(req, `http://${req.headers.host ?? `${host}:${port}`}`);
      if (!request) return json(res, 413, { error: 'too_large' });
      // DNS-rebinding guard: a page in a browser cannot reach a loopback DEA under another name or origin
      const rejected = loopback
        ? (hostHeaderValidationResponse(request, localhostAllowedHostnames()) ?? originValidationResponse(request, localhostAllowedOrigins()))
        : o.allowedHosts?.length
          ? hostHeaderValidationResponse(request, o.allowedHosts)
          : undefined;
      if (rejected) return await sendResponse(res, rejected);
      const authInfo = { token: 'redacted', clientId: who, scopes: [] as string[] };
      // each client has its own runs folder: list_runs, report and "latest" never show another client's runs
      if (path === '/mcp') return await withRunsRoot(clientRunsDir(home, who), async () => sendResponse(res, await tools.fetch(request, { authInfo })));
      if (path === '/hub') return await sendResponse(res, await gateway.fetch(request, { authInfo }));
      if (path === '/' || path === '/health') return json(res, 200, { name: 'dea', version: '0.2.0', client: who, endpoints: { tools: '/mcp', hub: '/hub' } });
      return json(res, 404, { error: 'not_found', endpoints: ['/mcp', '/hub'] });
    } catch (e) {
      log(`dea serve: ${(e as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: 'internal', message: (e as Error).message });
      else res.end();
    } finally {
      if (path !== '/health') log(`${new Date().toISOString()} ${req.method} ${path} ${res.statusCode} ${who ?? '-'} ${Date.now() - t0}ms`);
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok());
  });
  const addr = server.address();
  const real = typeof addr === 'object' && addr ? addr.port : port;
  const shown = host.includes(':') ? `[${host}]` : host;
  return {
    url: `http://${shown}:${real}`,
    port: real,
    host,
    server,
    async close() {
      await Promise.allSettled([tools.close(), gateway.close()]);
      for (const s of states.values()) await s.hands?.close().catch(() => {});
      await hub.close();
      server.closeAllConnections?.();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

/** `dea serve --http` / `dea-mcp --http`: make a token on first use, print how to connect, serve until Ctrl+C. */
export async function serveHttpFromArgs(argv: string[], prog: string): Promise<HttpServer> {
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return startHttp({
    host: flag('--host'),
    port: flag('--port') ? Number(flag('--port')) : undefined,
    client: flag('--client'),
    newToken: argv.includes('--new-token'),
    prog,
    // --profile-client a,b: the clients that may use DEA_PROFILE (the owner's sign-ins)
    profileClients: flag('--profile-client')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
}

export async function startHttp(o: {
  host?: string;
  port?: number;
  client?: string;
  newToken?: boolean;
  prog: string;
  allowedHosts?: string[];
  profileClients?: string[];
}) {
  const client = o.client ?? 'remote';
  const home = serveHome();
  const say = (s: string) => process.stderr.write(`${s}\n`);
  let fresh: string | null = null;
  const tokens = await loadTokens(home);
  if (o.newToken || !tokens.some((t) => t.client === client)) fresh = await createToken(client, home);
  const host = o.host ?? '127.0.0.1';
  if (!LOOPBACK.has(host))
    say(`WARNING: listening on ${host}, not just this computer. Anyone who can reach this port and has a token can use DEA. Put it behind HTTPS.`);
  const s = await serveHttp({ host, port: o.port, home, allowedHosts: o.allowedHosts, profileClients: o.profileClients });
  say(`DEA is serving over HTTP (Streamable HTTP, MCP)
  DEA tools  ${s.url}/mcp
  DEA Hub    ${s.url}/hub   (apps and permissions of client "${client}"; change with: dea hub allow ${client} <app> <level>)`);
  if (fresh)
    say(`\nNew token for "${client}" (shown once; only its hash is saved in ${tokenFile(home)}):\n  ${fresh}\n\nSend it as:  Authorization: Bearer ${fresh}`);
  else
    say(`\nUsing the saved token for "${client}". Lost it? ${o.prog === 'dea' ? 'dea serve token --client' : 'dea-mcp --http --new-token --client'} ${client}`);
  say('Ctrl+C stops it.');
  const stop = async () => {
    await s.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return s;
}
