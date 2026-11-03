import type { RunDoc } from '../see/inspect.ts';
import { fmtBytes } from '../see/network.ts';
import type { ApiCall, ApiSpecResult } from './api.ts';
import { isTelemetry } from './api.ts';
import type { CodeDoc } from './decode.ts';
import type { CodeIndex, Excerpt } from './excerpt.ts';
import type { Section, TweenInfo } from './runtime.ts';
import { isLibraryPath } from './scripts.ts';
import type { ProgramExplained } from './uniforms.ts';

export interface ExplainContext {
  run: RunDoc;
  code: CodeDoc;
  programs: ProgramExplained[];
  index: CodeIndex;
  tweenSites: Map<number, { where: string; excerpt: Excerpt } | null>;
  rawShaders: Array<{ type: string; source: string }>;
  calls: ApiCall[];
  spec: ApiSpecResult;
}

const V = '✔';
const I = '≈';
const U = '?';
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const file = (u: string) => u.split('?')[0].split('/').pop() || u;

function fence(e: Excerpt, lang = 'js'): string {
  const head =
    e.from === 'original'
      ? `${e.file}:${e.line} (original source, from the site's public source map)`
      : `${e.file} near line ${e.line} (shipped bundle, re-indented by DEA)`;
  return `_${head}${e.name ? ` — in \`${e.name}\`` : ''}_\n\n\`\`\`${lang}\n${e.code}\n\`\`\``;
}

const GENERIC =
  /^(container|wrapper|wrap|inner|outer|content|row|col|grid|flex|block|section|main|page|app|root|layout|box|item|items|list|text|title|hidden|visible|active|relative|absolute|fixed|w-full|h-full|mx-auto|js-\w+)$/i;

function needles(s: Section): string[] {
  const out: string[] = [];
  if (s.id) out.push(s.id);
  for (const c of s.classes)
    if (!GENERIC.test(c) && !/[:[\]/]|^-?\d|^(sm|md|lg|xl|p|m|px|py|mt|mb|pt|pb|gap|text|bg|w|h)-/.test(c) && c.length >= 4) out.push(c);
  return [...new Set(out)].slice(0, 4);
}

function stringsOf(v: unknown, out: Set<string>, depth = 0): void {
  if (out.size > 2000 || depth > 10) return;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.length >= 4 && t.length <= 90 && !/^(https?:|\/|#|data:|[0-9a-f-]{16,}$)/i.test(t) && /\p{L}{3}/u.test(t)) out.add(t.toLowerCase());
  } else if (Array.isArray(v)) for (const x of v) stringsOf(x, out, depth + 1);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) stringsOf(x, out, depth + 1);
}

export interface DataLink {
  section: number;
  endpoint: string;
  method: string;
  matches: string[];
  label: 'Verified' | 'Inferred';
}

/** Which API response feeds which section: strings from the JSON that also appear in the section's text. */
export function linkData(calls: ApiCall[], sections: Section[]): DataLink[] {
  const out: DataLink[] = [];
  for (const c of calls) {
    if (!c.responseBody || isTelemetry(c.url)) continue;
    let json: unknown;
    try {
      json = JSON.parse(c.responseBody);
    } catch {
      continue;
    }
    const strs = new Set<string>();
    stringsOf(json, strs);
    if (!strs.size) continue;
    for (const s of sections) {
      const hay = `${s.heading ?? ''} ${s.text ?? ''} ${(s.strings ?? []).join(' ')}`.toLowerCase();
      const matches = [...strs].filter((x) => hay.includes(x)).slice(0, 6);
      if (matches.length >= 2 || matches.some((m) => m.length >= 14)) {
        let path = c.url;
        try {
          const u = new URL(c.url);
          path = `${u.host}${u.pathname}`;
        } catch {
          /* ignore */
        }
        out.push({ section: s.index, endpoint: path, method: c.method, matches, label: matches.length >= 3 ? 'Verified' : 'Inferred' });
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = `${d.section} ${d.method} ${d.endpoint}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function tweenLine(t: TweenInfo, site: string | null): string {
  const props = Object.entries(t.props)
    .map(([k, v]) => `${k}: ${cut(v, 30)}`)
    .join(', ');
  const st = t.scrollTrigger
    ? ` — ScrollTrigger on \`${t.scrollTrigger.trigger || '?'}\` from "${t.scrollTrigger.start}" to "${t.scrollTrigger.end}"${t.scrollTrigger.scrub ? `, scrub ${t.scrollTrigger.scrub}` : ''}${t.scrollTrigger.pin ? ', pinned' : ''}`
    : '';
  const what =
    t.kind === 'timeline'
      ? `timeline (${t.duration > 1e6 ? 'repeats forever' : `${t.duration}s total`})`
      : t.duration === 0 && !t.stagger
        ? `set ${t.targets.join(', ') || 'no target'} → { ${props} } (instant)`
        : `${t.targets.join(', ') || 'no target'} → { ${props} }, ${t.duration}s, ease ${t.ease}${t.delay ? `, delay ${t.delay}s` : ''}${t.stagger ? `, stagger ${t.stagger}` : ''}${t.repeat ? `, repeat ${t.repeat === -1 ? '∞' : t.repeat}${t.yoyo ? ' yoyo' : ''}` : ''}`;
  return `${V} ${what}${st}${site ? `. Created in \`${site}\`` : ''}`;
}

function siteOf(ctx: ExplainContext, t: TweenInfo): string | null {
  return ctx.tweenSites.get(t.n * 10 + (t.kind === 'timeline' ? 1 : 0))?.where ?? null;
}

/** Expert-level reading of the app code's shape: state, render loops, scroll model, code splitting. Each line shows its evidence. */
function architecture(ctx: ExplainContext): string[] {
  const { code, run } = ctx;
  const rt = code.runtime;
  const app = ctx.index.scripts.filter((s) => s.role === 'app' || s.role === 'mixed' || s.role === 'inline');
  const all = app.map((s) => s.source).join('\n');
  const count = (re: RegExp) => (all.match(re) ?? []).length;
  const L: string[] = [];
  const raf = count(/requestAnimationFrame\(/g);
  const styleWrites = count(/\.style\.(setProperty|transform|opacity|visibility)\b/g);
  if (raf >= 3)
    L.push(
      `- ${I} **Frame loops drive the page**: ${raf} \`requestAnimationFrame\` calls and ${styleWrites} direct style writes in the app code — components update the DOM every frame themselves instead of re-rendering through the framework.`,
    );
  if (/getState\(\)/.test(all) && /setState\(/.test(all) && /subscribe\(/.test(all))
    L.push(
      `- ${I} **Shared state store** (zustand-style \`getState()/setState()/subscribe()\`, ${count(/getState\(\)/g)} reads): ${rt?.three ? 'the WebGL scene and the HTML layers read the same state, so scroll, intro and page changes stay in sync' : 'components share one store instead of passing props down'}.`,
    );
  const docH = Number(run.page.counts?.documentHeight ?? 0);
  const vh = run.meta.viewport.height;
  const wheel = code.listeners.filter((l) => /wheel|touchmove|touchstart|pointermove/.test(l.type));
  if (docH && docH <= vh * 1.15)
    L.push(
      `- ${V} **No native scroll**: the document is ${docH}px tall in a ${vh}px window, ${rt?.three ? `so "scrolling" is the site's own: input (${[...new Set(wheel.map((l) => l.type))].join(', ') || 'wheel/touch handlers'}) moves a progress value that the scene and layers read` : 'so it is a single-screen app: the page itself never scrolls, panels and the canvas handle input themselves'}.`,
    );
  else if (code.scripts.some((s) => s.libs.includes('Lenis'))) L.push(`- ${I} **Smooth scroll** with Lenis over native scrolling (${docH}px page).`);
  const lazy = code.scripts
    .filter((s) => s.role !== 'inline' && !/main|index|polyfill|legacy/i.test(file(s.url)) && s.role === 'app')
    .map((s) => file(s.url).replace(/-[A-Za-z0-9_-]{8}\.m?js$/, ''));
  const preload = count(/__vitePreload|__vite__mapDeps|import\(/g);
  if (preload)
    L.push(`- ${V} **Code splitting**: ${preload} dynamic-import sites; separately loaded app chunks: ${[...new Set(lazy)].join(', ') || 'none seen'}.`);
  if (/nomodule|System\.register|-legacy-/.test(all + code.scripts.map((s) => s.url).join(' ')) || run.page.scripts?.some((s) => /legacy/.test(s.src)))
    L.push(`- ${V} **Two builds**: modern ES modules plus a legacy (SystemJS / nomodule) copy for old browsers.`);
  const workers = count(/new Worker\(/g);
  if (workers) L.push(`- ${V} **Web Workers**: ${workers} \`new Worker(\` site(s) — heavy work runs off the main thread.`);
  if (/EffectComposer|EffectPass|RenderPass/.test(ctx.index.scripts.map((s) => s.source.slice(0, 1_000_000)).join(' ')))
    L.push(`- ${V} **Post-processing** chain (EffectComposer / passes) after the 3D render.`);
  const gpgpu = ctx.programs.filter((p) => p.techniques.some((t) => t.startsWith('GPU particle')));
  if (gpgpu.length)
    L.push(
      `- ${V} **GPU particle simulation**: ${gpgpu.length} shader pass(es) keep particle positions/velocities in textures and update them on the GPU each frame.`,
    );
  if (rt?.sections.length && rt.sections.filter((s) => s.fixed || s.top === 0).length >= Math.max(2, rt.sections.length * 0.6))
    L.push(
      `- ${V} **Layered single screen**: ${rt.sections.filter((s) => s.fixed || s.top === 0).length} of ${rt.sections.length} sections sit on top of each other (fixed, at the top), shown and hidden by state — not a stack of blocks you scroll past.`,
    );
  if (/matchMedia\(["'`]\(prefers-reduced-motion/.test(all)) L.push(`- ${V} Respects **prefers-reduced-motion** (checked in code).`);
  if (/matchMedia\(["'`]\(hover: none\)|pointer: coarse/.test(all))
    L.push(`- ${V} Separate **touch behaviour** (checks \`hover: none\` / \`pointer: coarse\`).`);
  if (/(deviceMemory|hardwareConcurrency|getParameter\([^)]*RENDERER|UNMASKED_RENDERER)/.test(all))
    L.push(`- ${V} **Adapts quality to the device** (reads GPU name / memory / CPU cores).`);
  return L;
}

export function renderExplain(ctx: ExplainContext): string {
  const { run, code, programs } = ctx;
  const rt = code.runtime;
  const sections = rt?.sections ?? [];
  const tweens = rt?.tweens ?? [];
  const realTweens = tweens.filter((t) => t.kind === 'tween' && t.duration > 0);
  const data = linkData(ctx.calls, sections);
  const app = code.scripts.filter((s) => s.role === 'app' || s.role === 'mixed');
  const lib = code.scripts.filter((s) => s.role === 'vendor');
  const stackNames = run.stack.map((h) => `${h.name}${h.version ? ` ${h.version}` : ''}`);
  const maps = code.sourceMaps.length > 0;
  const L: string[] = [];
  const P = (...x: string[]) => L.push(...x);

  P(`# How ${run.meta.title || run.meta.finalUrl} works`, '');
  P(
    `A teardown by DEA of ${run.meta.finalUrl}, ${run.meta.finishedAt.slice(0, 16).replace('T', ' ')} UTC, in ${run.meta.browser.name} ${run.meta.browser.version}.`,
    '',
  );
  P(
    `${V} Verified = DEA saw it directly (runtime object, network log, source map, shader source). ${I} Inferred = a strong signal, not proof. ${U} Unknown = DEA could not tell, and says why.`,
    '',
  );
  P(
    maps
      ? `${V} This site publishes source maps, so the code excerpts below are the author's **original files**.`
      : `${V} This site publishes **no source maps**. Code excerpts are from the shipped (minified) bundle, re-indented by DEA; names like \`e\`, \`t\`, \`n\` are the minifier's, not the author's. Strings, property names, numbers and structure are real.`,
    '',
  );

  // 1. short version
  P('## 1. The short version', '');
  const libsInApp = [...new Set(code.scripts.flatMap((s) => s.libs))];
  P(
    `- ${V} Built with ${code.bundlers.map((b) => `${b.name}${b.label === 'Inferred' ? ' (inferred)' : ''}`).join(', ') || 'an unknown tool'}; shipped as ${code.scripts.filter((s) => s.role !== 'inline').length} script files (${fmtBytes(app.reduce((a, s) => a + s.bytes, 0))} app code, ${fmtBytes(lib.reduce((a, s) => a + s.bytes, 0))} libraries) plus ${code.scripts.filter((s) => s.role === 'inline').length} inline scripts.`,
  );
  if (stackNames.length) P(`- ${V} Stack: ${stackNames.join(', ')}.`);
  if (libsInApp.length) P(`- ${I} Libraries found inside the bundles: ${libsInApp.join(', ')}.`);
  if (rt?.three.scenes.length)
    P(
      `- ${V} The visuals are WebGL: three.js r${rt.three.revision ?? '?'}, ${rt.three.scenes.length} scene(s), ${rt.three.materials.length} materials, ${programs.length} author-written shader stages${programs.length ? ` (${[...new Set(programs.flatMap((p) => p.techniques))].slice(0, 6).join(', ') || 'custom effects'})` : ''}.`,
    );
  if (tweens.length)
    P(
      `- ${V} Motion: GSAP ${rt?.gsapVersion ?? ''} built ${realTweens.length} tweens and ${tweens.filter((t) => t.kind === 'timeline').length} timelines while DEA watched; ${tweens.filter((t) => t.scrollTrigger).length} are tied to scroll (ScrollTrigger). Targets: ${countKinds(realTweens)}.`,
    );
  else P(`- ${U} No GSAP tweens were seen being built${rt?.gsapVersion ? ` (GSAP ${rt.gsapVersion} is present)` : ''}.`);
  const apis = code.api.filter((e) => !e.telemetry);
  if (apis.length)
    P(
      `- ${V} Data: ${apis.length} API endpoint(s) on ${[...new Set(apis.map((e) => new URL(e.host).hostname))].join(', ')}${data.length ? `; their content shows up in ${new Set(data.map((d) => d.section)).size} section(s)` : ''}.`,
    );
  const vulnHits = 'hits' in code.vulns ? code.vulns.hits.filter((h) => h.vulnerabilities.length) : [];
  if ('hits' in code.vulns)
    P(`- ${V} Known-vulnerable libraries: ${vulnHits.length ? vulnHits.map((h) => `${h.library} ${h.version}`).join(', ') : 'none found'} (retire.js data).`);
  P('');

  const archLines = architecture(ctx);
  if (archLines.length) P('**How it is put together**', '', ...archLines, '');

  // 2. delivery
  P('## 2. How the code is delivered', '');
  for (const b of code.bundlers) P(`- ${b.label === 'Verified' ? V : I} **${b.name}**: ${b.evidence.join('; ')}`);
  P('', '| file | role | size | libraries inside | source map |', '|---|---|---|---|---|');
  for (const s of code.scripts.filter((x) => x.role !== 'inline').slice(0, 40))
    P(`| ${cell(file(s.url))} | ${s.role} | ${fmtBytes(s.bytes)} | ${s.libs.join(', ') || '–'} | ${cell(s.mapStatus)}${s.unpacked ? ' · unpacked' : ''} |`);
  P('');
  if (code.sourceMaps.length) {
    P(`${V} Original files recovered from source maps (${code.originals.saved} app files, ${code.originals.library} library files not saved):`, '');
    for (const m of code.sourceMaps)
      P(
        `- ${file(m.script)} → ${m.appSources
          .slice(0, 25)
          .map((x) => `\`${x}\``)
          .join(', ')}${m.appSources.length > 25 ? ` … (+${m.appSources.length - 25})` : ''}`,
      );
    P('');
  }

  // 3. sections
  P('## 3. Section by section', '');
  if (!sections.length) P(`${U} DEA could not split this page into sections (one full-screen canvas, or content built later).`, '');
  for (const s of sections) {
    const title = s.heading || s.text.slice(0, 50) || s.selector;
    P(`### 3.${s.index + 1} ${cut(title, 70)}`, '');
    P(
      `\`${s.selector}\` · ${s.top}px from the top · ${s.height}px tall${s.images ? ` · ${s.images} images/videos` : ''}${s.links ? ` · ${s.links} links` : ''}`,
      '',
    );
    if (s.text) P(`> ${cut(s.text, 200)}`, '');
    if (s.canvases.length) P(`- ${V} Drawn with WebGL on ${s.canvases.join(', ')} — see section 4 for the scene and shaders.`);
    const here = tweens.filter((t) => t.sections.includes(s.index));
    for (const t of here.slice(0, 8)) P(`- ${tweenLine(t, siteOf(ctx, t))}`);
    if (here.length > 8) P(`- … ${here.length - 8} more tweens on this section (section 5 lists all).`);
    const st = tweens.filter(
      (t) =>
        t.scrollTrigger &&
        !t.sections.includes(s.index) &&
        s.selector.includes(t.scrollTrigger.trigger.split(/[.#]/)[0]) &&
        t.scrollTrigger.trigger &&
        sameEl(t.scrollTrigger.trigger, s),
    );
    for (const t of st.slice(0, 4)) P(`- ${V} Scroll here drives: ${tweenLine(t, siteOf(ctx, t)).slice(2)}`);
    const ls = code.listeners.filter((l) => l.section === s.index);
    for (const l of ls.slice(0, 6))
      P(`- ${V} \`${l.type}\` on ${cut(l.target, 60)} → handler ${l.where ? `in \`${l.where}\`` : `(script ${l.scriptId}, line ${l.line})`}`);
    for (const d of data.filter((x) => x.section === s.index))
      P(
        `- ${d.label === 'Verified' ? V : I} Content comes from \`${d.method} ${d.endpoint}\` — these values from the response are on screen here: ${d.matches.map((m) => `"${cut(m, 40)}"`).join(', ')}`,
      );
    const ex = needles(s).flatMap((n) => ctx.index.find(n, 1).map((e) => ({ n, e })));
    if (ex.length) {
      P('', `Code that names this section (\`${ex[0].n}\`):`, '', fence(ex[0].e));
    } else if (!here.length && !ls.length && !s.canvases.length)
      P(
        `- ${U} No script, animation or data call could be tied to this section; it is likely static HTML/CSS (or rendered by a framework without distinctive names).`,
      );
    P('');
  }

  // 4. WebGL
  if (rt?.three.scenes.length || programs.length) {
    P('## 4. WebGL: scene, materials and shaders', '');
    for (const r of rt?.three.renderers ?? [])
      P(
        `- ${V} Renderer: pixel ratio ${r.pixelRatio ?? '?'}, size ${r.size?.join('×') ?? '?'}, tone mapping ${toneName(r.toneMapping)}, colour space ${r.outputColorSpace ?? '?'}, shadows ${r.shadows ? 'on' : 'off'}, antialias ${r.antialias ?? '?'}`,
      );
    for (const sc of rt?.three.scenes ?? [])
      P(
        `- ${V} Scene "${sc.name}": ${sc.objects} objects, ${sc.meshes} drawables, ${sc.lights} lights${sc.fog ? `, fog ${sc.fog}` : ''}${sc.background ? `, background ${sc.background}` : ''}`,
      );
    const custom = (rt?.three.materials ?? []).filter((m) => m.customProgram);
    if (rt?.three.materials.length) {
      P('', '| material | type | used by | uniforms that move |', '|---|---|---|---|');
      for (const m of rt.three.materials.slice(0, 30))
        P(
          `| ${cell(m.name || '–')} | ${m.type} | ${cell(m.meshes.join(', ') || '–')} | ${cell(
            m.uniforms
              .filter((u) => u.changed)
              .map((u) => u.name)
              .join(', ') || '–',
          )} |`,
        );
      P('');
    }
    if (!custom.length && !programs.length) P(`${I} No author-written shaders: the look comes from three.js's built-in materials.`, '');
    for (const p of programs.slice(0, 14)) {
      P(`### ${p.name} (${p.stage})`, '');
      if (p.techniques.length) P(`${V} Techniques in the code: ${p.techniques.join(', ')}.`);
      if (p.functions.length) P(`${V} Helper functions it defines: ${p.functions.map((f) => `\`${f}()\``).join(', ')}.`);
      if (p.varyings.length) P(`${V} Passes between stages: ${p.varyings.map((v) => `\`${v}\``).join(', ')}.`);
      if (p.material)
        P(
          `${V} Live material: ${p.material.type}${p.material.name ? ` "${p.material.name}"` : ''} on ${p.material.meshes.join(', ') || '?'}${p.material.transparent ? ', transparent' : ''}.`,
        );
      if (p.uniforms.length) {
        P('', '| uniform | type | what it does | live value | moves? |', '|---|---|---|---|---|');
        for (const u of p.uniforms)
          P(
            `| \`${u.name}\` | ${u.type} | ${cell(u.meaning)}${u.usage[0] ? `<br>\`${cell(cut(u.usage[0], 90))}\`` : ''} | ${u.live ? cell(cut(u.live.value, 40)) : '–'} | ${u.live ? (u.live.changed ? `${V} yes` : 'no (in 0.7 s)') : U} |`,
          );
        P('');
      }
      if (p.main) P('```glsl', p.main, '```', '');
    }
  }

  // 5. motion timeline
  if (tweens.length || code.staticTweens.length) P('## 5. Motion timeline (GSAP)', '');
  if (!tweens.length && code.staticTweens.length)
    P(
      `${U} No tween was built while DEA watched (load + scroll). The site's motion is either frame-loop code (see section 1) or starts on a click, hover or a later chapter; the calls below are read from the code.`,
      '',
    );
  if (tweens.length) {
    P(
      `${V} Every tween and timeline below was read from the live GSAP objects; "created" is ms after the page started, and the call site is the code that built it.`,
      '',
    );
    P('| # | created | kind | targets | animates | duration | ease | scroll | call site |', '|---|---|---|---|---|---|---|---|---|');
    for (const t of tweens.slice(0, 120))
      P(
        `| ${t.kind === 'timeline' ? 'tl' : 'tw'}${t.n} | ${t.t}ms | ${t.kind}${t.timeline != null ? ` in tl${t.timeline}` : ''} | ${cell(cut(t.targets.join(', '), 50) || '–')} | ${cell(cut(Object.keys(t.props).join(', '), 50) || '–')} | ${t.duration > 1e6 ? '∞ (repeats)' : `${t.duration}s`}${t.delay ? ` +${t.delay}` : ''} | ${t.kind === 'timeline' ? '–' : cell(t.ease)} | ${t.scrollTrigger ? cell(`${t.scrollTrigger.start} → ${t.scrollTrigger.end}${t.scrollTrigger.scrub ? ` scrub ${t.scrollTrigger.scrub}` : ''}`) : '–'} | ${cell(siteOf(ctx, t) ?? '–')} |`,
      );
    if (tweens.length > 120) P(`| … | | | ${tweens.length - 120} more in code.json | | | | | |`);
    P('');
    const sites = new Map<string, { t: TweenInfo; excerpt: Excerpt }>();
    for (const t of tweens) {
      const s = ctx.tweenSites.get(t.n * 10 + (t.kind === 'timeline' ? 1 : 0));
      if (s && !sites.has(s.where)) sites.set(s.where, { t, excerpt: s.excerpt });
    }
    for (const [s, { t, excerpt }] of [...sites].slice(0, 5))
      P(`Code that creates ${t.kind === 'timeline' ? 'a timeline' : `the ${t.targets[0] ?? ''} tween`} (\`${s}\`):`, '', fence(excerpt), '');
    if (!sites.size) P(`${U} The code that created these animations could not be told apart from GSAP's own (no app frame in the call stacks).`, '');
  }

  const stat = code.staticTweens;
  if (stat.length) {
    P(`### Animations written in the code (${stat.length})`, '');
    P(
      `${I} Found by reading the ${maps ? 'original source' : 'shipped bundles'}, not by watching: these include motion that only starts after a click, a page change or a scroll beat. Values in quotes or numbers are literal; anything else is computed at runtime.`,
      '',
    );
    P('| where | call | target | vars |', '|---|---|---|---|');
    for (const s of stat.slice(0, 60))
      P(
        `| ${cell(`${s.file}:${s.line}${s.col ? `:${s.col}` : ''}`)} | ${s.method} | ${cell(cut(s.target, 40) || '–')} | ${cell(
          cut(
            Object.entries(s.props)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', '),
            120,
          ),
        )} |`,
      );
    P('');
  }

  // 6. data flow
  P('## 6. Data flow', '');
  if (!apis.length) P(`${I} No API calls: the content is in the HTML or the JavaScript bundle itself.`, '');
  for (const e of apis.slice(0, 20)) {
    const secs = [
      ...new Set(
        data.filter((d) => d.endpoint.startsWith(new URL(e.host).host) && d.endpoint.endsWith(e.path.replace(/\{[^}]+\}/g, ''))).map((d) => d.section),
      ),
    ];
    P(
      `- ${V} \`${e.method} ${new URL(e.host).host}${e.path}\` ×${e.calls} (HTTP ${e.statuses.join(', ')})${e.graphql.length ? ` GraphQL ${e.graphql.join(', ')}` : ''}${e.auth.length ? `, auth: ${e.auth.join(', ')} (values never saved)` : ''}${e.initiators.length ? `, called from \`${e.initiators[0]}\`` : ''}${secs.length ? `. Feeds section ${secs.map((x) => `3.${x + 1}`).join(', ')}` : ''}.`,
    );
    if (e.query) P(`  - Query: \`${cut(e.query, 300)}\``);
    if (e.responseKeys.length) P(`  - Response keys: ${e.responseKeys.map((k) => `\`${k}\``).join(', ')}`);
  }
  if (code.runtime?.sockets?.length) for (const s of code.runtime.sockets) P(`- ${V} ${s.kind} to ${s.url}`);
  if (code.assets.length) {
    P('', `${V} Files the code fetched itself (not page assets):`, '');
    for (const a of code.assets.slice(0, 20))
      P(`- \`${cut(a.url.replace(/^https?:\/\/[^/]+/, ''), 90)}\`${a.bytes ? ` (${fmtBytes(a.bytes)})` : ''}${a.initiator ? ` ← \`${a.initiator}\`` : ''}`);
  }
  P('', 'Full machine-readable spec: `api/openapi.json` (OpenAPI 3.1). Human view: `api.md`.', '');

  // 7. interaction
  P('## 7. Interaction map', '');
  // the site's own handlers first; a library that wraps every listener (error trackers do) goes last, said once
  const isLib = (l: (typeof code.listeners)[number]) => Boolean(l.where && isLibraryPath(l.where.split(':')[0]));
  const allGlobals = code.listeners.filter((l) => l.target === 'window' || l.target === 'document');
  const globals = [...allGlobals.filter((l) => !isLib(l)), ...allGlobals.filter(isLib)];
  if (globals.length)
    for (const l of globals.slice(0, 20))
      P(
        `- ${V} ${l.target} \`${l.type}\` → ${l.where ? `\`${l.where}\`` : `script ${l.scriptId}:${l.line}`}${isLib(l) ? ' (library code: a wrapper, the real handler sits behind it)' : ''}`,
      );
  const elems = code.listeners.filter((l) => l.target !== 'window' && l.target !== 'document');
  if (elems.length)
    P(
      `- ${V} ${elems.length} element listeners (${[...new Set(elems.map((l) => l.type))].slice(0, 10).join(', ')}); per-section ones are listed in section 3.`,
    );
  if (run.stack.some((h) => /react/i.test(h.name)))
    P(`- ${I} React attaches most handlers once at its root and dispatches them itself, so individual buttons may show no listener of their own.`);
  const top =
    globals.find((l) => /wheel|scroll|pointermove|mousemove/.test(l.type) && l.where && !isLib(l)) ??
    globals.find((l) => /keydown|pointerdown|click/.test(l.type) && l.where && !isLib(l)) ??
    code.listeners.find((l) => /wheel|touchmove|pointermove/.test(l.type) && l.where) ??
    globals.find((l) => /keydown|pointerdown/.test(l.type) && l.where);
  if (top) {
    const s = ctx.index.script(top.scriptId);
    const e = s ? ctx.index.at(s.url, top.line, top.col, 30) : null;
    if (e) P('', `The \`${top.type}\` handler on ${top.target}:`, '', fence(e));
  }
  P('');

  // 8. rebuild
  P('## 8. Rebuild it', '', `${I} A sketch written by DEA from the measurements above, to start your own version. It is not the site's code.`, '');
  P(...rebuild(ctx), '');

  // 9. unknowns
  P('## 9. What DEA could not see', '');
  if (!maps) P(`- ${U} Original file and variable names (no public source maps). Structure, strings and numbers are real.`);
  if (run.meta.warnings.some((w) => /software/i.test(w)))
    P(`- ${I} WebGL ran in software on DEA's machine; the site may pick a different quality level on a real GPU.`);
  P(`- ${U} Animations that start only after a click or a route change are not in the timeline unless they ran while DEA scrolled.`);
  P(`- ${U} Code that runs inside workers, iframes from other sites, or WebAssembly is listed but not explained.`);
  if (code.unpacked.some((u) => 'error' in u))
    P(
      `- ${U} Some bundles could not be unpacked: ${code.unpacked
        .filter((u) => 'error' in u)
        .map((u) => `${file(u.script)} (${(u as { error: string }).error})`)
        .join(', ')}.`,
    );
  P(
    '',
    'Evidence in this run folder: `code.json`, `code/scripts/`, `code/unpacked/`, `code/original/`, `shaders.json`, `api/openapi.json`, `network.har`, `progress.md`.',
    '',
  );
  return L.join('\n');
}

function sameEl(sel: string, s: Section): boolean {
  if (!sel) return false;
  if (s.id && sel.includes(`#${s.id}`)) return true;
  return s.classes.some((c) => sel.includes(`.${c}`));
}

function countKinds(t: TweenInfo[]): string {
  const m = new Map<string, number>();
  for (const x of t) m.set(x.targetKind, (m.get(x.targetKind) ?? 0) + 1);
  const name: Record<string, string> = {
    element: 'HTML elements',
    three: 'three.js objects',
    uniform: 'shader uniforms',
    object: 'plain JS objects',
    mixed: 'mixed',
    none: 'nothing',
  };
  return [...m].map(([k, n]) => `${n} on ${name[k] ?? k}`).join(', ') || 'none';
}

function toneName(n: number | null): string {
  const names = ['none', 'linear', 'Reinhard', 'Cineon', 'ACES Filmic', 'custom', 'AgX', 'Neutral'];
  return n == null ? '?' : (names[n] ?? String(n));
}

function rebuild(ctx: ExplainContext): string[] {
  const { run, code, programs } = ctx;
  const rt = code.runtime;
  const L: string[] = [];
  const pkgs: string[] = [];
  for (const h of run.stack) {
    if (h.id === 'three' && h.version) pkgs.push(`three@0.${h.version.replace(/^r/, '')}.0`);
    else if (h.id === 'gsap' && h.version) pkgs.push(`gsap@${h.version}`);
    else if (h.id === 'lenis') pkgs.push('lenis');
    else if (h.id === 'react' && h.version) pkgs.push(`react@${h.version} react-dom@${h.version}`);
  }
  if (code.scripts.some((s) => s.libs.includes('React Three Fiber'))) pkgs.push('@react-three/fiber');
  if (code.scripts.some((s) => s.libs.includes('postprocessing'))) pkgs.push('postprocessing');
  const vite = code.bundlers.some((b) => /vite/i.test(b.name));
  L.push(
    '**Set up**',
    '',
    '```bash',
    vite ? `npm create vite@latest my-site -- --template ${run.stack.some((h) => h.id === 'react') ? 'react' : 'vanilla'}` : 'npm init -y',
    `npm i ${pkgs.join(' ') || 'three gsap'}`,
    '```',
    '',
  );
  const fonts = [...new Set((run.page.fonts ?? []).filter((f) => f.status === 'loaded').map((f) => f.family))];
  if (fonts.length) L.push(`**Fonts:** ${fonts.join(', ')} (licence them before you use them).`, '');
  const r = rt?.three.renderers[0];
  if (rt?.three.scenes.length) {
    L.push(
      '**Renderer, as measured**',
      '',
      '```js',
      "import * as THREE from 'three';",
      `const renderer = new THREE.WebGLRenderer({ antialias: ${r?.antialias ?? true}, alpha: true });`,
      `renderer.setPixelRatio(Math.min(window.devicePixelRatio, ${r?.pixelRatio && r.pixelRatio > 0 ? Math.max(1, Math.round(r.pixelRatio * 2) / 2) : 2}));`,
      `renderer.toneMapping = ${r?.toneMapping != null ? (['THREE.NoToneMapping', 'THREE.LinearToneMapping', 'THREE.ReinhardToneMapping', 'THREE.CineonToneMapping', 'THREE.ACESFilmicToneMapping', 'THREE.CustomToneMapping', 'THREE.AgXToneMapping', 'THREE.NeutralToneMapping'][r.toneMapping] ?? 'THREE.NoToneMapping') : 'THREE.NoToneMapping'};`,
      `renderer.outputColorSpace = ${r?.outputColorSpace === 'srgb-linear' ? 'THREE.LinearSRGBColorSpace' : 'THREE.SRGBColorSpace'};`,
      'renderer.setSize(innerWidth, innerHeight);',
      'document.body.appendChild(renderer.domElement);',
      '```',
      '',
    );
  }
  // a shader on an object the author named (heroHaze) says more than an anonymous simulation pass
  const named = (p: ProgramExplained) => Boolean(p.material?.meshes.some((m) => !/^(Mesh|Points|Line|Sprite|InstancedMesh|LineSegments)$/.test(m)));
  const prog =
    [...programs]
      .filter((p) => p.stage === 'fragment' && p.uniforms.length)
      .sort(
        (a, b) =>
          Number(Boolean(b.material)) - Number(Boolean(a.material)) ||
          Number(named(b)) - Number(named(a)) ||
          b.uniforms.filter((u) => u.live?.changed).length - a.uniforms.filter((u) => u.live?.changed).length ||
          b.uniforms.length - a.uniforms.length,
      )[0] ?? programs[0];
  if (prog) {
    const moving = prog.uniforms.filter((u) => u.live?.changed);
    const init = (u: ProgramExplained['uniforms'][number]) => {
      const t = u.type;
      if (t === 'float') return u.live && /^-?[\d.]+$/.test(u.live.value) ? u.live.value : '0';
      if (t === 'vec2') return 'new THREE.Vector2()';
      if (t === 'vec3') return u.live?.value.startsWith('#') ? `new THREE.Color('${u.live.value}')` : 'new THREE.Vector3()';
      if (t === 'vec4') return 'new THREE.Vector4()';
      if (t === 'sampler2D') return 'null /* a THREE.Texture */';
      if (t === 'int' || t === 'bool') return u.live?.value ?? '0';
      return 'null';
    };
    L.push(
      `**The "${prog.name}" shader, wired the same way** (uniform names and starting values are the site's; the GLSL body is in section 4)`,
      '',
      '```js',
      'const material = new THREE.ShaderMaterial({',
      '  uniforms: {',
      ...prog.uniforms.slice(0, 14).map((u) => `    ${u.name}: { value: ${init(u)} }, // ${cut(u.meaning, 60)}`),
      '  },',
      '  vertexShader, // see section 4',
      '  fragmentShader,',
      '});',
      'const clock = new THREE.Clock();',
      'renderer.setAnimationLoop(() => {',
      ...moving.filter((u) => u.type === 'float' && /time|elapsed/i.test(u.name)).map((u) => `  material.uniforms.${u.name}.value = clock.getElapsedTime();`),
      ...prog.uniforms
        .filter((u) => /mouse|pointer/i.test(u.name) && u.type === 'vec2')
        .map((u) => `  // ${u.name} ← pointermove (normalised -1..1), eased toward the cursor`),
      '  renderer.render(scene, camera);',
      '});',
      '```',
      '',
    );
  }
  const st = rt?.tweens.find((t) => t.scrollTrigger && t.kind === 'tween') ?? rt?.tweens.find((t) => t.kind === 'tween' && t.duration > 0);
  if (st) {
    const props = Object.entries(st.props)
      .filter(([, v]) => v !== 'function')
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${/^-?[\d.]+$/.test(v) || /^(true|false)$/.test(v) || v.startsWith('{') || v.startsWith('[') ? v : JSON.stringify(v)}`);
    L.push(
      '**The motion, with the measured values**',
      '',
      '```js',
      "import gsap from 'gsap';",
      ...(st.scrollTrigger ? ["import { ScrollTrigger } from 'gsap/ScrollTrigger';", 'gsap.registerPlugin(ScrollTrigger);'] : []),
      `gsap.to(${st.targetKind === 'element' ? `'${(st.targets[0] ?? '.target').replace(/^\w+(?=[.#])/, '')}'` : `/* the same target: ${cut(st.targets[0] ?? '?', 40)} */ target`}, {`,
      ...props.map((p) => `  ${p},`),
      `  duration: ${st.duration},`,
      `  ease: '${st.ease === 'default' ? 'power1.out' : st.ease}',`,
      ...(st.delay ? [`  delay: ${st.delay},`] : []),
      ...(st.scrollTrigger
        ? [
            '  scrollTrigger: {',
            `    trigger: '${st.scrollTrigger.trigger.replace(/^\w+(?=[.#])/, '') || 'body'}',`,
            `    start: '${st.scrollTrigger.start}',`,
            `    end: '${st.scrollTrigger.end}',`,
            ...(st.scrollTrigger.scrub ? [`    scrub: ${/^(true|[\d.]+)$/.test(st.scrollTrigger.scrub) ? st.scrollTrigger.scrub : 'true'},`] : []),
            ...(st.scrollTrigger.pin ? ['    pin: true,'] : []),
            '  },',
          ]
        : []),
      '});',
      '```',
      '',
    );
  }
  const api = code.api.find((e) => !e.telemetry && e.method === 'GET');
  if (api) {
    L.push(
      '**The data**',
      '',
      '```js',
      `const res = await fetch('${api.example.replace(/'/g, "\\'")}');`,
      'const data = await res.json();',
      `// keys DEA saw: ${api.responseKeys.join(', ') || '(not JSON)'}`,
      '```',
      '',
    );
  }
  return L;
}

export function renderCodeMd(ctx: ExplainContext): string {
  const { code, run } = ctx;
  const L = [`# Code decode: ${run.meta.title || run.meta.finalUrl}`, '', `${run.meta.finalUrl}`, ''];
  L.push('## Build tool', '');
  for (const b of code.bundlers) L.push(`- ${b.label === 'Verified' ? V : I} ${b.name}: ${b.evidence.join('; ')}`);
  if (!code.bundlers.length) L.push(`- ${U} No build-tool markers found.`);
  L.push('', '## Scripts', '', '| file | role | size | libraries | source map | unpacked |', '|---|---|---|---|---|---|');
  for (const s of code.scripts)
    L.push(
      `| ${cell(s.role === 'inline' ? `inline (${s.scriptId})` : file(s.url))} | ${s.role} | ${fmtBytes(s.bytes)} | ${s.libs.join(', ') || '–'} | ${cell(s.mapStatus)} | ${s.unpacked ?? '–'} |`,
    );
  L.push('', '## Original sources', '');
  if (!code.sourceMaps.length) L.push(`${V} None: no script publishes a readable source map (DEA also tried each file + ".map").`);
  for (const m of code.sourceMaps) {
    L.push(`### ${file(m.script)} → ${m.map}`, '', `${m.sources} sources in the map, ${m.withContent} with their text. App files:`, '');
    for (const s of m.appSources.slice(0, 200)) L.push(`- \`${s}\``);
    L.push('');
  }
  L.push('', '## Unpacked bundles', '');
  for (const u of code.unpacked)
    L.push(
      'error' in u
        ? `- ${U} ${file(u.script)}: ${u.error}`
        : `- ${V} ${file(u.script)} → \`${u.file}\`${u.bundle ? ` (${u.bundle} bundle, ${u.modules} modules)` : ''}, ${Math.round(u.ms / 100) / 10}s`,
    );
  if (!code.unpacked.length) L.push('- Nothing needed unpacking (source maps cover the app code, or no app bundle was small enough).');
  L.push('', '## Known vulnerabilities (retire.js data)', '');
  if ('error' in code.vulns) L.push(`${U} Not checked: ${code.vulns.error}`);
  else {
    for (const h of code.vulns.hits) {
      L.push(
        `- ${h.vulnerabilities.length ? '⚠' : V} **${h.library} ${h.version}** (${h.evidence}): ${h.vulnerabilities.length ? `${h.vulnerabilities.length} known issue(s)` : 'no known issues'}`,
      );
      for (const v of h.vulnerabilities.slice(0, 6))
        L.push(`  - ${v.severity}: ${v.summary || v.ids.join(', ')}${v.below ? ` (fixed in ${v.below})` : ''}${v.info[0] ? ` — ${v.info[0]}` : ''}`);
    }
    if (!code.vulns.hits.length) L.push(`${V} No library versions from the retire.js list were found.`);
    L.push('', `Data: ${code.vulns.source}`);
  }
  L.push('');
  return L.join('\n');
}

export function renderApiMd(ctx: ExplainContext): string {
  const { code, run } = ctx;
  const L = [
    `# API map: ${run.meta.title || run.meta.finalUrl}`,
    '',
    `Observed while DEA loaded and scrolled ${run.meta.finalUrl}. OpenAPI 3.1: \`api/openapi.json\`.`,
    '',
  ];
  const app = code.api.filter((e) => !e.telemetry);
  const tel = code.api.filter((e) => e.telemetry);
  if (!code.api.length) L.push(`${I} No API calls were made: the content ships inside the HTML or the JavaScript.`);
  if (app.length) L.push('| method | endpoint | calls | status | auth | called from |', '|---|---|---|---|---|---|');
  for (const e of app)
    L.push(
      `| ${e.method} | ${cell(`${new URL(e.host).host}${e.path}`)} | ${e.calls} | ${e.statuses.join(', ')} | ${cell(e.auth.join(', ') || 'none seen')} | ${cell(e.initiators[0] ?? '–')} |`,
    );
  for (const e of app) {
    if (!e.query && !e.graphql.length && !e.responseKeys.length) continue;
    L.push('', `### ${e.method} ${new URL(e.host).host}${e.path}`, '', `Example: \`${cut(e.example, 300)}\``);
    if (e.graphql.length) L.push(`GraphQL operations: ${e.graphql.join(', ')}`);
    if (e.query) L.push('', '```', e.query, '```');
    if (e.responseKeys.length) L.push(`Response keys: ${e.responseKeys.join(', ')}`);
  }
  if (tel.length) L.push('', `## Analytics / telemetry (${tel.length})`, '', ...tel.map((e) => `- ${e.method} ${new URL(e.host).host}${e.path} ×${e.calls}`));
  L.push('', 'Auth values, cookies and tokens are never saved; only their kind is noted.', '');
  return L.join('\n');
}
