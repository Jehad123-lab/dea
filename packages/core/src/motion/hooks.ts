/**
 * In-page recorder for motion no library describes: float uniforms the page sets each frame (uTime, uProgress, …),
 * the scroll position, and the transform/opacity of elements that move. Off until DEA starts a recording window;
 * it only reads. Kept as a string so bundlers cannot inject helpers into it.
 */
export const MOTION_INIT_SCRIPT = String.raw`(() => {
  if (window.__DEA_MOTION__) return;
  const M = (window.__DEA_MOTION__ = { recording: false, frames: [], last: {}, names: new Set(), els: [], errors: [], wheel: 0 });
  const MAX_FRAMES = 900, MAX_UNIFORMS = 80;
  const locName = new WeakMap();
  const wrap = (C) => {
    if (!C || !C.prototype) return;
    const P = C.prototype;
    const gl = P.getUniformLocation;
    P.getUniformLocation = function (p, name) { const l = gl.apply(this, arguments); try { if (l) locName.set(l, String(name)); } catch (e) {} return l; };
    for (const fn of ['uniform1f', 'uniform2f', 'uniform3f', 'uniform4f', 'uniform1fv']) {
      const o = P[fn];
      if (!o) continue;
      P[fn] = function (loc, x) {
        try {
          if (M.recording && loc) {
            const n = locName.get(loc);
            if (n && (M.names.has(n) || M.names.size < MAX_UNIFORMS)) { M.names.add(n); M.last[n] = typeof x === 'number' ? x : x && x.length ? x[0] : NaN; }
          }
        } catch (e) {}
        return o.apply(this, arguments);
      };
    }
  };
  wrap(window.WebGLRenderingContext);
  wrap(window.WebGL2RenderingContext);
  addEventListener('wheel', (e) => { M.wheel += e.deltaY || 0; }, { passive: true, capture: true });
  const raf = window.requestAnimationFrame;
  const tick = () => {
    try {
      if (M.recording && M.frames.length < MAX_FRAMES) {
        const els = M.els.map((el) => { const cs = getComputedStyle(el); return [cs.transform, cs.opacity]; });
        M.frames.push({ t: performance.now(), y: scrollY, w: M.wheel, u: Object.assign({}, M.last), e: els });
      }
    } catch (e) { if (M.errors.length < 10) M.errors.push(String(e)); }
    raf.call(window, tick);
  };
  raf.call(window, tick);
})();`;
