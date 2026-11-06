import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONNECTORS, Hub, loadHub, saveHub } from '../src/index.ts';

const fx = (n: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'gitlab', n), 'utf8');
let home: string;
let seen: Array<{ url: string; method: string; auth?: string; private?: string }>;

/** Answers are the real gitlab.com answers for gitlab-org/cli, recorded on 2026-11-06 (public project, no token). */
const recorded = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input);
  const h = (init.headers ?? {}) as Record<string, string>;
  seen.push({ url, method: init.method ?? 'GET', auth: h.authorization, private: h['private-token'] });
  const ok = (b: string) => new Response(b, { status: 200, headers: { 'content-type': 'application/json' } });
  const base = 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli';
  if (url === base) return ok(fx('project.json'));
  if (url.startsWith(`${base}/issues`)) return ok(fx('issues.json'));
  if (url.startsWith(`${base}/merge_requests`)) return ok(fx('mrs.json'));
  if (url.startsWith(`${base}/repository/files/go.mod`)) return ok(fx('file-go-mod.json'));
  if (url.startsWith(`${base}/repository/files/`)) return new Response('{"message":"404 File Not Found"}', { status: 404 });
  if (url.startsWith(`${base}/repository/tree`)) return ok(fx('tree.json'));
  return new Response('{"message":"404 Project Not Found"}', { status: 404 });
}) as typeof fetch;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dea-gl-'));
  seen = [];
  const cfg = await loadHub(home);
  cfg.mcpServers = { gl: { builtin: 'gitlab', scope: { projects: ['gitlab-org/cli'] } } } as never;
  cfg.clients.cli = { enabled: true, apps: {}, defaultLevel: 'full' };
  await saveHub(cfg, home);
});
afterEach(() => rm(home, { recursive: true, force: true }));

const text = (r: { content: Array<{ [k: string]: unknown }> }) => r.content.map((c) => String(c.text ?? '')).join('\n');

describe('GitLab connector (read only, recorded answers)', () => {
  it('reads a public project without any token, and sends no credentials', async () => {
    const hub = new Hub(home, {}, { mode: 'restricted', env: {}, fetch: recorded });
    try {
      const p = JSON.parse(text(await hub.call('cli', 'gl', 'get_project', { project: 'gitlab-org/cli' })));
      expect(p.data).toMatchObject({ path_with_namespace: 'gitlab-org/cli', default_branch: 'main', visibility: 'public' });
      const issues = JSON.parse(text(await hub.call('cli', 'gl', 'list_issues', { project: 'gitlab-org/cli', limit: 2 }))).data;
      expect(issues).toHaveLength(2);
      expect(issues[0]).toMatchObject({ iid: expect.any(Number), title: expect.any(String), web_url: expect.stringContaining('gitlab.com/gitlab-org/cli') });
      const mrs = JSON.parse(text(await hub.call('cli', 'gl', 'list_merge_requests', { project: 'gitlab-org/cli', state: 'merged', limit: 2 }))).data;
      expect(mrs[0].state).toBe('merged');
      expect(seen.every((s) => !s.auth && !s.private)).toBe(true);
      expect(seen.map((s) => s.method)).toEqual(['GET', 'GET', 'GET']);
    } finally {
      await hub.close();
    }
  });
  it('reads a file (base64 decoded) and a folder', async () => {
    const hub = new Hub(home, {}, { mode: 'restricted', env: {}, fetch: recorded });
    try {
      const f = JSON.parse(text(await hub.call('cli', 'gl', 'get_file', { project: 'gitlab-org/cli', path: 'go.mod', ref: 'main' }))).data;
      expect(f.text).toMatch(/^module gitlab\.com\/gitlab-org\/cli/);
      const d = JSON.parse(text(await hub.call('cli', 'gl', 'get_file', { project: 'gitlab-org/cli', path: 'internal' }))).data;
      expect(d.type).toBe('dir');
      expect(d.entries[0]).toMatch(/^(dir|file) /);
    } finally {
      await hub.close();
    }
  });
  it('stays inside its scope and has no tool that changes anything', async () => {
    const hub = new Hub(home, {}, { mode: 'delegated', env: {}, fetch: recorded });
    try {
      const out = await hub.call('cli', 'gl', 'get_project', { project: 'gitlab-org/gitlab' });
      expect(out.isError).toBe(true);
      expect(text(out)).toMatch(/not in this connector's scope/);
      expect(CONNECTORS.gitlab.tools.every((t) => t.kind === 'read')).toBe(true);
      expect(seen).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });
  it('a token named in config is sent, never shown', async () => {
    const cfg = await loadHub(home);
    cfg.mcpServers = { gl: { builtin: 'gitlab', tokenEnv: 'MY_GITLAB_TOKEN', scope: { projects: ['gitlab-org/*'] } } } as never;
    await saveHub(cfg, home);
    const hub = new Hub(home, {}, { mode: 'restricted', env: { MY_GITLAB_TOKEN: 'glpat-abcdefghijklmnop1234' }, fetch: recorded });
    try {
      const r = await hub.call('cli', 'gl', 'get_project', { project: 'gitlab-org/cli' });
      expect(seen[0].auth).toBe('Bearer glpat-abcdefghijklmnop1234');
      expect(text(r)).not.toContain('abcdefghijklmnop');
    } finally {
      await hub.close();
    }
  });
  it('scope checks', () => {
    expect(() => CONNECTORS.gitlab.validateScope({ projects: ['a/b', 'group/*', 'g/sub/proj'] })).not.toThrow();
    expect(() => CONNECTORS.gitlab.validateScope({ projects: ['nonsense'] })).toThrow(/group\/name/);
    expect(() => CONNECTORS.gitlab.validateScope({ projects: ['a/b'], host: 'evil.com/x' })).toThrow(/host name/);
  });
});
