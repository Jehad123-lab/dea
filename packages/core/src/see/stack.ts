/**
 * DEA's own stack detector. Small, readable rules; no third-party fingerprint data.
 * (Wappalyzer's data is GPL-3.0, so it is never bundled; see THIRD_PARTY_NOTICES.md.)
 *
 * Labels:
 *  - Verified: a runtime marker the library creates itself (a global, a DOM marker it adds,
 *    its devtools hook, a generator tag or a response header that names it).
 *  - Inferred: a naming convention (file names, URL paths, class-name patterns).
 */
import type { Evidence, Fact, Label } from '../types.ts';

export interface StackSignals {
  probes: Record<string, unknown>;
  meta: Record<string, string>;
  scripts: string[];
  requestUrls: string[];
  htmlClass: string;
  htmlAttrs: Record<string, string>;
  documentHeaders: Record<string, string>;
  threeRevision?: string | null;
  reactRenderers?: Array<{ version: string | null; packageName: string | null }>;
  shaderCount?: number;
  contexts?: number;
}

export type Category =
  | '3d / webgl'
  | 'animation'
  | 'smooth scroll'
  | 'ui framework'
  | 'meta-framework'
  | 'site builder'
  | 'page transitions'
  | 'css'
  | 'build tool'
  | 'hosting'
  | 'cms'
  | 'analytics'
  | 'library';

export interface StackHit {
  id: string;
  name: string;
  category: Category;
  version: string | null;
  label: Label;
  versionLabel: Label;
  evidence: Evidence[];
  why?: string;
}

type Rule = (s: StackSignals) => Omit<StackHit, 'id' | 'name' | 'category'> | null;

const str = (v: unknown): string | null => (v === null || v === undefined || v === false ? null : String(v));

function urlMatch(s: StackSignals, re: RegExp): { url: string; m: RegExpMatchArray } | null {
  for (const url of [...s.scripts, ...s.requestUrls]) {
    const m = url.match(re);
    if (m) return { url, m };
  }
  return null;
}

function verified(version: string | null, evidence: Evidence[], versionLabel: Label = version ? 'Verified' : 'Unknown') {
  return { version, label: 'Verified' as Label, versionLabel, evidence };
}

function inferred(version: string | null, evidence: Evidence[], why: string) {
  return { version, label: 'Inferred' as Label, versionLabel: (version ? 'Inferred' : 'Unknown') as Label, evidence, why };
}

const RULES: Array<{ id: string; name: string; category: Category; rule: Rule }> = [
  {
    id: 'three',
    name: 'three.js',
    category: '3d / webgl',
    rule: (s) => {
      const rev = str(s.probes.three) ?? str(s.threeRevision);
      if (rev) {
        const ev: Evidence[] = [{ source: 'global', pointer: 'window.__THREE__', excerpt: rev }];
        return verified(`r${rev.replace(/^r/, '')}`, ev);
      }
      const u = urlMatch(s, /three(?:@|\/)(?:0\.)?(\d{2,3})(?:\.\d+)?|three(?:\.module)?(?:\.min)?\.js/i);
      if (u)
        return inferred(
          u.m[1] ? `r${u.m[1]}` : null,
          [{ source: 'script-url', pointer: u.url }],
          'a script is named like three.js, but window.__THREE__ was not set',
        );
      return null;
    },
  },
  {
    id: 'gsap',
    name: 'GSAP',
    category: 'animation',
    rule: (s) => {
      const g = str(s.probes.gsap);
      if (g) return verified(g, [{ source: 'global', pointer: 'window.gsap.version', excerpt: g }]);
      const list = s.probes.gsapVersions as string[] | null;
      if (Array.isArray(list) && list.length) {
        return verified(list[list.length - 1], [{ source: 'global', pointer: 'window.gsapVersions', excerpt: JSON.stringify(list) }]);
      }
      const tm = str(s.probes.tweenMax);
      if (tm) return verified(tm, [{ source: 'global', pointer: 'window.TweenMax.version', excerpt: tm }]);
      const u = urlMatch(s, /gsap(?:@|\/)(\d+\.\d+\.\d+)|\/gsap(?:\.min)?\.js|TweenMax(?:\.min)?\.js/i);
      if (u) return inferred(u.m[1] ?? null, [{ source: 'script-url', pointer: u.url }], 'a script is named like GSAP');
      return null;
    },
  },
  {
    id: 'scrolltrigger',
    name: 'GSAP ScrollTrigger',
    category: 'animation',
    rule: (s) => {
      const v = str(s.probes.scrollTrigger);
      if (v) return verified(v === 'present' ? null : v, [{ source: 'global', pointer: 'window.ScrollTrigger', excerpt: v }]);
      const u = urlMatch(s, /ScrollTrigger(?:\.min)?\.js/i);
      if (u) return inferred(null, [{ source: 'script-url', pointer: u.url }], 'a script is named ScrollTrigger');
      return null;
    },
  },
  {
    id: 'lenis',
    name: 'Lenis',
    category: 'smooth scroll',
    rule: (s) => {
      const v = str(s.probes.lenisVersion);
      if (v) return verified(v, [{ source: 'global', pointer: 'window.lenisVersion', excerpt: v }]);
      if (/(^|\s)lenis(\s|$)/.test(s.htmlClass)) {
        return verified(null, [{ source: 'dom', pointer: '<html class>', excerpt: s.htmlClass.slice(0, 120) }]);
      }
      const u = urlMatch(s, /lenis(?:@|\/)(\d+\.\d+\.\d+)|lenis(?:\.min)?\.js/i);
      if (u) return inferred(u.m[1] ?? null, [{ source: 'script-url', pointer: u.url }], 'a script is named like Lenis');
      return null;
    },
  },
  {
    id: 'locomotive',
    name: 'Locomotive Scroll',
    category: 'smooth scroll',
    rule: (s) => {
      if (s.probes.locomotive) return verified(null, [{ source: 'global', pointer: 'window.LocomotiveScroll' }]);
      if (/has-scroll-smooth|has-scroll-init/.test(s.htmlClass))
        return verified(null, [{ source: 'dom', pointer: '<html class>', excerpt: s.htmlClass.slice(0, 120) }]);
      return null;
    },
  },
  {
    id: 'react',
    name: 'React',
    category: 'ui framework',
    rule: (s) => {
      const r = (s.reactRenderers ?? []).find((x) => x.version);
      if (r?.version) {
        return verified(r.version, [
          { source: 'global', pointer: '__REACT_DEVTOOLS_GLOBAL_HOOK__.inject()', excerpt: `${r.packageName ?? 'react-dom'} ${r.version}` },
        ]);
      }
      const g = str(s.probes.react);
      if (g) return verified(g, [{ source: 'global', pointer: 'window.React.version', excerpt: g }]);
      if (s.probes.reactFiber)
        return verified(null, [{ source: 'dom', pointer: 'element.__reactFiber$… / __reactContainer$…', excerpt: 'React internal keys on DOM nodes' }]);
      return null;
    },
  },
  {
    id: 'next',
    name: 'Next.js',
    category: 'meta-framework',
    rule: (s) => {
      const v = str(s.probes.next);
      const ev: Evidence[] = [];
      if (v) ev.push({ source: 'global', pointer: 'window.next', excerpt: v });
      if (s.probes.nextData) ev.push({ source: 'dom', pointer: 'script#__NEXT_DATA__' });
      if (s.probes.nextAppRouter) ev.push({ source: 'global', pointer: 'self.__next_f (App Router)' });
      const h = s.documentHeaders['x-powered-by'];
      if (h && /next\.js/i.test(h)) ev.push({ source: 'header', pointer: 'x-powered-by', excerpt: h });
      for (const k of ['x-nextjs-cache', 'x-nextjs-prerender'])
        if (s.documentHeaders[k]) ev.push({ source: 'header', pointer: k, excerpt: s.documentHeaders[k] });
      if (ev.length) return verified(v && v !== 'present' ? v : null, ev);
      const u = urlMatch(s, /\/_next\/static\//);
      if (u) return inferred(null, [{ source: 'script-url', pointer: u.url }], 'assets are served from /_next/static/, the Next.js build folder');
      return null;
    },
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    category: 'meta-framework',
    rule: (s) => {
      if (s.probes.nuxt) return verified(null, [{ source: 'global', pointer: 'window.__NUXT__ / #__NUXT_DATA__' }]);
      const u = urlMatch(s, /\/_nuxt\//);
      if (u) return inferred(null, [{ source: 'script-url', pointer: u.url }], 'assets are served from /_nuxt/');
      return null;
    },
  },
  {
    id: 'vue',
    name: 'Vue',
    category: 'ui framework',
    rule: (s) => {
      const app = str(s.probes.vue3App);
      if (app) return verified(app === 'unknown' ? null : app, [{ source: 'dom', pointer: 'element.__vue_app__.version', excerpt: app }]);
      const g = str(s.probes.vue);
      if (g) return verified(g, [{ source: 'global', pointer: 'window.Vue.version', excerpt: g }]);
      if (s.probes.vue2) return verified('2.x', [{ source: 'dom', pointer: 'element.__vue__' }], 'Inferred');
      if (s.probes.vueDevtoolsGlobal) return verified(null, [{ source: 'global', pointer: 'window.__VUE__' }]);
      return null;
    },
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    category: 'meta-framework',
    rule: (s) => (s.probes.svelteKit ? verified(null, [{ source: 'global', pointer: 'window.__sveltekit_*' }]) : null),
  },
  {
    id: 'astro',
    name: 'Astro',
    category: 'meta-framework',
    rule: (s) => {
      const gen = s.meta.generator ?? '';
      if (/astro/i.test(gen)) return verified(gen.match(/v?(\d+\.\d+\.\d+)/)?.[1] ?? null, [{ source: 'meta', pointer: 'meta[name=generator]', excerpt: gen }]);
      if (s.probes.astroIsland) return verified(null, [{ source: 'dom', pointer: '<astro-island>' }]);
      return null;
    },
  },
  {
    id: 'webflow',
    name: 'Webflow',
    category: 'site builder',
    rule: (s) => {
      const ev: Evidence[] = [];
      const gen = s.meta.generator ?? '';
      if (/webflow/i.test(gen)) ev.push({ source: 'meta', pointer: 'meta[name=generator]', excerpt: gen });
      if (s.probes.webflowSite) ev.push({ source: 'dom', pointer: 'html[data-wf-site]', excerpt: String(s.probes.webflowSite) });
      if (s.probes.webflowGlobal) ev.push({ source: 'global', pointer: 'window.Webflow' });
      if (ev.length) return verified(null, ev);
      const u = urlMatch(s, /website-files\.com|assets\.website-files|webflow\.com\/js/i);
      if (u) return inferred(null, [{ source: 'script-url', pointer: u.url }], 'assets come from Webflow’s CDN');
      return null;
    },
  },
  {
    id: 'framer',
    name: 'Framer',
    category: 'site builder',
    rule: (s) => {
      const ev: Evidence[] = [];
      const gen = s.meta.generator ?? '';
      if (/framer/i.test(gen)) ev.push({ source: 'meta', pointer: 'meta[name=generator]', excerpt: gen });
      if (s.probes.framerBadge) ev.push({ source: 'dom', pointer: '#__framer-badge-container' });
      const g = s.probes.framerGlobals as string[] | null;
      if (g?.length) ev.push({ source: 'global', pointer: `window.${g[0]}` });
      if (Number(s.probes.framerDataAttrs) > 0) ev.push({ source: 'dom', pointer: '[data-framer-name]', excerpt: `${s.probes.framerDataAttrs} elements` });
      if (ev.length) return verified(gen.match(/(\d+[\w.-]*)/)?.[1] ?? null, ev, gen.match(/\d/) ? 'Verified' : 'Unknown');
      const u = urlMatch(s, /framerusercontent\.com|framer\.com\/m\//i);
      if (u) return inferred(null, [{ source: 'script-url', pointer: u.url }], 'assets come from Framer’s CDN (could be an embedded Framer component)');
      return null;
    },
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    category: 'cms',
    rule: (s) => {
      const gen = s.meta.generator ?? '';
      if (/wordpress/i.test(gen))
        return verified(gen.match(/(\d+\.\d+(\.\d+)?)/)?.[1] ?? null, [{ source: 'meta', pointer: 'meta[name=generator]', excerpt: gen }]);
      if (s.probes.wordpress) return inferred(null, [{ source: 'dom', pointer: 'link/script under /wp-content/' }], 'files live under /wp-content/');
      return null;
    },
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'site builder',
    rule: (s) => (s.probes.shopify ? verified(null, [{ source: 'global', pointer: 'window.Shopify' }]) : null),
  },
  {
    id: 'pixi',
    name: 'PixiJS',
    category: '3d / webgl',
    rule: (s) => {
      const v = str(s.probes.pixi);
      return v ? verified(v === 'present' ? null : v, [{ source: 'global', pointer: 'window.PIXI.VERSION', excerpt: v }]) : null;
    },
  },
  {
    id: 'babylon',
    name: 'Babylon.js',
    category: '3d / webgl',
    rule: (s) => {
      const v = str(s.probes.babylon);
      return v ? verified(v, [{ source: 'global', pointer: 'window.BABYLON.Engine.Version', excerpt: v }]) : null;
    },
  },
  {
    id: 'spline',
    name: 'Spline',
    category: '3d / webgl',
    rule: (s) => {
      if (s.probes.splineViewer) return verified(null, [{ source: 'dom', pointer: '<spline-viewer>' }]);
      const u = urlMatch(s, /@splinetool|prod\.spline\.design|\.splinecode/i);
      return u ? inferred(null, [{ source: 'script-url', pointer: u.url }], 'a Spline scene or runtime is loaded') : null;
    },
  },
  {
    id: 'unicorn',
    name: 'Unicorn Studio',
    category: '3d / webgl',
    rule: (s) => {
      const v = str(s.probes.unicornStudio);
      return v ? verified(v === 'present' ? null : v, [{ source: 'global', pointer: 'window.UnicornStudio' }]) : null;
    },
  },
  {
    id: 'lottie',
    name: 'Lottie',
    category: 'animation',
    rule: (s) => {
      const v = str(s.probes.lottie);
      if (v) return verified(v === 'present' ? null : v, [{ source: 'global', pointer: 'window.lottie' }]);
      if (s.probes.lottiePlayer) return verified(null, [{ source: 'dom', pointer: '<lottie-player>/<dotlottie-player>' }]);
      return null;
    },
  },
  {
    id: 'barba',
    name: 'Barba.js',
    category: 'page transitions',
    rule: (s) => {
      const v = str(s.probes.barba);
      return v ? verified(v === 'present' ? null : v, [{ source: 'global', pointer: 'window.barba' }]) : null;
    },
  },
  {
    id: 'jquery',
    name: 'jQuery',
    category: 'library',
    rule: (s) => {
      const v = str(s.probes.jquery);
      return v ? verified(v, [{ source: 'global', pointer: 'jQuery.fn.jquery', excerpt: v }]) : null;
    },
  },
  {
    id: 'alpine',
    name: 'Alpine.js',
    category: 'ui framework',
    rule: (s) => {
      const v = str(s.probes.alpine);
      return v ? verified(v, [{ source: 'global', pointer: 'window.Alpine.version' }]) : null;
    },
  },
  {
    id: 'tailwind',
    name: 'Tailwind CSS',
    category: 'css',
    rule: (s) => {
      const n = Number(s.probes.utilityClassHits ?? 0);
      return n >= 40
        ? inferred(
            null,
            [{ source: 'dom', pointer: 'class attributes', excerpt: `${n} utility classes like flex, px-4, text-sm` }],
            'many elements use Tailwind-style utility class names',
          )
        : null;
    },
  },
  {
    id: 'vite',
    name: 'Vite',
    category: 'build tool',
    rule: (s) => {
      const u = urlMatch(s, /\/@vite\/client/);
      if (u) return verified(null, [{ source: 'script-url', pointer: u.url }]);
      const m = s.scripts.find((x) => /\/assets\/[\w-]+-[\w-]{8}\.js$/.test(x));
      return m ? inferred(null, [{ source: 'script-url', pointer: m }], 'the entry script is /assets/<name>-<hash>.js, the Vite build naming') : null;
    },
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'hosting',
    rule: (s) => {
      const ev: Evidence[] = [];
      if (/vercel/i.test(s.documentHeaders.server ?? '')) ev.push({ source: 'header', pointer: 'server', excerpt: s.documentHeaders.server });
      if (s.documentHeaders['x-vercel-id']) ev.push({ source: 'header', pointer: 'x-vercel-id' });
      return ev.length ? verified(null, ev) : null;
    },
  },
  {
    id: 'netlify',
    name: 'Netlify',
    category: 'hosting',
    rule: (s) =>
      /netlify/i.test(s.documentHeaders.server ?? '') || s.documentHeaders['x-nf-request-id']
        ? verified(null, [{ source: 'header', pointer: 'server / x-nf-request-id', excerpt: s.documentHeaders.server }])
        : null,
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'hosting',
    rule: (s) =>
      /cloudflare/i.test(s.documentHeaders.server ?? '') || s.documentHeaders['cf-ray']
        ? verified(null, [{ source: 'header', pointer: 'server / cf-ray', excerpt: s.documentHeaders.server }])
        : null,
  },
  {
    id: 'github-pages',
    name: 'GitHub Pages',
    category: 'hosting',
    rule: (s) =>
      /github\.com/i.test(s.documentHeaders.server ?? '') ? verified(null, [{ source: 'header', pointer: 'server', excerpt: s.documentHeaders.server }]) : null,
  },
  {
    id: 'sanity',
    name: 'Sanity',
    category: 'cms',
    rule: (s) => {
      const u = urlMatch(s, /([a-z0-9]+)\.(?:api|apicdn)\.sanity\.io|cdn\.sanity\.io/i);
      return u ? verified(null, [{ source: 'har', pointer: u.url.slice(0, 160) }]) : null;
    },
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics / Tag Manager',
    category: 'analytics',
    rule: (s) => {
      const u = urlMatch(s, /googletagmanager\.com|google-analytics\.com/i);
      return u ? verified(null, [{ source: 'har', pointer: u.url.slice(0, 160) }]) : null;
    },
  },
  {
    id: 'vercel-analytics',
    name: 'Vercel Analytics',
    category: 'analytics',
    rule: (s) => {
      const u = urlMatch(s, /\/_vercel\/(insights|speed-insights)\//);
      return u ? verified(null, [{ source: 'har', pointer: u.url }]) : null;
    },
  },
];

export function detectStack(s: StackSignals): StackHit[] {
  const hits: StackHit[] = [];
  for (const r of RULES) {
    try {
      const out = r.rule(s);
      if (out) hits.push({ id: r.id, name: r.name, category: r.category, ...out });
    } catch {
      /* one bad rule never breaks the report */
    }
  }
  // A WebGL page with shaders but no known engine: say so honestly.
  const engines = hits.filter((h) => h.category === '3d / webgl');
  if (!engines.length && (s.shaderCount ?? 0) > 0) {
    hits.push({
      id: 'webgl-unknown',
      name: 'WebGL (engine not identified)',
      category: '3d / webgl',
      version: null,
      label: 'Inferred',
      versionLabel: 'Unknown',
      evidence: [{ source: 'webgl', pointer: 'canvas.getContext / shaderSource', excerpt: `${s.contexts ?? 0} contexts, ${s.shaderCount ?? 0} shaders` }],
      why: 'the page compiled shaders, but no engine left a marker DEA knows (could be raw WebGL, OGL, regl, or a bundled engine)',
    });
  }
  return hits;
}

export function stackFacts(hits: StackHit[]): Fact[] {
  return hits.map((h) => ({
    key: `stack.${h.id}`,
    claim: `${h.name}${h.version ? ` ${h.version}` : ''} (${h.category})`,
    value: { name: h.name, version: h.version, category: h.category, versionLabel: h.versionLabel },
    label: h.label,
    evidence: h.evidence,
    ...(h.why ? { why: h.why } : {}),
  }));
}

export const KNOWN_TECH = RULES.map((r) => r.name);
