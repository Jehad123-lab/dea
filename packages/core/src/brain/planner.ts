import type { InvestigationPlan, PlanStep, StepKind } from './types.ts';

/** Goal words → the steps that answer them. Order in the final plan follows STEP_ORDER, not this table. */
const RULES: Array<[StepKind, RegExp, string]> = [
  ['stack', /\b(stack|built|framework|tech(nolog(y|ies))?|library|libraries|cms|hosting|host(ed)?|version|tools?|uses?)\b/i, 'what it is built with'],
  [
    'design',
    /\b(design|font|fonts|typograph\w*|type ?scale|colou?rs?|palette|look|style|brand|spacing|layout|motion|eas(e|ing)|animation|animate|scroll|webgl|3d|three|shader|visual|aesthetic)\b/i,
    'how it looks and moves',
  ],
  [
    'code',
    /\b(code|how (it|this|does|do)|works?|implement\w*|bundle|source|script|javascript|js|gsap|timeline|shader|uniforms?|rebuild|recreate|clone|copy|reverse|engineer\w*|tear ?down|interaction)\b/i,
    'how the code works',
  ],
  ['api', /\b(api|apis|endpoint\w*|data|backend|graphql|rest|json|requests?|network|calls?|cms|content|fetch\w*|auth)\b/i, 'which APIs feed it'],
  [
    'pages',
    /\b(pages?|site ?map|structure|navigation|nav|sections?|content|copy|text|seo|links?|routes?|whole site|all pages|audit|pricing|blog|products?)\b/i,
    'what the other pages contain',
  ],
];

const STEP_ORDER: StepKind[] = ['stack', 'pages', 'design', 'code', 'api', 'hub'];

const DOES: Record<StepKind, (w?: Record<string, unknown>) => string> = {
  stack: () => 'Detect the stack: frameworks, libraries, versions, hosting, with proof for each.',
  design: () => 'Decode the design: fonts actually rendered, colours, type scale, motion and easing, WebGL scenes and shaders.',
  code: () => 'Decode the code: bundles, source maps or unpacked code, GSAP calls, shader uniforms, listeners, and what feeds each section.',
  api: () => 'Map the APIs the page talks to (OpenAPI 3.1), auth kinds only.',
  pages: (w) => `Read up to ${w?.max ?? 5} internal pages (read-only: look and scroll, nothing typed or submitted) and outline each.`,
  hub: (w) => `Send the finished report to ${String(w?.app)}.${String(w?.tool)} through DEA Hub.`,
};

export interface PlanOptions {
  maxPages?: number;
  /** force these steps, whatever the goal says */
  only?: StepKind[];
  /** after the report: call this hub tool with the report */
  deliver?: { app: string; tool: string; args: Record<string, unknown> };
}

/**
 * DEA's own planner: no model needed. It reads the goal for the questions it asks and picks the steps that answer
 * them; a vague goal ("tell me about this site") gets the full survey.
 */
export function planInvestigation(url: string, goal: string, o: PlanOptions = {}): InvestigationPlan {
  // the site's own address in the goal ("what does gsap.com use") is not a question about GSAP
  const asked = goal.replace(/\b(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?/gi, ' ');
  const picked = new Map<StepKind, string>();
  const reasons: string[] = [];
  if (o.only?.length) for (const k of o.only) picked.set(k, 'asked for');
  else
    for (const [kind, re, what] of RULES) {
      const m = asked.match(re);
      if (m) {
        picked.set(kind, what);
        reasons.push(`"${m[0]}" → ${what}`);
      }
    }
  if (!picked.size) {
    for (const k of ['stack', 'pages', 'design', 'code'] as StepKind[]) picked.set(k, 'general survey');
    reasons.push('no specific question in the goal → a general survey (stack, pages, design, code)');
  }
  // every answer is better with the stack known, and code reading needs nothing else
  if (!picked.has('stack')) {
    picked.set('stack', 'context for every other answer');
    reasons.push('stack added: it frames every other answer');
  }
  if (o.deliver) picked.set('hub', 'deliver the report');
  const steps: PlanStep[] = STEP_ORDER.filter((k) => picked.has(k)).map((kind, i) => {
    const w = kind === 'pages' ? { max: o.maxPages ?? 5 } : kind === 'hub' ? { ...o.deliver } : undefined;
    return { id: `s${i + 1}-${kind}`, kind, does: DOES[kind](w), ...(w ? { with: w } : {}) };
  });
  return { goal, url, by: 'rules', reasons, steps };
}

/** Words of the goal worth matching against facts and links (stop words dropped). */
export function goalTerms(goal: string): string[] {
  const stop = new Set(
    'a an the and or of to in on for with how what which who why is are was were it its this that these those does do did site website page pages me my i you your about tell find out show explain please can could would should from by at as be use uses used using main cover covers built build its they them their there has have get give want know need like also all any some more most into than then out up'.split(
      ' ',
    ),
  );
  return [...new Set(goal.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{1,}/g) ?? [])].filter((w) => !stop.has(w));
}
