import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Hub, readHistory, SecretStore, updateHub } from '@dea/core';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installClient } from '../../cli/src/hub.ts';
import { connectServer } from '../../core/src/hub/client.ts';
import { startOAuthFixture } from './fixtures/oauth-server.ts';

const root = resolve(import.meta.dirname, '../../..');
const notes = resolve(import.meta.dirname, 'fixtures/notes-server.ts');
const text = (r: any) => (r.content ?? []).map((c: any) => c.text).join('\n');

describe('DEA Hub end to end', () => {
  let home = '';
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dea-hub-e2e-'));
    process.env.DEA_HUB_HOME = home;
    await updateHub((c) => {
      c.mcpServers.notes = { command: process.execPath, args: ['--import', 'tsx', notes], cwd: root };
      c.alert = { max: 2, minutes: 10 };
    }, home);
  });
  afterAll(async () => {
    delete process.env.DEA_HUB_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it('connects to a stdio MCP server and enforces each client’s access', async () => {
    const hub = new Hub(home);
    try {
      expect((await hub.appTools('notes')).map((t) => t.name).sort()).toEqual(['add_note', 'delete_note', 'list_notes']);
      // a new client sees read-only tools only
      expect((await hub.toolsFor('claude')).tools.map((t) => t.name)).toEqual(['notes__list_notes']);
      expect(text(await hub.call('claude', 'notes', 'list_notes'))).toContain('first note');
      const blocked = await hub.call('claude', 'notes', 'add_note', { text: 'nope' });
      expect(blocked.isError).toBe(true);
      expect(text(blocked)).toMatch(/blocked.*read/);

      await updateHub((c) => {
        c.clients.claude = { enabled: true, apps: { notes: { level: 'full' } } };
      }, home);
      expect((await hub.toolsFor('claude')).tools).toHaveLength(3);
      expect(text(await hub.call('claude', 'notes', 'add_note', { text: 'hello', apiKey: 'sk_live_supersecretvalue123456' }))).toContain('added');

      // history: every call, with the secret argument hidden
      const h = await readHistory({ client: 'claude' }, home);
      expect(h.map((l) => [l.tool, l.ok, Boolean(l.blocked)])).toEqual([
        ['list_notes', true, false],
        ['add_note', false, true],
        ['add_note', true, false],
      ]);
      expect(JSON.stringify(h)).not.toContain('supersecret');

      // alert rule: more than 2 destructive calls in 10 minutes pauses the client
      for (let i = 0; i < 3; i++) await hub.call('claude', 'notes', 'delete_note', { n: 1 });
      const cfg = await hub.config();
      expect(cfg.clients.claude.enabled).toBe(false);
      expect(cfg.clients.claude.pausedReason).toMatch(/paused automatically/);
      expect(text(await hub.call('claude', 'notes', 'list_notes'))).toMatch(/switched off/);
    } finally {
      await hub.close();
    }
  }, 60_000);

  it('serves the hub to an AI client over stdio (the gateway), honouring the kill switch live', async () => {
    await updateHub((c) => {
      c.clients.cursor = { enabled: true, apps: { notes: { level: 'selected', tools: ['list_notes', 'add_note'] } } };
    }, home);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', resolve(root, 'packages/cli/src/index.ts'), 'hub', 'serve', '--client', 'cursor'],
      env: { ...process.env, DEA_HUB_HOME: home, DEA_MODE: 'delegated' } as Record<string, string>,
      cwd: root,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test-cursor', version: '1.0.0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['notes__add_note', 'notes__list_notes']);
      const r = await client.callTool({ name: 'notes__add_note', arguments: { text: 'via gateway' } });
      expect(text(r)).toContain('added');
      const denied = await client.callTool({ name: 'notes__delete_note', arguments: { n: 1 } });
      expect(denied.isError).toBe(true);

      await updateHub((c) => {
        c.clients.cursor.enabled = false;
      }, home);
      const off = await client.callTool({ name: 'notes__list_notes', arguments: {} });
      expect(text(off)).toMatch(/switched off/);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('supervised mode over MCP: the AI app is asked (elicitation) before a change; an app that cannot be asked gets no changes', async () => {
    await updateHub((c) => {
      c.clients.zed = { enabled: true, apps: { notes: { level: 'full' } } };
    }, home);
    const connect = async (withElicit: boolean, answer: boolean) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', resolve(root, 'packages/cli/src/index.ts'), 'hub', 'serve', '--client', 'zed'],
        env: { ...process.env, DEA_HUB_HOME: home, DEA_MODE: 'supervised' } as Record<string, string>,
        cwd: root,
        stderr: 'pipe',
      });
      const asked: string[] = [];
      const client = new Client({ name: 'test-zed', version: '1.0.0' }, withElicit ? { capabilities: { elicitation: { form: {} } } } : {});
      if (withElicit)
        client.setRequestHandler('elicitation/create', async (req) => {
          asked.push(String((req.params as { message?: string }).message));
          return { action: 'accept', content: { approve: answer } };
        });
      await client.connect(transport);
      return { client, asked };
    };
    const yes = await connect(true, true);
    try {
      expect(text(await yes.client.callTool({ name: 'notes__list_notes', arguments: {} }))).toContain('first note');
      expect(yes.asked.length).toBe(0); // reading never asks
      expect(
        text(await yes.client.callTool({ name: 'notes__add_note', arguments: { text: 'asked first', apiKey: 'sk_live_supersecretvalue123456' } })),
      ).toContain('added');
      expect(yes.asked.length).toBe(1);
      expect(yes.asked[0]).toMatch(/add_note on notes/);
      expect(yes.asked[0]).not.toContain('supersecret');
    } finally {
      await yes.client.close();
    }
    const no = await connect(true, false);
    try {
      const r = await no.client.callTool({ name: 'notes__add_note', arguments: { text: 'declined' } });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/did not approve/);
    } finally {
      await no.client.close();
    }
    const mute = await connect(false, true);
    try {
      const r = await mute.client.callTool({ name: 'notes__add_note', arguments: { text: 'no way to ask' } });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/nothing here can ask you/);
      expect(text(await mute.client.callTool({ name: 'notes__list_notes', arguments: {} }))).not.toContain('declined');
    } finally {
      await mute.client.close();
    }
    const { readAudit } = await import('@dea/core');
    const a = await readAudit({ app: 'notes' }, home);
    expect(a.filter((l) => l.mode === 'supervised').map((l) => `${l.stage}`)).toEqual(['intent', 'done', 'denied', 'denied']);
    expect(JSON.stringify(a)).not.toContain('supersecret');
  }, 60_000);

  it('logs in to an OAuth-protected MCP server: discovery, registration, PKCE, tokens stored encrypted, refresh', async () => {
    const fx = await startOAuthFixture();
    const port = 34000 + Math.floor(Math.random() * 1000);
    const secrets = new SecretStore(home);
    try {
      let saw: URL | null = null;
      const client = await connectServer(
        'notes-remote',
        { url: fx.url },
        {
          secrets,
          interactive: true,
          port,
          // the "browser": follow the login link; the fixture approves and redirects to DEA's loopback
          onAuthorize: async (u) => {
            saw = u;
            await fetch(u, { redirect: 'follow' });
          },
        },
      );
      expect(String(saw)).toContain('code_challenge_method=S256');
      expect(fx.issued).toMatchObject({ clients: 1, tokens: 1 });
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('list_notes');
      await client.close();

      const stored = await secrets.get('notes-remote');
      expect((stored.tokens as any).access_token).toBeTruthy();
      expect((await readFile(join(home, 'secrets.enc'))).toString('latin1')).not.toContain((stored.tokens as any).access_token);

      // a second connection reuses the stored token: no new registration, no browser
      const again = await connectServer('notes-remote', { url: fx.url }, { secrets, port, onAuthorize: () => expect.fail('should not ask to log in again') });
      expect((await again.listTools()).tools.length).toBe(3);
      await again.close();
      expect(fx.issued.clients).toBe(1);
    } finally {
      await fx.close();
    }
  }, 60_000);

  it('writes AI app configs without touching their other entries', async () => {
    const file = join(home, 'claude_desktop_config.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, JSON.stringify({ mcpServers: { other: { command: 'x' } }, theme: 'dark' }));
    const l = { node: '/usr/bin/node', mcp: '/repo/packages/mcp/bin/dea-mcp.mjs', cli: '/repo/packages/cli/bin/dea.mjs' };
    await installClient('claude', { hub: true, target: { file, key: 'mcpServers' }, l });
    const j = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(j.mcpServers)).toEqual(['other', 'dea', 'dea-hub']);
    expect(j.mcpServers['dea-hub'].args).toEqual([l.cli, 'hub', 'serve', '--client', 'claude']);
    expect(j.theme).toBe('dark');

    const vs = join(home, 'vscode-mcp.json');
    await installClient('vscode', { target: { file: vs, key: 'servers' }, l });
    expect(JSON.parse(await readFile(vs, 'utf8')).servers.dea).toEqual({ type: 'stdio', command: l.node, args: [l.mcp] });

    const toml = join(home, 'codex.toml');
    await writeFile(toml, 'model = "x"\n\n[mcp_servers.dea]\ncommand = "old"\nargs = []\n');
    await installClient('codex', { hub: true, target: { file: toml, key: 'toml' }, l });
    const t = await readFile(toml, 'utf8');
    expect(t).toContain('model = "x"');
    expect(t.match(/\[mcp_servers\.dea\]/g)).toHaveLength(1);
    expect(t).toContain('[mcp_servers.dea-hub]');
    expect(t).not.toContain('"old"');
  });
});
