import { isSecretParam, redactText, redactUrl } from '../evidence/secrets.ts';

/** `?access_token=abc` inside any text: the value goes, the parameter name stays. */
export function hideQuerySecrets(t: string): string {
  return t.replace(/([?&;])([A-Za-z0-9_.-]+)=([^&\s"'#]+)/g, (m, sep: string, name: string) => (isSecretParam(name) ? `${sep}${name}=[hidden]` : m));
}

/**
 * Hides secret values wherever they could leak: results, error messages, audit and history lines. It knows the exact
 * token values a call used (so a service that echoes a token back is covered) and, on top, the generic shapes
 * (JWTs, Bearer headers, ghp_ / sk_ / xox keys, secret URL parameters).
 */
export class Redactor {
  private readonly values: string[] = [];

  constructor(secrets: Array<string | undefined> = []) {
    for (const s of secrets) this.add(s);
  }

  add(s: string | undefined): void {
    if (!s || s.length < 6) return; // a 3-letter "secret" would shred ordinary text; real tokens are longer
    for (const v of [
      s,
      encodeURIComponent(s),
      Buffer.from(s).toString('base64'),
      Buffer.from(`x:${s}`).toString('base64'),
      Buffer.from(`:${s}`).toString('base64'),
    ]) {
      if (v && !this.values.includes(v)) this.values.push(v);
    }
    this.values.sort((a, b) => b.length - a.length);
  }

  text(t: string): string {
    let out = t;
    for (const v of this.values) out = out.split(v).join('[hidden]');
    return hideQuerySecrets(redactText(out));
  }

  url(u: string): string {
    return this.text(redactUrl(u));
  }

  /** Any JSON-ish value, strings redacted at every depth. */
  deep<T>(v: T, depth = 0): T {
    if (typeof v === 'string') return this.text(v) as T;
    if (depth > 8 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => this.deep(x, depth + 1)) as T;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.deep(x, depth + 1)])) as T;
  }
}

/**
 * Is this plausibly the NAME of an environment variable, and not a token someone pasted where the name belongs?
 * Real names are short and word-like; tokens are long, have runs of digits, or match a known key shape.
 */
export function isEnvVarName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(name)) return false;
  if (redactText(name) !== name) return false; // ghp_…, sk_live_…, xoxb-…, JWT shapes
  if ((name.match(/\d/g) ?? []).length >= 7) return false;
  if (/^[a-z0-9]{24,}$/i.test(name) && /[a-z]/.test(name) && /[A-Z]/.test(name) && /\d/.test(name)) return false;
  return true;
}
