import { redactUrl } from '../../evidence/secrets.ts';
import type { BuiltinTool, Connector, Scope, ScopeCheck } from './types.ts';
import { list, str } from './types.ts';

const MAX = 100_000;

/** The request goes to scope.baseUrl + a relative path, never to another host and never above the base path. */
function target(scope: Scope, path: string): { ok: true; url: URL } | { ok: false; why: string } {
  if (typeof scope.baseUrl !== 'string') return { ok: false, why: 'scope.baseUrl is missing' };
  let base: URL;
  try {
    base = new URL(scope.baseUrl);
  } catch {
    return { ok: false, why: 'scope.baseUrl is not a web address' };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return { ok: false, why: 'give a path relative to the base address, not a full address' };
  if (path.split(/[/?#]/)[0].split('/').includes('..') || /%2e%2e/i.test(path) || path.includes('\\'))
    return { ok: false, why: 'paths with .. are not allowed' };
  const basePath = base.pathname.replace(/\/+$/, '');
  const u = new URL(`${base.origin}${basePath}/${path.replace(/^\/+/, '')}`);
  if (u.origin !== base.origin || !(u.pathname === basePath || u.pathname.startsWith(`${basePath}/`)))
    return { ok: false, why: 'that path leaves the base address' };
  return { ok: true, url: u };
}

const methods = (s: Scope) => (Array.isArray(s.methods) ? (s.methods as string[]).map((m) => m.toUpperCase()) : ['GET']);

const mk = (name: string, write: boolean, allowed: string[], description: string): BuiltinTool => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: {
      method: { type: 'string', enum: allowed },
      path: { type: 'string', description: 'relative to the connector base address, e.g. /v1/items?limit=5' },
      body: { description: 'JSON body for writes' },
    },
    required: ['path'],
  },
  kind: write ? 'write' : 'read',
  check(a, s): ScopeCheck {
    const method = String(a.method ?? allowed[0]).toUpperCase();
    if (!allowed.includes(method)) return { ok: false, why: `${method} is not a ${write ? 'changing' : 'read'} method for this tool` };
    if (!methods(s).includes(method)) return { ok: false, why: `${method} is not in this connector's allowed methods (${methods(s).join(', ')})` };
    const t = target(s, str(a, 'path'));
    return t.ok ? { ok: true, where: `http ${method} ${redactUrl(t.url.toString())}` } : t;
  },
  async run(a, c) {
    const method = String(a.method ?? allowed[0]).toUpperCase();
    const t = target(c.scope, str(a, 'path'));
    if (!t.ok) throw new Error(t.why);
    let r: Response;
    try {
      r = await c.fetch(t.url, {
        method,
        redirect: 'manual',
        headers: {
          'user-agent': 'dea-hub/0.1',
          accept: 'application/json, text/*;q=0.8',
          ...(a.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(c.token ? { authorization: `Bearer ${c.token}` } : {}),
        },
        ...(a.body !== undefined && method !== 'GET' && method !== 'HEAD' ? { body: JSON.stringify(a.body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new Error(c.redact.text(`could not reach ${t.url.host}: ${(e as Error).name === 'TimeoutError' ? 'no answer within 20 s' : (e as Error).message}`));
    }
    if (r.status >= 300 && r.status < 400)
      return { status: r.status, note: `redirect to ${c.redact.url(r.headers.get('location') ?? '')} not followed (DEA stays on the base address)` };
    const text = await r.text();
    let body: unknown = text.length > MAX ? `${text.slice(0, MAX)}…` : text;
    try {
      body = JSON.parse(text);
    } catch {
      /* text */
    }
    if (!r.ok)
      throw new Error(
        c.redact.text(`${t.url.host} answered ${r.status}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`),
      );
    return { status: r.status, content_type: r.headers.get('content-type'), body };
  },
});

export const http: Connector = {
  id: 'http',
  title: 'HTTP (one base address)',
  needsToken: false,
  defaultTokenEnv: undefined,
  scopeHelp: {
    baseUrl: 'https address every call stays under (required)',
    methods: 'allowed methods, default GET; add POST, PUT, PATCH, DELETE to allow changes',
  },
  validateScope(s) {
    if (typeof s.baseUrl !== 'string') throw new Error('scope.baseUrl is required.');
    const u = new URL(s.baseUrl);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)))
      throw new Error('scope.baseUrl must be https (http only for localhost).');
    if (u.username || u.password) throw new Error('scope.baseUrl must not contain a user name or password; use the token variable.');
    if (s.methods !== undefined)
      for (const m of list(s.methods, 'methods'))
        if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m.toUpperCase()))
          throw new Error(`scope.methods: ${m} is not an HTTP method DEA allows.`);
  },
  tools: [
    mk('get', false, ['GET', 'HEAD'], 'Read from the connector base address (GET or HEAD).'),
    mk(
      'send',
      true,
      ['POST', 'PUT', 'PATCH', 'DELETE'],
      'Change something at the connector base address (POST, PUT, PATCH, DELETE). Needs approval in supervised mode; the method must be allowed in the connector scope.',
    ),
  ],
};
