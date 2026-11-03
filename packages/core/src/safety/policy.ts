/**
 * Permission modes (Phase 5 builds the hands; the policy lives here from day one so every
 * action door asks the same question). Plan rule: looking and scrolling never ask; submitting always does.
 */
export type Mode = 'restricted' | 'supervised' | 'delegated';

export type ActionKind =
  | 'read' // inspect, snapshot, decode: no change to the page
  | 'navigate' // goto, back, scroll, wait
  | 'interact' // click, type, select, press (not a submit)
  | 'upload' // set files on an input, only from the allowed folder
  | 'submit'; // anything that sends data: form submit, buy, post, send

export type Decision = 'allow' | 'ask' | 'deny';

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
const SUBMIT_WORDS = /\b(submit|send|pay|buy|order|checkout|purchase|confirm|sign ?up|register|subscribe|delete|remove|post|publish|book|reserve|transfer)\b/i;

export function looksLikeSubmit(target: { role?: string; type?: string; name?: string; text?: string }): boolean {
  if (target.type && /^(submit|image)$/i.test(target.type)) return true;
  return SUBMIT_WORDS.test(`${target.name ?? ''} ${target.text ?? ''}`);
}
