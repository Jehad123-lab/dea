// A local OAuth-protected MCP server for tests: protected-resource metadata, authorization-server metadata,
// dynamic client registration, PKCE (S256), refresh tokens, and a Streamable HTTP MCP endpoint behind Bearer auth.
// /authorize approves at once (a real app would show its login page here).
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { notesServer } from './notes-server.ts';

export interface OAuthFixture {
  url: string;
  issued: { clients: number; tokens: number; refreshed: number };
  close: () => Promise<void>;
}

const b64url = (b: Buffer) => b.toString('base64url');

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startOAuthFixture(opts: { tokenTtl?: number } = {}): Promise<OAuthFixture> {
  const clients = new Map<string, { redirect_uris: string[] }>();
  const codes = new Map<string, { client: string; challenge: string; redirect: string }>();
  const tokens = new Set<string>();
  const refresh = new Map<string, string>();
  const issued = { clients: 0, tokens: 0, refreshed: 0 };
  let base = '';
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', base);
    const json = (code: number, j: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(j));
    };
    try {
      if (u.pathname.startsWith('/.well-known/oauth-protected-resource'))
        return json(200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'] });
      if (u.pathname === '/.well-known/oauth-authorization-server')
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      if (u.pathname === '/register' && req.method === 'POST') {
        const meta = JSON.parse(await body(req));
        const id = `client-${randomBytes(6).toString('hex')}`;
        clients.set(id, { redirect_uris: meta.redirect_uris });
        issued.clients++;
        return json(201, { ...meta, client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000) });
      }
      if (u.pathname === '/authorize') {
        const c = clients.get(u.searchParams.get('client_id') ?? '');
        const redirect = u.searchParams.get('redirect_uri') ?? '';
        if (!c?.redirect_uris.includes(redirect)) return json(400, { error: 'invalid_client' });
        if (u.searchParams.get('code_challenge_method') !== 'S256') return json(400, { error: 'invalid_request' });
        const code = b64url(randomBytes(16));
        codes.set(code, { client: u.searchParams.get('client_id') as string, challenge: u.searchParams.get('code_challenge') as string, redirect });
        const to = new URL(redirect);
        to.searchParams.set('code', code);
        to.searchParams.set('state', u.searchParams.get('state') ?? '');
        res.writeHead(302, { location: to.toString() });
        return res.end();
      }
      if (u.pathname === '/token' && req.method === 'POST') {
        const p = new URLSearchParams(await body(req));
        const issue = () => {
          const at = b64url(randomBytes(24));
          const rt = b64url(randomBytes(24));
          tokens.add(at);
          refresh.set(rt, p.get('client_id') ?? '');
          issued.tokens++;
          return { access_token: at, token_type: 'Bearer', expires_in: opts.tokenTtl ?? 3600, refresh_token: rt };
        };
        if (p.get('grant_type') === 'authorization_code') {
          const c = codes.get(p.get('code') ?? '');
          codes.delete(p.get('code') ?? '');
          const ok =
            c &&
            c.client === p.get('client_id') &&
            c.redirect === p.get('redirect_uri') &&
            b64url(
              createHash('sha256')
                .update(p.get('code_verifier') ?? '')
                .digest(),
            ) === c.challenge;
          return ok ? json(200, issue()) : json(400, { error: 'invalid_grant' });
        }
        if (p.get('grant_type') === 'refresh_token' && refresh.has(p.get('refresh_token') ?? '')) {
          refresh.delete(p.get('refresh_token') ?? '');
          issued.refreshed++;
          return json(200, issue());
        }
        return json(400, { error: 'invalid_grant' });
      }
      if (u.pathname === '/mcp') {
        const auth = req.headers.authorization ?? '';
        if (!auth.startsWith('Bearer ') || !tokens.has(auth.slice(7)))
          return json(401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
        const sid = req.headers['mcp-session-id'] as string | undefined;
        let t = sid ? sessions.get(sid) : undefined;
        if (!t) {
          t = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomBytes(8).toString('hex'),
            onsessioninitialized: (id) => void sessions.set(id, t as WebStandardStreamableHTTPServerTransport),
          });
          await notesServer().connect(t);
        }
        const text = req.method === 'POST' ? await body(req) : undefined;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const r = await t.handleRequest(new Request(`${base}${req.url}`, { method: req.method, headers, body: text }));
        res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
        if (r.body) {
          const reader = r.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        return res.end();
      }
      res.writeHead(404).end();
    } catch (e) {
      json(500, { error: String(e) });
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: `${base}/mcp`,
    issued,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
