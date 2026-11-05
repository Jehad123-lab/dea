import type { Session } from '../browser/open.ts';
import type { RunWriter } from '../evidence/run.ts';
import { renderReport } from '../report.ts';
import { collect, type InspectOptions, type InspectResult } from '../see/inspect.ts';
import type { NetEntry } from '../see/network.ts';
import type { Fact } from '../types.ts';
import { type AnimationWatch, describeTargets, readDomAndCss, watchAnimations } from './cdp.ts';
import { type ColorGroup, colorRoles, contrast, groupColors } from './colors.ts';
import { easingName, readCss } from './css.ts';
import { renderDesignMd } from './markdown.ts';
import { readJsMotion } from './motion.ts';
import { sampleStyles } from './sample.ts';
import { sampleScroll } from './scroll.ts';
import { type RawShader, summarizeShaders } from './shaders.ts';
import { readThree } from './three.ts';
import { typeScale, typeStyles } from './type.ts';

export interface DesignOptions extends InspectOptions {
  /** how many wheel steps to scroll (default 7) */
  scrollSteps?: number;
  /** stop scrolling after this long, for very slow machines (default 90 s) */
  scrollBudgetMs?: number;
}

export interface DesignResult extends InspectResult {
  design: Design;
  designMd: string;
}

export type Design = Awaited<ReturnType<typeof buildDesign>>;

function fontSource(url: string, site: string): string {
  if (/fonts\.gstatic\.com|fonts\.googleapis\.com/.test(url)) return 'Google Fonts';
  if (/typekit\.net|use\.typekit/.test(url)) return 'Adobe Fonts';
  if (/fonts\.bunny\.net/.test(url)) return 'Bunny Fonts';
  if (/framerusercontent\.com/.test(url)) return 'Framer (hosted)';
  if (/website-files\.com/.test(url)) return 'Webflow (hosted)';
  if (/fontshare\.com/.test(url)) return 'Fontshare';
  try {
    const h = new URL(url).hostname;
    return site && h.endsWith(site) ? 'self-hosted' : `hosted on ${h}`;
  } catch {
    return 'embedded (data URL)';
  }
}

async function buildDesign(session: Session, writer: RunWriter, watch: AnimationWatch, opts: DesignOptions) {
  const { page, cdp } = session;
  const t0 = Date.now();
  const say = (step: string) => {
    opts.onProgress?.(step);
    void writer.progress(`${step} (+${Math.round((Date.now() - t0) / 1000)}s)`);
  };
  // 1. render loop rate while idle (nothing of DEA's runs in the page during this second)
  const r0 = await page.evaluate(() => (window as any).__DEA__?.raf?.calls ?? 0);
  await page.waitForTimeout(1000);
  const r1 = await page.evaluate(() => (window as any).__DEA__?.raf?.calls ?? 0);
  const rafPerSecond = r1 - r0;

  say('reading computed styles');
  watch.phase.name = 'idle';
  const styles = await sampleStyles(page);
  say('asking Chrome which fonts drew the text');
  const domCss = await readDomAndCss(cdp);
  const css = readCss(domCss.sheets);
  say('reading three.js scenes');
  const three = await readThree(page).catch(() => ({ renderers: [], scenes: [] }));
  say('watching JavaScript motion');
  const js = await readJsMotion(page, 1200);
  const faces = await page.evaluate(() =>
    Array.from(document.fonts).map((f) => ({
      family: f.family.replace(/^["']|["']$/g, ''),
      weight: f.weight,
      style: f.style,
      status: f.status,
      display: f.display,
    })),
  );
  say('scrolling the page');
  watch.phase.name = 'scroll';
  const scroll = await sampleScroll(page, writer, { steps: opts.scrollSteps ?? 7, budgetMs: opts.scrollBudgetMs ?? 90_000 });
  if (scroll.misses.length) say(`some frames could not be captured: ${scroll.misses.length} (page renders very slowly here)`);
  if (scroll.truncated) say(`scroll sampling stopped after ${scroll.steps.length - 1} steps (time budget; this machine renders slowly)`);
  say('reading what moved');
  await watch.stop();
  await describeTargets(cdp, watch.events);
  const shadersRaw: RawShader[] = await page.evaluate(() => {
    const D = (window as any).__DEA__ ?? {};
    return [...(D.shaders ?? []), ...(D.webgpu?.shaders ?? [])];
  });

  // ---- typography
  const textChars = styles.text.reduce((n, t) => n + t.chars, 0) || 1;
  const families = new Map<
    string,
    {
      family: string;
      rendered: Map<string, { name: string; postScriptName: string | null; custom: boolean; glyphs: number }>;
      weights: Set<string>;
      chars: number;
      selectors: string[];
    }
  >();
  for (const t of styles.text) {
    const f = families.get(t.family) ?? { family: t.family, rendered: new Map(), weights: new Set<string>(), chars: 0, selectors: [] as string[] };
    f.weights.add(t.weight);
    f.chars += t.chars;
    if (f.selectors.length < 3) f.selectors.push(t.selector);
    if (t.fontId !== null) {
      for (const pf of domCss.platformFonts[String(t.fontId)] ?? []) {
        const prev = f.rendered.get(pf.familyName);
        f.rendered.set(pf.familyName, {
          name: pf.familyName,
          postScriptName: pf.postScriptName ?? null,
          custom: pf.isCustomFont,
          glyphs: (prev?.glyphs ?? 0) + pf.glyphCount,
        });
      }
    }
    families.set(t.family, f);
  }
  const fontFamilies = [...families.values()]
    .sort((a, b) => b.chars - a.chars)
    .map((f) => {
      const face = css.fontFaces.find((x) => x.family.toLowerCase() === f.family.toLowerCase());
      const rendered = [...f.rendered.values()].sort((a, b) => b.glyphs - a.glyphs);
      return {
        family: f.family,
        share: Math.round((f.chars / textChars) * 1000) / 1000,
        weights: [...f.weights].sort(),
        rendered,
        webfont: rendered.some((r) => r.custom) || !!face,
        fallbackUsed: rendered.length > 0 && !rendered.some((r) => r.name.toLowerCase().includes(f.family.toLowerCase().split(' ')[0])),
        files: face?.urls.slice(0, 4) ?? [],
        source: null as string | null,
        selectors: f.selectors,
      };
    });
  const styleList = typeStyles(styles.text);
  const scale = typeScale(styles.text);

  // ---- colour
  const kinds = (k: string) =>
    groupColors(
      styles.colors.filter((c) => c.kind === k),
      0.035,
      8,
    );
  // the palette counts what elements paint; 'visible' samples (what is on top of the first screen) only pick the background
  const palette = groupColors(
    styles.colors.filter((c) => c.kind !== 'visible'),
    0.035,
    16,
  );
  const visibleBg = styles.coverage.dom >= 0.2 ? kinds('visible') : [];
  const roles = colorRoles(palette, (k) => (k === 'background' && visibleBg.length ? visibleBg : kinds(k)));
  const screenSamples = scroll.frames.flatMap((f) => f.buckets.map(([r, g, b, n]) => ({ css: `rgb(${r}, ${g}, ${b})`, weight: n, kind: 'screen' })));
  const screen = groupColors(screenSamples, 0.05, 10);
  const colorVars = Object.entries({ ...css.customProps, ...styles.rootVars })
    .filter(([, v]) => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i.test(v.trim()))
    .slice(0, 40);
  const bodyContrast = roles.text && roles.background ? contrast(roles.text.hex, roles.background.hex) : null;

  // ---- motion
  const anims = watch.events;
  const animEasings = new Map<string, number>();
  const animDurations = new Map<number, number>();
  for (const a of anims) {
    for (const e of [a.easing, ...a.keyframeEasings]) if (e && e !== 'linear') animEasings.set(e, (animEasings.get(e) ?? 0) + 1);
    if (a.duration) animDurations.set(a.duration, (animDurations.get(a.duration) ?? 0) + 1);
  }
  const top = <K>(m: Map<K, number>, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const cssMotion = {
    observed: {
      count: anims.length,
      byType: anims.reduce<Record<string, number>>((o, a) => ((o[a.type] = (o[a.type] ?? 0) + 1), o), {}),
      byPhase: anims.reduce<Record<string, number>>((o, a) => ((o[a.phase] = (o[a.phase] ?? 0) + 1), o), {}),
      durations: top(animDurations).map(([ms, count]) => ({ ms, count })),
      easings: top(animEasings).map(([value, count]) => ({ value, name: easingName(value), count })),
      examples: anims.slice(0, 15).map((a) => ({
        type: a.type,
        name: a.name,
        target: a.target ?? null,
        duration: a.duration,
        delay: a.delay,
        easing: a.easing,
        iterations: a.iterations,
        phase: a.phase,
      })),
    },
    declared: {
      durations: css.durations,
      easings: css.easings.map((e) => ({ ...e, name: easingName(e.value) })),
      transitions: css.transitions.slice(0, 8),
      keyframes: css.keyframes,
    },
  };

  // ---- WebGL
  const shaders = summarizeShaders(shadersRaw);
  const canvases = await page.evaluate(() =>
    Array.from(document.querySelectorAll('canvas[data-dea-canvas]')).map((c) => {
      const el = c as HTMLCanvasElement;
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-dea-canvas'),
        width: el.width,
        height: el.height,
        cssWidth: Math.round(r.width),
        cssHeight: Math.round(r.height),
        position: getComputedStyle(el).position,
        coversViewport: r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9,
      };
    }),
  );
  return {
    schema: 'dea.design/1' as const,
    typography: { families: fontFamilies, styles: styleList, scale, fluid: css.fluidType, faces, fontFaceRules: css.fontFaces.slice(0, 120) },
    color: {
      coverage: styles.coverage,
      scheme: roles.scheme,
      background: roles.background,
      text: roles.text,
      accents: roles.accents,
      neutrals: roles.neutrals,
      palette,
      screen,
      gradients: styles.gradients,
      variables: Object.fromEntries(colorVars),
      bodyContrast,
    },
    motion: { css: cssMotion, js, rafPerSecond },
    scroll: { ...scroll, frames: scroll.frames.map((f) => ({ file: f.file, diff: f.diff, brightness: f.brightness })) },
    webgl: { canvases, three, shaders: { ...shaders, programs: shaders.programs.map(({ ...p }) => p) }, shaderFiles: [] as string[] },
    layout: {
      viewport: styles.viewport,
      breakpoints: css.breakpoints,
      radii: Object.entries(styles.radii)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([value, count]) => ({ value, count })),
      shadows: Object.entries(styles.shadows)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count })),
      elementsScanned: styles.elementsScanned,
    },
    css: { sheets: css.sheets, bytes: css.bytes, customProps: Object.keys(css.customProps).length },
    raw: { shaders: shadersRaw },
  };
}

function tokens(d: Design) {
  const color: Record<string, unknown> = {};
  if (d.color.background) color.background = { $type: 'color', $value: d.color.background.hex };
  if (d.color.text) color.text = { $type: 'color', $value: d.color.text.hex };
  for (const [i, a] of d.color.accents.entries()) color[`accent-${i + 1}`] = { $type: 'color', $value: a.hex, $description: a.name };
  for (const [i, a] of d.color.neutrals.entries()) color[`neutral-${i + 1}`] = { $type: 'color', $value: a.hex, $description: a.name };
  const fontFamily: Record<string, unknown> = {};
  for (const [i, f] of d.typography.families.slice(0, 4).entries())
    fontFamily[i === 0 ? 'primary' : `family-${i + 1}`] = { $type: 'fontFamily', $value: f.family };
  const fontSize: Record<string, unknown> = {};
  for (const s of d.typography.scale.sizes) fontSize[`${s}`] = { $type: 'dimension', $value: `${s}px` };
  const duration: Record<string, unknown> = {};
  for (const x of [...d.motion.css.declared.durations, ...d.motion.css.observed.durations].slice(0, 8))
    duration[`${x.ms}ms`] = { $type: 'duration', $value: `${x.ms}ms` };
  const cubicBezier: Record<string, unknown> = {};
  const seen = new Set<string>();
  let n = 0;
  for (const e of [...d.motion.css.observed.easings, ...d.motion.css.declared.easings]) {
    const m = e.value.match(/cubic-bezier\(([^)]+)\)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const named = e.name && !e.name.startsWith('custom') ? e.name.replace(/[^\w]+/g, '-') : `custom-${++n}`;
    cubicBezier[named] = { $type: 'cubicBezier', $value: m[1].split(',').map(Number), ...(e.name ? { $description: e.name } : {}) };
  }
  return { color, fontFamily, fontSize, duration, cubicBezier };
}

function designFacts(d: Design): Fact[] {
  const f: Fact[] = [];
  const fam = d.typography.families;
  if (fam.length) {
    const main = fam[0];
    f.push({
      key: 'design.fonts',
      claim: `Text is set mostly in ${main.family}${main.rendered[0] && main.rendered[0].name !== main.family ? ` (drawn with ${main.rendered[0].name})` : ''}, ${Math.round(main.share * 100)}% of characters${
        fam.length > 1
          ? `; also ${fam
              .slice(1, 4)
              .map((x) => x.family)
              .join(', ')}`
          : ''
      }.`,
      value: fam.map((x) => ({ family: x.family, share: x.share, rendered: x.rendered.map((r) => r.name) })),
      label: 'Verified',
      evidence: [
        {
          source: 'cdp',
          pointer: 'CSS.getPlatformFontsForNode',
          excerpt: main.rendered.map((r) => `${r.name}${r.custom ? ' (web font)' : ' (system)'}`).join(', ') || 'no glyph data',
        },
        { source: 'computed-style', pointer: main.selectors[0] ?? 'font-family' },
      ],
    });
  }
  const s = d.typography.scale;
  if (s.sizes.length) {
    f.push({
      key: 'design.type-scale',
      claim:
        s.ratio && s.consistent
          ? `Font sizes ${s.sizes.join(', ')} px follow a ~${s.ratio} ratio${s.ratioName ? ` (${s.ratioName})` : ''}, base ${s.base}px.`
          : `Font sizes in use: ${s.sizes.join(', ')} px (base ${s.base}px); they do not follow one modular ratio.`,
      value: s,
      label: s.ratio && s.consistent ? 'Inferred' : 'Verified',
      evidence: [{ source: 'computed-style', pointer: 'font-size of text elements', excerpt: `${d.layout.elementsScanned} elements scanned` }],
      ...(s.ratio && s.consistent ? { why: 'fitted from the sizes in use; the designer may not have used a formal scale' } : {}),
    });
  }
  const c = d.color;
  if (c.background || c.text) {
    f.push({
      key: 'design.colors',
      claim: `${c.scheme === 'dark' ? 'Dark' : c.scheme === 'light' ? 'Light' : 'Mixed'} scheme: background ${c.background?.hex ?? '?'} (${c.background?.name ?? '?'}), text ${c.text?.hex ?? '?'} (${c.text?.name ?? '?'})${
        c.accents.length
          ? `, accents ${c.accents
              .slice(0, 3)
              .map((a) => `${a.hex} ${a.name}`)
              .join(', ')}`
          : ''
      }${c.bodyContrast ? `; text contrast ${c.bodyContrast}:1` : ''}.`,
      value: { background: c.background?.hex, text: c.text?.hex, accents: c.accents.map((a) => a.hex) },
      label: 'Verified',
      evidence: [{ source: 'computed-style', pointer: 'color / background-color, weighted by text length and area' }],
    });
  }
  if (c.screen.length) {
    f.push({
      key: 'design.screen-colors',
      claim: `On screen (including canvas/WebGL), the main colours are ${c.screen
        .slice(0, 4)
        .map((x) => `${x.hex} ${x.name} ${Math.round(x.share * 100)}%`)
        .join(', ')}.`,
      value: c.screen.map((x) => ({ hex: x.hex, share: x.share })),
      label: 'Verified',
      evidence: [{ source: 'screenshot', pointer: `${d.scroll.frames.length} frames in frames/`, excerpt: 'pixel colours grouped in OKLab' }],
    });
  }
  const m = d.motion;
  const easings = [...m.css.observed.easings, ...m.css.declared.easings].filter((e) => e.name);
  if (m.css.observed.count || m.css.declared.durations.length) {
    f.push({
      key: 'design.motion.css',
      claim: `CSS motion: ${m.css.observed.count} animations/transitions ran while DEA watched${
        m.css.observed.durations.length
          ? `, mostly ${m.css.observed.durations
              .slice(0, 3)
              .map((x) => `${x.ms}ms`)
              .join(', ')}`
          : ''
      }${easings.length ? `; easing ${[...new Set(easings.map((e) => e.name))].slice(0, 3).join(', ')}` : ''}.`,
      value: { observed: m.css.observed.count, durations: m.css.observed.durations, easings },
      label: 'Verified',
      evidence: [
        { source: 'cdp', pointer: 'Animation.animationStarted', excerpt: `${m.css.observed.count} events` },
        { source: 'stylesheet', pointer: 'transition / animation declarations', excerpt: `${m.css.declared.durations.length} durations declared` },
      ],
    });
  }
  const g = m.js.gsap;
  if (g.version || g.animatedElements) {
    const verifiedTweens = g.global && g.tweens.length;
    f.push({
      key: 'design.motion.gsap',
      claim:
        !g.animatedElements && !g.tweens.length
          ? `GSAP ${g.version ?? ''} is loaded but no HTML element carries its _gsap cache, so it most likely animates JavaScript values (e.g. three.js objects) rather than page elements.`
          : `GSAP ${g.version ?? ''} animates ${g.animatedElements} elements${Object.keys(g.animatedProps).length ? ` (${Object.keys(g.animatedProps).slice(0, 5).join(', ')})` : ''}${
              verifiedTweens
                ? `; eases ${g.eases
                    .slice(0, 3)
                    .map((e) => e.ease)
                    .join(', ')}`
                : ''
            }${g.scrollTriggers.length || g.pinSpacers ? `; ${g.scrollTriggers.length || ''} ScrollTriggers${g.pinSpacers ? `, ${g.pinSpacers} pinned sections` : ''}` : ''}.`,
      value: { version: g.version, elements: g.animatedElements, eases: g.eases, scrollTriggers: g.scrollTriggers.length },
      label: !g.animatedElements && !g.tweens.length ? 'Inferred' : 'Verified',
      evidence: [
        { source: 'dom', pointer: 'element._gsap (GSAP’s own cache on animated elements)', excerpt: `${g.animatedElements} elements` },
        ...(verifiedTweens ? [{ source: 'global' as const, pointer: 'gsap.globalTimeline.getChildren()', excerpt: `${g.tweens.length} tweens` }] : []),
      ],
      ...(!g.global ? { why: 'GSAP is bundled (no window.gsap), so DEA can see which elements it moves but not each tween’s ease' } : {}),
    });
  }
  if (m.js.idle.jsDriven.length) {
    f.push({
      key: 'design.motion.js',
      claim: `${m.js.idle.jsDriven.length} visible elements keep changing ${[...new Set(m.js.idle.jsDriven.flatMap((x) => x.props))].join('/')} every frame without any CSS animation: motion driven from JavaScript.`,
      value: m.js.idle.jsDriven,
      label: 'Inferred',
      evidence: m.js.idle.jsDriven
        .slice(0, 3)
        .map((x) => ({ source: 'sampling' as const, pointer: x.selector, excerpt: `${x.changes} changes in ${m.js.idle.sampledMs}ms` })),
      why: 'style changed between animation frames while no CSS animation or transition was running on it',
    });
  }
  const sc = d.scroll;
  f.push({
    key: 'design.scroll',
    claim: `Scrolling is ${sc.mode}${sc.mode.startsWith('smooth') && sc.settleMs ? ` (one wheel tick eases out over ~${sc.settleMs}ms${m.js.lenis.present ? ', Lenis' : ''})` : ''}; the page is ${sc.screens} screen${sc.screens === 1 ? '' : 's'} tall${sc.fixed.length ? `, with ${sc.fixed.length} fixed/sticky layers` : ''}.`,
    value: { mode: sc.mode, settleMs: sc.settleMs, screens: sc.screens },
    label: sc.mode === 'native' || sc.mode === 'does not scroll' ? 'Verified' : m.js.lenis.present ? 'Verified' : 'Inferred',
    evidence: [{ source: 'sampling', pointer: 'scrollY per frame after one wheel tick', excerpt: `${sc.intermediateFrames} in-between positions` }],
    ...(sc.mode.startsWith('custom') ? { why: 'the wheel changed what is on screen but scrollY stayed 0: the scroll drives the scene directly' } : {}),
  });
  if (sc.hero.moves) {
    f.push({
      key: 'design.hero-motion',
      claim: 'The first screen keeps moving on its own (pixels changed between frames with nobody touching the page).',
      value: sc.hero.change,
      label: 'Verified',
      evidence: [{ source: 'screenshot', pointer: sc.hero.files.join(', '), excerpt: `mean pixel change ${sc.hero.change}` }],
    });
  }
  const t3 = d.webgl.three;
  if (t3.renderers.length || t3.scenes.length) {
    const r = t3.renderers[0];
    const sc0 = t3.scenes.reduce((a, b) => (b.objects > (a?.objects ?? 0) ? b : a), t3.scenes[0]);
    f.push({
      key: 'design.webgl.three',
      claim: `three.js ${r ? `${r.kind}: tone mapping ${r.toneMapping}${r.exposure !== null ? ` (exposure ${r.exposure})` : ''}, ${r.colorSpace ?? 'colour space ?'}, pixel ratio ${r.pixelRatio}, shadows ${r.shadows}, ${r.calls ?? '?'} draw calls, ${r.triangles?.toLocaleString('en-US') ?? '?'} triangles` : ''}${sc0 ? `${r ? '; ' : ''}largest scene has ${sc0.objects} objects, ${Object.keys(sc0.materials).slice(0, 4).join(', ')}${sc0.lights.length ? `, ${sc0.lights.length} lights` : ''}` : ''}.`,
      value: t3,
      label: 'Verified',
      evidence: [
        {
          source: 'global',
          pointer: '__THREE_DEVTOOLS__ observe events (three.js’s own hook)',
          excerpt: `${t3.renderers.length} renderers, ${t3.scenes.length} scenes`,
        },
      ],
    });
  }
  return f;
}

/** Phase 2: decode how a site looks and moves. Writes design.json, design.md, shaders/ and frames/. */
export async function decodeDesign(url: string, opts: DesignOptions = {}): Promise<DesignResult> {
  let watch: AnimationWatch | null = null;
  let design: Design | null = null;
  const res = await collect(
    url,
    'design',
    {
      ...opts,
      tree: opts.tree ?? true,
      settleMs: opts.settleMs ?? 4000,
      beforeGoto: async (_page, cdp) => {
        watch = await watchAnimations(cdp);
      },
    },
    async (session, writer) => {
      design = await buildDesign(session, writer, watch as unknown as AnimationWatch, opts);
      return { facts: designFacts(design) };
    },
  );
  const d = design as unknown as Design;
  const site = (() => {
    try {
      return new URL(res.run.meta.finalUrl).hostname.split('.').slice(-2).join('.');
    } catch {
      return '';
    }
  })();
  // link fonts to the files that actually came over the network
  const fontFiles: NetEntry[] = res.run.network.fonts;
  for (const fam of d.typography.families) {
    const files = fam.files.length
      ? fam.files
      : fontFiles.filter((e) => e.url.toLowerCase().includes(fam.family.toLowerCase().split(' ')[0])).map((e) => e.url);
    fam.files = files.slice(0, 4);
    fam.source = files[0] ? fontSource(files[0], site) : fam.webfont ? 'web font (source not seen)' : 'system font';
  }
  // save shaders as readable files: the site's own first
  const order = [...d.webgl.shaders.programs].sort((a, b) => Number(b.custom === true) - Number(a.custom === true));
  for (const p of order.slice(0, 60)) {
    const raw = d.raw.shaders.find((_s, i) => i === Number(p.id.slice(1)) - 1);
    if (!raw) continue;
    const hint =
      p.threeName ?? (p.origin === 'custom' ? `custom-${(p.techniques[0] ?? p.uniforms.find((u) => !/^u?Time$/i.test(u)) ?? '').split(' ')[0]}` : p.origin);
    const name = `shaders/${p.id}-${hint
      .replace(/[^\w-]+/g, '_')
      .replace(/[-_]+$/, '')
      .slice(0, 40)}.${p.type === 'vertex' ? 'vert' : p.type === 'wgsl' ? 'wgsl' : 'frag'}`;
    await res.writer.text(name, raw.source, name);
    d.webgl.shaderFiles.push(name);
  }
  const { raw: _raw, ...publicDesign } = d;
  const out = {
    ...publicDesign,
    tokens: tokens(d),
    stack: res.run.stack.map((h) => ({ name: h.name, version: h.version, label: h.label })),
    url: res.run.meta.finalUrl,
    runId: res.runId,
  };
  await res.writer.json('design.json', out, 'design');
  const md = renderDesignMd(out as unknown as DesignDoc, res.run);
  await res.writer.text('design.md', md, 'designMd');
  res.run.design = { file: 'design.json' };
  res.run.meta.files = { ...res.writer.files, run: 'run.json', progress: 'progress.md' };
  await res.writer.text('report.md', renderReport(res.run), 'report');
  await res.writer.json('run.json', res.run, 'run');
  const summary = designSummary(out as unknown as DesignDoc);
  res.writer.emit({ type: 'run.finished', runId: res.runId, dir: res.dir, summary, at: new Date().toISOString() });
  return { ...res, design: d, designMd: md, summary };
}

export type DesignDoc = Omit<Design, 'raw'> & {
  tokens: ReturnType<typeof tokens>;
  stack: Array<{ name: string; version: string | null; label: string }>;
  url: string;
  runId: string;
};

export function designSummary(d: DesignDoc): string {
  const lines: string[] = [];
  const fam = d.typography.families;
  lines.push(`Design decode: ${d.url}`);
  if (fam.length)
    lines.push(
      `Fonts: ${fam
        .slice(0, 3)
        .map((f) => `${f.family} ${f.weights.join('/')} (${f.source}, ${Math.round(f.share * 100)}%)`)
        .join('; ')}`,
    );
  if (d.typography.scale.sizes.length)
    lines.push(
      `Type sizes: ${d.typography.scale.sizes.join(' / ')} px${d.typography.scale.consistent && d.typography.scale.ratio ? ` (~${d.typography.scale.ratio} ratio)` : ''}`,
    );
  const cov = d.color.coverage;
  const covered = cov ? cov.canvas + cov.video : 0;
  if (covered >= 0.5)
    lines.push(`First screen: ${Math.round(covered * 100)}% ${cov.canvas >= cov.video ? 'WebGL canvas' : 'video'}; HTML text ${d.color.text?.hex ?? '?'}`);
  else if (d.color.background)
    lines.push(
      `Colours: ${d.color.scheme} scheme, bg ${d.color.background.hex}, text ${d.color.text?.hex ?? '?'}${
        d.color.accents.length
          ? `, accents ${d.color.accents
              .slice(0, 3)
              .map((a: ColorGroup) => a.hex)
              .join(' ')}`
          : ''
      }`,
    );
  if (d.color.screen.length)
    lines.push(
      `On screen: ${d.color.screen
        .slice(0, 5)
        .map((c) => c.hex)
        .join(' ')}`,
    );
  const easings = [...new Set([...d.motion.css.observed.easings, ...d.motion.css.declared.easings].map((e) => e.name).filter(Boolean))].sort(
    (a, b) => Number(a === 'ease') - Number(b === 'ease'),
  );
  const g = d.motion.js.gsap;
  const gsapNote = g.version
    ? g.animatedElements
      ? `; GSAP ${g.version} moves ${g.animatedElements} elements`
      : `; GSAP ${g.version} loaded (animates JS values, not HTML elements)`
    : '';
  lines.push(`Motion: ${d.motion.css.observed.count} CSS animations seen${easings.length ? `, easing ${easings.slice(0, 3).join(', ')}` : ''}${gsapNote}`);
  lines.push(`Scroll: ${d.scroll.mode}${d.scroll.mode.startsWith('unknown') ? '' : `, ${d.scroll.screens} screen${d.scroll.screens === 1 ? '' : 's'}`}`);
  const sh = d.webgl.shaders;
  if (sh.shaderCount)
    lines.push(
      `WebGL: ${sh.shaderCount} shaders, ${sh.customPrograms} custom${sh.techniquesCustom.length ? ` (${sh.techniquesCustom.slice(0, 5).join(', ')})` : ''}`,
    );
  return lines.join('\n');
}
