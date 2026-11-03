/**
 * Secret stripping. Nothing that looks like a credential may reach a run folder.
 * Applied to HAR files before they are written and to any text DEA saves.
 */

export const REDACTED = '[redacted by dea]';

const SECRET_HEADER =
  /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|csrf-token|x-amz-security-token|x-goog-api-key|x-firebase-appcheck|x-vercel-protection-bypass)$/i;
/** long names: a substring match is safe ("x-session-id", "refreshToken") */
const SECRET_NAME_LONG =
  /(password|passwd|secret|token|api[-_]?key|apikey|session|credential|signature|private[-_]?key|access[-_]?key|cookie|csrf|xsrf|bearer|jwt|code_verifier|authorization)/i;
/** short names: only as a whole word or segment ("auth", "x-sig"), never inside "author" or "outside" */
const SECRET_NAME_SHORT = /(^|[-_.[])(pass|pwd|auth|sid|sig|otp|jsessionid|phpsessid)($|[-_.\]])/i;
const SECRET_NAME = { test: (n: string) => SECRET_NAME_LONG.test(n) || SECRET_NAME_SHORT.test(n) };
/** query parameters that are signatures or keys even though their names are short or odd */
const SECRET_QUERY =
  /^(key|code|sig|signature|token|access_token|id_token|refresh_token|auth|x-goog-signature|x-goog-credential|x-amz-signature|x-amz-credential|x-amz-security-token|awsaccesskeyid|se|sp|sv|st)$/i;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const LONG_KEYS = /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g;

export function isSecretHeader(name: string): boolean {
  if (name.startsWith(':')) return false; // HTTP/2 pseudo-headers (:authority, :path)
  return SECRET_HEADER.test(name) || (SECRET_NAME.test(name) && !/^(content|accept|cache|sec-fetch|access-control)/i.test(name));
}

export function isSecretParam(name: string): boolean {
  return SECRET_QUERY.test(name) || SECRET_NAME.test(name);
}

/** Redact secret-looking values inside free text (JWTs, bearer tokens, well-known key shapes). */
export function redactText(text: string): string {
  return text.replace(JWT, REDACTED).replace(BEARER, `$1 ${REDACTED}`).replace(LONG_KEYS, REDACTED);
}

/** Redact secret query parameters in a URL. Leaves the URL readable. */
export function redactUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return redactText(url);
  }
  if (u.username || u.password) {
    u.username = u.username ? 'user' : '';
    u.password = u.password ? 'redacted' : '';
  }
  let changed = false;
  for (const name of [...u.searchParams.keys()]) {
    if (isSecretParam(name)) {
      u.searchParams.set(name, REDACTED);
      changed = true;
    }
  }
  const out = changed || u.username ? u.toString() : url;
  return redactText(out);
}

type NameValue = { name: string; value: string; [k: string]: unknown };

function redactPairs(list: NameValue[] | undefined, test: (n: string) => boolean): void {
  if (!Array.isArray(list)) return;
  for (const p of list) {
    if (test(p.name)) p.value = REDACTED;
    else if (typeof p.value === 'string') p.value = redactText(p.value);
  }
}

function redactJsonValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactJsonValue);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = isSecretParam(k) ? REDACTED : redactJsonValue(val);
    return o;
  }
  return typeof v === 'string' ? redactText(v) : v;
}

/** Redact a request/response body: JSON keys, form fields, and token shapes. */
export function redactBody(text: string, mimeType = ''): string {
  if (!text) return text;
  if (/json/i.test(mimeType) || /^\s*[{[]/.test(text)) {
    try {
      return JSON.stringify(redactJsonValue(JSON.parse(text)));
    } catch {
      /* not JSON, fall through */
    }
  }
  if (/x-www-form-urlencoded/i.test(mimeType) || /^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(text)) {
    const params = new URLSearchParams(text);
    for (const k of [...params.keys()]) if (isSecretParam(k)) params.set(k, REDACTED);
    return redactText(params.toString());
  }
  return redactText(text);
}

// Minimal HAR shape: only the fields DEA touches.
export interface Har {
  log: {
    entries: Array<{
      request: {
        url: string;
        headers?: NameValue[];
        cookies?: NameValue[];
        queryString?: NameValue[];
        postData?: { mimeType?: string; text?: string; params?: NameValue[] };
        [k: string]: unknown;
      };
      response: {
        headers?: NameValue[];
        cookies?: NameValue[];
        redirectURL?: string;
        content?: { mimeType?: string; text?: string; [k: string]: unknown };
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }>;
    pages?: Array<{ title?: string; [k: string]: unknown }>;
    [k: string]: unknown;
  };
}

/** Strip cookies, auth headers, tokens and signed-URL parameters from a HAR, in place. Returns how many values were redacted. */
export function stripHar(har: Har): { har: Har; redactions: number } {
  let before = 0;
  const count = (s: string) => (s.match(/\[redacted by dea\]/g) ?? []).length;
  before = count(JSON.stringify(har));
  for (const e of har.log?.entries ?? []) {
    const req = e.request;
    req.url = redactUrl(req.url);
    redactPairs(req.headers, isSecretHeader);
    redactPairs(req.cookies, () => true);
    redactPairs(req.queryString, isSecretParam);
    if (req.postData) {
      if (req.postData.text) req.postData.text = redactBody(req.postData.text, req.postData.mimeType);
      redactPairs(req.postData.params, isSecretParam);
    }
    const res = e.response;
    redactPairs(res.headers, isSecretHeader);
    redactPairs(res.cookies, () => true);
    if (res.redirectURL) res.redirectURL = redactUrl(res.redirectURL);
    if (res.content?.text && /json|text|javascript|xml|html/i.test(res.content.mimeType ?? '')) {
      res.content.text = redactBody(res.content.text, res.content.mimeType);
    }
    // header values that carry URLs (location, referer) can carry tokens too
    for (const list of [req.headers, res.headers]) {
      for (const h of list ?? []) {
        if (/^(location|referer|content-location|link)$/i.test(h.name) && h.value !== REDACTED) h.value = redactUrl(h.value);
      }
    }
  }
  for (const p of har.log?.pages ?? []) if (typeof p.title === 'string') p.title = redactUrl(p.title);
  return { har, redactions: count(JSON.stringify(har)) - before };
}
