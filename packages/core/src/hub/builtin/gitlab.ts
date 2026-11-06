import { api, type BuiltinTool, type Connector, type Ctx, list, type Scope, type ScopeCheck, str } from './types.ts';

/**
 * GitLab, read only. Public projects need no token; a private project needs a token in an environment variable (GITLAB_TOKEN
 * by default, set with --token-env). Only reads: DEA does not change anything on GitLab. The host is gitlab.com unless
 * scope.host names another https GitLab (a self-managed one).
 */
const PROJECT = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/;

const hostOf = (scope: Scope): string => {
  const h = typeof scope.host === 'string' && scope.host ? scope.host : 'gitlab.com';
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(h)) throw new Error(`scope.host "${h}" must be a host name like gitlab.com`);
  return h;
};
const apiOf = (scope: Scope) => `https://${hostOf(scope)}/api/v4`;

/** scope.projects: "group/name" (or "group/sub/name") entries, or "group/*" for everything under a group. */
function projectIn(project: string, scope: Scope): ScopeCheck {
  if (!PROJECT.test(project)) return { ok: false, why: `"${project}" is not group/name` };
  const allowed = list(scope.projects, 'projects').map((p) => p.toLowerCase());
  const p = project.toLowerCase();
  const ok = allowed.some((a) => a === p || (a.endsWith('/*') && p.startsWith(a.slice(0, -1))));
  return ok
    ? { ok: true, where: `gitlab ${hostOf(scope)} ${project}` }
    : { ok: false, why: `${project} is not in this connector's scope (${allowed.join(', ')})` };
}

const pid = (a: Record<string, unknown>) => encodeURIComponent(str(a, 'project'));
const lim = (a: Record<string, unknown>) => Math.min(Math.max(Number(a.limit ?? 20) || 20, 1), 50);
const slim = (x: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in x).map((k) => [k, x[k]]));
const state = (a: Record<string, unknown>, ok: string[]) => (typeof a.state === 'string' && ok.includes(a.state) ? a.state : ok[0]);
const projectProp = { type: 'string', description: 'group/name, inside the connector scope' };

const tools: BuiltinTool[] = [
  {
    name: 'get_project',
    description: 'A project: description, default branch, visibility, stars, last activity.',
    inputSchema: { type: 'object', properties: { project: projectProp }, required: ['project'] },
    kind: 'read',
    check: (a, s) => projectIn(str(a, 'project'), s),
    async run(a, c) {
      const d = (await api(c, 'GET', `${apiOf(c.scope)}/projects/${pid(a)}`)).data as Record<string, unknown>;
      return slim(d, ['path_with_namespace', 'description', 'web_url', 'default_branch', 'visibility', 'star_count', 'forks_count', 'last_activity_at']);
    },
  },
  {
    name: 'list_issues',
    description: 'Issues of a project (state: opened, closed or all).',
    inputSchema: {
      type: 'object',
      properties: { project: projectProp, state: { type: 'string', enum: ['opened', 'closed', 'all'] }, limit: { type: 'number' } },
      required: ['project'],
    },
    kind: 'read',
    check: (a, s) => projectIn(str(a, 'project'), s),
    async run(a, c) {
      const d = (await api(c, 'GET', `${apiOf(c.scope)}/projects/${pid(a)}/issues?state=${state(a, ['opened', 'closed', 'all'])}&per_page=${lim(a)}`))
        .data as Array<Record<string, unknown>>;
      return d.map((i) => ({
        ...slim(i, ['iid', 'title', 'state', 'web_url', 'created_at', 'user_notes_count']),
        author: (i.author as { username?: string } | null)?.username,
      }));
    },
  },
  {
    name: 'list_merge_requests',
    description: 'Merge requests of a project (state: opened, merged, closed or all).',
    inputSchema: {
      type: 'object',
      properties: { project: projectProp, state: { type: 'string', enum: ['opened', 'merged', 'closed', 'all'] }, limit: { type: 'number' } },
      required: ['project'],
    },
    kind: 'read',
    check: (a, s) => projectIn(str(a, 'project'), s),
    async run(a, c) {
      const d = (
        await api(c, 'GET', `${apiOf(c.scope)}/projects/${pid(a)}/merge_requests?state=${state(a, ['opened', 'merged', 'closed', 'all'])}&per_page=${lim(a)}`)
      ).data as Array<Record<string, unknown>>;
      return d.map((m) => ({
        ...slim(m, ['iid', 'title', 'state', 'web_url', 'created_at', 'merged_at', 'draft']),
        author: (m.author as { username?: string } | null)?.username,
      }));
    },
  },
  {
    name: 'get_file',
    description: 'A text file from a project (up to 200 KB), at a branch, tag or commit; a folder path lists its entries.',
    inputSchema: { type: 'object', properties: { project: projectProp, path: { type: 'string' }, ref: { type: 'string' } }, required: ['project', 'path'] },
    kind: 'read',
    check: (a, s) => projectIn(str(a, 'project'), s),
    async run(a, c) {
      const path = str(a, 'path').replace(/^\/+/, '');
      const ref = str(a, 'ref', false);
      const base = `${apiOf(c.scope)}/projects/${pid(a)}`;
      const file = await api(c, 'GET', `${base}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref || 'HEAD')}`).catch((e: Error) => e);
      if (file instanceof Error) {
        if (!/answered 404/.test(file.message)) throw file;
        const tree = (
          await api(c, 'GET', `${base}/repository/tree?path=${encodeURIComponent(path)}&per_page=100${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`)
        ).data as Array<Record<string, unknown>>;
        if (!tree.length) throw file;
        return { type: 'dir', entries: tree.map((e) => `${e.type === 'tree' ? 'dir ' : 'file'} ${e.path}`) };
      }
      const d = file.data as Record<string, unknown>;
      if (d.encoding !== 'base64' || typeof d.content !== 'string') throw new Error('GitLab did not return file text for that path.');
      if (Number(d.size) > 200_000) throw new Error(`${path} is ${d.size} bytes; DEA reads files up to 200 KB.`);
      return { path: d.file_path, ref: d.ref, sha: d.blob_id, text: Buffer.from(d.content, 'base64').toString('utf8') };
    },
  },
];

export const gitlab: Connector = {
  id: 'gitlab',
  title: 'GitLab (read only; public projects need no token)',
  needsToken: false,
  defaultTokenEnv: 'GITLAB_TOKEN',
  scopeHelp: { projects: 'group/name entries, or group/* (required)', host: 'gitlab.com by default; a self-managed GitLab host name' },
  validateScope(s) {
    hostOf(s);
    for (const p of list(s.projects, 'projects'))
      if (!PROJECT.test(p) && !/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\/\*$/.test(p))
        throw new Error(`scope.projects entry "${p}" must be group/name or group/*`);
  },
  tools,
  async probe(c: Ctx) {
    if (!c.token) return 'no token set: public projects can be read; private ones need GITLAB_TOKEN';
    const d = (await api(c, 'GET', `${apiOf(c.scope)}/user`)).data as { username?: string };
    return `token works for ${d.username ?? 'an account'}`;
  },
};
