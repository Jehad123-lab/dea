// Who asked for a request? DEA tries, in order, and labels the answer honestly:
//   1. the call stack its fetch/XHR hook saw                       → Verified (the site's own code line)
//   2. Chrome's own initiator stack, async parents included (CDP)   → Verified
//   3. only library frames in that stack                            → Verified that the library sent it; the app caller is unknown
//   4. the HTML parser (a <script>/<link> tag)                      → Verified
//   5. the endpoint's path or host written in a script's text       → Inferred (the string is there; DEA did not see it run)
//   otherwise nothing: the report says Unknown.

export interface CdpFrame {
  functionName: string;
  url: string;
  /** 0-based, as CDP reports it */
  lineNumber: number;
  columnNumber: number;
}

export interface CdpInitiator {
  type: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  frames: CdpFrame[];
}

export interface Initiator {
  /** where, e.g. "main-DTyWc6eg.js:1:20345 (fetchHits)" or "src/api/search.ts:42" */
  where: string;
  label: 'Verified' | 'Inferred';
  /** how DEA knows, in plain words */
  how: string;
}

/** CDP's Network.Initiator → a flat list of frames, the request's own stack first, then its async parents. */
export function flattenInitiator(init: any): CdpInitiator {
  const frames: CdpFrame[] = [];
  let st = init?.stack;
  let guard = 0;
  while (st && guard++ < 12 && frames.length < 60) {
    for (const f of st.callFrames ?? []) if (frames.length < 60) frames.push(f);
    st = st.parent;
  }
  return { type: String(init?.type ?? 'other'), url: init?.url, lineNumber: init?.lineNumber, columnNumber: init?.columnNumber, frames };
}

/** Frames in the "at fn (url:line:col)" shape DEA's stack parser reads (1-based, like Error.stack). */
const CODE_URL = /^(https?:|webpack-internal:|webpack:)/;

export function framesToStack(frames: CdpFrame[]): string[] {
  return frames.filter((f) => CODE_URL.test(f.url)).map((f) => `at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`);
}

const file = (u: string) => {
  const wp = /^webpack-internal:\/\/\/(.+)$/.exec(u);
  if (wp) return `webpack module ${wp[1]}`;
  try {
    const p = new URL(u).pathname.split('/').pop();
    return p || new URL(u).host;
  } catch {
    return u.split('/').pop() || u;
  }
};

/** The literal strings worth searching scripts for: the path up to its first variable-looking segment, then the host. */
export function endpointNeedles(url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const segs = u.pathname.split('/').filter(Boolean);
  const fixed: string[] = [];
  for (const s of segs) {
    if (/^\d+$/.test(s) && fixed.length > 0) break; // ids
    if (/^[0-9a-f-]{16,}$/i.test(s) || s.length > 40) break;
    fixed.push(s);
  }
  const out: string[] = [];
  for (let n = fixed.length; n >= 1; n--) {
    const p = `/${fixed.slice(0, n).join('/')}`;
    if (p.length >= 5) out.push(p);
  }
  out.push(u.host);
  const parts = u.host.split('.');
  if (parts.length > 2) out.push(parts.slice(-2).join('.'));
  return [...new Set(out)];
}

export interface ScriptText {
  url: string;
  source: string;
  role: string;
  libs?: string[];
}

/** First place a script's text contains one of the needles, app code before libraries. 1-based line:col. */
export function findInScripts(scripts: ScriptText[], needles: string[]): { url: string; line: number; col: number; needle: string; role: string } | null {
  const order = [...scripts].sort((a, b) => Number(a.role === 'vendor') - Number(b.role === 'vendor'));
  for (const needle of needles) {
    for (const s of order) {
      if (!s.source || !/^https?:/.test(s.url)) continue;
      const i = s.source.indexOf(needle);
      if (i < 0) continue;
      const before = s.source.slice(0, i);
      const line = before.split('\n').length;
      return { url: s.url, line, col: i - before.lastIndexOf('\n'), needle, role: s.role };
    }
  }
  return null;
}

export interface InitiatorInputs {
  url: string;
  /** stack lines from DEA's fetch/XHR hook */
  hookStack?: string[] | null;
  cdp?: CdpInitiator | null;
  /** DEA's "first frame that is the site's own code" over a stack */
  appSite: (stack: string[]) => { where: string } | null;
  roleOf: (scriptUrl: string) => string | undefined;
  libsOf?: (scriptUrl: string) => string[];
  scripts: ScriptText[];
  pageUrl?: string;
}

export function describeInitiator(i: InitiatorInputs): Initiator | null {
  if (i.hookStack?.length) {
    const a = i.appSite(i.hookStack);
    if (a) return { where: a.where, label: 'Verified', how: 'call stack when the page called fetch/XHR' };
  }
  const frames = i.cdp?.frames ?? [];
  if (frames.length) {
    const a = i.appSite(framesToStack(frames));
    if (a) return { where: a.where, label: 'Verified', how: 'Chrome’s initiator stack (async callers included)' };
    const f = frames.find((x) => CODE_URL.test(x.url));
    if (f) {
      const role = i.roleOf(f.url);
      const libs = i.libsOf?.(f.url) ?? [];
      const own = role && role !== 'vendor' && role !== 'runtime';
      return {
        where: `${file(f.url)}:${f.lineNumber + 1}:${f.columnNumber + 1}${f.functionName ? ` (${f.functionName})` : ''}`,
        label: 'Verified',
        how: own
          ? 'Chrome’s initiator stack (DEA could not map this line to readable code)'
          : `Chrome’s initiator stack shows only library code${libs.length ? ` (${libs.slice(0, 2).join(', ')})` : ''}; the app code that asked is not in the stack`,
      };
    }
  }
  if (i.cdp?.type === 'parser' && i.cdp.url)
    return {
      where: `${file(i.cdp.url)}${i.cdp.lineNumber != null ? `:${i.cdp.lineNumber + 1}` : ''} (HTML)`,
      label: 'Verified',
      how: 'requested by the HTML parser (a tag in the page)',
    };
  if (i.cdp?.type === 'script' && i.cdp.url)
    return {
      where: `${file(i.cdp.url)}${i.cdp.lineNumber != null ? `:${i.cdp.lineNumber + 1}` : ''}`,
      label: 'Verified',
      how: 'Chrome names this script as the initiator',
    };
  const hit = findInScripts(i.scripts, endpointNeedles(i.url));
  if (hit)
    return {
      where: `${file(hit.url)}:${hit.line}:${hit.col}`,
      label: 'Inferred',
      how: `the string "${hit.needle}" is written in this ${hit.role === 'vendor' ? 'library ' : ''}file; DEA did not see the call itself`,
    };
  return null;
}

/** How an initiator reads in a table cell or a sentence. */
export function initiatorText(x: Initiator | null | undefined): string {
  if (!x) return 'Unknown';
  return x.label === 'Verified' ? `${x.where}` : `≈ ${x.where} (Inferred)`;
}

// ------------------------------------------------------------------------------------------------ gaps

/**
 * Endpoints whose caller is still not known after every fallback become gaps: what DEA knows (method, path, status,
 * response shape, auth kind), a fetch call that reproduces the request (Inferred), and the probes that would find the
 * caller.
 */
export function apiGaps(
  endpoints: Array<{
    host: string;
    method: string;
    path: string;
    statuses: number[];
    auth: string[];
    telemetry: boolean;
    responseKeys: string[];
    initiators: Initiator[];
    example: string;
  }>,
  site: string,
  o: { unpacked: boolean },
): import('../gaps.ts').Gap[] {
  return endpoints
    .filter((e) => !e.telemetry && !e.initiators.length)
    .slice(0, 12)
    .map((e) => {
      const host = (() => {
        try {
          return new URL(e.host).host;
        } catch {
          return e.host;
        }
      })();
      const hasBody = !/^(GET|HEAD|DELETE)$/.test(e.method);
      const headers = e.auth.filter((a) => a.startsWith('header ')).map((a) => `    '${a.slice(7)}': process.env.API_KEY, // DEA never saves the value`);
      const code = [
        `const res = await fetch('${e.example || `https://${host}${e.path}`}', {`,
        `  method: '${e.method}',`,
        ...(headers.length || hasBody ? ['  headers: {', ...(hasBody ? [`    'content-type': 'application/json',`] : []), ...headers, '  },'] : []),
        ...(hasBody ? ['  body: JSON.stringify({ /* see the request schema in api/openapi.json */ }),'] : []),
        '});',
        `const data = await res.json(); // keys: ${e.responseKeys.slice(0, 8).join(', ') || 'see api/bodies'}`,
      ].join('\n');
      const next: import('../gaps.ts').Gap['next'] = [];
      if (!o.unpacked)
        next.push({ why: 'unpacks and deobfuscates the app bundles and searches them for this path', command: `dea code ${site}`, probe: 'code' });
      next.push({
        why: 'opens the site in a visible browser so you can do the action that sends this request; DEA logs every request with its call stack',
        command: `dea session start ${site} --headed`,
      });
      return {
        area: 'api',
        topic: `Which code calls ${e.method} ${host}${e.path}`,
        known: [
          `Verified: the page sent ${e.method} ${host}${e.path} (HTTP ${e.statuses.join(', ')})`,
          ...(e.responseKeys.length ? [`Verified: the answer has keys ${e.responseKeys.slice(0, 8).join(', ')}`] : []),
          ...(e.auth.length ? [`Verified: auth kind ${e.auth.join(', ')} (values never saved)`] : []),
        ],
        missing:
          'the line of the site’s code that sends it: no call stack named it (the request may come from a worker, an iframe or code that ran before DEA’s hooks), and the address is not written as one string in any script DEA read',
        approximation: { text: 'a fetch call that sends the same request, from what was observed', code, lang: 'js' },
        next,
      };
    });
}
