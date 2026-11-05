import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Approve,
  type AuditLine,
  CONNECTORS,
  Hub,
  type HubOptions,
  isEnvVarName,
  loadHub,
  Redactor,
  readAudit,
  readHistory,
  saveHub,
} from '../src/index.ts';
import type { Mode } from '../src/safety/policy.ts';

const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
const VTOKEN = 'vcl_SuperSecretTokenValue1234567890';

let home: string;
let work: string;
let calls: Array<{ url: string; method: string; body?: string; auth?: string }>;

/** A fake network: answers like the real APIs, records what was sent. Nothing leaves the machine. */
const fakeFetch = (extra?: (url: string, init: RequestInit) => Response | undefined) =>
  (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const h = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : undefined, auth: h.authorization });
    const x = extra?.(url, init);
    if (x) return x;
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/repos/me/site'))
      return json({ full_name: 'me/site', description: 'd', default_branch: 'main', license: { spdx_id: 'MIT' }, stargazers_count: 3 });
    if (url.endsWith('/repos/me/site/issues') && init.method === 'POST')
      return json({ number: 7, html_url: 'https://github.com/me/site/issues/7', title: 'T', state: 'open' }, 201);
    if (url.includes('/issues/4/comments') && init.method === 'POST')
      return json({ id: 1, html_url: 'https://github.com/me/site/issues/4#c1', created_at: 'now' }, 201);
    if (url.includes('api.vercel.com/v13/deployments'))
      return json({ id: 'dpl_1', url: 'site-abc.vercel.app', readyState: 'QUEUED', inspectorUrl: 'https://vercel.com/x' });
    if (url.startsWith('https://api.example.com/')) return json({ ok: true, path: new URL(url).pathname });
    return json({ message: 'Not Found' }, 404);
  }) as typeof fetch;

async function setup(mode: Mode | undefined, extra: Partial<HubOptions> = {}, servers: Record<string, unknown> = {}) {
  const cfg = await loadHub(home);
  cfg.mcpServers = {
    gh: { builtin: 'github', tokenEnv: 'TEST_GH_TOKEN', scope: { repos: ['me/site', 'org/*'] } },
    fs: { builtin: 'filesystem', scope: { root: work } },
    web: { builtin: 'http', tokenEnv: 'TEST_API_TOKEN', scope: { baseUrl: 'https://api.example.com/v1', methods: ['GET', 'POST'] } },
    vc: { builtin: 'vercel', tokenEnv: 'TEST_VERCEL', scope: { projects: ['site'], dirs: [join(work, 'dist')] } },
    ...servers,
  } as never;
  cfg.clients.bot = { enabled: true, apps: {}, defaultLevel: 'full' };
  await saveHub(cfg, home);
  return new Hub(home, {}, { mode, env: { TEST_GH_TOKEN: TOKEN, TEST_API_TOKEN: TOKEN, TEST_VERCEL: VTOKEN }, fetch: fakeFetch(), ...extra });
}
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? '').join('\n');
const audit = () => readAudit({}, home);

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dea-hub-'));
  work = await mkdtemp(join(tmpdir(), 'dea-work-'));
  calls = [];
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe('connector registry', () => {
  it('lists the built-in connectors with their tools marked read-only or changing', async () => {
    expect(Object.keys(CONNECTORS).sort()).toEqual(['filesystem', 'github', 'http', 'vercel']);
    const hub = await setup('supervised');
    const tools = await hub.appTools('gh');
    expect(tools.find((t) => t.name === 'get_repo')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.find((t) => t.name === 'create_issue')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const { tools: shown } = await hub.toolsFor('bot');
    expect(shown.map((t) => t.name)).toContain('gh__comment');
    expect(shown.map((t) => t.name)).toContain('vc__deploy_static');
  });

  it('a client with read access sees only the read tools of a connector', async () => {
    const hub = await setup('delegated');
    const cfg = await loadHub(home);
    cfg.clients.reader = { enabled: true, apps: { gh: { level: 'read' } } };
    await saveHub(cfg, home);
    const { tools } = await hub.toolsFor('reader');
    const gh = tools.filter((t) => t.app === 'gh').map((t) => t.original);
    expect(gh).toContain('get_repo');
    expect(gh).not.toContain('create_issue');
    const r = await hub.call('reader', 'gh', 'create_issue', { repo: 'me/site', title: 'x' });
    expect(r.isError).toBe(true);
    expect(calls.length).toBe(0);
  });

  it('every connector validates its scope and refuses a missing or too-wide one', () => {
    expect(() => CONNECTORS.github.validateScope({})).toThrow(/repos/);
    expect(() => CONNECTORS.github.validateScope({ repos: ['not a repo'] })).toThrow(/owner\/name/);
    expect(() => CONNECTORS.filesystem.validateScope({ root: 'relative/dir' })).toThrow(/absolute/);
    expect(() => CONNECTORS.filesystem.validateScope({ root: '/' })).toThrow(/whole drive/);
    expect(() => CONNECTORS.http.validateScope({ baseUrl: 'http://example.com' })).toThrow(/https/);
    expect(() => CONNECTORS.http.validateScope({ baseUrl: 'https://u:p@example.com' })).toThrow(/user name/);
    expect(() => CONNECTORS.http.validateScope({ baseUrl: 'https://example.com', methods: ['TRACE'] })).toThrow(/method/);
    expect(() => CONNECTORS.vercel.validateScope({ projects: ['a'] })).toThrow(/dirs/);
  });
});

describe('permission modes gate every connector call', () => {
  it('restricted: reads run, a change is refused before any network call, and the refusal is audited', async () => {
    const hub = await setup('restricted');
    const ok = await hub.call('bot', 'gh', 'get_repo', { repo: 'me/site' });
    expect(ok.isError).toBeFalsy();
    expect(text(ok)).toContain('"verified": true');
    calls = [];
    const no = await hub.call('bot', 'gh', 'create_issue', { repo: 'me/site', title: 'x' });
    expect(no.isError).toBe(true);
    expect(text(no)).toMatch(/restricted mode/);
    expect(calls.length).toBe(0);
    const a = await audit();
    expect(a.map((l) => l.stage)).toEqual(['denied']);
    expect(a[0]).toMatchObject({ app: 'gh', tool: 'create_issue', mode: 'restricted', where: expect.stringContaining('me/site') });
  });

  it('supervised: a change needs an explicit yes; no way to ask means no', async () => {
    const asked: string[] = [];
    const yes: Approve = async (r) => {
      asked.push(`${r.tool}|${r.where}|${r.mode}`);
      return true;
    };
    const hub = await setup('supervised', { approve: yes });
    const r = await hub.call('bot', 'gh', 'create_issue', { repo: 'me/site', title: 'Hello', body: 'b' });
    expect(r.isError).toBeFalsy();
    expect(asked).toEqual([expect.stringMatching(/^create_issue\|github me\/site \(new issue "Hello"\)\|supervised$/)]);
    expect(calls.map((c) => c.method)).toEqual(['POST']);
    const a = await audit();
    expect(a.map((l) => l.stage)).toEqual(['intent', 'done']);
    expect(a[0].basis).toMatch(/approved by the user/);

    const refusing = await setup('supervised', { approve: async () => false });
    calls = [];
    const n = await refusing.call('bot', 'gh', 'comment', { repo: 'me/site', number: 4, body: 'hi' });
    expect(n.isError).toBe(true);
    expect(text(n)).toMatch(/did not approve/);
    expect(calls.length).toBe(0);

    const mute = await setup('supervised');
    const m = await mute.call('bot', 'gh', 'comment', { repo: 'me/site', number: 4, body: 'hi' });
    expect(text(m)).toMatch(/nothing here can ask you/);
    expect(calls.length).toBe(0);
    const throwing = await setup('supervised', { approve: async () => Promise.reject(new Error('boom')) });
    expect((await throwing.call('bot', 'gh', 'comment', { repo: 'me/site', number: 4, body: 'hi' })).isError).toBe(true);
    expect(calls.length).toBe(0);
  });

  it('supervised: reads never ask', async () => {
    let asked = 0;
    const hub = await setup('supervised', {
      approve: async () => {
        asked++;
        return true;
      },
    });
    expect((await hub.call('bot', 'gh', 'get_repo', { repo: 'me/site' })).isError).toBeFalsy();
    expect(asked).toBe(0);
  });

  it('delegated: a change inside the scope runs without asking, and is audited with its basis', async () => {
    const hub = await setup('delegated');
    const r = await hub.call('bot', 'gh', 'comment', { repo: 'org/anything', number: 4, body: 'hi' });
    expect(r.isError).toBeFalsy();
    const a = await audit();
    expect(a.map((l) => l.stage)).toEqual(['intent', 'done']);
    expect(a[0].basis).toMatch(/delegated, inside the connector scope/);
    expect(a[0]).toMatchObject({ mode: 'delegated', client: 'bot', where: 'github org/anything #4 (comment)' });
    expect(Date.parse(a[0].t)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('outside the declared scope is refused in every mode, even delegated, and nothing is sent', async () => {
    for (const mode of ['restricted', 'supervised', 'delegated'] as const) {
      const hub = await setup(mode, { approve: async () => true });
      calls = [];
      for (const [tool, args] of [
        ['get_repo', { repo: 'someone/else' }],
        ['create_issue', { repo: 'someone/else', title: 'x' }],
        ['comment', { repo: 'ME/SITE/../x', number: 1, body: 'x' }],
      ] as const) {
        const r = await hub.call('bot', 'gh', tool, args as never);
        expect(r.isError, `${mode} ${tool}`).toBe(true);
        expect(text(r)).toMatch(/not in this connector's scope|not owner\/name/);
      }
      expect(calls.length).toBe(0);
    }
  });

  it('grants still apply: a client that may only read cannot change things even in delegated mode', async () => {
    const hub = await setup('delegated');
    const cfg = await loadHub(home);
    cfg.clients.bot = { enabled: true, apps: { gh: { level: 'read' } } };
    await saveHub(cfg, home);
    const r = await hub.call('bot', 'gh', 'comment', { repo: 'me/site', number: 4, body: 'hi' });
    expect(text(r)).toMatch(/has "read" access/);
    expect(calls.length).toBe(0);
  });

  it('an MCP server tool that is not marked read-only counts as a change in every mode', async () => {
    const hub = await setup('restricted', {}, { notes: { command: 'node', args: ['-e', '0'] } });
    // an unreachable MCP server: the tool list is unknown, so the tool is treated as one that may change things
    const r = await hub.call('bot', 'notes', 'create_note', { text: 'x' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/restricted mode/);
    expect((await audit())[0]).toMatchObject({ stage: 'denied', app: 'notes' });
  });

  it('without a mode set the hub behaves as before (grants only) but still audits changes', async () => {
    const hub = await setup(undefined);
    expect((await hub.call('bot', 'gh', 'comment', { repo: 'me/site', number: 4, body: 'hi' })).isError).toBeFalsy();
    expect((await audit()).map((l) => `${l.stage}:${l.mode}`)).toEqual(['intent:unset', 'done:unset']);
  });

  it('the person at their own terminal ("cli") needs no grant, but mode and scope still apply', async () => {
    const hub = await setup('restricted');
    expect((await hub.call('cli', 'gh', 'get_repo', { repo: 'me/site' })).isError).toBeFalsy();
    expect((await hub.call('cli', 'gh', 'comment', { repo: 'me/site', number: 4, body: 'x' })).isError).toBe(true);
  });
});

describe('audit log', () => {
  it('a change that cannot be recorded is not made', async () => {
    await mkdir(join(home, 'audit.jsonl'), { recursive: true }); // a folder where the file should be: appending fails
    const hub = await setup('delegated');
    const r = await hub.call('bot', 'gh', 'comment', { repo: 'me/site', number: 4, body: 'hi' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/audit log could not be written/);
    expect(calls.length).toBe(0);
    // reads are not audited and still work
    expect((await hub.call('bot', 'gh', 'get_repo', { repo: 'me/site' })).isError).toBeFalsy();
  });

  it('records a failed change as failed, with the reason, and writes one line per stage', async () => {
    const hub = await setup('delegated', { fetch: fakeFetch(() => new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 })) });
    const r = await hub.call('bot', 'gh', 'create_issue', { repo: 'me/site', title: 'x' });
    expect(r.isError).toBe(true);
    const a = await audit();
    expect(a.map((l) => l.stage)).toEqual(['intent', 'failed']);
    expect(a[1].error).toMatch(/422.*Validation Failed/);
    const raw = (await readFile(join(home, 'audit.jsonl'), 'utf8')).trim().split('\n');
    expect(raw.length).toBe(2);
    for (const l of raw)
      expect(Object.keys(JSON.parse(l) as AuditLine)).toEqual(expect.arrayContaining(['t', 'client', 'app', 'tool', 'where', 'mode', 'stage', 'basis']));
  });
});

describe('secrets never show', () => {
  const everything = async () =>
    [
      await readFile(join(home, 'hub.json'), 'utf8'),
      await readFile(join(home, 'audit.jsonl'), 'utf8').catch(() => ''),
      await readFile(join(home, 'history.jsonl'), 'utf8').catch(() => ''),
    ].join('\n');

  it('the token goes out as the Authorization header and nowhere else: not in the config, history or audit', async () => {
    const hub = await setup('delegated');
    await hub.call('bot', 'gh', 'comment', { repo: 'me/site', number: 4, body: 'hello' });
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
    const all = await everything();
    expect(all).not.toContain(TOKEN);
    expect(all).toContain('TEST_GH_TOKEN'); // the NAME of the variable is stored, never its value
    const history = await readHistory({}, home);
    expect(history.length).toBe(1);
  });

  it('a service that echoes the token back in its answer is redacted in the result, history and audit', async () => {
    const echo = fakeFetch((url) =>
      url.includes('/v1/echo')
        ? new Response(
            JSON.stringify({ you_sent: `Bearer ${TOKEN}`, note: `token=${TOKEN}`, b64: Buffer.from(TOKEN).toString('base64'), enc: encodeURIComponent(TOKEN) }),
            { headers: { 'content-type': 'application/json' } },
          )
        : undefined,
    );
    const hub = await setup('delegated', { fetch: echo });
    const r = await hub.call('bot', 'web', 'get', { path: '/echo' });
    expect(text(r)).not.toContain(TOKEN);
    expect(text(r)).not.toContain(Buffer.from(TOKEN).toString('base64'));
    expect(text(r)).toContain('[hidden]');
    expect(await everything()).not.toContain(TOKEN);
  });

  it('an error that mentions the token (a failing request, a 4xx body) is redacted in the message, history and audit', async () => {
    const boom = fakeFetch((url) => {
      if (url.includes('/boom')) throw new Error(`connect failed with Authorization: Bearer ${TOKEN} to ${url}?access_token=${TOKEN}`);
      if (url.includes('/bad')) return new Response(`denied for ${TOKEN}`, { status: 403 });
      return undefined;
    });
    const hub = await setup('delegated', { fetch: boom });
    for (const p of ['/boom', '/bad']) {
      const r = await hub.call('bot', 'web', 'send', { method: 'POST', path: p, body: { token: TOKEN, note: `uses ${TOKEN}` } });
      expect(r.isError).toBe(true);
      expect(text(r)).not.toContain(TOKEN);
      expect(text(r)).not.toContain('access_token=ghp');
    }
    const all = await everything();
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('Bearer ghp');
  });

  it('arguments that look like secrets are hidden in history and audit lines, and a token pasted as an argument value is redacted', async () => {
    const hub = await setup('delegated');
    await hub.call('bot', 'web', 'send', { method: 'POST', path: '/x', body: { password: 'hunter2hunter2', apiKey: 'abcdef123456', note: `pasted ${TOKEN}` } });
    const all = await everything();
    expect(all).not.toContain('hunter2hunter2');
    expect(all).not.toContain('abcdef123456');
    expect(all).not.toContain(TOKEN);
  });

  it('a token pasted where the variable NAME belongs is recognised, never used, and never echoed', async () => {
    for (const ok of ['GITHUB_TOKEN', 'VERCEL_TOKEN', 'MyApiKey', 'NPM_TOKEN_2', 'TEST_GH_TOKEN']) expect(isEnvVarName(ok), ok).toBe(true);
    for (const bad of [
      TOKEN,
      VTOKEN.replace('vcl_', 'vcl-'),
      'sk_live_abcdefghijklmnop',
      'xoxb-1234567890-abcdef',
      `${'a1B2'.repeat(10)}`,
      'has space',
      'with-dash',
      '1STARTS',
      '',
    ])
      expect(isEnvVarName(bad), bad).toBe(false);
    const hub = await setup('delegated', {}, { pasted: { builtin: 'github', tokenEnv: TOKEN, scope: { repos: ['me/site'] } } });
    const r = await hub.call('bot', 'pasted', 'get_repo', { repo: 'me/site' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/not the name of an environment variable/);
    expect(text(r)).not.toContain(TOKEN);
    expect(calls.length).toBe(0);
    expect(await readFile(join(home, 'history.jsonl'), 'utf8')).not.toContain(TOKEN);
  });

  it('a missing token is named by its variable, never asked for, and nothing is sent', async () => {
    const hub = await setup('delegated', { env: {} });
    const r = await hub.call('bot', 'gh', 'get_repo', { repo: 'me/site' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/environment variable TEST_GH_TOKEN/);
    expect(calls.length).toBe(0);
  });

  it('the approval question shows where and what, never the token', async () => {
    let seen = '';
    const hub = await setup('supervised', {
      approve: async (r) => {
        seen = JSON.stringify(r);
        return false;
      },
    });
    await hub.call('bot', 'web', 'send', { method: 'POST', path: '/items?access_token=abc123456789', body: { note: TOKEN } });
    expect(seen).toContain('api.example.com');
    expect(seen).not.toContain(TOKEN);
    expect(seen).not.toContain('abc123456789');
  });

  it('Redactor covers raw, URL-encoded and base64 forms, ignores very short values, and cleans nested data', () => {
    const r = new Redactor(['tok_abcdef123456', 'ab']);
    expect(r.text('x tok_abcdef123456 y')).toBe('x [hidden] y');
    expect(r.text(`u ${encodeURIComponent('tok_abc/def=123456')}`)).toContain('u ');
    const r2 = new Redactor(['a/b+c=SECRETVALUE']);
    expect(r2.text(`q=${encodeURIComponent('a/b+c=SECRETVALUE')}`)).toBe('q=[hidden]');
    expect(r2.text(Buffer.from('a/b+c=SECRETVALUE').toString('base64'))).toBe('[hidden]');
    expect(r.text('about abc')).toBe('about abc');
    expect(r.text('GET /x?access_token=abcdef123456&q=1&sig=zzzz')).toBe('GET /x?access_token=[hidden]&q=1&sig=[hidden]');
    expect(r.deep({ a: ['tok_abcdef123456'], b: { c: 'tok_abcdef123456!' } })).toEqual({ a: ['[hidden]'], b: { c: '[hidden]!' } });
    expect(r.text('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk')).not.toContain('eyJ');
    expect(r.text(`ghp_${'a'.repeat(36)}`)).toBe('[redacted by dea]');
  });
});

describe('github connector', () => {
  it('reads a repo and creates an issue inside scope, with the documented API calls', async () => {
    const hub = await setup('delegated');
    const r = await hub.call('bot', 'gh', 'get_repo', { repo: 'me/site' });
    expect(JSON.parse(text(r))).toMatchObject({ ok: true, data: { full_name: 'me/site', license: 'MIT' } });
    const c = await hub.call('bot', 'gh', 'create_issue', { repo: 'me/site', title: 'Bug', body: 'steps' });
    expect(JSON.parse(text(c)).data).toMatchObject({ number: 7 });
    const post = calls.find((x) => x.method === 'POST');
    expect(post?.url).toBe('https://api.github.com/repos/me/site/issues');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ title: 'Bug', body: 'steps' });
  });
});

describe('filesystem connector', () => {
  it('reads and writes only inside the folder; refuses .., absolute paths, links out, and silent overwrite', async () => {
    const hub = await setup('delegated');
    await writeFile(join(work, 'a.txt'), 'hello');
    expect(JSON.parse(text(await hub.call('bot', 'fs', 'read_file', { path: 'a.txt' }))).data.text).toBe('hello');
    expect((await hub.call('bot', 'fs', 'write_file', { path: 'sub/new.txt', text: 'x' })).isError).toBeFalsy();
    expect(await readFile(join(work, 'sub', 'new.txt'), 'utf8')).toBe('x');
    const again = await hub.call('bot', 'fs', 'write_file', { path: 'sub/new.txt', text: 'y' });
    expect(text(again)).toMatch(/already exists/);
    expect(await readFile(join(work, 'sub', 'new.txt'), 'utf8')).toBe('x');
    expect((await hub.call('bot', 'fs', 'write_file', { path: 'sub/new.txt', text: 'y', overwrite: true })).isError).toBeFalsy();
    for (const p of ['../outside.txt', 'sub/../../outside.txt', '/etc/passwd', 'C:\\Windows\\win.ini'.replace(/^C:/, '/C:')]) {
      const r = await hub.call('bot', 'fs', 'write_file', { path: p, text: 'x' });
      expect(r.isError, p).toBe(true);
    }
    const outside = await mkdtemp(join(tmpdir(), 'dea-out-'));
    await writeFile(join(outside, 'secret.txt'), 'top secret');
    try {
      await symlink(outside, join(work, 'link'));
      const viaLink = await hub.call('bot', 'fs', 'read_file', { path: 'link/secret.txt' });
      expect(viaLink.isError).toBe(true);
      expect(text(viaLink)).toMatch(/outside the scoped folder/);
      expect(text(viaLink)).not.toContain('top secret');
      expect((await hub.call('bot', 'fs', 'write_file', { path: 'link/new.txt', text: 'x' })).isError).toBe(true);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e; // symlinks need privileges on some Windows setups
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
    expect((await audit()).some((l) => l.tool === 'write_file' && l.stage === 'denied')).toBe(true);
  });
});

describe('http connector', () => {
  it('stays under its base address: no other host, no .., no full URL, only allowed methods', async () => {
    const hub = await setup('delegated');
    const ok = await hub.call('bot', 'web', 'get', { path: '/items?limit=2' });
    expect(JSON.parse(text(ok)).data.body.path).toBe('/v1/items');
    expect(calls[0].url).toBe('https://api.example.com/v1/items?limit=2');
    calls = [];
    for (const path of ['https://evil.example.org/x', '//evil.example.org/x', '/../admin', '/items/%2e%2e/admin', '..\\x', 'ftp://x/y']) {
      const r = await hub.call('bot', 'web', 'get', { path });
      expect(r.isError, path).toBe(true);
    }
    expect((await hub.call('bot', 'web', 'send', { method: 'DELETE', path: '/items/1' })).isError).toBe(true); // DELETE is not in methods
    expect((await hub.call('bot', 'web', 'get', { method: 'POST', path: '/x' })).isError).toBe(true);
    expect(calls.length).toBe(0);
    expect((await hub.call('bot', 'web', 'send', { method: 'POST', path: '/items', body: { a: 1 } })).isError).toBeFalsy();
    expect(calls[0]).toMatchObject({ method: 'POST', body: '{"a":1}' });
  });

  it('does not follow a redirect to another host', async () => {
    const hub = await setup('delegated', {
      fetch: fakeFetch(() => new Response('', { status: 302, headers: { location: 'https://evil.example.org/steal' } })),
    });
    const r = await hub.call('bot', 'web', 'get', { path: '/x' });
    expect(text(r)).toMatch(/not followed/);
    expect(calls.length).toBe(1);
  });
});

describe('vercel connector', () => {
  it('deploys a static folder: right payload, no node_modules/.env, preview unless production is allowed', async () => {
    const dist = join(work, 'dist');
    await mkdir(join(dist, 'assets'), { recursive: true });
    await mkdir(join(dist, 'node_modules', 'x'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<h1>hi</h1>');
    await writeFile(join(dist, 'assets', 'a.js'), 'console.log(1)');
    await writeFile(join(dist, '.env'), 'SECRET=1');
    await writeFile(join(dist, '.env.local'), 'SECRET=2');
    await writeFile(join(dist, 'node_modules', 'x', 'i.js'), 'x');
    const hub = await setup('delegated');
    const r = await hub.call('bot', 'vc', 'deploy_static', { project: 'site', dir: dist });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r)).data).toMatchObject({ url: 'https://site-abc.vercel.app', target: 'preview', files: 2 });
    const sent = JSON.parse(calls[0].body ?? '{}') as { name: string; files: Array<{ file: string; data: string }>; target?: string };
    expect(sent.files.map((f) => f.file).sort()).toEqual(['assets/a.js', 'index.html']);
    expect(Buffer.from(sent.files.find((f) => f.file === 'index.html')?.data ?? '', 'base64').toString()).toBe('<h1>hi</h1>');
    expect(sent.target).toBeUndefined();
    expect(calls[0].auth).toBe(`Bearer ${VTOKEN}`);
    expect(JSON.stringify(sent)).not.toContain('SECRET');
    expect((await audit()).find((l) => l.tool === 'deploy_static')?.where).toMatch(/vercel project site from .*dist \(preview\)/);
    expect(await readFile(join(home, 'audit.jsonl'), 'utf8')).not.toContain(VTOKEN);
  });

  it('refuses another project, another folder, and a production deploy the scope does not allow', async () => {
    const dist = join(work, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), 'x');
    const hub = await setup('delegated');
    for (const args of [
      { project: 'other', dir: dist },
      { project: 'site', dir: work },
      { project: 'site', dir: join(dist, '..', 'dist', '..') },
      { project: 'site', dir: 'relative' },
      { project: 'site', dir: dist, production: true },
    ]) {
      const r = await hub.call('bot', 'vc', 'deploy_static', args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
    }
    expect(calls.length).toBe(0);
    const cfg = await loadHub(home);
    (cfg.mcpServers.vc as { scope: Record<string, unknown> }).scope.allowProduction = true;
    await saveHub(cfg, home);
    expect((await hub.call('bot', 'vc', 'deploy_static', { project: 'site', dir: dist, production: true })).isError).toBeFalsy();
    expect(JSON.parse(calls[0].body ?? '{}').target).toBe('production');
  });

  it('needs an index.html and, in supervised mode, an approval that names the folder and project', async () => {
    const dist = join(work, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'page.html'), 'x');
    let where = '';
    const hub = await setup('supervised', {
      approve: async (r) => {
        where = r.where;
        return true;
      },
    });
    const r = await hub.call('bot', 'vc', 'deploy_static', { project: 'site', dir: dist });
    expect(text(r)).toMatch(/no index\.html/);
    expect(where).toMatch(/vercel project site from .*dist \(preview\)/);
    expect(calls.length).toBe(0);
  });
});
