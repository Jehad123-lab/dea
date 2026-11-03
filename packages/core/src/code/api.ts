import { REDACTED, redactBody, redactUrl } from '../evidence/secrets.ts';
import { type Initiator, initiatorText } from './initiator.ts';

export interface ApiCall {
  method: string;
  url: string;
  status: number;
  requestMime: string;
  requestBody: string | null;
  responseMime: string;
  responseBody: string | null;
  /** header names only; values never reach the spec */
  requestHeaderNames: string[];
  /** "Bearer", "Basic", "cookie", "api-key header", ... read from the live request, value never stored */
  auth: string[];
  /** where in the HAR this came from */
  harIndex: number | null;
  /** the code that asked for it, labelled Verified (seen in a call stack) or Inferred (the URL is written there) */
  initiator: Initiator | null;
}

type Schema = Record<string, any>;

/** JSON Schema (2020-12, as OpenAPI 3.1 uses) for one example value. */
export function inferSchema(v: unknown, depth = 0): Schema {
  if (v === null) return { type: 'null' };
  if (Array.isArray(v)) {
    if (depth > 8) return { type: 'array' };
    let items: Schema | null = null;
    for (const x of v.slice(0, 20)) items = items ? mergeSchema(items, inferSchema(x, depth + 1)) : inferSchema(x, depth + 1);
    return items ? { type: 'array', items } : { type: 'array' };
  }
  switch (typeof v) {
    case 'string':
      return { type: 'string', ...stringFormat(v) };
    case 'number':
      return { type: Number.isInteger(v) ? 'integer' : 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'object': {
      if (depth > 8) return { type: 'object' };
      const props: Record<string, Schema> = {};
      const entries = Object.entries(v as Record<string, unknown>).slice(0, 80);
      for (const [k, x] of entries) props[k] = inferSchema(x, depth + 1);
      return { type: 'object', properties: props, required: entries.map(([k]) => k) };
    }
    default:
      return {};
  }
}

function stringFormat(s: string): Schema {
  if (s === REDACTED) return { description: 'value redacted by DEA' };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return { format: 'date-time' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { format: 'date' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { format: 'uuid' };
  if (/^https?:\/\//.test(s)) return { format: 'uri' };
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) return { format: 'email' };
  return {};
}

/** Merge two schemas seen for the same place: union of properties, required = present in both, types widened. */
export function mergeSchema(a: Schema, b: Schema): Schema {
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  const ta = a.type;
  const tb = b.type;
  if (ta === 'object' && tb === 'object') {
    const props: Record<string, Schema> = { ...(a.properties ?? {}) };
    for (const [k, s] of Object.entries(b.properties ?? {})) props[k] = props[k] ? mergeSchema(props[k], s as Schema) : (s as Schema);
    const req = (a.required ?? []).filter((k: string) => (b.required ?? []).includes(k));
    return { type: 'object', properties: props, ...(req.length ? { required: req } : {}) };
  }
  if (ta === 'array' && tb === 'array')
    return { type: 'array', ...(a.items && b.items ? { items: mergeSchema(a.items, b.items) } : a.items || b.items ? { items: a.items ?? b.items } : {}) };
  if ((ta === 'integer' && tb === 'number') || (ta === 'number' && tb === 'integer')) return { type: 'number' };
  const types = [...new Set([ta, tb].flat().filter(Boolean))];
  if (types.length === 2 && types.includes('null')) {
    const other = ta === 'null' ? b : a;
    return { ...other, type: [other.type, 'null'] };
  }
  return { anyOf: [a, b] };
}

const ID_SEGMENT =
  /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{12,}|[A-Za-z0-9_-]{22,}|v\d+-[A-Za-z0-9]{6,}|[\w.:~-]{20,}|[\w-]*\d[\w-]*:[\w:.-]+|\d+\.\d+[\w:.-]*)$/;

/** /api/posts/123 → /api/posts/{id}; ids, uuids, hashes and long tokens become parameters. */
export function templatePath(path: string): { template: string; params: string[] } {
  const params: string[] = [];
  const parts = path.split('/').map((seg, i, all) => {
    if (!seg || !ID_SEGMENT.test(seg) || /^v\d$/.test(seg)) return seg;
    if (i === 1 && /^\d{1,2}$/.test(seg)) return seg; // /1/indexes/... is an API version, not an id
    const prev = all[i - 1] ?? '';
    const word = /^[a-z][a-z_-]{1,30}$/i.test(prev) && !ID_SEGMENT.test(prev);
    let name = word ? `${prev.replace(/[^a-z0-9]/gi, '').replace(/s$/, '')}Id` : `param${params.length + 1}`;
    while (params.includes(name)) name = `${name}_`;
    params.push(name);
    return `{${name}}`;
  });
  return { template: parts.join('/') || '/', params };
}

const TELEMETRY =
  /(telemetry|cdn-cgi\/challenge-platform|cdn-cgi\/rum|recaptcha|hcaptcha|turnstile|google-analytics|googletagmanager|analytics|vitals|_vercel\/insights|\/insights\/|sentry|segment\.io|mixpanel|hotjar|clarity\.ms|plausible|posthog|doubleclick|facebook\.com\/tr|amplitude|datadog|newrelic|cloudflareinsights|stats\.|\/collect\b|\/beacon)/i;

/** Files code fetches that are content, not API: models, decoders, textures, fonts, media, scripts. */
export function isAssetUrl(url: string, mime = ''): boolean {
  return (
    /\.(glb|gltf|bin|drc|ktx2|basis|hdr|exr|wasm|js|mjs|css|png|jpe?g|webp|avif|gif|svg|woff2?|ttf|otf|mp4|webm|mp3|ogg|wav|m4a|usdz|fbx|obj|ply|splat|riv|lottie)(\?|$)/i.test(
      url,
    ) || /^(image|video|audio|font)\/|model\/|wasm|octet-stream/i.test(mime)
  );
}

export function isTelemetry(url: string): boolean {
  return TELEMETRY.test(url);
}

/** Is this request an API call (data), rather than a page asset? */
export function isApiCall(c: { method: string; url: string; responseMime: string; resourceType?: string }): boolean {
  if (!/^https?:/.test(c.url)) return false;
  if (c.resourceType && /^(fetch|xhr|eventsource|websocket)$/.test(c.resourceType)) return true;
  if (/json|graphql|x-ndjson|protobuf|grpc|event-stream/i.test(c.responseMime)) return true;
  if (c.method !== 'GET' && c.method !== 'HEAD' && c.method !== 'OPTIONS') return true;
  return (
    /\/(api|graphql|gql|v\d+|rest|query|rpc|trpc)(\/|\?|$)/i.test(c.url) &&
    !/\.(js|css|png|jpe?g|webp|avif|svg|woff2?|mp4|glb|gltf|ktx2|hdr)(\?|$)/i.test(c.url)
  );
}

function parseJson(text: string | null): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface ApiSpecResult {
  openapi: Record<string, unknown>;
  endpoints: Array<{
    host: string;
    method: string;
    path: string;
    calls: number;
    statuses: number[];
    telemetry: boolean;
    graphql: string[];
    query: string | null;
    auth: string[];
    initiators: Initiator[];
    example: string;
    responseKeys: string[];
  }>;
}

/** Build an OpenAPI 3.1 document from observed calls. Everything secret is already redacted; examples are redacted again. */
export function buildOpenApi(calls: ApiCall[], info: { title: string; site: string }): ApiSpecResult {
  const groups = new Map<string, { host: string; method: string; template: string; params: string[]; calls: ApiCall[] }>();
  for (const c of calls) {
    let u: URL;
    try {
      u = new URL(c.url);
    } catch {
      continue;
    }
    const { template, params } = templatePath(u.pathname);
    const key = `${u.origin} ${c.method} ${template}`;
    const g = groups.get(key) ?? { host: u.origin, method: c.method.toUpperCase(), template, params, calls: [] };
    g.calls.push(c);
    groups.set(key, g);
  }
  const hosts = [...new Set([...groups.values()].map((g) => g.host))];
  const paths: Record<string, any> = {};
  const securitySchemes: Record<string, any> = {};
  const endpoints: ApiSpecResult['endpoints'] = [];
  for (const g of groups.values()) {
    const pathKey = hosts.length > 1 ? `${g.template}${g.template.includes('#') ? '' : ''}` : g.template;
    // OpenAPI paths are host-free; when several hosts share a path, keep them apart with a host suffix comment in summary
    let key = pathKey;
    while (paths[key]?.[g.method.toLowerCase()] && paths[key].servers?.[0]?.url !== g.host) key = `${key}#${new URL(g.host).hostname}`;
    const item = (paths[key] ??= { servers: [{ url: g.host }] });
    const qp = new Map<string, string>();
    const statuses = new Set<number>();
    let reqSchema: Schema | null = null;
    let reqExample: unknown;
    const resSchemas = new Map<string, Schema>();
    const resExamples = new Map<string, unknown>();
    const auth = new Set<string>();
    const graphql = new Set<string>();
    let groq: string | null = null;
    const initiators = new Map<string, Initiator>();
    for (const c of g.calls) {
      const u = new URL(redactUrl(c.url));
      for (const [k, v] of u.searchParams) if (!qp.has(k)) qp.set(k, v.slice(0, 200));
      const gq = u.searchParams.get('query');
      if (gq && /\*\[|_type|groq/.test(gq)) groq = gq.slice(0, 1200);
      statuses.add(c.status);
      for (const a of c.auth) auth.add(a);
      if (c.initiator && !initiators.has(c.initiator.where)) initiators.set(c.initiator.where, c.initiator);
      const reqJson = parseJson(c.requestBody ? redactBody(c.requestBody, c.requestMime) : null);
      if (reqJson !== undefined) {
        reqSchema = reqSchema ? mergeSchema(reqSchema, inferSchema(reqJson)) : inferSchema(reqJson);
        reqExample ??= reqJson;
        const op = reqJson as { query?: string; operationName?: string };
        if (op && typeof op.query === 'string') {
          const m = /(query|mutation|subscription)\s+(\w+)/.exec(op.query);
          graphql.add(op.operationName || m?.[2] || `${m?.[1] ?? 'query'} (anonymous)`);
        }
      }
      const resJson = parseJson(c.responseBody ? redactBody(c.responseBody, c.responseMime) : null);
      const code = String(c.status || 'default');
      if (resJson !== undefined) {
        resSchemas.set(code, resSchemas.has(code) ? mergeSchema(resSchemas.get(code) as Schema, inferSchema(resJson)) : inferSchema(resJson));
        if (!resExamples.has(code)) resExamples.set(code, trimExample(resJson));
      } else if (!resSchemas.has(code)) resSchemas.set(code, {});
    }
    const security: Array<Record<string, string[]>> = [];
    for (const a of auth) {
      const name =
        a === 'Bearer'
          ? 'bearerAuth'
          : a === 'Basic'
            ? 'basicAuth'
            : a.startsWith('cookie')
              ? 'cookieAuth'
              : a.startsWith('header ')
                ? `apiKey_${a.slice(7)}`
                : a.startsWith('query ')
                  ? `apiKeyQuery_${a.slice(6)}`
                  : 'otherAuth';
      securitySchemes[name] ??=
        a === 'Bearer'
          ? { type: 'http', scheme: 'bearer', description: 'Seen on live requests; the token itself is never saved.' }
          : a === 'Basic'
            ? { type: 'http', scheme: 'basic' }
            : a.startsWith('cookie')
              ? { type: 'apiKey', in: 'cookie', name: a.slice(7) || 'session', description: 'A cookie was sent; its value is never saved.' }
              : a.startsWith('header ')
                ? { type: 'apiKey', in: 'header', name: a.slice(7) }
                : a.startsWith('query ')
                  ? { type: 'apiKey', in: 'query', name: a.slice(6) }
                  : { type: 'http', scheme: 'unknown' };
      security.push({ [name]: [] });
    }
    const sample = g.calls[0];
    const op: Record<string, any> = {
      summary: `${g.method} ${g.template}${graphql.size ? ` (GraphQL: ${[...graphql].slice(0, 4).join(', ')})` : ''}`,
      description: [
        `Seen ${g.calls.length}× while DEA loaded ${info.site}.`,
        isTelemetry(sample.url) ? 'This looks like analytics/telemetry, not app data.' : '',
        groq ? `Sanity GROQ query: ${groq}` : '',
        initiators.size
          ? `Called from: ${[...initiators.values()]
              .slice(0, 3)
              .map((x) => `${initiatorText(x)}, ${x.how}`)
              .join('; ')}`
          : 'Called from: Unknown (no call stack and the URL is not written in any script DEA read)',
      ]
        .filter(Boolean)
        .join('\n\n'),
      tags: [isTelemetry(sample.url) ? 'telemetry' : new URL(g.host).hostname],
      parameters: [
        ...g.params.map((p) => ({ name: p, in: 'path', required: true, schema: { type: 'string' } })),
        ...[...qp].map(([name, ex]) => ({
          name,
          in: 'query',
          required: g.calls.every((c) => new URL(c.url).searchParams.has(name)),
          schema: { type: /^-?\d+$/.test(ex) ? 'integer' : 'string' },
          example: ex,
        })),
      ],
      responses: Object.fromEntries(
        [...resSchemas].map(([code, schema]) => [
          code,
          {
            description: `HTTP ${code}`,
            ...(Object.keys(schema).length
              ? {
                  content: {
                    [sample.responseMime.split(';')[0] || 'application/json']: { schema, ...(resExamples.has(code) ? { example: resExamples.get(code) } : {}) },
                  },
                }
              : {}),
          },
        ]),
      ),
      ...(security.length ? { security } : {}),
    };
    if (reqSchema)
      op.requestBody = { content: { [sample.requestMime.split(';')[0] || 'application/json']: { schema: reqSchema, example: trimExample(reqExample) } } };
    if (!op.parameters.length) delete op.parameters;
    item[g.method.toLowerCase()] = op;
    const top = resExamples.values().next().value as unknown;
    endpoints.push({
      host: g.host,
      method: g.method,
      path: g.template,
      calls: g.calls.length,
      statuses: [...statuses],
      telemetry: isTelemetry(sample.url),
      graphql: [...graphql],
      query: groq,
      auth: [...auth],
      initiators: [...initiators.values()].sort((a, b) => Number(a.label === 'Inferred') - Number(b.label === 'Inferred')),
      example: redactUrl(sample.url),
      responseKeys: top && typeof top === 'object' && !Array.isArray(top) ? Object.keys(top as object).slice(0, 12) : [],
    });
  }
  endpoints.sort((a, b) => Number(a.telemetry) - Number(b.telemetry) || b.calls - a.calls);
  return {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: `${info.title || info.site} (observed API)`,
        version: 'observed',
        description: `Reconstructed by DEA from live traffic on ${info.site}. Only calls DEA saw are listed; secrets are redacted.`,
      },
      servers: hosts.map((url) => ({ url })),
      paths,
      ...(Object.keys(securitySchemes).length ? { components: { securitySchemes } } : {}),
    },
    endpoints,
  };
}

function trimExample(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.slice(0, 2).map((x) => trimExample(x, depth + 1));
  if (v && typeof v === 'object') {
    if (depth > 5) return '…';
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .slice(0, 25)
        .map(([k, x]) => [k, trimExample(x, depth + 1)]),
    );
  }
  return typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v;
}
