import type { Page } from 'playwright';

export interface JsMotion {
  gsap: {
    global: boolean;
    version: string | null;
    animatedElements: number;
    animatedProps: Record<string, number>;
    tweens: Array<{ duration: number; delay: number; ease: string; repeat: number; yoyo: boolean; targets: string; props: string[]; scroll: boolean }>;
    eases: Array<{ ease: string; count: number }>;
    scrollTriggers: Array<{ trigger: string; start: string; end: string; scrub: string | null; pin: boolean }>;
    pinSpacers: number;
  };
  lenis: { present: boolean; version: string | null; htmlClass: string; options: Record<string, unknown> | null };
  idle: { sampledMs: number; frames: number; jsDriven: Array<{ selector: string; props: string[]; changes: number }>; cssDriven: number };
  webAnimations: Array<{ type: string; name: string; duration: number; easing: string; target: string }>;
}

/** Read motion that JavaScript drives. GSAP and Lenis objects are read directly when reachable (Verified);
 *  the rest is found by watching styles change frame by frame (Inferred). */
export async function readJsMotion(page: Page, sampleMs = 1500): Promise<JsMotion> {
  return page.evaluate(async (ms) => {
    const w = window as any;
    const sel = (el: any): string => {
      if (!el?.tagName) return typeof el === 'object' ? 'object' : String(el);
      const id = el.id ? `#${el.id}` : '';
      const cls = Array.from(el.classList ?? [])
        .slice(0, 2)
        .map((c: any) => `.${c}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 80);
    };
    // GSAP stores a cache object on every element it animates: el._gsap (present even when GSAP is bundled)
    const all = Array.from(document.querySelectorAll('*'));
    const animated = all.filter((el: any) => el._gsap);
    const animatedProps: Record<string, number> = {};
    for (const el of animated.slice(0, 500) as any[]) {
      const c = el._gsap;
      for (const k of ['x', 'y', 'xPercent', 'yPercent', 'rotation', 'rotationX', 'rotationY', 'scaleX', 'scaleY', 'skewX', 'skewY', 'z']) {
        const v = c?.[k];
        const def = k.startsWith('scale') ? 1 : 0;
        if (v !== undefined && Number.parseFloat(v) !== def && !Number.isNaN(Number.parseFloat(v))) animatedProps[k] = (animatedProps[k] ?? 0) + 1;
      }
    }
    const g = w.gsap;
    const tweens: JsMotion['gsap']['tweens'] = [];
    const eases = new Map<string, number>();
    const easeName = (e: any) =>
      typeof e === 'string' ? e : typeof e === 'function' ? 'custom function' : e == null ? 'power1.out (GSAP default)' : String(e);
    if (g?.globalTimeline?.getChildren) {
      try {
        for (const t of g.globalTimeline.getChildren(true, true, false).slice(0, 400)) {
          const v = t.vars ?? {};
          const props = Object.keys(v).filter(
            (k) =>
              ![
                'ease',
                'duration',
                'delay',
                'repeat',
                'yoyo',
                'onComplete',
                'onUpdate',
                'onStart',
                'scrollTrigger',
                'stagger',
                'overwrite',
                'immediateRender',
                'paused',
                'data',
                'id',
                'callbackScope',
                'lazy',
                'runBackwards',
                'startAt',
                'inherit',
                'parent',
              ].includes(k),
          );
          const targets = t.targets?.() ?? [];
          const e = easeName(v.ease);
          eases.set(e, (eases.get(e) ?? 0) + 1);
          if (tweens.length < 60)
            tweens.push({
              duration: Math.round((t.duration?.() ?? 0) * 1000) / 1000,
              delay: v.delay ?? 0,
              ease: e,
              repeat: v.repeat ?? 0,
              yoyo: !!v.yoyo,
              targets: `${targets.length} × ${sel(targets[0])}`,
              props: props.slice(0, 8),
              scroll: !!t.scrollTrigger,
            });
        }
      } catch {
        /* GSAP internals changed */
      }
    }
    const scrollTriggers: JsMotion['gsap']['scrollTriggers'] = [];
    try {
      for (const st of (w.ScrollTrigger?.getAll?.() ?? []).slice(0, 60)) {
        const v = st.vars ?? {};
        scrollTriggers.push({
          trigger: sel(st.trigger),
          start: String(v.start ?? 'top bottom'),
          end: String(v.end ?? 'bottom top'),
          scrub: v.scrub === undefined ? null : String(v.scrub),
          pin: !!v.pin,
        });
      }
    } catch {
      /* ignore */
    }
    let lenisOptions: Record<string, unknown> | null = null;
    try {
      const l = w.lenis;
      if (l?.options) {
        const o = l.options;
        lenisOptions = {
          lerp: o.lerp,
          duration: o.duration,
          smoothWheel: o.smoothWheel,
          syncTouch: o.syncTouch,
          wheelMultiplier: o.wheelMultiplier,
          orientation: o.orientation,
          infinite: o.infinite,
          easing: typeof o.easing === 'function' ? 'custom function' : o.easing,
        };
      }
    } catch {
      /* ignore */
    }
    // Web Animations / CSS animations running right now
    const webAnimations: JsMotion['webAnimations'] = [];
    try {
      for (const a of document.getAnimations().slice(0, 80) as any[]) {
        const t = a.effect?.getTiming?.() ?? {};
        webAnimations.push({
          type: a.constructor?.name ?? 'Animation',
          name: a.animationName ?? a.transitionProperty ?? a.id ?? '',
          duration: Number(t.duration) || 0,
          easing: t.easing ?? 'linear',
          target: sel(a.effect?.target),
        });
      }
    } catch {
      /* ignore */
    }
    // Watch visible elements for style changes each frame while nobody touches the page
    const watch = all
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && el.tagName !== 'HTML' && el.tagName !== 'BODY';
      })
      .slice(0, 400);
    const read = (el: Element) => {
      const cs = getComputedStyle(el);
      return [cs.transform, cs.opacity, cs.filter, cs.clipPath, (el as HTMLElement).style?.cssText?.length ?? 0].join('|');
    };
    const last = watch.map(read);
    const changes = new Array(watch.length).fill(0);
    const props: Array<Set<string>> = watch.map(() => new Set());
    let frames = 0;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const tick = () => {
        frames++;
        watch.forEach((el, i) => {
          const now = read(el);
          if (now !== last[i]) {
            const a = last[i].split('|');
            const b = now.split('|');
            ['transform', 'opacity', 'filter', 'clip-path', 'inline style'].forEach((n, j) => {
              if (a[j] !== b[j]) props[i].add(n);
            });
            changes[i]++;
            last[i] = now;
          }
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
      setTimeout(done, ms + 3000);
    });
    const moving = watch.map((el, i) => ({ el, i })).filter(({ i }) => changes[i] >= 2);
    const css = moving.filter(({ el }) => el.getAnimations().length > 0);
    const js = moving.filter(({ el }) => el.getAnimations().length === 0);
    // keep the outermost moving elements (a moving parent makes children "move" too only if they animate themselves)
    return {
      gsap: {
        global: !!g,
        version: g?.version ?? (Array.isArray(w.gsapVersions) ? w.gsapVersions[w.gsapVersions.length - 1] : null),
        animatedElements: animated.length,
        animatedProps,
        tweens,
        eases: [...eases.entries()].sort((a, b) => b[1] - a[1]).map(([ease, count]) => ({ ease, count })),
        scrollTriggers,
        pinSpacers: document.querySelectorAll('.pin-spacer').length,
      },
      lenis: {
        present: !!(w.lenisVersion || /(^|\s)lenis(\s|$)/.test(document.documentElement.className)),
        version: w.lenisVersion ?? null,
        htmlClass: document.documentElement.className.toString().slice(0, 200),
        options: lenisOptions,
      },
      idle: {
        sampledMs: Math.round(performance.now() - t0),
        frames,
        jsDriven: js.slice(0, 20).map(({ el, i }) => ({ selector: sel(el), props: [...props[i]], changes: changes[i] })),
        cssDriven: css.length,
      },
      webAnimations,
    };
  }, sampleMs);
}
