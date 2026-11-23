import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readHistory, updateHub } from '@dea/core';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkToken, createToken, type HttpServer, loadTokens, revokeToken, serveHttp, tokenFile } from '../src/http.ts';

const root = resolve(import.meta.dirname, '../../..');
const notes = resolve(import.meta.dirname, 'fixtures/notes-server.ts');
const text = (r: any) => (r.content ?? []).map((c: any) => c.text).join('\n');

describe('dea serve --http (Streamable HTTP, bearer token)', () => {
  let home = '';
  let hubHome = '';
  let srv: HttpServer;
  let token = '';

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dea-http-'));
    hubHome = join(home, 'hub');
    process.env.DEA_HOME = join(home, 'runs-home');
    await updateHub((c) => {
      c.mcpServers.notes = { command: process.execPath, args: ['--import', 'tsx', notes], cwd: root };
      c.clients.laptop = { enabled: true, apps: { notes: { level: 'selected', tools: ['list_notes', 'add_note'] } } };
    }, hubHome);
    token = await createToken('laptop', home);
    srv = await serveHttp({ port: 0, home, hubHome, hubMode: 'delegated', log: () => {} });
  });
  afterAll(async () => {
    await srv?.close();
    delete process.env.DEA_HOME;
    await rm(home, { recursive: true, force: true });
  });

  const connect = async (path: '/mcp' | '/hub', tok = token) => {
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}${path}`), { requestInit: { headers: { Authorization: `Bearer ${tok}` } } }));
    return client;
  };

  it('listens on 127.0.0.1 only, and stores a hash of the token, never the token', async () => {
    expect(srv.host).toBe('127.0.0.1');
    expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const file = await readFile(tokenFile(home), 'utf8');
    expect(file).not.toContain(token);
    expect(token).toMatch(/^dea_[A-Za-z0-9_-]{43}$/);
    if (process.platform !== 'win32') expect((await stat(tokenFile(home))).mode & 0o777).toBe(0o600);
    expect(checkToken(`Bearer ${token}`, await loadTokens(home))).toBe('laptop');
    expect(checkToken('Bearer dea_wrong', await loadTokens(home))).toBeNull();
  });

  it('refuses every request without the right bearer token', async () => {
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    };
    const post = (headers: Record<string, string>, path = '/mcp') =>
      fetch(`${srv.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(init),
      });
    const tries: Record<string, string>[] = [{}, { authorization: 'Bearer nope' }, { authorization: `Basic ${token}` }, { authorization: `Bearer ${token}x` }];
    for (const h of tries) {
      const r = await post(h);
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toContain('Bearer');
    }
    expect((await post({}, '/hub')).status).toBe(401);
    expect((await fetch(`${srv.url}/health`)).status).toBe(401);
    // a page in a browser on another origin is turned away even with a token (DNS-rebinding guard)
    expect((await post({ authorization: `Bearer ${token}`, origin: 'https://evil.example' })).status).toBe(403);
    // the right token works
    expect((await post({ authorization: `Bearer ${token}` })).status).toBe(200);
    // and the MCP client cannot connect with a wrong one
    await expect(connect('/mcp', 'dea_wrong')).rejects.toThrow();
  });

  it('serves the DEA tools at /mcp: list and call a tool', async () => {
    const client = await connect('/mcp');
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['decode_design', 'decode_code', 'decode_api', 'investigate', 'browse', 'submit']));
      expect(tools.find((t) => t.name === 'submit')?.annotations?.destructiveHint).toBe(true);
      const r = await client.callTool({ name: 'list_runs', arguments: {} });
      expect(text(r)).toContain('No runs yet');
    } finally {
      await client.close();
    }
  });

  it('serves DEA Hub at /hub with the token’s client permissions, and logs history', async () => {
    const client = await connect('/hub');
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['notes__add_note', 'notes__list_notes']);
      expect(text(await client.callTool({ name: 'notes__add_note', arguments: { text: 'over http', token: 'sk_live_supersecretvalue123456' } }))).toContain(
        'added',
      );
      const denied = await client.callTool({ name: 'notes__delete_note', arguments: { n: 1 } });
      expect(denied.isError).toBe(true);

      // the kill switch works live over HTTP too
      await updateHub((c) => {
        c.clients.laptop.enabled = false;
      }, hubHome);
      expect(text(await client.callTool({ name: 'notes__list_notes', arguments: {} }))).toMatch(/switched off/);
    } finally {
      await client.close();
    }
    const h = await readHistory({ client: 'laptop' }, hubHome);
    expect(h.map((l) => [l.tool, Boolean(l.blocked)])).toEqual(
      expect.arrayContaining([
        ['add_note', false],
        ['delete_note', true],
      ]),
    );
    expect(JSON.stringify(h)).not.toContain('supersecret');
  });

  it('a revoked token stops working at once', async () => {
    const other = await createToken('phone', home);
    const ok = await fetch(`${srv.url}/health`, { headers: { authorization: `Bearer ${other}` } });
    expect(await ok.json()).toMatchObject({ client: 'phone' });
    expect(await revokeToken('phone', home)).toBe(true);
    expect((await fetch(`${srv.url}/health`, { headers: { authorization: `Bearer ${other}` } })).status).toBe(401);
  });

  it("each client has its own runs folder: list_runs never shows another client's runs", async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { clientRunsDir } = await import('../src/http.ts');
    // a run that belongs to another client, and one in the shared DEA_HOME (from a plain CLI run on the same machine)
    const theirs = join(clientRunsDir(home, 'phone2'), '20261124-000000-secret-site-aaaaaaaa');
    const shared = join(process.env.DEA_HOME as string, 'runs', '20261124-000001-shared-site-bbbbbbbb');
    for (const d of [theirs, shared]) {
      await mkdir(d, { recursive: true });
      await writeFile(
        join(d, 'run.json'),
        JSON.stringify({
          meta: { id: d.split(/[\\/]/).pop(), kind: 'inspect', url: 'https://secret.example/', title: 'Secret', startedAt: new Date().toISOString() },
        }),
      );
    }
    const mine = join(clientRunsDir(home, 'laptop'), '20261124-000002-mine-cccccccc');
    await mkdir(mine, { recursive: true });
    await writeFile(
      join(mine, 'run.json'),
      JSON.stringify({
        meta: {
          id: '20261124-000002-mine-cccccccc',
          kind: 'inspect',
          url: 'https://mine.example/',
          title: 'Mine',
          startedAt: new Date().toISOString(),
        },
      }),
    );
    const client = await connect('/mcp');
    try {
      const r = text(await client.callTool({ name: 'list_runs', arguments: { limit: 50 } }));
      expect(r).toContain('20261124-000002-mine-cccccccc');
      expect(r).not.toContain('secret-site');
      expect(r).not.toContain('shared-site');
      const rep = text(await client.callTool({ name: 'report', arguments: { run: '20261124-000000-secret-site-aaaaaaaa' } }));
      expect(rep).not.toContain('Secret');
    } finally {
      await client.close();
    }
    expect(clientRunsDir(home, '../evil')).toBe(join(home, 'clients', '__evil', 'runs'));
  });

  it("only a client the owner named may use the owner's browser profile (DEA_PROFILE)", async () => {
    const { profileAllowed } = await import('../src/http.ts');
    expect(profileAllowed('laptop', undefined)).toBe(false);
    expect(profileAllowed('laptop', [])).toBe(false);
    expect(profileAllowed('phone', ['laptop'])).toBe(false);
    expect(profileAllowed('laptop', ['laptop'])).toBe(true);
  });
});
