import type { CDPSession, Page } from 'playwright';

/** A code location as the browser reports it: script URL plus 1-based line and column. */
export interface Frame {
  fn: string;
  url: string;
  line: number;
  col: number;
}

export interface Section {
  index: number;
  selector: string;
  tag: string;
  id: string;
  classes: string[];
  heading: string;
  text: string;
  top: number;
  height: number;
  canvases: string[];
  /** position: fixed or sticky (a layer over the page, not a block in the flow) */
  fixed: boolean;
  links: number;
  images: number;
  /** distinctive words shown in this section, for matching API data and code strings */
  strings: string[];
}

export interface TweenInfo {
  n: number;
  t: number;
  kind: 'tween' | 'timeline';
  timeline: number | null;
  targets: string[];
  targetKind: 'element' | 'three' | 'uniform' | 'object' | 'mixed' | 'none';
  sections: number[];
  props: Record<string, string>;
  duration: number;
  delay: number;
  start: number;
  ease: string;
  repeat: number;
  yoyo: boolean;
  stagger: string | null;
  scrollTrigger: { trigger: string; start: string; end: string; scrub: string | null; pin: boolean; toggleActions: string | null } | null;
  stack: string[];
}

export interface UniformInfo {
  name: string;
  kind: string;
  value: string;
  changed: boolean;
}

export interface MaterialInfo {
  name: string;
  type: string;
  meshes: string[];
  uniforms: UniformInfo[];
  transparent: boolean;
  blending: number | null;
  depthWrite: boolean | null;
  customProgram: boolean;
}

export interface RendererInfo {
  pixelRatio: number | null;
  toneMapping: number | null;
  outputColorSpace: string | null;
  shadows: boolean | null;
  antialias: boolean | null;
  size: [number, number] | null;
}

export interface Runtime {
  sections: Section[];
  tweens: TweenInfo[];
  timelines: number;
  gsapVersion: string | null;
  requests: Array<{ kind: string; url: string; method: string; t: number; stack: string[] }>;
  sockets: Array<{ kind: string; url: string; t: number; stack: string[] }>;
  three: {
    revision: string | null;
    scenes: Array<{ name: string; objects: number; meshes: number; lights: number; fog: string | null; background: string | null }>;
    materials: MaterialInfo[];
    renderers: RendererInfo[];
  };
  errors: string[];
}

/** Read what the page built at runtime: sections, GSAP tweens with their call stacks, three.js materials and uniforms, requests. */
export async function readRuntime(page: Page): Promise<Runtime> {
  return page.evaluate(async () => {
    const w = window as any;
    const C = w.__DEA_CODE__ ?? { timelines: [], tweens: [], requests: [], sockets: [], errors: ['code observers were not installed'] };
    const D = w.__DEA__ ?? { three: { scenes: [], renderers: [] } };
    const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
    const sel = (el: any): string => {
      if (!el?.tagName) return '';
      const id = el.id ? `#${el.id}` : '';
      const cls = Array.from(el.classList ?? [])
        .filter((c: any) => !/^(is-|has-)/.test(c))
        .slice(0, 3)
        .map((c: any) => `.${c}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 90);
    };

    // ---- sections: the big blocks a visitor scrolls through
    const vw = innerWidth;
    const big = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.height >= 120 && r.width >= vw * 0.45;
    };
    let root: Element = document.querySelector('main') ?? document.body;
    for (let i = 0; i < 6; i++) {
      const kids = Array.from(root.children).filter((k) => big(k) && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(k.tagName));
      if (kids.length === 1) root = kids[0];
      else break;
    }
    let blocks = Array.from(root.children).filter((k) => big(k) && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(k.tagName));
    const landmarks = Array.from(document.querySelectorAll('header, nav, footer, section, [data-section], canvas')).filter(big);
    for (const l of landmarks) if (!blocks.some((b) => b.contains(l) || l.contains(b))) blocks.push(l);
    if (blocks.length < 2) blocks = Array.from(document.querySelectorAll('section, header, footer, [data-section]')).filter(big);
    blocks = blocks.slice(0, 40);
    const docTop = (el: Element) => Math.round(el.getBoundingClientRect().top + scrollY);
    blocks.sort((a, b) => docTop(a) - docTop(b));
    const words = (t: string) => Array.from(new Set((t.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]{3,}/gu) ?? []).map((x) => x.toLowerCase()))).slice(0, 200);
    const canvasOf = (el: Element) =>
      Array.from(el.querySelectorAll('canvas'))
        .concat(el.tagName === 'CANVAS' ? [el as HTMLCanvasElement] : [])
        .map((c) => c.getAttribute('data-dea-canvas') || sel(c));
    const sections = blocks.map((el, index) => {
      const r = el.getBoundingClientRect();
      // biome-ignore lint/performance/useDomNodeTextContent: the visible text is wanted, not hidden nodes
      const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const h = el.querySelector('h1,h2,h3,[role=heading]');
      return {
        index,
        selector: sel(el),
        tag: el.tagName.toLowerCase(),
        id: el.id,
        classes: Array.from(el.classList).slice(0, 8),
        heading: cut((h?.textContent ?? '').replace(/\s+/g, ' ').trim(), 100),
        text: cut(text, 240),
        top: docTop(el),
        height: Math.round(r.height),
        canvases: canvasOf(el),
        fixed: /^(fixed|sticky)$/.test(getComputedStyle(el).position),
        links: el.querySelectorAll('a[href]').length,
        images: el.querySelectorAll('img,picture,video').length,
        strings: words(text),
      };
    });
    const sectionOf = (el: any): number[] => {
      if (!el?.nodeType) return [];
      const out: number[] = [];
      blocks.forEach((b, i) => {
        if (b === el || b.contains(el) || el.contains?.(b)) out.push(i);
      });
      return out;
    };

    // ---- three.js: materials, uniforms (sampled twice to see which ones move), renderers
    const scenes = (D.three?.scenes ?? []) as any[];
    const mats = new Map<any, { meshes: string[] }>();
    const uniformOwner = new Map<any, string>();
    const sceneInfo = scenes.slice(0, 10).map((s: any) => {
      let objects = 0;
      let meshes = 0;
      let lights = 0;
      try {
        s.traverse((o: any) => {
          objects++;
          if (o.isLight) lights++;
          if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
            meshes++;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (!m) continue;
              const e = mats.get(m) ?? { meshes: [] };
              if (e.meshes.length < 6) e.meshes.push(o.name || o.type);
              mats.set(m, e);
            }
          }
        });
      } catch {
        /* ignore */
      }
      const col = (c: any) => (c?.isColor ? `#${c.getHexString()}` : c?.isTexture ? 'texture' : null);
      return {
        name: s.name || 'scene',
        objects,
        meshes,
        lights,
        fog: s.fog ? `${s.fog.isFogExp2 ? `FogExp2 density ${s.fog.density}` : `Fog ${s.fog.near}–${s.fog.far}`} ${col(s.fog.color) ?? ''}`.trim() : null,
        background: col(s.background),
      };
    });
    const show = (v: any): [string, string] => {
      try {
        if (v == null) return ['null', 'null'];
        if (typeof v === 'number') return ['float', String(Math.round(v * 10000) / 10000)];
        if (typeof v === 'boolean') return ['bool', String(v)];
        if (v.isColor) return ['color', `#${v.getHexString()}`];
        if (v.isVector2) return ['vec2', `${v.x.toFixed(3)}, ${v.y.toFixed(3)}`];
        if (v.isVector3) return ['vec3', `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`];
        if (v.isVector4) return ['vec4', `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}, ${v.w.toFixed(3)}`];
        if (v.isMatrix4 || v.isMatrix3) return [v.isMatrix4 ? 'mat4' : 'mat3', 'matrix'];
        if (v.isTexture) {
          const img = v.image;
          const src = img?.currentSrc || img?.src || '';
          return [
            'sampler2D',
            `${v.isDataTexture ? 'data' : v.isVideoTexture ? 'video' : v.isCubeTexture ? 'cube' : v.isRenderTargetTexture || v.isFramebufferTexture ? 'render target' : 'image'} texture${img?.width ? ` ${img.width}×${img.height}` : ''}${src ? ` ${String(src).split('/').pop()?.slice(0, 60)}` : ''}`,
          ];
        }
        if (Array.isArray(v))
          return [
            `array[${v.length}]`,
            cut(JSON.stringify(v.slice(0, 4).map((x: any) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : typeof x))), 80),
          ];
        return [typeof v, cut(String(v.constructor?.name ?? typeof v), 40)];
      } catch {
        return ['unknown', '?'];
      }
    };
    const matList = Array.from(mats.entries()).slice(0, 80);
    const before = matList.map(([m]) => {
      const u: Record<string, string> = {};
      for (const [k, o] of Object.entries((m.uniforms ?? {}) as Record<string, any>)) {
        u[k] = show(o?.value)[1];
        uniformOwner.set(o, `uniform ${k} of ${m.name || m.type}`);
      }
      return u;
    });
    await new Promise((r) => setTimeout(r, 700));
    const materials = matList.map(([m, e], i) => ({
      name: m.name || '',
      type: m.type,
      meshes: e.meshes,
      transparent: !!m.transparent,
      blending: m.blending ?? null,
      depthWrite: m.depthWrite ?? null,
      customProgram: !!(m.isShaderMaterial || m.isRawShaderMaterial || m.onBeforeCompile?.toString().length > 40),
      uniforms: Object.entries((m.uniforms ?? {}) as Record<string, any>)
        .slice(0, 40)
        .map(([name, o]) => {
          const [kind, value] = show(o?.value);
          return { name, kind, value, changed: before[i][name] !== value };
        }),
    }));
    const renderers = ((D.three?.renderers ?? []) as any[]).slice(0, 4).map((r: any) => {
      const sz = r.getSize
        ? r.getSize({
            x: 0,
            y: 0,
            set(x: number, y: number) {
              this.x = x;
              this.y = y;
              return this;
            },
          } as any)
        : null;
      let aa: boolean | null = null;
      try {
        aa = r.getContext?.()?.getContextAttributes?.()?.antialias ?? null;
      } catch {
        /* ignore */
      }
      return {
        pixelRatio: r.getPixelRatio?.() ?? null,
        toneMapping: r.toneMapping ?? null,
        outputColorSpace: r.outputColorSpace ?? null,
        shadows: r.shadowMap?.enabled ?? null,
        antialias: aa,
        size: sz ? [Math.round(sz.x), Math.round(sz.y)] : null,
      };
    });

    // ---- GSAP: every tween and timeline the observers saw being built
    const tlIndex = new Map<any, number>();
    C.timelines.forEach((t: any, i: number) => {
      tlIndex.set(t.ref, i);
    });
    const describeTarget = (t: any): [string, TweenInfo['targetKind']] => {
      if (t?.nodeType === 1) return [sel(t), 'element'];
      if (uniformOwner.has(t)) return [uniformOwner.get(t) as string, 'uniform'];
      if (t?.isObject3D) return [`three ${t.type}${t.name ? ` "${t.name}"` : ''}`, 'three'];
      if (t?.isVector3 || t?.isEuler || t?.isColor || t?.isVector2)
        return [`three ${t.isVector3 ? 'Vector3' : t.isEuler ? 'Euler' : t.isColor ? 'Color' : 'Vector2'}`, 'three'];
      if (t && typeof t === 'object') return [`object {${Object.keys(t).slice(0, 4).join(', ')}}`, 'object'];
      return [String(t).slice(0, 40), 'object'];
    };
    const SKIP = new Set([
      'ease',
      'duration',
      'delay',
      'repeat',
      'yoyo',
      'stagger',
      'scrollTrigger',
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
      'defaults',
      'repeatDelay',
      'repeatRefresh',
      'reversed',
      'keyframes',
      'onComplete',
      'onUpdate',
      'onStart',
      'onRepeat',
      'onReverseComplete',
      'onInterrupt',
      'yoyoEase',
      'smoothChildTiming',
      'autoRemoveChildren',
      'sortChildren',
    ]);
    const val = (v: any) => (typeof v === 'function' ? 'function' : typeof v === 'object' && v ? cut(JSON.stringify(v), 60) : String(v));
    // GSAP turns ease names into functions; recognise the standard ones by sampling them
    const P = (p: number) => ({
      in: (t: number) => t ** p,
      out: (t: number) => 1 - (1 - t) ** p,
      inOut: (t: number) => (t < 0.5 ? (2 * t) ** p / 2 : 1 - (2 * (1 - t)) ** p / 2),
    });
    const KNOWN: Array<[string, (t: number) => number]> = [['none', (t) => t]];
    for (let p = 1; p <= 4; p++) {
      const f = P(p + 1);
      KNOWN.push([`power${p}.in`, f.in], [`power${p}.out`, f.out], [`power${p}.inOut`, f.inOut]);
    }
    KNOWN.push(
      ['sine.in', (t) => 1 - Math.cos((t * Math.PI) / 2)],
      ['sine.out', (t) => Math.sin((t * Math.PI) / 2)],
      ['sine.inOut', (t) => -(Math.cos(Math.PI * t) - 1) / 2],
      ['expo.out', (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t))],
      ['expo.in', (t) => (t === 0 ? 0 : 2 ** (10 * (t - 1)))],
      ['circ.out', (t) => Math.sqrt(1 - (t - 1) ** 2)],
      ['circ.in', (t) => 1 - Math.sqrt(1 - t * t)],
      ['back.out(1.7)', (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2],
    );
    const easeOf = (e: any, tw?: any) => {
      if (typeof e === 'string') return e;
      const f = typeof e === 'function' ? e : typeof tw?._ease === 'function' ? tw._ease : null;
      if (!f) return e == null ? 'power1.out (GSAP default)' : String(e);
      try {
        const xs = [0.1, 0.3, 0.5, 0.7, 0.9];
        const ys = xs.map((x) => Number(f(x)));
        for (const [name, g] of KNOWN) if (xs.every((x, i) => Math.abs(g(x) - ys[i]) < 0.004)) return name;
        return `custom curve (${ys.map((y) => y.toFixed(2)).join(', ')} at 10/30/50/70/90%)`;
      } catch {
        return 'custom function';
      }
    };
    const stOf = (st: any) => {
      if (!st) return null;
      const v = st.vars ?? {};
      return {
        trigger: v.trigger?.nodeType ? sel(v.trigger) : st.trigger?.nodeType ? sel(st.trigger) : String(v.trigger ?? ''),
        start: String(v.start ?? 'top bottom'),
        end: String(v.end ?? 'bottom top'),
        scrub: v.scrub === undefined ? null : String(v.scrub),
        pin: !!v.pin,
        toggleActions: v.toggleActions ?? null,
      };
    };
    const tweens: TweenInfo[] = [];
    const push = (ref: any, kind: 'tween' | 'timeline', stack: string[], t: number, n: number) => {
      try {
        const v = ref.vars ?? {};
        const targets: any[] = kind === 'tween' ? (ref.targets?.() ?? ref._targets ?? []) : [];
        // GSAP's own helper tweens (delayedCall, internal nested timelines) are not the author's motion
        if (kind === 'tween' && (typeof targets[0] === 'function' || (targets.length === 1 && targets[0] && Object.keys(targets[0]).join() === '_gsap')))
          return;
        if (kind === 'timeline' && v.data === 'nested') return;
        const desc = targets.slice(0, 4).map(describeTarget);
        const kinds = new Set(desc.map((d) => d[1]));
        const props: Record<string, string> = {};
        for (const [k, x] of Object.entries(v)) if (!SKIP.has(k) && !k.startsWith('on') && Object.keys(props).length < 10) props[k] = val(x);
        const parent = ref.parent;
        tweens.push({
          n,
          t,
          kind,
          timeline: parent && tlIndex.has(parent) && parent.vars?.id !== 'root' ? (tlIndex.get(parent) as number) : null,
          targets: desc.map((d) => d[0]).concat(targets.length > 4 ? [`+${targets.length - 4} more`] : []),
          targetKind: kind === 'timeline' ? 'none' : kinds.size === 1 ? (Array.from(kinds)[0] as TweenInfo['targetKind']) : kinds.size ? 'mixed' : 'none',
          sections: Array.from(new Set(targets.flatMap(sectionOf))),
          props,
          duration: Math.round((ref.duration?.() ?? 0) * 1000) / 1000,
          delay: Number(v.delay ?? 0),
          start: Math.round((ref.startTime?.() ?? 0) * 1000) / 1000,
          ease: easeOf(v.ease, ref),
          repeat: Number(v.repeat ?? 0),
          yoyo: !!v.yoyo,
          stagger: v.stagger == null ? null : val(v.stagger),
          scrollTrigger: stOf(ref.scrollTrigger ?? (v.scrollTrigger && typeof v.scrollTrigger === 'object' ? { vars: v.scrollTrigger } : null)),
          stack,
        });
      } catch {
        /* GSAP internals differ */
      }
    };
    C.timelines.forEach((x: any, i: number) => {
      if (x.ref?.vars?.id === 'root') return;
      push(x.ref, 'timeline', x.stack, x.t, i);
    });
    C.tweens.forEach((x: any, i: number) => {
      push(x.ref, 'tween', x.stack, x.t, i);
    });

    return {
      sections,
      tweens,
      timelines: C.timelines.length,
      gsapVersion: Array.isArray(w.gsapVersions) ? w.gsapVersions[w.gsapVersions.length - 1] : (w.gsap?.version ?? null),
      requests: C.requests,
      sockets: C.sockets,
      three: { revision: D.three?.revision ?? null, scenes: sceneInfo, materials, renderers },
      errors: C.errors,
    } as Runtime;
  });
}

/** Parse V8 stack lines ("at fn (https://x/a.js:1:200)") into frames. */
export function parseStack(lines: string[]): Frame[] {
  const out: Frame[] = [];
  for (const l of lines) {
    const m = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l.trim());
    if (!m) continue;
    const url = m[2].replace(/^async /, '');
    if (!/^(https?:|webpack-internal:|webpack:)/.test(url)) continue;
    out.push({ fn: m[1] ?? '', url, line: Number(m[3]), col: Number(m[4]) });
  }
  return out;
}

export interface ListenerInfo {
  target: string;
  section: number | null;
  /** position on the page (CSS px from the top of the document), to find its section */
  top: number | null;
  type: string;
  scriptId: string;
  line: number;
  col: number;
}

/** Event listeners on interactive elements, the window and the document, with the script position of each handler (CDP). */
export async function readListeners(cdp: CDPSession): Promise<ListenerInfo[]> {
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const els = [window, document, ...Array.from(document.querySelectorAll('a[href], button, [role=button], input, select, textarea, canvas, [onclick], [data-cursor], [class*="menu"], [class*="nav"], [class*="slider"], [class*="carousel"]')).slice(0, 220)];
      return els;
    })()`,
    returnByValue: false,
  });
  if (!result.objectId) return [];
  const props = await cdp.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true });
  const out: ListenerInfo[] = [];
  for (const p of props.result) {
    if (!/^\d+$/.test(p.name) || !p.value?.objectId) continue;
    try {
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: p.value.objectId, depth: 0 });
      if (!listeners.length) continue;
      const who = await cdp.send('Runtime.callFunctionOn', {
        objectId: p.value.objectId,
        functionDeclaration: `function () {
          if (this === window) return { label: 'window', top: null };
          if (this === document) return { label: 'document', top: null };
          const id = this.id ? '#' + this.id : '';
          const cls = Array.from(this.classList || []).slice(0, 2).map((c) => '.' + c).join('');
          const txt = (this.getAttribute && (this.getAttribute('aria-label') || '')) || (this.textContent || '').trim().slice(0, 30);
          const top = Math.round(this.getBoundingClientRect().top + scrollY);
          return { label: this.tagName.toLowerCase() + id + cls + (txt ? ' "' + txt.replace(/\\s+/g, ' ') + '"' : ''), top };
        }`,
        returnByValue: true,
      });
      for (const l of listeners.slice(0, 8)) {
        const v = who.result.value as { label: string; top: number | null };
        out.push({ target: v.label, section: null, top: v.top, type: l.type, scriptId: l.scriptId, line: l.lineNumber + 1, col: l.columnNumber + 1 });
      }
    } catch {
      /* element went away */
    }
    if (out.length > 400) break;
  }
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId }).catch(() => {});
  return out;
}
