import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Permission modes. Plan rule: looking and scrolling never ask; submitting always does.
 * The same question is asked by every door (CLI, MCP, the investigator), here, in core.
 */
export type Mode = 'restricted' | 'supervised' | 'delegated';

export type ActionKind =
  | 'read' // inspect, snapshot, screenshot, decode: no change to the page
  | 'navigate' // goto, back, scroll, hover, wait, switch tab
  | 'interact' // click, type, select, press, fill (not a submit)
  | 'upload' // set files on an input, only from the allowed folder
  | 'submit'; // anything that sends data: form submit, buy, post, send

export type Decision = 'allow' | 'ask' | 'deny';

export const MODES: readonly Mode[] = ['restricted', 'supervised', 'delegated'];

const TABLE: Record<Mode, Record<ActionKind, Decision>> = {
  restricted: { read: 'allow', navigate: 'allow', interact: 'deny', upload: 'deny', submit: 'deny' },
  supervised: { read: 'allow', navigate: 'allow', interact: 'allow', upload: 'ask', submit: 'ask' },
  delegated: { read: 'allow', navigate: 'allow', interact: 'allow', upload: 'allow', submit: 'ask' },
};

/** What DEA may do with an action in a mode. Submits always ask, in every mode that allows them at all. */
export function decide(mode: Mode, action: ActionKind): Decision {
  return TABLE[mode][action];
}

/** Words that make a click a submit, whatever the element claims to be. */
const SUBMIT_WORDS =
  /\b(submit|send|pay|buy|order|checkout|purchase|confirm|sign ?up|sign ?in|log ?in|register|subscribe|delete|remove|post|publish|book|reserve|transfer|donate|place order)\b/i;

export function looksLikeSubmit(target: { role?: string; type?: string; name?: string; text?: string }): boolean {
  if (target.type && /^(submit|image)$/i.test(target.type)) return true;
  return SUBMIT_WORDS.test(`${target.name ?? ''} ${target.text ?? ''}`);
}

/** Hosts whose POSTs are tracking beacons, not changes the person would care about. */
const ANALYTICS_HOSTS =
  /(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com|doubleclick\.net|segment\.(io|com)|sentry\.io|posthog\.com|plausible\.io|hotjar\.(com|io)|clarity\.ms|mixpanel\.com|amplitude\.com|vercel-insights\.com|cloudflareinsights\.com)$/i;

/**
 * A request that changes something on a server: a non-GET sent by a script or a form, not a tracking beacon.
 * A click that only "looks" harmless can still send one (a div with a handler, a renamed button), so the hands
 * stop these during plain interact actions and turn the action into a question.
 */
export function isMutatingRequest(req: { method: string; resourceType: string; url: string }): boolean {
  if (/^(GET|HEAD|OPTIONS)$/i.test(req.method)) return false;
  if (!/^(fetch|xhr|document|other)$/i.test(req.resourceType)) return false;
  let host: string;
  try {
    const u = new URL(req.url);
    if (!/^https?:$/.test(u.protocol)) return false;
    host = u.hostname;
  } catch {
    return false;
  }
  return !ANALYTICS_HOSTS.test(host);
}

/** Paths and queries that change something just by being opened: logout, delete, unsubscribe and the like. */
const RISKY_LINK =
  /\/(log-?out|sign-?out|delete|remove|destroy|unsubscribe|deactivate|cancel-?(subscription|account|order))(\/|$)|[?&](action|do|op)=(delete|remove|destroy|logout|signout|unsubscribe|cancel)\b/i;

/**
 * Opening this URL may change something on the site (a GET with a side effect). A plain goto is a look; one of these
 * is treated like a submit and asks first.
 */
export function riskyUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return RISKY_LINK.test(`${u.pathname}${u.search}`);
  } catch {
    return false;
  }
}

/** A field DEA never types into: passwords, one-time codes, card numbers. Secrets do not pass through DEA. */
export function isSecretField(f: { type?: string; name?: string; autocomplete?: string; id?: string; label?: string }): boolean {
  if (f.type && /^password$/i.test(f.type)) return true;
  if (f.autocomplete && /(password|one-time-code|cc-|card)/i.test(f.autocomplete)) return true;
  return /\b(pass(word|wd)?|pwd|otp|one.?time|2fa|cvv|cvc|card.?num(ber)?|cc.?num|iban|ssn|pin)\b/i.test(
    `${f.name ?? ''} ${f.id ?? ''} ${f.label ?? ''}`.replace(/[_-]/g, ' '),
  );
}

/** What a form looks like, enough to know whether it is a login or a payment. */
export interface FormInfo {
  action?: string;
  method?: string;
  fields: Array<{ type?: string; name?: string; autocomplete?: string; id?: string; label?: string }>;
}

/** Logins and payments are never submitted by DEA, in any mode, with or without an OK. */
export function sensitiveForm(form: FormInfo | null): 'login' | 'payment' | null {
  if (!form) return null;
  const all = form.fields;
  if (
    all.some(
      (f) =>
        /^cc-/i.test(f.autocomplete ?? '') ||
        /\b(cvv|cvc|card.?num(ber)?|cc.?num|expiry|iban)\b/i.test(`${f.name ?? ''} ${f.id ?? ''} ${f.label ?? ''}`.replace(/[_-]/g, ' ')),
    )
  )
    return 'payment';
  if (all.some((f) => /^password$/i.test(f.type ?? '') || /(current-password|new-password|one-time-code)/i.test(f.autocomplete ?? ''))) return 'login';
  if (/(login|signin|sign-in|session|auth|checkout|payment|pay\b)/i.test(form.action ?? ''))
    return /checkout|pay/i.test(form.action ?? '') ? 'payment' : 'login';
  return null;
}

/** The policy file, `.dea/policy.json`. Every field is optional. */
export interface PolicyFile {
  /** restricted (look only), supervised (default: click and type, submits ask), delegated (uploads allowed too, submits still ask) */
  mode?: Mode;
  /** hosts DEA may open; "*.example.com" matches subdomains; empty or missing = any host */
  allowedDomains?: string[];
  /** hosts DEA must never open, checked before allowedDomains */
  blockedDomains?: string[];
  /** action names ("type", "click", "select", "upload", "submit", ...) or kinds ("interact") that are always denied */
  blockedActions?: string[];
  /** stop a session after this many actions (default 500) */
  maxActions?: number;
}

export interface Policy {
  mode: Mode;
  allowedDomains: string[];
  blockedDomains: string[];
  blockedActions: string[];
  maxActions: number;
  /** where the policy came from, for the evidence log */
  source: string;
}

export const DEFAULT_POLICY: Policy = {
  mode: 'supervised',
  allowedDomains: [],
  blockedDomains: [],
  blockedActions: [],
  maxActions: 500,
  source: 'built-in default (supervised)',
};

/** Validate a parsed policy file. Unknown keys are refused so a typo never silently loosens anything. */
export function parsePolicy(raw: unknown, source = 'inline'): Policy {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${source}: the policy must be a JSON object`);
  const r = raw as Record<string, unknown>;
  const known = new Set(['mode', 'allowedDomains', 'blockedDomains', 'blockedActions', 'maxActions', '$schema', 'note']);
  for (const k of Object.keys(r)) if (!known.has(k)) throw new Error(`${source}: unknown key "${k}"`);
  const list = (k: string): string[] => {
    const v = r[k];
    if (v == null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`${source}: "${k}" must be a list of strings`);
    return (v as string[]).map((x) => x.trim().toLowerCase()).filter(Boolean);
  };
  const mode = (r.mode ?? DEFAULT_POLICY.mode) as Mode;
  if (!MODES.includes(mode)) throw new Error(`${source}: mode must be one of ${MODES.join(', ')}`);
  const maxActions = r.maxActions == null ? DEFAULT_POLICY.maxActions : Number(r.maxActions);
  if (!Number.isInteger(maxActions) || maxActions < 1) throw new Error(`${source}: maxActions must be a positive whole number`);
  return { mode, allowedDomains: list('allowedDomains'), blockedDomains: list('blockedDomains'), blockedActions: list('blockedActions'), maxActions, source };
}

/** Read `<home>/policy.json` (home = .dea or $DEA_HOME). No file = the built-in supervised default. A broken file is an error, never a fallback. */
export function loadPolicy(home: string, override?: { mode?: Mode }): Policy {
  const file = join(home, 'policy.json');
  let text: string | null = null;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    text = null;
  }
  let policy: Policy = { ...DEFAULT_POLICY };
  if (text != null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`${file} is not valid JSON: ${(e as Error).message}`);
    }
    policy = parsePolicy(parsed, file);
  }
  if (override?.mode) policy = { ...policy, mode: override.mode, source: `${policy.source}, mode set to ${override.mode} on the command line` };
  return policy;
}

function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase();
  if (p === '*') return true;
  if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(p.slice(1));
  return h === p || h === `www.${p}`;
}

/** May DEA open this URL under this policy? */
export function domainAllowed(policy: Policy, url: string): { ok: boolean; reason?: string } {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol === 'about:' || u.protocol === 'data:') return { ok: true };
    if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: `only http and https pages can be opened (got ${u.protocol})` };
    host = u.hostname;
  } catch {
    return { ok: false, reason: `not a URL: ${url}` };
  }
  if (policy.blockedDomains.some((p) => hostMatches(host, p))) return { ok: false, reason: `${host} is in blockedDomains` };
  if (policy.allowedDomains.length && !policy.allowedDomains.some((p) => hostMatches(host, p)))
    return { ok: false, reason: `${host} is not in allowedDomains (${policy.allowedDomains.join(', ')})` };
  return { ok: true };
}

export interface ActionRequest {
  /** the verb as the user said it: goto, click, type, fill, select, hover, scroll, screenshot, back, submit, upload, ... */
  action: string;
  kind: ActionKind;
  /** where the action happens (the page URL, or the target of a goto) */
  url?: string;
  /** set when the user (not the agent) has already said yes to exactly this action */
  confirmed?: boolean;
  /** a login or payment form is involved */
  sensitive?: 'login' | 'payment' | null;
  /** typing into a password / code / card field */
  secretField?: boolean;
  /** how many actions this session already took */
  count?: number;
  /** the session runs on a DEA browser profile the person logged in with by hand: its pages may be signed in */
  profile?: boolean;
}

export interface Verdict {
  decision: Decision;
  reason: string;
}

/** The one gate. Order: hard rules, blocked actions, domains, the mode table, then the user's OK for submits. */
export function checkAction(policy: Policy, req: ActionRequest): Verdict {
  if (req.secretField)
    return { decision: 'deny', reason: 'DEA never types passwords, one-time codes or card numbers. Type those yourself in the browser window (--headed).' };
  if (req.kind === 'submit' && req.sensitive)
    return {
      decision: 'deny',
      reason: `This is a ${req.sensitive} form. DEA never submits logins or payments, in any mode; do it yourself in the browser window.`,
    };
  if (req.count != null && req.count >= policy.maxActions) return { decision: 'deny', reason: `this session reached maxActions (${policy.maxActions})` };
  const blocked = policy.blockedActions;
  if (blocked.includes(req.action.toLowerCase()) || blocked.includes(req.kind)) return { decision: 'deny', reason: `"${req.action}" is in blockedActions` };
  if (req.url) {
    const d = domainAllowed(policy, req.url);
    if (!d.ok) return { decision: 'deny', reason: d.reason ?? 'domain not allowed' };
  }
  let base = decide(policy.mode, req.kind);
  // a profile carries the person's logins: a change to a page (typing, a click, a selection) asks first in supervised mode, on every
  // site, because DEA cannot tell which pages are signed in. Looking, scrolling and opening pages stay free.
  const profileAsk = Boolean(req.profile) && policy.mode === 'supervised' && req.kind === 'interact';
  if (profileAsk) base = 'ask';
  if (base === 'deny') return { decision: 'deny', reason: `${policy.mode} mode does not allow ${req.kind} actions (${req.action})` };
  if (base === 'ask') {
    if (req.confirmed) return { decision: 'allow', reason: `${req.action} confirmed by the user` };
    return {
      decision: 'ask',
      reason: profileAsk
        ? `${req.action} changes a page in your DEA browser profile, which may be signed in, so it needs your explicit OK (${policy.mode} mode)`
        : `${req.action} sends data, so it needs your explicit OK (${policy.mode} mode)`,
    };
  }
  return { decision: 'allow', reason: `${policy.mode} mode allows ${req.kind}` };
}
