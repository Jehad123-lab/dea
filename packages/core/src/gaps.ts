// "Gap → path to result": DEA never stops at Unknown. For what it could not fully decode it writes what it knows, what is
// missing, the best reconstruction it can make now (labelled Inferred), and the exact next probe that would close the
// gap. `dea investigate` reads these probes and runs the ones it is allowed to, then reports what is still open.

/** A decoder the Brain can run as a step to close a gap. */
export type ProbeStep = 'stack' | 'design' | 'code' | 'api' | 'pages' | 'motion' | 'assets';

/** Which area each decoder answers for, so a later, deeper run supersedes an earlier gap. */
export const COVERS: Record<ProbeStep, string[]> = {
  stack: ['stack'],
  design: ['design'],
  code: ['code', 'api'],
  api: ['api'],
  pages: ['pages'],
  motion: ['motion'],
  assets: ['assets'],
};

export interface Gap {
  /** the area this gap belongs to: api, code, design, motion, assets */
  area: string;
  /** one line: what DEA could not fully decode */
  topic: string;
  /** what DEA does know about it, each with its label */
  known: string[];
  /** what is missing, in plain words */
  missing: string;
  /** the best reconstruction DEA can make now; always Inferred */
  approximation?: { text: string; code?: string; lang?: string };
  /** the next probes, best first: a command a person can run, and the decoder the Brain can run itself */
  next: Array<{ why: string; command: string; probe?: ProbeStep }>;
}

const fence = (code: string, lang = '') => `\`\`\`${lang}\n${code.trim()}\n\`\`\``;

/** The markdown section every report ends with when something is still open. Empty string when nothing is. */
export function renderGaps(gaps: Gap[], title = 'Gap → path to result'): string {
  if (!gaps.length) return '';
  const out: string[] = [
    `## ${title}`,
    '',
    'What DEA could not fully decode yet, what it knows anyway, its best reconstruction (Inferred), and the next probe that would close the gap.',
    '',
  ];
  gaps.forEach((g, i) => {
    out.push(`### G${i + 1}. ${g.topic}`, '');
    if (g.known.length) out.push('**Known**', '', ...g.known.map((k) => `- ${k}`), '');
    out.push(`**Missing:** ${g.missing}`, '');
    if (g.approximation) {
      out.push(`**Best reconstruction now (Inferred):** ${g.approximation.text}`, '');
      if (g.approximation.code) out.push(fence(g.approximation.code, g.approximation.lang), '');
    }
    if (g.next.length) out.push('**Next probe**', '', ...g.next.map((n) => `- \`${n.command}\`: ${n.why}`), '');
  });
  return out.join('\n');
}
