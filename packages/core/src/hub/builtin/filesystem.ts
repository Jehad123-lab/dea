import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { BuiltinTool, Connector, Scope, ScopeCheck } from './types.ts';
import { str } from './types.ts';

const MAX_READ = 1_000_000;
const MAX_WRITE = 2_000_000;

/** The declared folder. Everything resolves against it; nothing outside it (dots, absolute paths, links out) is touched. */
async function inside(scope: Scope, p: string, mustExist: boolean): Promise<{ ok: true; abs: string; rel: string } | { ok: false; why: string }> {
  const rootRaw = scope.root;
  if (typeof rootRaw !== 'string' || !isAbsolute(rootRaw)) return { ok: false, why: 'scope.root must be an absolute folder path' };
  const root = await realpath(rootRaw).catch(() => null);
  if (!root) return { ok: false, why: `the scoped folder ${rootRaw} does not exist` };
  if (isAbsolute(p) || p.includes('\0')) return { ok: false, why: 'give a path relative to the scoped folder' };
  const abs = resolve(root, p || '.');
  if (abs !== root && !abs.startsWith(root + sep)) return { ok: false, why: `${p} leaves the scoped folder` };
  // a link inside the folder must not lead out of it: check the real location of the nearest existing part
  let probe = abs;
  for (;;) {
    const real = await realpath(probe).catch(() => null);
    if (real) {
      if (real !== root && !real.startsWith(root + sep)) return { ok: false, why: `${p} resolves outside the scoped folder (through a link)` };
      break;
    }
    const up = dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  if (mustExist && !(await lstat(abs).catch(() => null))) return { ok: false, why: `${p} does not exist` };
  return { ok: true, abs, rel: relative(root, abs).split(sep).join('/') || '.' };
}

const place = async (a: Record<string, unknown>, s: Scope, must: boolean, verb: string): Promise<ScopeCheck> => {
  const r = await inside(s, str(a, 'path', false), must);
  return r.ok ? { ok: true, where: `${verb} ${r.rel} in ${String(s.root)}` } : r;
};

const tools: BuiltinTool[] = [
  {
    name: 'list_dir',
    description: 'List a folder inside the scoped folder (path relative to it; empty = the folder itself).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    kind: 'read',
    check: (a, s) => place(a, s, true, 'list'),
    async run(a, c) {
      const r = await inside(c.scope, str(a, 'path', false), true);
      if (!r.ok) throw new Error(r.why);
      const names = await readdir(r.abs, { withFileTypes: true });
      return names.slice(0, 500).map((d) => `${d.isDirectory() ? 'dir ' : 'file'} ${d.name}`);
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file inside the scoped folder (up to 1 MB).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    kind: 'read',
    check: (a, s) => place(a, s, true, 'read'),
    async run(a, c) {
      const r = await inside(c.scope, str(a, 'path'), true);
      if (!r.ok) throw new Error(r.why);
      const st = await stat(r.abs);
      if (!st.isFile()) throw new Error(`${r.rel} is not a file`);
      if (st.size > MAX_READ) throw new Error(`${r.rel} is ${st.size} bytes; DEA reads files up to 1 MB.`);
      return { path: r.rel, text: await readFile(r.abs, 'utf8') };
    },
  },
  {
    name: 'write_file',
    description:
      'Write a text file inside the scoped folder (up to 2 MB). Refuses to replace an existing file unless overwrite is true. Changes things: needs approval in supervised mode.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, text: { type: 'string' }, overwrite: { type: 'boolean' } },
      required: ['path', 'text'],
    },
    kind: 'write',
    check: (a, s) => place(a, s, false, a.overwrite === true ? 'overwrite' : 'create'),
    async run(a, c) {
      const r = await inside(c.scope, str(a, 'path'), false);
      if (!r.ok) throw new Error(r.why);
      const text = str(a, 'text', false);
      if (Buffer.byteLength(text) > MAX_WRITE) throw new Error('that is more than 2 MB');
      const exists = await lstat(r.abs).catch(() => null);
      if (exists && a.overwrite !== true) throw new Error(`${r.rel} already exists; pass overwrite: true to replace it`);
      if (exists && !exists.isFile()) throw new Error(`${r.rel} is not a file`);
      await mkdir(dirname(r.abs), { recursive: true });
      await writeFile(r.abs, text, { flag: exists ? 'w' : 'wx' });
      return { path: r.rel, bytes: Buffer.byteLength(text), replaced: Boolean(exists) };
    },
  },
];

export const filesystem: Connector = {
  id: 'filesystem',
  title: 'Filesystem (one folder)',
  needsToken: false,
  scopeHelp: { root: 'absolute folder path (required); nothing outside it is read or written' },
  validateScope(s) {
    if (typeof s.root !== 'string' || !isAbsolute(s.root)) throw new Error('scope.root must be an absolute folder path.');
    if (s.root === dirname(s.root) || /^[A-Za-z]:[\\/]?$/.test(s.root)) throw new Error('scope.root cannot be a whole drive; pick a folder.');
  },
  tools,
};
