import type { ToolInfo } from '../client.ts';
import type { CallKind } from '../modes.ts';
import type { Redactor } from '../redact.ts';

export type Scope = Record<string, unknown>;
export type FetchLike = typeof fetch;

/** What a connector tool gets when it runs. The token is here and nowhere else: it is read from the environment at call time. */
export interface Ctx {
  token?: string;
  scope: Scope;
  fetch: FetchLike;
  redact: Redactor;
}

export type ScopeCheck = { ok: true; where: string } | { ok: false; why: string };

export interface BuiltinTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** read = looks only; write = changes something (depends on the arguments for tools like http requests) */
  kind: CallKind | ((args: Record<string, unknown>) => CallKind);
  /** is this call inside the connector's declared scope? `where` is the plain-words place it touches, for audit and approval */
  check(args: Record<string, unknown>, scope: Scope): ScopeCheck | Promise<ScopeCheck>;
  run(args: Record<string, unknown>, ctx: Ctx): Promise<unknown>;
}

export interface Connector {
  id: string;
  title: string;
  /** which environment variable holds the token (null = no token needed) */
  needsToken: boolean;
  defaultTokenEnv?: string;
  /** the scope keys this connector reads, for dea hub connectors */
  scopeHelp: Record<string, string>;
  /** throws a plain error when a declared scope is unusable (missing, or wider than allowed) */
  validateScope(scope: Scope): void;
  tools: BuiltinTool[];
  /** a cheap read that proves the token and scope work (dea hub doctor --live) */
  probe?(ctx: Ctx): Promise<string>;
}

export const kindOf = (t: BuiltinTool, args: Record<string, unknown>): CallKind => (typeof t.kind === 'function' ? t.kind(args) : t.kind);

export const toToolInfo = (t: BuiltinTool, args?: Record<string, unknown>): ToolInfo => {
  const write = args ? kindOf(t, args) === 'write' : typeof t.kind === 'function' ? true : t.kind === 'write';
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: write ? { readOnlyHint: false, destructiveHint: true, openWorldHint: true } : { readOnlyHint: true, openWorldHint: true },
  };
};

export const str = (a: Record<string, unknown>, k: string, required = true): string => {
  const v = a[k];
  if (v === undefined || v === null || v === '') {
    if (required) throw new Error(`"${k}" is required.`);
    return '';
  }
  if (typeof v !== 'string') throw new Error(`"${k}" must be text.`);
  return v;
};

export const list = (v: unknown, name: string): string[] => {
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'string' || !x.trim()))
    throw new Error(`scope.${name} must be a non-empty list of text values.`);
  return (v as string[]).map((x) => x.trim());
};

/** A JSON API call with a timeout and a size cap. Errors say what failed without the request headers. */
export async function api(
  ctx: Ctx,
  method: string,
  url: string,
  o: { body?: unknown; headers?: Record<string, string>; maxChars?: number } = {},
): Promise<{ status: number; data: unknown; text: string }> {
  let r: Response;
  try {
    r = await ctx.fetch(url, {
      method,
      headers: {
        'user-agent': 'dea-hub/0.1',
        accept: 'application/json',
        ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(ctx.token ? { authorization: `Bearer ${ctx.token}` } : {}),
        ...o.headers,
      },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(
      ctx.redact.text(`could not reach ${new URL(url).host}: ${(e as Error).name === 'TimeoutError' ? 'no answer within 20 s' : (e as Error).message}`),
    );
  }
  const raw = await r.text();
  const text = raw.length > (o.maxChars ?? 200_000) ? `${raw.slice(0, o.maxChars ?? 200_000)}…` : raw;
  let data: unknown = text;
  try {
    data = JSON.parse(raw);
  } catch {
    /* plain text answer */
  }
  if (!r.ok) {
    const msg = typeof data === 'object' && data && 'message' in data ? String((data as { message: unknown }).message) : text.slice(0, 200);
    throw new Error(ctx.redact.text(`${new URL(url).host} answered ${r.status}: ${msg}`));
  }
  return { status: r.status, data, text };
}
