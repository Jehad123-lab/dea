import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  type HistoryLine,
  type HubConfig,
  isDestructive,
  isReadOnly,
  mayCall,
  overLimit,
  parseServersConfig,
  qualify,
  SecretStore,
  summarizeArgs,
  unqualify,
  visibleTools,
} from '../src/index.ts';

const cfg = (over: Partial<HubConfig> = {}): HubConfig => ({
  ...structuredClone(DEFAULT_CONFIG),
  mcpServers: { notion: { url: 'https://mcp.notion.com/mcp' }, files: { command: 'npx', args: ['x'] } },
  ...over,
});
const read = { name: 'search', annotations: { readOnlyHint: true } };
const add = { name: 'create_page', annotations: { readOnlyHint: false, destructiveHint: false } };
const del = { name: 'delete_page', annotations: { readOnlyHint: false, destructiveHint: true } };
const bare: { name: string; annotations?: Record<string, boolean> } = { name: 'mystery' };

describe('hub permissions', () => {
  it('follows MCP hints: only explicit readOnlyHint is read-only, unknown tools count as destructive', () => {
    expect(isReadOnly(read)).toBe(true);
    expect(isReadOnly(bare)).toBe(false);
    expect(isDestructive(bare)).toBe(true);
    expect(isDestructive(add)).toBe(false);
    expect(isDestructive(del)).toBe(true);
  });

  it('gives a new client read-only access by default', () => {
    const c = cfg();
    expect(mayCall(c, 'claude', 'notion', read).ok).toBe(true);
    const v = mayCall(c, 'claude', 'notion', add);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.why).toMatch(/dea hub allow claude notion full/);
  });

  it('applies full, selected and off per client and app', () => {
    const c = cfg({
      clients: {
        cursor: { enabled: true, apps: { notion: { level: 'full' }, files: { level: 'selected', tools: ['create_page'] } } },
        codex: { enabled: true, apps: { notion: { level: 'off' } } },
      },
    });
    expect(mayCall(c, 'cursor', 'notion', del).ok).toBe(true);
    expect(mayCall(c, 'cursor', 'files', add).ok).toBe(true);
    expect(mayCall(c, 'cursor', 'files', read).ok).toBe(false);
    expect(mayCall(c, 'codex', 'notion', read).ok).toBe(false);
    expect(visibleTools(c, 'cursor', 'files', [read, add, del] as any).map((t) => t.name)).toEqual(['create_page']);
  });

  it('refuses everything for a client that is switched off', () => {
    const c = cfg({ clients: { claude: { enabled: false, pausedReason: 'switched off by you', apps: { notion: { level: 'full' } } } } });
    const v = mayCall(c, 'claude', 'notion', read);
    expect(v.ok).toBe(false);
    expect(!v.ok && v.why).toMatch(/switched off/);
  });

  it('pauses a client over the destructive-call limit', () => {
    const now = Date.parse('2026-11-03T10:00:00Z');
    const line = (minAgo: number, destructive = true, blocked?: string): HistoryLine => ({
      t: new Date(now - minAgo * 60_000).toISOString(),
      client: 'claude',
      app: 'notion',
      tool: 'delete_page',
      args: '',
      ok: true,
      destructive,
      ms: 1,
      ...(blocked ? { blocked } : {}),
    });
    const h = [line(1), line(2), line(3), line(4, false), line(5, true, 'no'), line(30)];
    expect(overLimit(h, 'claude', { max: 2, minutes: 10 }, now)).toEqual({ over: true, count: 3 });
    expect(overLimit(h, 'claude', { max: 3, minutes: 10 }, now).over).toBe(false);
  });

  it('names proxied tools <app>__<tool>', () => {
    expect(qualify('my-app', 'do_thing')).toBe('my-app__do_thing');
    expect(unqualify('my-app__do_thing')).toEqual({ app: 'my-app', tool: 'do_thing' });
    expect(unqualify('plain')).toBeNull();
  });
});

describe('hub history and secrets', () => {
  let dir = '';
  afterAll(async () => dir && rm(dir, { recursive: true, force: true }));

  it('summarises arguments with secrets hidden', () => {
    const s = summarizeArgs({ title: 'Plan', apiKey: 'sk_live_abcdefghijklmnopqrstuvwx', body: 'x'.repeat(500), nested: { password: 'hunter2' } });
    expect(s).toContain('title: "Plan"');
    expect(s).toContain('apiKey: [hidden]');
    expect(s).not.toContain('sk_live');
    expect(s).not.toContain('hunter2');
    expect(s.length).toBeLessThan(200);
  });

  it('keeps tokens encrypted on disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dea-hub-'));
    const st = new SecretStore(dir);
    await st.patch('notion', (s) => {
      s.tokens = { access_token: 'secret-access-token-123', refresh_token: 'secret-refresh-456' };
    });
    const raw = await readFile(join(dir, 'secrets.enc'));
    expect(raw.toString('latin1')).not.toContain('secret-access-token-123');
    expect(((await new SecretStore(dir).get('notion')).tokens as any).access_token).toBe('secret-access-token-123');
    await st.remove('notion');
    expect(await st.get('notion')).toEqual({});
  });

  it('imports a standard mcpServers config', () => {
    const s = parseServersConfig(
      JSON.stringify({
        mcpServers: { files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] }, linear: { url: 'https://mcp.linear.app/mcp' } },
      }),
    );
    expect(Object.keys(s)).toEqual(['files', 'linear']);
    expect(() => parseServersConfig(JSON.stringify({ mcpServers: { 'bad name!': { command: 'x' } } }))).toThrow();
  });
});
