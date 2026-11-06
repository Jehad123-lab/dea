import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilities, selftest, selftestFailed } from '@dea/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entriesFor, installClient, previewInstall } from '../../cli/src/hub.ts';

const L = { node: '/usr/bin/node', mcp: '/opt/dea/mcp.mjs', cli: '/opt/dea/cli.mjs' };

describe('dea hub selftest', () => {
  it('offline: every check passes and nothing needs the network', async () => {
    const checks = await selftest({});
    expect(checks.map((c) => c.id)).toEqual(['modes', 'supervised', 'approval-file', 'scope', 'redaction', 'connectors']);
    expect(checks.filter((c) => c.status !== 'pass')).toEqual([]);
    expect(selftestFailed(checks)).toBe(false);
  }, 60_000);

  it('live with no tokens: public checks run, token checks are skipped with a plain note and nothing is asked for', async () => {
    const net = (async (url: string | URL | Request) => {
      const u = String(url);
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes('api.github.com/repos/octocat')) return json({ full_name: 'octocat/Hello-World' });
      if (u.includes('gitlab.com/api/v4/projects/')) return json({ path_with_namespace: 'gitlab-org/cli' });
      if (u.includes('wikipedia.org')) return json({ pages: [{ key: 'WebGL', title: 'WebGL', excerpt: 'a JavaScript API' }] });
      if (u.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response(
        '<html><head><title>Example</title></head><body><p>This domain is for use in examples in documents, without any permission.</p></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }) as typeof fetch;
    const checks = await selftest({ live: true, env: {}, fetch: net });
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by['github-public'].status).toBe('pass');
    expect(by['gitlab-public'].status).toBe('pass');
    expect(by['web-search'].status).toBe('pass');
    expect(by['web-read'].status).toBe('pass');
    for (const id of ['github-token', 'vercel-token', 'gitlab-token']) {
      expect(by[id].status).toBe('skip');
      expect(by[id].note).toMatch(/is not set in this shell/);
    }
    expect(selftestFailed(checks)).toBe(false);
  }, 60_000);

  it('live with a token in the environment: one read proves it; the value is nowhere in the output; a refused token fails with advice', async () => {
    const TOKEN = 'ghp_selftestFakeValue0123456789abcdefghij';
    const good = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const auth = ((init?.headers ?? {}) as Record<string, string>).authorization;
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
      if (u.endsWith('/user')) return auth === `Bearer ${TOKEN}` ? json({ login: 'someone' }) : json({ message: 'Bad credentials' }, 401);
      if (u.includes('/repos/octocat')) return json({ full_name: 'octocat/Hello-World', echo: auth });
      return json({ message: 'x' }, 404);
    }) as typeof fetch;
    const ok = await selftest({ live: true, env: { GITHUB_TOKEN: TOKEN }, fetch: good });
    const t = ok.find((c) => c.id === 'github-token');
    expect(t?.status).toBe('pass');
    expect(t?.note).toMatch(/token works for someone; get_repo answered/);
    expect(JSON.stringify(ok)).not.toContain('selftestFakeValue');
    const bad = await selftest({ live: true, env: { GITHUB_TOKEN: 'ghp_wrongWrongWrong0123456789abcdefghijkl' }, fetch: good });
    const f = bad.find((c) => c.id === 'github-token');
    expect(f?.status).toBe('fail');
    expect(f?.note).toMatch(/refused the token in \$GITHUB_TOKEN \(401/);
    expect(JSON.stringify(bad)).not.toContain('wrongWrong');
    expect(selftestFailed(bad)).toBe(true);
  }, 60_000);
});

describe('dea hub doctor: what works right now', () => {
  it('lists the capabilities with a status each, and never prints a token', async () => {
    const caps = await capabilities({ env: { GITHUB_TOKEN: 'ghp_doctorFakeValue0123456789abcdefghijk' } });
    const by = Object.fromEntries(caps.map((c) => [c.id, c]));
    expect(by.pdf.status).toBe('works');
    expect(by.feeds.status).toBe('works');
    expect(['works', 'no']).toContain(by.render.status); // depends on whether this machine has a browser; either way it says which
    expect(by.search.status).toBe('unknown');
    expect(by['token:github'].status).toBe('works');
    expect(by['token:vercel'].status).toBe('no');
    expect(by['token:gitlab'].status).toBe('limited');
    expect(JSON.stringify(caps)).not.toContain('doctorFakeValue');
  }, 60_000);
});

describe('dea hub install', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dea-install-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('prints the snippet in each client’s own shape and touches no file', () => {
    expect(previewInstall('generic', { l: L })).toMatch(/"mcpServers"[\s\S]*"dea-hub"[\s\S]*"hub"[\s\S]*"serve"[\s\S]*"generic"/);
    expect(previewInstall('generic', { l: L })).not.toContain('"dea":');
    expect(previewInstall('vscode', { l: L })).toMatch(/"servers"[\s\S]*"type": "stdio"/);
    expect(previewInstall('codex', { l: L })).toMatch(/\[mcp_servers\.dea-hub\]\ncommand = "\/usr\/bin\/node"/);
    expect(previewInstall('cursor', { l: L })).toMatch(/cursor reads its MCP servers from .*mcp\.json/);
    expect(entriesFor('cursor', { hubOnly: true, l: L })).toEqual({ 'dea-hub': { command: L.node, args: [L.cli, 'hub', 'serve', '--client', 'cursor'] } });
  });

  it('--write merges into an existing file, keeps everything else, and never overwrites an earlier backup', async () => {
    const file = join(dir, 'mcp.json');
    const mine = { mcpServers: { mine: { command: 'x', args: ['y'] } }, other: { keep: true } };
    await writeFile(file, JSON.stringify(mine));
    const target = { file, key: 'mcpServers' as const };
    // installClient writes the hub config too: keep it in the temp folder
    process.env.DEA_HUB_HOME = dir;
    try {
      const msg = await installClient('cursor', { hubOnly: true, target, l: L });
      expect(msg).toContain(`${file}.dea-backup`);
      const after = JSON.parse(await readFile(file, 'utf8'));
      expect(after.mcpServers.mine).toEqual(mine.mcpServers.mine);
      expect(after.other).toEqual({ keep: true });
      expect(after.mcpServers['dea-hub'].args).toEqual([L.cli, 'hub', 'serve', '--client', 'cursor']);
      expect(JSON.parse(await readFile(`${file}.dea-backup`, 'utf8'))).toEqual(mine);
      await installClient('cursor', { hubOnly: true, target, l: L });
      expect(JSON.parse(await readFile(`${file}.dea-backup`, 'utf8'))).toEqual(mine); // the first backup is still the original
      expect(JSON.parse(await readFile(`${file}.dea-backup-2`, 'utf8')).mcpServers['dea-hub']).toBeTruthy();
    } finally {
      delete process.env.DEA_HUB_HOME;
    }
  });

  it('a file that is not plain JSON is left exactly as it was, with the snippet to add by hand', async () => {
    const file = join(dir, 'settings.json');
    const text = '{\n  // my comment\n  "servers": {}\n}\n';
    await writeFile(file, text);
    await expect(installClient('vscode', { hubOnly: true, target: { file, key: 'servers' }, l: L })).rejects.toThrow(/not plain JSON[\s\S]*"dea-hub"/);
    expect(await readFile(file, 'utf8')).toBe(text);
  });
});
