/**
 * In-page observers for the code decoder, installed before the site's scripts run.
 *
 * GSAP: when GSAP is bundled (no window.gsap), DEA still sees every timeline and tween as it is built, by
 * noticing the first write of two GSAP-only instance fields (smoothChildTiming on timelines, _ptLookup on
 * tweens). The call stack at that moment says which script line created the animation.
 * fetch / XHR / WebSocket / EventSource: the URL and the stack of the code that asked for it.
 *
 * Observers record; they do not change what the page does. Only `dea code` / `dea explain` turn them on.
 */
export const CODE_INIT_SCRIPT = String.raw`(() => {
  if (window.__DEA_CODE__) return;
  const C = (window.__DEA_CODE__ = { timelines: [], tweens: [], requests: [], sockets: [], errors: [], t0: performance.now() });
  const now = () => Math.round(performance.now() - C.t0);
  const stack = () => String(new Error().stack || '').split('\n').slice(2, 16).map((s) => s.trim()).filter((s) => s.startsWith('at '));
  const trap = (prop, onFirst) => {
    try {
      Object.defineProperty(Object.prototype, prop, {
        configurable: true,
        enumerable: false,
        get() { return undefined; },
        set(v) {
          Object.defineProperty(this, prop, { value: v, writable: true, configurable: true, enumerable: true });
          try { onFirst(this); } catch (e) {}
        },
      });
    } catch (e) { C.errors.push('trap ' + prop + ': ' + e); }
  };
  trap('smoothChildTiming', (tl) => { if (C.timelines.length < 300) C.timelines.push({ ref: tl, stack: stack(), t: now() }); });
  trap('_ptLookup', (tw) => { if (tw && tw.vars && C.tweens.length < 800) C.tweens.push({ ref: tw, stack: stack(), t: now() }); });

  const rec = (kind, url, method) => { if (C.requests.length < 600) C.requests.push({ kind, url: String(url).slice(0, 500), method: method || 'GET', stack: stack(), t: now() }); };
  try {
    const f = window.fetch;
    if (f) window.fetch = function (input, init) {
      try { rec('fetch', typeof input === 'string' ? input : (input && input.url) || String(input), (init && init.method) || (input && input.method)); } catch (e) {}
      return f.apply(this, arguments);
    };
  } catch (e) { C.errors.push('fetch hook: ' + e); }
  try {
    const o = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) { try { rec('xhr', url, method); } catch (e) {} return o.apply(this, arguments); };
  } catch (e) { C.errors.push('xhr hook: ' + e); }
  try {
    for (const name of ['WebSocket', 'EventSource']) {
      const N = window[name];
      if (!N) continue;
      const W = function (url, p) { try { if (C.sockets.length < 50) C.sockets.push({ kind: name, url: String(url).slice(0, 300), stack: stack(), t: now() }); } catch (e) {} return new N(url, p); };
      W.prototype = N.prototype;
      Object.assign(W, N);
      window[name] = W;
    }
  } catch (e) { C.errors.push('socket hook: ' + e); }
})();`;
