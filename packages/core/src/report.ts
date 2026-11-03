import type { RunDoc } from './see/inspect.ts';
import { fmtBytes } from './see/network.ts';
import type { Fact } from './types.ts';

const badge = (l: string) => (l === 'Verified' ? '**Verified**' : l === 'Inferred' ? '*Inferred*' : 'Unknown');

function factLine(f: Fact): string {
  const ev = f.evidence
    .slice(0, 3)
    .map((e) => `\`${e.source}: ${e.pointer}\`${e.excerpt ? ` (${e.excerpt.slice(0, 80)})` : ''}`)
    .join('; ');
  return `- ${badge(f.label)} ${f.claim}${ev ? `  \n  Evidence: ${ev}` : ''}${f.why ? `  \n  Why: ${f.why}` : ''}`;
}

/** The human report for a run. Every claim carries its label and evidence. */
export function renderReport(run: RunDoc): string {
  const m = run.meta;
  const out: string[] = [];
  out.push(`# DEA report: ${m.title || m.finalUrl}`);
  out.push('');
  out.push(`- URL: ${m.finalUrl}${m.finalUrl !== m.url ? ` (asked for ${m.url})` : ''}`);
  out.push(`- Run: \`${m.id}\` (${m.kind}), ${m.startedAt}`);
  out.push(`- Browser: ${m.browser.name} ${m.browser.version}${m.browser.headless ? ', headless' : ''}, viewport ${m.viewport.width}×${m.viewport.height}`);
  if (m.status) out.push(`- HTTP status: ${m.status}`);
  out.push('');
  out.push('Labels: **Verified** = seen in the page or its traffic. *Inferred* = DEA’s reading, with the reason. Unknown = DEA could not tell.');
  out.push('');

  out.push('## Stack');
  out.push('');
  if (!run.stack.length) out.push('Nothing DEA recognises was found. That usually means plain HTML/CSS, or an app bundled without runtime markers.');
  for (const h of run.stack) {
    const ver = h.version ? ` ${h.version}${h.versionLabel !== h.label ? ` (version ${h.versionLabel.toLowerCase()})` : ''}` : '';
    const ev = h.evidence.map((e) => `\`${e.source}: ${e.pointer.slice(0, 140)}\`${e.excerpt ? ` (${e.excerpt.slice(0, 80)})` : ''}`).join('; ');
    out.push(`- ${badge(h.label)} ${h.name}${ver} — ${h.category}  \n  Evidence: ${ev}${h.why ? `  \n  Why: ${h.why}` : ''}`);
  }
  out.push('');

  const g = run.webgl;
  if (g.contexts.length || g.shaderCount) {
    out.push('## WebGL');
    out.push('');
    for (const f of run.facts.filter((x) => x.key.startsWith('webgl.'))) out.push(factLine(f));
    if (g.rafCalls) out.push(`- **Verified** requestAnimationFrame was called ${g.rafCalls} times while DEA watched (a render loop).`);
    out.push('');
  }

  out.push('## Network');
  out.push('');
  const n = run.network;
  out.push(`- **Verified** ${n.requests} requests, ${fmtBytes(n.bytes)} transferred, ${n.failed} failed. Source: \`network.har\`.`);
  if (n.redactions) out.push(`- ${n.redactions} secret values (cookies, auth headers, tokens) were redacted before saving.`);
  const kinds = Object.entries(n.byKind).sort((a, b) => b[1].bytes - a[1].bytes);
  if (kinds.length) {
    out.push('');
    out.push('| Kind | Requests | Size |');
    out.push('|---|---:|---:|');
    for (const [k, v] of kinds) out.push(`| ${k} | ${v.count} | ${fmtBytes(v.bytes)} |`);
  }
  if (n.largest.length) {
    out.push('');
    out.push('Largest files:');
    for (const e of n.largest.slice(0, 8)) out.push(`- ${fmtBytes(e.bytes)} ${e.kind} \`${e.url.slice(0, 120)}\` (HAR entry ${e.i})`);
  }
  if (n.models.length) {
    out.push('');
    out.push('3D models and textures:');
    for (const e of n.models.slice(0, 12)) out.push(`- ${fmtBytes(e.bytes)} \`${e.url.slice(0, 120)}\``);
  }
  if (n.hosts.length) {
    out.push('');
    out.push(`Hosts: ${n.hosts.slice(0, 10).map((h) => `${h.host} (${h.count}${h.firstParty ? ', first party' : ''})`).join(', ')}`);
  }
  const hdr = Object.entries(n.documentHeaders).filter(([k]) => k !== 'content-security-policy');
  if (hdr.length) {
    out.push('');
    out.push(`Document headers: ${hdr.map(([k, v]) => `\`${k}: ${v.slice(0, 60)}\``).join(', ')}`);
  }
  out.push('');

  out.push('## Page');
  out.push('');
  const p = run.page;
  out.push(`- Language: ${p.lang || 'not set'}; ${p.counts.elements} elements, ${p.counts.images} images, ${p.counts.videos} videos, ${p.counts.canvases} canvases, ${p.counts.links} links, page height ${p.counts.documentHeight}px.`);
  if (p.meta.description) out.push(`- Description: ${p.meta.description}`);
  if (p.meta.generator) out.push(`- Generator: ${p.meta.generator}`);
  const loaded = [...new Set(p.fonts.filter((f) => f.status === 'loaded').map((f) => f.family))];
  out.push(`- Fonts loaded: ${loaded.length ? loaded.join(', ') : 'none'}`);
  if (p.headings.length) {
    out.push('- Outline:');
    for (const h of p.headings.slice(0, 12)) out.push(`  ${'  '.repeat(h.level - 1)}- h${h.level} ${h.text}`);
  }
  out.push(`- Scripts: ${p.scripts.length} external, ${p.inlineScripts.count} inline (${fmtBytes(p.inlineScripts.bytes)}).`);
  out.push('');

  const design = run.facts.filter((f) => f.key.startsWith('design.'));
  if (design.length) {
    out.push('## Design (summary)');
    out.push('');
    for (const f of design) out.push(factLine(f));
    out.push('');
    out.push('The full design decode is in `design.md` and `design.json`.');
    out.push('');
  }

  if (m.warnings.length) {
    out.push('## Notes');
    out.push('');
    for (const w of m.warnings) out.push(`- ${w}`);
    out.push('');
  }
  out.push('## Files in this run');
  out.push('');
  for (const [role, file] of Object.entries(m.files)) out.push(`- ${role}: \`${file}\``);
  out.push('');
  return out.join('\n');
}
