import { api, type BuiltinTool, type Connector, type Ctx, list, type Scope, type ScopeCheck, str } from './types.ts';

const API = 'https://api.github.com';
const GH = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** scope.repos: "owner/name" entries, or "owner/*" for everything one owner has. Nothing outside the list is touched, in any mode. */
function repoIn(repo: string, scope: Scope): ScopeCheck {
  if (!REPO.test(repo)) return { ok: false, why: `"${repo}" is not owner/name` };
  const allowed = list(scope.repos, 'repos').map((r) => r.toLowerCase());
  const [o] = repo.toLowerCase().split('/');
  return allowed.includes(repo.toLowerCase()) || allowed.includes(`${o}/*`)
    ? { ok: true, where: `github ${repo}` }
    : { ok: false, why: `${repo} is not in this connector's scope (${allowed.join(', ')})` };
}

const num = (a: Record<string, unknown>, k = 'number') => {
  const n = Number(a[k]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`"${k}" must be a whole number.`);
  return n;
};
const repoProp = { type: 'string', description: 'owner/name, inside the connector scope' };
const slim = (x: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in x).map((k) => [k, x[k]]));
const lim = (a: Record<string, unknown>) => Math.min(Math.max(Number(a.limit ?? 20) || 20, 1), 50);

const tools: BuiltinTool[] = [
  {
    name: 'get_repo',
    description: 'A repository: description, default branch, licence, stars, open issue count.',
    inputSchema: { type: 'object', properties: { repo: repoProp }, required: ['repo'] },
    kind: 'read',
    check: (a, s) => repoIn(str(a, 'repo'), s),
    async run(a, c) {
      const d = (await api(c, 'GET', `${API}/repos/${str(a, 'repo')}`, { headers: GH })).data as Record<string, unknown>;
      return {
        ...slim(d, [
          'full_name',
          'description',
          'html_url',
          'default_branch',
          'private',
          'archived',
          'stargazers_count',
          'open_issues_count',
          'language',
          'pushed_at',
        ]),
        license: (d.license as { spdx_id?: string } | null)?.spdx_id ?? null,
      };
    },
  },
  {
    name: 'list_issues',
    description: 'Issues of a repository (pull requests are listed by list_pulls).',
    inputSchema: {
      type: 'object',
      properties: { repo: repoProp, state: { type: 'string', enum: ['open', 'closed', 'all'] }, limit: { type: 'number' } },
      required: ['repo'],
    },
    kind: 'read',
    check: (a, s) => repoIn(str(a, 'repo'), s),
    async run(a, c) {
      const st = a.state === 'closed' || a.state === 'all' ? a.state : 'open';
      const d = (await api(c, 'GET', `${API}/repos/${str(a, 'repo')}/issues?state=${st}&per_page=${lim(a)}`, { headers: GH })).data as Array<
        Record<string, unknown>
      >;
      return d
        .filter((i) => !i.pull_request)
        .map((i) => ({ ...slim(i, ['number', 'title', 'state', 'html_url', 'created_at', 'comments']), author: (i.user as { login?: string } | null)?.login }));
    },
  },
  {
    name: 'get_issue',
    description: 'One issue or pull request with its text and its comments (the first 20).',
    inputSchema: { type: 'object', properties: { repo: repoProp, number: { type: 'number' } }, required: ['repo', 'number'] },
    kind: 'read',
    check: (a, s) => repoIn(str(a, 'repo'), s),
    async run(a, c) {
      const base = `${API}/repos/${str(a, 'repo')}/issues/${num(a)}`;
      const i = (await api(c, 'GET', base, { headers: GH })).data as Record<string, unknown>;
      const cm = (await api(c, 'GET', `${base}/comments?per_page=20`, { headers: GH })).data as Array<Record<string, unknown>>;
      return {
        ...slim(i, ['number', 'title', 'state', 'html_url', 'body', 'created_at']),
        comments: cm.map((x) => ({ author: (x.user as { login?: string } | null)?.login, created_at: x.created_at, body: x.body })),
      };
    },
  },
  {
    name: 'list_pulls',
    description: 'Pull requests of a repository.',
    inputSchema: {
      type: 'object',
      properties: { repo: repoProp, state: { type: 'string', enum: ['open', 'closed', 'all'] }, limit: { type: 'number' } },
      required: ['repo'],
    },
    kind: 'read',
    check: (a, s) => repoIn(str(a, 'repo'), s),
    async run(a, c) {
      const st = a.state === 'closed' || a.state === 'all' ? a.state : 'open';
      const d = (await api(c, 'GET', `${API}/repos/${str(a, 'repo')}/pulls?state=${st}&per_page=${lim(a)}`, { headers: GH })).data as Array<
        Record<string, unknown>
      >;
      return d.map((p) => ({
        ...slim(p, ['number', 'title', 'state', 'html_url', 'draft', 'created_at']),
        author: (p.user as { login?: string } | null)?.login,
      }));
    },
  },
  {
    name: 'get_file',
    description: 'A text file from a repository (up to 200 KB), at a branch, tag or commit.',
    inputSchema: { type: 'object', properties: { repo: repoProp, path: { type: 'string' }, ref: { type: 'string' } }, required: ['repo', 'path'] },
    kind: 'read',
    check: (a, s) => repoIn(str(a, 'repo'), s),
    async run(a, c) {
      const path = str(a, 'path').replace(/^\/+/, '');
      const ref = str(a, 'ref', false);
      const d = (
        await api(
          c,
          'GET',
          `${API}/repos/${str(a, 'repo')}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
          { headers: GH },
        )
      ).data as Record<string, unknown>;
      if (Array.isArray(d))
        return { type: 'dir', entries: (d as Array<Record<string, unknown>>).map((e) => `${e.type === 'dir' ? 'dir ' : 'file'} ${e.path}`) };
      if (d.encoding !== 'base64' || typeof d.content !== 'string') throw new Error('GitHub did not return file text for that path.');
      if (Number(d.size) > 200_000) throw new Error(`${path} is ${d.size} bytes; DEA reads files up to 200 KB.`);
      return { path: d.path, sha: d.sha, text: Buffer.from(d.content, 'base64').toString('utf8') };
    },
  },
  {
    name: 'create_issue',
    description: 'Open a new issue in a repository. Changes things: needs approval in supervised mode.',
    inputSchema: { type: 'object', properties: { repo: repoProp, title: { type: 'string' }, body: { type: 'string' } }, required: ['repo', 'title'] },
    kind: 'write',
    check(a, s) {
      const r = repoIn(str(a, 'repo'), s);
      return r.ok ? { ok: true, where: `${r.where} (new issue "${str(a, 'title').slice(0, 60)}")` } : r;
    },
    async run(a, c) {
      const d = (
        await api(c, 'POST', `${API}/repos/${str(a, 'repo')}/issues`, {
          headers: GH,
          body: { title: str(a, 'title'), ...(a.body ? { body: str(a, 'body') } : {}) },
        })
      ).data as Record<string, unknown>;
      return slim(d, ['number', 'html_url', 'title', 'state']);
    },
  },
  {
    name: 'comment',
    description: 'Add a comment to an issue or pull request. Changes things: needs approval in supervised mode.',
    inputSchema: { type: 'object', properties: { repo: repoProp, number: { type: 'number' }, body: { type: 'string' } }, required: ['repo', 'number', 'body'] },
    kind: 'write',
    check(a, s) {
      const r = repoIn(str(a, 'repo'), s);
      return r.ok ? { ok: true, where: `${r.where} #${num(a)} (comment)` } : r;
    },
    async run(a, c) {
      const d = (await api(c, 'POST', `${API}/repos/${str(a, 'repo')}/issues/${num(a)}/comments`, { headers: GH, body: { body: str(a, 'body') } }))
        .data as Record<string, unknown>;
      return slim(d, ['id', 'html_url', 'created_at']);
    },
  },
];

export const github: Connector = {
  id: 'github',
  title: 'GitHub (REST API, your token)',
  needsToken: true,
  defaultTokenEnv: 'GITHUB_TOKEN',
  scopeHelp: { repos: 'owner/name entries, or owner/* (required)' },
  validateScope(s) {
    for (const r of list(s.repos, 'repos'))
      if (!REPO.test(r) && !/^[A-Za-z0-9_.-]+\/\*$/.test(r)) throw new Error(`scope.repos entry "${r}" must be owner/name or owner/*`);
  },
  tools,
  async probe(c: Ctx) {
    const d = (await api(c, 'GET', `${API}/user`, { headers: GH })).data as { login?: string };
    return `token works for ${d.login ?? 'an account'}`;
  },
};
