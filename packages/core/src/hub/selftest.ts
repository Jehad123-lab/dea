import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { read as readWeb } from '../web/read.ts';
import { search as searchWeb } from '../web/search.ts';
import { approvalIdOf, decideApproval } from './approvals.ts';
import { readAudit } from './audit.ts';
import { CONNECTORS } from './builtin/index.ts';
import type { Ctx } from './builtin/types.ts';
import { Hub } from './hub.ts';
import { decideCall } from './modes.ts';
import { isEnvVarName, Redactor } from './redact.ts';
import { saveHub } from './store.ts';

export type CheckStatus = 'pass' | 'fail' | 'skip';
export interface Check {
  id: string;
  /** offline = needs nothing; public = real network, no login; token = real network with a token YOU put in an environment variable */
  group: 'offline' | 'public' | 'token';
  title: string;
  status: CheckStatus;
  note: string;
  ms: number;
}

export interface SelftestOptions {
  /** also make real read-only calls (public ones always; token ones only for the variables that are set) */
  live?: boolean;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

/** Which environment variable proves which connector against the real service. The value is read from the environment and never shown. */
export const TOKEN_CHECKS = [
  { connector: 'github', env: 'GITHUB_TOKEN' },
  { connector: 'vercel', env: 'VERCEL_TOKEN' },
  { connector: 'gitlab', env: 'GITLAB_TOKEN' },
] as const;

async function timed(
  list: Check[],
  id: string,
  group: Check['group'],
  title: string,
  fn: () => Promise<{ status?: CheckStatus; note: string }>,
): Promise<void> {
  const t0 = Date.now();
  try {
    const r = await fn();
    list.push({ id, group, title, status: r.status ?? 'pass', note: r.note, ms: Date.now() - t0 });
  } catch (e) {
    list.push({ id, group, title, status: 'fail', note: (e as Error).message.split('\n')[0].slice(0, 300), ms: Date.now() - t0 });
  }
}

const ok = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};
const textOf = (r: { content?: Array<{ [k: string]: unknown }> }) => (r.content ?? []).map((c) => String(c.text ?? '')).join('\n');

/**
 * `dea hub selftest`: does this installation do what it says? The offline checks run in a temp folder with a made-up token and
 * a fake network and need nothing from you. With live=true it also makes real read-only calls: public ones (no login), and for
 * each of GITHUB_TOKEN / VERCEL_TOKEN / GITLAB_TOKEN that is set in your environment, one read that proves the token works. A
 * variable that is not set is skipped with a plain note. DEA never asks for a token, never prints one, and never writes one down.
 */
export async function selftest(o: SelftestOptions = {}): Promise<Check[]> {
  const env = o.env ?? process.env;
  const out: Check[] = [];
  const home = await mkdtemp(join(tmpdir(), 'dea-selftest-'));
  const work = join(home, 'work');
  await mkdir(work, { recursive: true });
  const FAKE = 'ghp_selftest0123456789abcdefghijklmnopqrstu';
  try {
    await timed(out, 'modes', 'offline', 'permission modes: restricted refuses changes, supervised needs a yes, delegated runs in scope', async () => {
      ok(decideCall('restricted', 'write').ok === false, 'restricted allowed a change');
      ok(
        decideCall('supervised', 'write').ok === true && (decideCall('supervised', 'write') as { via: string }).via === 'approval-needed',
        'supervised did not ask',
      );
      ok(decideCall('delegated', 'write').ok === true, 'delegated refused');
      ok(decideCall('restricted', 'read').ok === true, 'restricted refused a read');
      return { note: '3 modes behave as documented' };
    });

    const fakeNet = (async (input: string | URL | Request) =>
      new Response(JSON.stringify({ echo: String(input), token_leak: FAKE, full_name: 'me/site' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await saveHub(
      {
        mcpServers: { fs: { builtin: 'filesystem', scope: { root: work } }, gh: { builtin: 'github', tokenEnv: 'SELFTEST_GH', scope: { repos: ['me/site'] } } },
        clients: { cli: { enabled: true, apps: {}, defaultLevel: 'full' } },
        alert: { max: 20, minutes: 10 },
      } as never,
      home,
    );
    let asked = 0;
    await timed(out, 'supervised', 'offline', 'supervised mode: a change is asked about; yes runs it, no does not; the audit log records both', async () => {
      const yes = new Hub(home, {}, { mode: 'supervised', approve: async () => (asked++, true) });
      const no = new Hub(home, {}, { mode: 'supervised', approve: async () => (asked++, false) });
      try {
        ok(!(await yes.call('cli', 'fs', 'write_file', { path: 'a.txt', text: 'x' })).isError, 'an approved change did not run');
        ok((await no.call('cli', 'fs', 'write_file', { path: 'b.txt', text: 'x' })).isError === true, 'a declined change ran');
        ok(!(await readFile(join(work, 'b.txt'), 'utf8').catch(() => null)), 'b.txt exists after a no');
      } finally {
        await yes.close();
        await no.close();
      }
      const stages = (await readAudit({ app: 'fs' }, home)).map((l) => l.stage);
      ok(asked === 2 && stages.join() === 'intent,done,denied', `unexpected audit trail: ${stages.join()}`);
      return { note: `asked twice; audit trail ${stages.join(' > ')}` };
    });

    await timed(
      out,
      'approval-file',
      'offline',
      'supervised mode with nobody to ask: the change waits as an approval, runs once after dea hub approve, and not twice',
      async () => {
        const hub = new Hub(home, {}, { mode: 'supervised' });
        try {
          const args = { path: 'c.txt', text: 'x' };
          const first = textOf(await hub.call('cli', 'fs', 'write_file', args));
          const id = /approval ([0-9a-f]{10})/.exec(first)?.[1];
          ok(Boolean(id) && id === approvalIdOf('cli', 'fs', 'write_file', args), 'no approval id was given');
          await decideApproval(id as string, 'approved', home);
          ok(!(await hub.call('cli', 'fs', 'write_file', args)).isError, 'the approved change did not run');
          ok(/waiting as approval/.test(textOf(await hub.call('cli', 'fs', 'write_file', { ...args, overwrite: true }))), 'an approval worked twice');
        } finally {
          await hub.close();
        }
        return { note: 'wait, approve in a terminal, run once' };
      },
    );

    await timed(out, 'scope', 'offline', 'a folder connector cannot leave its folder (dots, absolute paths)', async () => {
      const hub = new Hub(home, {}, { mode: 'delegated' });
      try {
        for (const path of ['../x.txt', '/etc/passwd', 'a/../../x'])
          ok((await hub.call('cli', 'fs', 'write_file', { path, text: 'x' })).isError === true, `${path} was allowed`);
      } finally {
        await hub.close();
      }
      return { note: '3 escapes refused' };
    });

    await timed(out, 'redaction', 'offline', 'a token the service echoes back is hidden in the result and in the audit log', async () => {
      const hub = new Hub(home, {}, { mode: 'restricted', env: { SELFTEST_GH: FAKE }, fetch: fakeNet });
      try {
        const r = textOf(await hub.call('cli', 'gh', 'get_repo', { repo: 'me/site' }));
        ok(r.includes('full_name') && !r.includes(FAKE) && !r.includes('selftest0123456789'), 'the made-up token appeared in a result');
      } finally {
        await hub.close();
      }
      const files = [join(home, 'history.jsonl'), join(home, 'audit.jsonl')];
      for (const f of files)
        ok(!(await readFile(f, 'utf8').catch(() => '')).includes('selftest0123456789'), `the made-up token appeared in ${f.split(/[\\/]/).pop()}`);
      return { note: 'a made-up token was sent, echoed back, and found nowhere' };
    });

    await timed(out, 'connectors', 'offline', 'every built-in connector has well-formed tools and rejects an unusable scope', async () => {
      for (const c of Object.values(CONNECTORS)) {
        ok(c.tools.length > 0 && new Set(c.tools.map((t) => t.name)).size === c.tools.length, `${c.id}: tool names`);
        ok(
          c.tools.every((t) => (t.inputSchema as { type?: string }).type === 'object'),
          `${c.id}: input schema`,
        );
        let threw = false;
        try {
          c.validateScope({});
        } catch {
          threw = true;
        }
        ok(threw, `${c.id}: accepted an empty scope`);
        if (c.defaultTokenEnv) ok(isEnvVarName(c.defaultTokenEnv), `${c.id}: token variable name`);
      }
      return { note: `${Object.keys(CONNECTORS).length} connectors: ${Object.keys(CONNECTORS).join(', ')}` };
    });

    if (!o.live) return out;

    // ---- public: the real network, no login
    const net = o.fetch ?? fetch;
    const publicCtx = (scope: Record<string, unknown>): Ctx => ({ scope, fetch: net, redact: new Redactor() });
    await timed(out, 'github-public', 'public', 'GitHub connector against the real API, public repo, no token', async () => {
      const t = CONNECTORS.github.tools.find((x) => x.name === 'get_repo');
      try {
        const d = (await (t as NonNullable<typeof t>).run({ repo: 'octocat/Hello-World' }, publicCtx({ repos: ['octocat/Hello-World'] }))) as {
          full_name?: string;
        };
        ok(d.full_name === 'octocat/Hello-World', 'unexpected answer');
        return { note: 'octocat/Hello-World answered; the connector reads the real API’s shape' };
      } catch (e) {
        if (/answered (403|429)/.test((e as Error).message))
          return { status: 'skip', note: 'GitHub limits requests without a token (60 an hour); try again later or set GITHUB_TOKEN' };
        throw e;
      }
    });
    await timed(out, 'gitlab-public', 'public', 'GitLab connector against the real API, public project, no token', async () => {
      const t = CONNECTORS.gitlab.tools.find((x) => x.name === 'get_project');
      try {
        const d = (await (t as NonNullable<typeof t>).run({ project: 'gitlab-org/cli' }, publicCtx({ projects: ['gitlab-org/cli'] }))) as {
          path_with_namespace?: string;
        };
        ok(d.path_with_namespace === 'gitlab-org/cli', 'unexpected answer');
        return { note: 'gitlab-org/cli answered' };
      } catch (e) {
        if (/answered (403|429)/.test((e as Error).message)) return { status: 'skip', note: 'GitLab limited the request; try again later' };
        throw e;
      }
    });
    await timed(out, 'web-search', 'public', 'search: at least one free source answers', async () => {
      const r = await searchWeb('webgl', { sources: ['wikipedia'], fresh: true, home, fetch: net, timeoutMs: 20_000 });
      if (r.status === 'blocked') return { status: 'skip', note: `blocked: ${r.problems.map((p) => `${p.source} ${p.why}`).join('; ')}` };
      ok(r.results.length > 0, `no results (status ${r.status})`);
      return { note: `${r.results.length} results from wikipedia, ${r.label}` };
    });
    await timed(out, 'web-read', 'public', 'read: a public page comes back as text', async () => {
      const r = await readWeb('https://example.com/', { fresh: true, home, fetch: net, render: 'never', timeoutMs: 20_000 });
      ok(r.text.length > 20 && r.method === 'static', 'no text');
      return { note: `${r.chars} characters, ${r.method}` };
    });

    // ---- token: only for what the person put in their environment
    for (const tc of TOKEN_CHECKS) {
      const c = CONNECTORS[tc.connector];
      const title = `${tc.connector} connector proves ${tc.env} against the real API (one read)`;
      const token = env[tc.env];
      if (!token) {
        out.push({
          id: `${tc.connector}-token`,
          group: 'token',
          title,
          status: 'skip',
          note: `$${tc.env} is not set in this shell, so there is nothing to test. Set it in the shell that runs this (the value is never shown or stored).`,
          ms: 0,
        });
        continue;
      }
      await timed(out, `${tc.connector}-token`, 'token', title, async () => {
        const redact = new Redactor([token]);
        const ctx: Ctx = {
          token,
          fetch: net,
          redact,
          scope:
            tc.connector === 'github'
              ? { repos: ['octocat/Hello-World'] }
              : tc.connector === 'gitlab'
                ? { projects: ['gitlab-org/cli'] }
                : { projects: ['dea-selftest-none'], dirs: [work] },
        };
        try {
          const who = await (c.probe as NonNullable<typeof c.probe>)(ctx);
          const readTool = tc.connector === 'github' ? 'get_repo' : tc.connector === 'gitlab' ? 'get_project' : 'list_projects';
          const args = tc.connector === 'github' ? { repo: 'octocat/Hello-World' } : tc.connector === 'gitlab' ? { project: 'gitlab-org/cli' } : {};
          await (c.tools.find((x) => x.name === readTool) as NonNullable<(typeof c.tools)[number]>).run(args, ctx);
          return { note: `${who}; ${readTool} answered` };
        } catch (e) {
          const m = redact.text((e as Error).message);
          throw new Error(
            /answered (401|403)/.test(m)
              ? `the service refused the token in $${tc.env} (${m.replace(/^.*answered /, '')}). Make a new one with read access and put it in the variable.`
              : m,
          );
        }
      });
    }
    return out;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export const selftestFailed = (checks: Check[]): boolean => checks.some((c) => c.status === 'fail');
