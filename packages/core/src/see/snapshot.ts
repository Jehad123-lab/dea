import type { Page } from 'playwright';

/** Everything DEA reads from the page itself in one pass. Plain data, no DOM objects. */
export interface PageSnapshot {
  url: string;
  title: string;
  lang: string;
  meta: Record<string, string>;
  scripts: Array<{ src: string; type: string; async: boolean; defer: boolean }>;
  inlineScripts: { count: number; bytes: number; samples: string[] };
  stylesheets: string[];
  htmlClass: string;
  htmlAttrs: Record<string, string>;
  bodyClass: string;
  counts: Record<string, number>;
  headings: Array<{ level: number; text: string }>;
  fonts: Array<{ family: string; weight: string; style: string; status: string; display: string; unicodeRange: string }>;
  probes: Record<string, unknown>;
  dea: {
    shaders: Array<{ api: string; type: string; source: string; t: number }>;
    wgsl: Array<{ api: string; type: string; source: string; t: number }>;
    contexts: Array<{
      id: string;
      kind: string;
      type: string;
      attrs: unknown;
      width: number;
      height: number;
      initialWidth: number;
      initialHeight: number;
      cssWidth: number | null;
      cssHeight: number | null;
      pixelRatio: number | null;
      position: string | null;
      zIndex: string | null;
      pointerEvents: string | null;
      inDom: boolean;
      t: number;
    }>;
    programs: number;
    rafCalls: number;
    rafSources: Record<string, number>;
    reactRenderers: Array<{ version: string | null; packageName: string | null; bundleType?: number }>;
    renderer: string | null;
    gpuMasked: boolean;
    threeRevision: string | null;
    threeRenderers: number;
    threeScenes: number;
    errors: string[];
  };
}

export async function takeSnapshot(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => {
    const w = window as any;
    const D = w.__DEA__ ?? {};
    const meta: Record<string, string> = {};
    for (const m of Array.from(document.querySelectorAll('meta'))) {
      const k = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv');
      const v = m.getAttribute('content');
      if (k && v != null && !meta[k.toLowerCase()]) meta[k.toLowerCase()] = v.slice(0, 300);
    }
    const scripts = Array.from(document.scripts)
      .filter((s) => s.src)
      .map((s) => ({ src: s.src, type: s.type || 'classic', async: s.async, defer: s.defer }));
    const inline = Array.from(document.scripts).filter((s) => !s.src);
    const htmlAttrs: Record<string, string> = {};
    for (const a of Array.from(document.documentElement.attributes)) htmlAttrs[a.name] = a.value.slice(0, 200);
    const q = (s: string) => document.querySelectorAll(s).length;
    const safe = (f: () => unknown) => {
      try {
        const v = f();
        return v === undefined ? null : v;
      } catch {
        return null;
      }
    };
    // runtime markers that libraries create themselves
    const sampleEls = Array.from(document.querySelectorAll('body *')).slice(0, 3000);
    let reactFiber = false;
    let vue3App: string | null = null;
    let vue2 = false;
    for (const el of [document.getElementById('root'), document.getElementById('__next'), document.getElementById('app'), ...sampleEls.slice(0, 400)]) {
      if (!el) continue;
      const keys = Object.keys(el);
      if (keys.some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$') || k === '_reactRootContainer')) reactFiber = true;
      const app = (el as any).__vue_app__;
      if (app && !vue3App) vue3App = String(app.version ?? 'unknown');
      if ((el as any).__vue__) vue2 = true;
      if (reactFiber && (vue3App || vue2)) break;
    }
    let utilityClassHits = 0;
    const util = /^(flex|grid|hidden|block|inline-flex|items-center|justify-between|gap-\d+|p[xytrbl]?-\d+|m[xytrbl]?-\d+|text-(xs|sm|base|lg|xl|\dxl)|w-full|h-full|rounded(-\w+)?|bg-[a-z]+-\d{2,3}|font-(bold|medium|semibold))$/;
    for (const el of sampleEls.slice(0, 1500)) for (const c of Array.from(el.classList)) if (util.test(c)) utilityClassHits++;

    const probes: Record<string, unknown> = {
      three: safe(() => w.__THREE__),
      gsap: safe(() => w.gsap?.version),
      gsapVersions: safe(() => (Array.isArray(w.gsapVersions) ? w.gsapVersions.slice(0, 5) : null)),
      tweenMax: safe(() => w.TweenMax?.version),
      scrollTrigger: safe(() => w.ScrollTrigger?.version ?? (w.ScrollTrigger ? 'present' : null)),
      lenisVersion: safe(() => w.lenisVersion),
      lenisGlobal: safe(() => (w.lenis ? (w.lenis.constructor?.name ?? 'object') : null)),
      locomotive: safe(() => (w.LocomotiveScroll ? 'present' : null)),
      react: safe(() => w.React?.version),
      reactFiber,
      next: safe(() => w.next?.version ?? (w.next ? 'present' : null)),
      nextData: !!document.getElementById('__NEXT_DATA__'),
      nextAppRouter: safe(() => Array.isArray(w.__next_f)),
      nextRoot: !!document.getElementById('__next'),
      nuxt: safe(() => (w.__NUXT__ || w.useNuxtApp || document.getElementById('__NUXT_DATA__') ? 'present' : null)),
      vue: safe(() => w.Vue?.version),
      vueDevtoolsGlobal: safe(() => (w.__VUE__ ? true : null)),
      vue3App,
      vue2,
      svelteKit: safe(() => Object.keys(w).some((k) => k.startsWith('__sveltekit'))),
      astroIsland: q('astro-island') > 0,
      webflowSite: document.documentElement.getAttribute('data-wf-site'),
      webflowPage: document.documentElement.getAttribute('data-wf-page'),
      webflowGlobal: safe(() => (w.Webflow ? 'present' : null)),
      framerBadge: q('#__framer-badge-container') > 0,
      framerGlobals: safe(() => Object.keys(w).filter((k) => /^__framer/i.test(k)).slice(0, 5)),
      framerDataAttrs: q('[data-framer-name],[data-framer-component-type]'),
      shopify: safe(() => (w.Shopify ? 'present' : null)),
      jquery: safe(() => w.jQuery?.fn?.jquery ?? null),
      barba: safe(() => w.barba?.version ?? (w.barba ? 'present' : null)),
      swup: safe(() => (w.swup ? 'present' : null)),
      pixi: safe(() => w.PIXI?.VERSION ?? (w.__PIXI_APP__ ? 'present' : null)),
      babylon: safe(() => w.BABYLON?.Engine?.Version),
      splineViewer: q('spline-viewer') > 0,
      lottie: safe(() => (w.lottie || w.bodymovin ? (w.lottie?.version ?? 'present') : null)),
      lottiePlayer: q('lottie-player,dotlottie-player,dotlottie-wc') > 0,
      unicornStudio: safe(() => (w.UnicornStudio ? (w.UnicornStudio.version ?? 'present') : null)),
      motionOne: safe(() => (w.Motion ? 'present' : null)),
      alpine: safe(() => w.Alpine?.version),
      htmx: safe(() => w.htmx?.version),
      gtag: safe(() => typeof w.gtag === 'function' || Array.isArray(w.dataLayer)),
      utilityClassHits,
      wordpress: q('link[href*="/wp-content/"],script[src*="/wp-content/"],link[href*="/wp-includes/"]') > 0,
    };
    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || '',
      meta,
      scripts,
      inlineScripts: {
        count: inline.length,
        bytes: inline.reduce((n, s) => n + (s.textContent?.length ?? 0), 0),
        samples: inline.map((s) => (s.textContent ?? '').trim().slice(0, 160)).filter(Boolean).slice(0, 8),
      },
      stylesheets: Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map((l) => (l as HTMLLinkElement).href),
      htmlClass: document.documentElement.className.toString().slice(0, 300),
      htmlAttrs,
      bodyClass: document.body?.className.toString().slice(0, 300) ?? '',
      counts: {
        elements: q('*'),
        images: q('img'),
        videos: q('video'),
        canvases: q('canvas'),
        svgs: q('svg'),
        iframes: q('iframe'),
        links: q('a[href]'),
        buttons: q('button,[role=button]'),
        forms: q('form'),
        textChars: document.body?.innerText?.length ?? 0,
        documentHeight: document.documentElement.scrollHeight,
      },
      headings: Array.from(document.querySelectorAll('h1,h2,h3'))
        .slice(0, 40)
        .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) }))
        .filter((h) => h.text),
      fonts: Array.from(document.fonts).map((f) => ({
        family: f.family.replace(/^["']|["']$/g, ''),
        weight: f.weight,
        style: f.style,
        status: f.status,
        display: f.display,
        unicodeRange: f.unicodeRange,
      })),
      probes,
      dea: {
        shaders: D.shaders ?? [],
        wgsl: D.webgpu?.shaders ?? [],
        contexts: (D.contexts ?? []).map((c: any) => {
          const el = document.querySelector(`[data-dea-canvas="${c.id}"]`) as HTMLCanvasElement | null;
          const r = el?.getBoundingClientRect();
          const cs = el ? getComputedStyle(el) : null;
          return {
            ...c,
            attrs: c.attrs ? JSON.parse(JSON.stringify(c.attrs)) : null,
            initialWidth: c.width,
            initialHeight: c.height,
            width: el?.width ?? c.width,
            height: el?.height ?? c.height,
            cssWidth: r ? Math.round(r.width) : null,
            cssHeight: r ? Math.round(r.height) : null,
            pixelRatio: el && r && r.width ? Math.round((el.width / r.width) * 100) / 100 : null,
            position: cs?.position ?? null,
            zIndex: cs?.zIndex ?? null,
            pointerEvents: cs?.pointerEvents ?? null,
            inDom: !!el?.isConnected,
          };
        }),
        programs: D.programs ?? 0,
        rafCalls: D.raf?.calls ?? 0,
        rafSources: D.raf?.sources ?? {},
        reactRenderers: D.react?.renderers ?? [],
        renderer: D.renderer ?? null,
        gpuMasked: !!D.gpuMasked,
        threeRevision: D.three?.revision ?? null,
        threeRenderers: D.three?.renderers?.length ?? 0,
        threeScenes: D.three?.scenes?.length ?? 0,
        errors: D.errors ?? [],
      },
    };
  });
}

/** Playwright's AI-oriented accessibility tree (YAML). Falls back to the classic tree. */
export async function pageTree(page: Page): Promise<string> {
  try {
    return await (page as any).ariaSnapshot({ mode: 'ai' });
  } catch {
    return page.locator('body').ariaSnapshot();
  }
}
