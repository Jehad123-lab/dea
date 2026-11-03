// In-page readers for every motion engine DEA knows. Strings, evaluated in the page, so bundlers add nothing.

/** GSAP: the full timeline tree (from gsap.globalTimeline, or from the tweens DEA's hooks saw when GSAP is bundled), every ScrollTrigger, SplitText. */
export const READ_GSAP = String.raw`(() => {
  const C = window.__DEA_CODE__;
  const stackOf = new Map();
  if (C) { for (const x of C.tweens) stackOf.set(x.ref, x.stack); for (const x of C.timelines) stackOf.set(x.ref, x.stack); }
  let g = window.gsap;
  let root = g && g.globalTimeline;
  let source = root ? 'global' : null;
  if (!root && C && (C.tweens.length || C.timelines.length)) {
    let n = (C.tweens[0] || C.timelines[0]).ref;
    for (let i = 0; n && n.parent && i < 50; i++) n = n.parent;
    root = n; source = 'hooks';
  }
  const desc = (t) => {
    try {
      if (!t) return 'null';
      if (t.nodeType === 1) {
        const cls = typeof t.className === 'string' ? t.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join('') : '';
        return t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + cls;
      }
      if (t === window) return 'window';
      const ctor = t.constructor && t.constructor.name;
      const keys = Object.keys(t).filter((k) => !k.startsWith('_')).slice(0, 4);
      if (t.isVector3 || t.isVector2 || t.isEuler) return ctor + ' {' + keys.join(', ') + '}';
      if ('value' in t && Object.keys(t).length <= 3) return 'uniform {value}';
      return (ctor && ctor !== 'Object' ? ctor + ' ' : '') + '{' + keys.join(', ') + '}';
    } catch (e) { return '?'; }
  };
  const SKIP = new Set(['ease', 'duration', 'delay', 'repeat', 'yoyo', 'stagger', 'scrollTrigger', 'onComplete', 'onUpdate', 'onStart', 'onRepeat', 'onReverseComplete', 'paused', 'immediateRender', 'runBackwards', 'startAt', 'overwrite', 'id', 'callbackScope', 'data', 'parent', 'defaults', 'smoothChildTiming', 'autoRemoveChildren', 'lazy', 'inherit', 'repeatDelay', 'repeatRefresh', 'yoyoEase', 'keyframes', 'onInterrupt', 'reversed', 'snap', 'modifiers', 'force3D']);
  const val = (v) => (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : Array.isArray(v) ? v.slice(0, 6) : typeof v === 'function' ? 'fn()' : v && typeof v === 'object' ? '{…}' : String(v));
  const props = (vars) => { const o = {}; if (!vars) return o; for (const k of Object.keys(vars)) if (!SKIP.has(k) && !/Params$|Scope$|^on[A-Z]/.test(k) && Object.keys(o).length < 14) o[k] = val(vars[k]); return o; };
  const easeName = (vars) => { const e = vars && vars.ease; if (typeof e === 'string') return e; return undefined; };
  const easeSamples = (child) => { const f = child._ease || (typeof (child.vars && child.vars.ease) === 'function' ? child.vars.ease : null); if (typeof f !== 'function') return undefined; try { return [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => +f(p).toFixed(4)); } catch (e) { return undefined; } };
  const stackTop = (ref) => { const s = stackOf.get(ref); if (!s) return null; const f = s.find((l) => !/gsap|greensock|TweenMax|TimelineMax/i.test(l)) || s[0]; return f || null; };
  let count = 0;
  const walk = (tl, depth) => {
    const out = [];
    let child = tl && tl._first;
    for (let guard = 0; child && guard < 2000 && count < 1500; guard++, child = child._next) {
      count++;
      const isTl = typeof child.getChildren === 'function' || !!child._first || child.smoothChildTiming !== undefined;
      const v = child.vars || {};
      const tg = !isTl && typeof child.targets === 'function' ? child.targets() : [];
      const isCall = !isTl && tg.length === 1 && typeof tg[0] === 'function';
      const node = {
        type: isTl ? 'timeline' : isCall ? 'call' : 'tween',
        easeSamples: isTl || isCall ? undefined : easeSamples(child),
        keyframes: v.keyframes ? (Array.isArray(v.keyframes) ? v.keyframes.slice(0, 8).map(props) : props(v.keyframes)) : undefined,
        start: +((child._start || 0).toFixed(3)),
        duration: +((typeof child.duration === 'function' ? child.duration() : child._dur || 0).toFixed(3)),
        mode: v.runBackwards ? 'from' : v.startAt ? 'fromTo' : isTl ? undefined : 'to',
        ease: easeName(v),
        repeat: v.repeat, yoyo: v.yoyo, delay: v.delay, stagger: v.stagger && typeof v.stagger === 'object' ? props(v.stagger) : v.stagger,
        targets: !isTl && !isCall && typeof child.targets === 'function' ? Array.from(new Set(child.targets().slice(0, 30).map(desc))).slice(0, 6) : undefined,
        targetCount: !isTl && typeof child.targets === 'function' ? child.targets().length : undefined,
        to: isTl ? undefined : props(v),
        from: v.startAt ? props(v.startAt) : undefined,
        labels: isTl && child.labels && Object.keys(child.labels).length ? child.labels : undefined,
        scrollTrigger: child.scrollTrigger ? true : v.scrollTrigger ? true : undefined,
        progress: typeof child.progress === 'function' ? +child.progress().toFixed(3) : undefined,
        createdAt: stackTop(child),
        children: isTl && depth < 8 ? walk(child, depth + 1) : undefined,
      };
      if (child.scrollTrigger) child.__deaStIndex = count;
      out.push(node);
    }
    return out;
  };
  const tree = root ? walk(root, 0) : [];
  const ST = window.ScrollTrigger || (g && g.core && g.core.globals && g.core.globals().ScrollTrigger);
  let triggers = [];
  try {
    const all = ST && ST.getAll ? ST.getAll() : [];
    triggers = all.slice(0, 120).map((s) => {
      const v = s.vars || {};
      return {
        trigger: desc(s.trigger), start: v.start != null ? String(v.start) : undefined, end: v.end != null ? String(v.end) : undefined,
        startPx: Math.round(s.start), endPx: Math.round(s.end), scrub: v.scrub, pin: v.pin ? desc(s.pin || v.pin) : undefined,
        snap: v.snap ? val(v.snap) : undefined, toggleActions: v.toggleActions, markers: v.markers ? true : undefined,
        animation: s.animation ? (s.animation.getChildren ? 'timeline' : 'tween') + ' ' + (s.animation.duration ? s.animation.duration().toFixed(2) + 's' : '') : (v.onUpdate ? 'onUpdate callback' : v.onToggle ? 'onToggle callback' : 'none'),
        animationTargets: s.animation && s.animation.targets ? Array.from(new Set(s.animation.targets().slice(0, 10).map(desc))).slice(0, 4) : undefined,
      };
    });
  } catch (e) {}
  const split = {
    global: !!window.SplitText,
    elements: document.querySelectorAll('[class*="char"], [class*="word"], [class*="line"]').length,
    ariaSplit: Array.from(document.querySelectorAll('[aria-label]')).filter((el) => el.children.length > 4 && Array.from(el.children).every((c) => (c.textContent || '').length <= 2)).length,
  };
  return {
    source, version: (g && g.version) || (window.gsapVersions && window.gsapVersions[0]) || null,
    hookTweens: C ? C.tweens.length : 0, hookTimelines: C ? C.timelines.length : 0,
    tree, nodes: count, scrollTriggers: triggers, scrollTriggerPresent: !!ST, split,
  };
})()`;

/** CSS animations and transitions, the Web Animations API, @keyframes rules, declared transitions (hover states). */
export const READ_CSS = String.raw`(() => {
  const desc = (t) => { try { if (!t || t.nodeType !== 1) return '?'; const cls = typeof t.className === 'string' ? t.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join('') : ''; return t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + cls; } catch (e) { return '?'; } };
  const anims = (document.getAnimations ? document.getAnimations() : []).slice(0, 300).map((a) => {
    const e = a.effect; const tm = e && e.getTiming ? e.getTiming() : {};
    let kf = [];
    try { kf = e && e.getKeyframes ? e.getKeyframes().slice(0, 8).map((k) => { const o = {}; for (const x of Object.keys(k)) if (!['composite', 'computedOffset'].includes(x) && Object.keys(o).length < 8) o[x] = k[x]; return o; }) : []; } catch (x) {}
    return {
      type: a.constructor && a.constructor.name, name: a.animationName || a.transitionProperty || a.id || undefined,
      target: desc(e && e.target), duration: tm.duration, delay: tm.delay, easing: tm.easing, iterations: tm.iterations, direction: tm.direction, fill: tm.fill,
      playState: a.playState, keyframes: kf,
      timeline: a.timeline && a.timeline.constructor && a.timeline.constructor.name,
    };
  });
  const keyframes = [];
  const walk = (rules) => { for (const r of Array.from(rules || [])) { if (keyframes.length >= 120) return; if (r.type === 7 || r.constructor.name === 'CSSKeyframesRule') keyframes.push({ name: r.name, css: r.cssText.slice(0, 1200) }); else if (r.cssRules) walk(r.cssRules); } };
  for (const s of Array.from(document.styleSheets)) { try { walk(s.cssRules); } catch (e) {} }
  const transitions = new Map();
  let n = 0;
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (n++ > 4000) break;
    const cs = getComputedStyle(el);
    if (!cs.transitionDuration || /^0s(, 0s)*$/.test(cs.transitionDuration)) continue;
    const key = cs.transitionProperty + '|' + cs.transitionDuration + '|' + cs.transitionTimingFunction + '|' + cs.transitionDelay;
    const t = transitions.get(key) || { property: cs.transitionProperty, duration: cs.transitionDuration, easing: cs.transitionTimingFunction, delay: cs.transitionDelay, count: 0, example: desc(el) };
    t.count++; transitions.set(key, t);
  }
  return { animations: anims, keyframes, transitions: Array.from(transitions.values()).sort((a, b) => b.count - a.count).slice(0, 40) };
})()`;

/** Lottie, Rive, Framer Motion, Motion One, Theatre.js, three.js animation clips. */
export const READ_OTHERS = String.raw`(() => {
  const out = { lottie: [], rive: {}, framer: {}, theatre: {}, three: [] };
  try {
    const L = window.lottie || window.bodymovin;
    if (L && L.getRegisteredAnimations) out.lottie = L.getRegisteredAnimations().slice(0, 20).map((a) => ({ name: a.name || a.fileName || null, path: a.path || null, fps: a.frameRate || (a.animationData && a.animationData.fr), frames: a.totalFrames, seconds: a.totalFrames && a.frameRate ? +(a.totalFrames / a.frameRate).toFixed(2) : null, loop: a.loop, autoplay: a.autoplay, renderer: a.renderer && a.renderer.rendererType, layers: a.animationData && a.animationData.layers ? a.animationData.layers.length : null, w: a.animationData && a.animationData.w, h: a.animationData && a.animationData.h, playing: !a.isPaused }));
    for (const el of Array.from(document.querySelectorAll('lottie-player, dotlottie-player, dotlottie-wc'))) out.lottie.push({ name: el.tagName.toLowerCase(), path: el.getAttribute('src'), player: 'web component' });
  } catch (e) {}
  try {
    out.rive = { runtime: !!(window.rive || window.Rive), canvases: document.querySelectorAll('canvas[class*="rive" i], canvas[id*="rive" i], rive-canvas').length };
  } catch (e) {}
  try {
    out.framer = { attributes: document.querySelectorAll('[data-framer-appear-id], [data-framer-component-type], [data-framer-name]').length, appear: document.querySelectorAll('[data-framer-appear-id]').length, motionOne: !!window.Motion };
  } catch (e) {}
  try {
    out.theatre = { core: !!(window.__TheatreJS_CoreBundle || window.__TheatreJS_Notifications), studio: !!window.__TheatreJS_StudioBundle };
  } catch (e) {}
  try {
    const D = window.__DEA__;
    const seen = new Set();
    for (const s of (D && D.three && D.three.scenes) || []) {
      s.traverse && s.traverse((o) => {
        for (const c of o.animations || []) {
          if (seen.has(c) || out.three.length > 60) continue; seen.add(c);
          out.three.push({ object: o.name || o.type, clip: c.name, seconds: +(c.duration || 0).toFixed(3), tracks: (c.tracks || []).length, trackNames: (c.tracks || []).slice(0, 6).map((t) => t.name) });
        }
      });
    }
  } catch (e) {}
  return out;
})()`;

/** Pick the elements worth recording: GSAP targets, elements with inline transforms, will-change, running animations. */
export const PICK_ELEMENTS = String.raw`(() => {
  const M = window.__DEA_MOTION__; if (!M) return [];
  const cand = new Set();
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (cand.size >= 30) break;
    const r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue;
    const st = el.getAttribute('style') || '';
    if (el._gsap || /transform|translate|opacity/.test(st) || getComputedStyle(el).willChange.includes('transform')) cand.add(el);
  }
  M.els = Array.from(cand);
  const desc = (t) => { const cls = typeof t.className === 'string' ? t.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join('') : ''; return t.tagName.toLowerCase() + (t.id ? '#' + t.id : '') + cls; };
  return M.els.map(desc);
})()`;
