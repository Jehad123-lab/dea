import type { RunDoc } from '../see/inspect.ts';
import type { DesignDoc } from './index.ts';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const V = '**Verified**';
const I = '*Inferred*';

/** design.md: the design decode in plain words, every line labelled. */
export function renderDesignMd(d: DesignDoc, run: RunDoc): string {
  const o: string[] = [];
  const push = (...l: string[]) => o.push(...l);
  push(`# How ${run.meta.title || d.url} looks and moves`, '');
  push(
    `${d.url} · decoded ${run.meta.startedAt.slice(0, 16).replace('T', ' ')} UTC · ${run.meta.browser.name} ${run.meta.browser.version} at ${run.meta.viewport.width}×${run.meta.viewport.height}`,
    '',
  );
  push('**Verified** = read from the page, Chrome or the network. *Inferred* = DEA’s reading, with the reason. Unknown = not visible from outside.', '');

  // at a glance
  push('## At a glance', '');
  const fam = d.typography.families;
  if (fam[0])
    push(
      `- Type: **${fam[0].family}**${
        fam[1]
          ? ` with ${fam
              .slice(1, 3)
              .map((f) => f.family)
              .join(' and ')}`
          : ''
      }${d.typography.scale.base ? `, body ${d.typography.scale.base}px` : ''}.`,
    );
  const cov = d.color.coverage;
  if (cov && cov.canvas + cov.video >= 0.5 && d.color.screen.length)
    push(
      `- Colour: the first screen is ${Math.round((cov.canvas + cov.video) * 100)}% ${cov.canvas >= cov.video ? 'WebGL canvas' : 'video'}, showing ${d.color.screen
        .slice(0, 3)
        .map((c) => `${c.hex} ${c.name}`)
        .join(', ')}; the HTML layer on top uses ${d.color.text?.hex ?? '?'} text${d.color.accents[0] ? ` and ${d.color.accents[0].hex} accents` : ''}.`,
    );
  else if (d.color.background)
    push(
      `- Colour: ${d.color.scheme} — ${d.color.background.hex} background, ${d.color.text?.hex ?? '?'} text${d.color.accents[0] ? `, accent ${d.color.accents[0].hex} (${d.color.accents[0].name})` : ''}.`,
    );
  // the browser default "ease" says little about a designer's choice; show chosen curves first
  const easeNames = [...new Set([...d.motion.css.observed.easings, ...d.motion.css.declared.easings].map((e) => e.name).filter(Boolean))].sort(
    (a, b) => Number(a === 'ease' || a === 'linear') - Number(b === 'ease' || b === 'linear'),
  );
  push(
    `- Motion: ${d.motion.js.gsap.version ? `GSAP ${d.motion.js.gsap.version}` : 'no GSAP'}${d.motion.css.observed.count ? `, ${d.motion.css.observed.count} CSS animations` : ''}${easeNames.length ? `, easing ${easeNames.slice(0, 2).join(' / ')}` : ''}.`,
  );
  push(`- Scroll: ${d.scroll.mode}${d.motion.js.lenis.present ? ' (Lenis)' : ''}, ${d.scroll.screens} screens tall.`);
  const sh = d.webgl.shaders;
  const engine = d.stack.find((s) => /three|pixi|babylon|spline|unicorn|webgl/i.test(s.name));
  if (sh.shaderCount || engine)
    push(
      `- 3D: ${engine ? `${engine.name}${engine.version ? ` ${engine.version}` : ''}` : 'WebGL'}${sh.shaderCount ? `, ${sh.shaderCount} shaders (${sh.customPrograms} written for this site)` : ''}${sh.techniquesCustom.length ? `: ${sh.techniquesCustom.slice(0, 4).join(', ')}` : ''}.`,
    );
  push('');

  // type
  push('## Typography', '');
  if (!fam.length) push('No text was found in the DOM (the page may draw its text in canvas).');
  for (const f of fam.slice(0, 6)) {
    const drawn = f.rendered.length ? f.rendered.map((r) => `${r.name}${r.custom ? '' : ' (system font)'}`).join(', ') : 'not measured';
    push(
      `- ${V} **${f.family}** — ${pct(f.share)} of text, weights ${f.weights.join(', ')}, ${f.source}. Chrome drew it with: ${drawn}.${f.fallbackUsed ? ' ⚠ The named font was not the one drawn; a fallback was used.' : ''}`,
    );
    if (f.files.length)
      push(
        `  Files: ${f.files
          .slice(0, 2)
          .map((u) => `\`${u.slice(0, 110)}\``)
          .join(', ')}`,
      );
  }
  if (d.typography.styles.length) {
    push('', 'Text styles, most used first:', '');
    push('| Role | Font | Size / line | Weight | Tracking | Case | Example |', '|---|---|---|---|---|---|---|');
    for (const s of d.typography.styles.slice(0, 12)) {
      push(
        `| ${s.role} | ${s.family} | ${s.size}px / ${s.lineHeight ?? 'normal'} | ${s.weight} | ${s.letterSpacing ? `${s.letterSpacing}em` : '0'} | ${s.transform === 'none' ? '—' : s.transform} | ${s.sample.replace(/\|/g, '/').slice(0, 40)} |`,
      );
    }
  }
  const split = d.typography.styles.filter((x) => x.role.includes('split'));
  if (split.length)
    push(
      '',
      `- ${I} Text split into single letters for animation: ${split.map((x) => `${x.size}px "${x.sample.slice(0, 30)}" (${x.elements} pieces)`).join('; ')}. Why: many elements of that style hold only one or two characters each (the SplitText pattern).`,
    );
  const sc = d.typography.scale;
  push('');
  if (sc.ratio && sc.consistent)
    push(
      `- ${I} Sizes ${sc.sizes.join(' / ')} px fit a ~${sc.ratio} scale${sc.ratioName ? ` (${sc.ratioName})` : ''} from a ${sc.base}px base. Why: fitted from the sizes in use.`,
    );
  else if (sc.sizes.length)
    push(
      `- ${V} Sizes in use: ${sc.sizes.join(' / ')} px, base ${sc.base}px. They do not follow a single modular ratio${sc.ratio ? ` (average step ${sc.ratio})` : ''}.`,
    );
  if (d.typography.fluid.length)
    push(
      `- ${V} Fluid type in CSS: ${d.typography.fluid
        .slice(0, 4)
        .map((f) => `\`${f.selector} { font-size: ${f.value} }\``)
        .join(', ')}.`,
    );
  push('');

  // colour
  push('## Colour', '');
  const c = d.color;
  if (c.coverage) {
    const parts = Object.entries(c.coverage)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k === 'dom' ? 'HTML backgrounds' : k} ${Math.round(v * 100)}%`);
    if (parts.length) push(`- ${V} The first screen is painted by: ${parts.join(', ')} (160 points checked with elementsFromPoint).`);
  }
  if (c.background)
    push(
      `- ${V} ${c.coverage && c.coverage.canvas + c.coverage.video >= 0.5 ? 'HTML background (mostly hidden under the canvas/video)' : 'Background'} **${c.background.hex}** (${c.background.name}), ${pct(c.background.share)} of painted colour.`,
    );
  if (c.text)
    push(
      `- ${V} Text **${c.text.hex}** (${c.text.name})${c.bodyContrast ? `, contrast ${c.bodyContrast}:1 on the background (${c.bodyContrast >= 7 ? 'AAA' : c.bodyContrast >= 4.5 ? 'AA' : c.bodyContrast >= 3 ? 'AA for large text only' : 'below AA'})` : ''}.`,
    );
  if (c.accents.length) push(`- ${V} Accents: ${c.accents.map((a) => `${a.hex} ${a.name}`).join(', ')}.`);
  if (c.neutrals.length) push(`- ${V} Neutrals: ${c.neutrals.map((a) => `${a.hex} ${a.name}`).join(', ')}.`);
  if (c.screen.length)
    push(
      `- ${V} What the screen actually shows (screenshots, includes WebGL and images): ${c.screen
        .slice(0, 6)
        .map((a) => `${a.hex} ${a.name} ${pct(a.share)}`)
        .join(', ')}.`,
    );
  const vars = Object.entries(c.variables);
  if (vars.length)
    push(
      `- ${V} Colour variables in CSS: ${vars
        .slice(0, 12)
        .map(([k, v]) => `\`${k}: ${v}\``)
        .join(', ')}${vars.length > 12 ? ` and ${vars.length - 12} more` : ''}.`,
    );
  if (c.gradients.length)
    push(
      `- ${V} Gradients: ${c.gradients
        .slice(0, 3)
        .map((g) => `\`${g.css.slice(0, 90)}\` on ${g.selector}`)
        .join('; ')}.`,
    );
  push('');

  // motion
  push('## Motion', '');
  const m = d.motion;
  const ob = m.css.observed;
  if (ob.count) {
    push(
      `- ${V} ${ob.count} CSS animations / transitions / Web Animations ran while DEA watched (${Object.entries(ob.byType)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')}; ${Object.entries(ob.byPhase)
        .map(([k, v]) => `${v} during ${k}`)
        .join(', ')}).`,
    );
    if (ob.durations.length) push(`  Durations: ${ob.durations.map((x) => `${x.ms}ms ×${x.count}`).join(', ')}.`);
    if (ob.easings.length)
      push(`  Easing: ${ob.easings.map((e) => `\`${e.value}\`${e.name && e.name !== e.value ? ` (${e.name})` : ''} ×${e.count}`).join(', ')}.`);
    for (const e of ob.examples.slice(0, 6))
      push(
        `  - ${e.type} ${e.name ? `"${e.name}" ` : ''}on ${e.target ?? '?'}: ${e.duration}ms${e.delay ? ` after ${e.delay}ms` : ''}, ${e.easing}${e.iterations > 1 || !Number.isFinite(e.iterations) ? `, repeats ${Number.isFinite(e.iterations) ? e.iterations : 'forever'}` : ''}`,
      );
  } else push(`- ${V} No CSS animation or transition ran while DEA watched (load, idle and scrolling).`);
  const dc = m.css.declared;
  if (dc.durations.length || dc.easings.length) {
    push(
      `- ${V} Declared in the stylesheets: durations ${
        dc.durations
          .slice(0, 6)
          .map((x) => `${x.ms}ms`)
          .join(', ') || 'none'
      }; easings ${
        dc.easings
          .slice(0, 5)
          .map((e) => `\`${e.value}\`${e.name && e.name !== e.value ? ` (${e.name})` : ''}`)
          .join(', ') || 'none'
      }.`,
    );
    if (dc.keyframes.length) push(`  Keyframes: ${dc.keyframes.slice(0, 12).join(', ')}.`);
  }
  const g = m.js.gsap;
  if (g.version && !g.animatedElements && !g.tweens.length) {
    push(
      `- ${I} GSAP ${g.version} is loaded, but no page element carries GSAP’s \`_gsap\` cache. Why: GSAP leaves that cache on every DOM element it animates, so here it most likely animates JavaScript values (three.js objects, uniforms, a timeline the scroll drives) rather than HTML.${g.global ? '' : ' Unknown: its eases, because GSAP is bundled.'}`,
    );
  } else if (g.version || g.animatedElements) {
    push(
      `- ${V} GSAP ${g.version ?? '(version unknown)'} has animated ${g.animatedElements} elements so far${
        Object.keys(g.animatedProps).length
          ? `, using ${Object.entries(g.animatedProps)
              .map(([k, v]) => `${k} (${v})`)
              .join(', ')}`
          : ''
      }. Evidence: GSAP’s own \`_gsap\` cache on those elements.`,
    );
    if (g.global && g.tweens.length) {
      push(
        `  Eases: ${g.eases
          .slice(0, 6)
          .map((e) => `${e.ease} ×${e.count}`)
          .join(', ')}.`,
      );
      for (const t of g.tweens.slice(0, 6))
        push(
          `  - ${t.duration}s ${t.ease} on ${t.targets} → ${t.props.join(', ')}${t.scroll ? ' (scroll-linked)' : ''}${t.repeat ? `, repeat ${t.repeat}${t.yoyo ? ' yoyo' : ''}` : ''}`,
        );
    } else if (!g.global)
      push(
        '  GSAP is bundled into the site’s code (no `window.gsap`), so the individual tweens and eases are not readable from outside. Unknown: exact eases.',
      );
    if (g.scrollTriggers.length)
      for (const st of g.scrollTriggers.slice(0, 6))
        push(`  - ScrollTrigger on ${st.trigger}: ${st.start} → ${st.end}${st.scrub ? `, scrub ${st.scrub}` : ''}${st.pin ? ', pinned' : ''}`);
    else if (g.pinSpacers) push(`  ${g.pinSpacers} pinned sections (\`.pin-spacer\` wrappers from ScrollTrigger).`);
  }
  if (m.js.lenis.present)
    push(
      `- ${V} Lenis smooth scroll${m.js.lenis.version ? ` ${m.js.lenis.version}` : ''}${m.js.lenis.options ? `, options ${JSON.stringify(m.js.lenis.options)}` : ''}.`,
    );
  if (m.js.idle.frames < 10)
    push(
      `- Unknown: JavaScript-driven HTML motion. Only ${m.js.idle.frames} frames came in during the ${m.js.idle.sampledMs}ms watch (the page renders slowly here), too few to tell.`,
    );
  else if (!m.js.idle.jsDriven.length) push(`- ${V} No HTML element moved from JavaScript while the page sat idle (${m.js.idle.frames} frames watched).`);
  if (m.js.idle.jsDriven.length)
    push(
      `- ${I} Moving from JavaScript every frame (no CSS animation on them): ${m.js.idle.jsDriven
        .slice(0, 6)
        .map((x) => `${x.selector} (${x.props.join('/')})`)
        .join(', ')}. Why: their styles changed between frames while idle.`,
    );
  if (m.rafPerSecond)
    push(
      `- ${V} The page asks for a new animation frame ~${m.rafPerSecond} times a second while idle${m.rafPerSecond >= 50 ? ' (a continuous render loop)' : run.meta.browser.headless ? ' (fewer than 60 here because this machine renders slowly)' : ''}.`,
    );
  push('');

  // scroll
  push('## Scroll', '');
  const s = d.scroll;
  push(
    `- ${s.mode === 'native' || s.mode === 'does not scroll' ? V : I} ${s.mode[0].toUpperCase()}${s.mode.slice(1)}.${s.mode.startsWith('smooth') && s.settleMs ? ` One wheel tick glides for ~${s.settleMs}ms through ${s.intermediateFrames} in-between positions.` : ''}${s.mode.startsWith('custom') ? ' Why: the wheel changed the picture but the page’s scroll position stayed at 0.' : ''}`,
  );
  push(`- ${V} Page height ${s.documentHeight}px = ${s.screens} screens of ${s.viewportHeight}px.`);
  if (s.fixed.length) push(`- ${V} Fixed / sticky layers: ${s.fixed.join(', ')}.`);
  if (s.hero.moves) push(`- ${V} The first screen animates on its own (mean pixel change ${s.hero.change} between frames ${s.hero.files.join(', ')}).`);
  const shots = s.steps.filter((x) => x.file);
  if (shots.length)
    push(`- Frames: ${shots.map((x) => `\`${x.file}\` (y=${x.scrollY}${x.visualChange !== null ? `, change ${x.visualChange}` : ''})`).join(', ')}.`);
  if (s.misses?.length)
    push(
      `- Unknown: ${s.misses.length} screenshots could not be taken because the page drew frames too slowly on this machine, so on-screen colours and visual change are partial.`,
    );
  if (s.truncated) push('- Scroll sampling stopped early (time budget) because this machine renders the page slowly.');
  push('');

  // webgl
  if (sh.shaderCount || d.webgl.canvases.length || d.webgl.three.scenes.length) {
    push('## WebGL and 3D', '');
    for (const cv of d.webgl.canvases)
      push(
        `- ${V} Canvas ${cv.id}: ${cv.width}×${cv.height} px in ${cv.cssWidth}×${cv.cssHeight} CSS px${cv.coversViewport ? ', full screen' : ''}, position ${cv.position}.`,
      );
    for (const r of d.webgl.three.renderers.slice(0, 2))
      push(
        `- ${V} three.js ${r.kind}: tone mapping ${r.toneMapping}${r.exposure !== null ? `, exposure ${r.exposure}` : ''}, output ${r.colorSpace}, pixel ratio ${r.pixelRatio}, shadows ${r.shadows}, antialias ${r.antialias}; ${r.geometries} geometries and ${r.textures} textures in GPU memory. Its last render call drew ${r.calls} draw calls / ${r.triangles?.toLocaleString('en-US')} triangles${r.points ? ` / ${r.points.toLocaleString('en-US')} points` : ''}${(r.calls ?? 0) <= 2 ? ' — a full-screen pass, so the scene is drawn off-screen first and finished with post-processing (renderer tone mapping can read "none" because an effect does it)' : ''}.`,
      );
    for (const scn of d.webgl.three.scenes.slice(0, 3)) {
      push(
        `- ${V} Scene: ${scn.objects} objects (${Object.entries(scn.types)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([k, v]) => `${v} ${k}`)
          .join(
            ', ',
          )}), ${scn.vertices.toLocaleString('en-US')} vertices${scn.instances ? `, ${scn.instances} instances` : ''}; materials ${Object.keys(scn.materials).join(', ') || 'none'}${
          scn.lights.length
            ? `; lights ${scn.lights
                .slice(0, 5)
                .map((l) => `${l.type} ${l.color ?? ''} ×${l.intensity}`)
                .join(', ')}`
            : ''
        }${scn.fog ? `; fog ${scn.fog}` : ''}${scn.background ? `; background ${scn.background}` : ''}${scn.environment ? '; environment map' : ''}.`,
      );
      if (scn.names.length) push(`  Named objects: ${scn.names.slice(0, 15).join(', ')}.`);
    }
    if (sh.shaderCount) {
      push(
        `- ${V} ${sh.shaderCount} shaders compiled (${sh.vertex} vertex, ${sh.fragment} fragment${sh.wgsl ? `, ${sh.wgsl} WGSL` : ''}), ${sh.programs.length} unique.`,
      );
      const mats = Object.entries(sh.materials);
      if (mats.length) push(`- ${V} three.js material types: ${mats.map(([k, v]) => `${k} ×${v}`).join(', ')}.`);
      if (sh.customPrograms)
        push(
          `- ${V} ${sh.customPrograms} fragment programs are written for this site${sh.origins.custom.length ? `: ${sh.origins.custom.join(', ')}` : ''}${sh.origins.unnamedCustom ? ` (+${sh.origins.unnamedCustom} unnamed)` : ''}.`,
        );
      if (sh.customUniforms.length)
        push(
          `- ${V} Their uniforms: ${sh.customUniforms
            .slice(0, 24)
            .map((u) => `\`${u}\``)
            .join(', ')}.`,
        );
      if (sh.techniquesCustom.length)
        push(`- ${I} Techniques in the site’s own shaders: ${sh.techniquesCustom.join(', ')}. Why: function and keyword names in the GLSL.`);
      if (sh.interactivity.length)
        push(`- ${I} The site’s shaders appear to ${sh.interactivity.join(' and ')}. Why: uniform names like uTime, uMouse, uScroll.`);
      if (sh.origins.postprocessing.length) push(`- ${I} Post-processing through the "postprocessing" library: ${sh.origins.postprocessing.join(', ')}.`);
      if (sh.origins.addons.length || sh.origins.internal.length)
        push(`- ${V} three.js’s own programs: ${[...sh.origins.addons, ...sh.origins.internal].join(', ')}.`);
      if (d.webgl.shaderFiles.length) push(`- Shader sources saved in \`shaders/\` (${d.webgl.shaderFiles.length} files, the site’s own first).`);
    }
    if (run.meta.warnings.some((w) => w.includes('software')))
      push('- Note: this decode ran with software WebGL; frame rates and timings are slower than on a real GPU.');
    push('');
  }

  // layout
  push('## Layout details', '');
  if (d.layout.breakpoints.length) push(`- ${V} Breakpoints in CSS: ${d.layout.breakpoints.map((b) => `${b.px}px`).join(', ')}.`);
  if (d.layout.radii.length) push(`- ${V} Corner radii: ${d.layout.radii.map((r) => `${r.value} ×${r.count}`).join(', ')}.`);
  if (d.layout.shadows.length)
    push(
      `- ${V} Shadows: ${d.layout.shadows
        .slice(0, 3)
        .map((r) => `\`${r.value.slice(0, 70)}\``)
        .join(', ')}.`,
    );
  push(`- ${d.css.sheets} stylesheets read (${Math.round(d.css.bytes / 1024)} KB), ${d.layout.elementsScanned} visible elements scanned.`);
  push('');

  // recipe
  push('## To rebuild this feel (DEA’s reading)', '');
  const recipe: string[] = [];
  if (fam[0])
    recipe.push(
      `Set text in ${fam[0].family} (${fam[0].weights.join('/')})${d.typography.scale.base ? ` at ${d.typography.scale.base}px` : ''}${d.typography.styles[0]?.lineHeight ? ` with line-height ${d.typography.styles[0].lineHeight}` : ''}.`,
    );
  if (c.background && c.text)
    recipe.push(`Use ${c.background.hex} as the ground and ${c.text.hex} for text${c.accents[0] ? `; keep ${c.accents[0].hex} for accents` : ''}.`);
  if (easeNames.length) recipe.push(`Move things with ${easeNames.slice(0, 2).join(' / ')} easing${dc.durations[0] ? ` around ${dc.durations[0].ms}ms` : ''}.`);
  if (g.version) recipe.push(`Drive the choreography with GSAP ${g.version}${g.scrollTriggers.length || g.pinSpacers ? ' and ScrollTrigger' : ''}.`);
  if (s.mode.startsWith('smooth')) recipe.push(`Add eased smooth scrolling${m.js.lenis.present ? ' (Lenis)' : ''} that settles over ~${s.settleMs}ms.`);
  if (s.mode.startsWith('custom')) recipe.push('Let the wheel drive a scene timeline instead of scrolling the document.');
  if (sh.customPrograms)
    recipe.push(
      `Write custom GLSL as three.js ShaderMaterials${sh.techniquesCustom.length ? ` using ${sh.techniquesCustom.slice(0, 3).join(', ')}` : ''}${sh.interactivity.length ? ` that ${sh.interactivity.join(' and ')}` : ''}.`,
    );
  if (sh.origins.postprocessing.length) recipe.push('Finish with a post-processing stack (bloom/SMAA-style passes).');
  for (const r of recipe) push(`- ${I} ${r}`);
  if (!recipe.length) push('- Not enough signals to suggest a recipe.');
  push('', '---', `Run \`${d.runId}\`. Machine-readable tokens are in \`design.json\` (\`tokens\`, W3C design-token format).`, '');
  return o.join('\n');
}
