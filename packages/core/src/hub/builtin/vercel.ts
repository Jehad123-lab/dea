import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { api, type BuiltinTool, type Connector, type Ctx, list, type Scope, type ScopeCheck, str } from './types.ts';

const API = 'https://api.vercel.com';
const MAX_FILES = 500;
const MAX_BYTES = 20_000_000;
const SKIP = new Set(['node_modules', '.git', '.vercel', '.dea', '.env']);

const team = (s: Scope) => (typeof s.teamId === 'string' && s.teamId ? `teamId=${encodeURIComponent(s.teamId)}` : '');
const q = (s: Scope, extra = '') => {
  const t = [extra, team(s)].filter(Boolean).join('&');
  return t ? `?${t}` : '';
};

function projectIn(name: string, scope: Scope): ScopeCheck {
  const allowed = list(scope.projects, 'projects').map((p) => p.toLowerCase());
  return allowed.includes(name.toLowerCase())
    ? { ok: true, where: `vercel project ${name}` }
    : { ok: false, why: `project "${name}" is not in this connector's scope (${allowed.join(', ')})` };
}

/** Folders a deploy may read from: inside one of scope.dirs. Links and dot-env files are never followed or sent. */
async function dirIn(dir: string, scope: Scope): Promise<{ ok: true; abs: string } | { ok: false; why: string }> {
  if (!isAbsolute(dir)) return { ok: false, why: 'give the folder as an absolute path' };
  const real = await realpath(dir).catch(() => null);
  if (!real) return { ok: false, why: `${dir} does not exist` };
  for (const d of list(scope.dirs, 'dirs')) {
    const root = await realpath(d).catch(() => null);
    if (root && (real === root || real.startsWith(root + sep))) return { ok: true, abs: real };
  }
  return { ok: false, why: `${dir} is not inside this connector's deploy folders (${list(scope.dirs, 'dirs').join(', ')})` };
}

async function collect(root: string): Promise<Array<{ file: string; data: string; size: number }>> {
  const out: Array<{ file: string; data: string; size: number }> = [];
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name.startsWith('.env') || e.isSymbolicLink()) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        const buf = await readFile(p);
        total += buf.length;
        if (out.length >= MAX_FILES) throw new Error(`more than ${MAX_FILES} files; deploy a smaller folder`);
        if (total > MAX_BYTES) throw new Error(`more than ${MAX_BYTES / 1_000_000} MB; deploy a smaller folder`);
        out.push({ file: relative(root, p).split(sep).join('/'), data: buf.toString('base64'), size: buf.length });
      }
    }
  };
  await walk(root);
  return out;
}

const tools: BuiltinTool[] = [
  {
    name: 'list_projects',
    description: 'Your Vercel projects that are inside this connector scope.',
    inputSchema: { type: 'object', properties: {} },
    kind: 'read',
    check: () => ({ ok: true, where: 'vercel projects' }),
    async run(_a, c) {
      const d = (await api(c, 'GET', `${API}/v9/projects${q(c.scope, 'limit=50')}`)).data as {
        projects?: Array<{ name: string; id: string; framework?: string | null; updatedAt?: number }>;
      };
      const allowed = list(c.scope.projects, 'projects').map((p) => p.toLowerCase());
      return (d.projects ?? [])
        .filter((p) => allowed.includes(p.name.toLowerCase()))
        .map((p) => ({ name: p.name, id: p.id, framework: p.framework ?? null, updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null }));
    },
  },
  {
    name: 'list_deployments',
    description: 'Recent deployments of one project in scope.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' }, limit: { type: 'number' } }, required: ['project'] },
    kind: 'read',
    check: (a, s) => projectIn(str(a, 'project'), s),
    async run(a, c) {
      const lim = Math.min(Math.max(Number(a.limit ?? 10) || 10, 1), 30);
      const d = (await api(c, 'GET', `${API}/v6/deployments${q(c.scope, `app=${encodeURIComponent(str(a, 'project'))}&limit=${lim}`)}`)).data as {
        deployments?: Array<{ uid: string; url: string; state?: string; created?: number; target?: string | null }>;
      };
      return (d.deployments ?? []).map((x) => ({
        id: x.uid,
        url: `https://${x.url}`,
        state: x.state,
        target: x.target ?? 'preview',
        created: x.created ? new Date(x.created).toISOString() : null,
      }));
    },
  },
  {
    name: 'deploy_static',
    description:
      'Deploy a folder of static files (index.html, assets) to a Vercel project in scope as a preview deployment. production: true needs the connector scope to allow it. Uploads the folder (not node_modules, .git, .env*) to Vercel. Changes things: needs approval in supervised mode.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        dir: { type: 'string', description: 'absolute folder, inside the connector deploy folders' },
        production: { type: 'boolean' },
      },
      required: ['project', 'dir'],
    },
    kind: 'write',
    async check(a, s): Promise<ScopeCheck> {
      const p = projectIn(str(a, 'project'), s);
      if (!p.ok) return p;
      const d = await dirIn(str(a, 'dir'), s);
      if (!d.ok) return d;
      if (a.production === true && s.allowProduction !== true)
        return { ok: false, why: 'production deploys are not enabled for this connector (scope.allowProduction)' };
      return { ok: true, where: `${p.where} from ${d.abs} (${a.production === true ? 'production' : 'preview'})` };
    },
    async run(a, c: Ctx) {
      const d = await dirIn(str(a, 'dir'), c.scope);
      if (!d.ok) throw new Error(d.why);
      const files = await collect(resolve(d.abs));
      if (!files.length) throw new Error('that folder has no files to deploy');
      if (!(await lstat(join(d.abs, 'index.html')).catch(() => null))) throw new Error('there is no index.html at the top of that folder');
      const project = str(a, 'project');
      const r = (
        await api(c, 'POST', `${API}/v13/deployments${q(c.scope, 'skipAutoDetectionConfirmation=1')}`, {
          body: {
            name: project,
            project,
            files: files.map(({ file, data }) => ({ file, data, encoding: 'base64' })),
            projectSettings: { framework: null },
            ...(a.production === true ? { target: 'production' } : {}),
          },
          maxChars: 50_000,
        })
      ).data as { id?: string; url?: string; readyState?: string; inspectorUrl?: string };
      return {
        id: r.id,
        url: r.url ? `https://${r.url}` : null,
        state: r.readyState,
        inspector: r.inspectorUrl,
        files: files.length,
        target: a.production === true ? 'production' : 'preview',
      };
    },
  },
];

export const vercel: Connector = {
  id: 'vercel',
  title: 'Vercel (REST API, your token): static deploys',
  needsToken: true,
  defaultTokenEnv: 'VERCEL_TOKEN',
  scopeHelp: {
    projects: 'project names it may touch (required)',
    dirs: 'absolute folders a deploy may be read from (required)',
    teamId: 'optional team id',
    allowProduction: 'true to allow production deploys (default: preview only)',
  },
  validateScope(s) {
    list(s.projects, 'projects');
    for (const d of list(s.dirs, 'dirs')) if (!isAbsolute(d)) throw new Error(`scope.dirs entry "${d}" must be an absolute folder path.`);
  },
  tools,
  async probe(c: Ctx) {
    const d = (await api(c, 'GET', `${API}/v2/user`)).data as { user?: { username?: string } };
    return `token works for ${d.user?.username ?? 'an account'}`;
  },
};
