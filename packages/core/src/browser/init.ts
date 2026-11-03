/**
 * Code that runs inside the page BEFORE the site's own scripts.
 * It only observes: it records WebGL/WebGPU shaders and contexts, three.js
 * renderers and scenes (through three's own devtools hook), the React renderer
 * version (through React's own devtools hook) and requestAnimationFrame use.
 * It never changes what the site draws.
 *
 * Kept as a string so bundlers/transpilers cannot inject helpers into it.
 */
export const INIT_SCRIPT = String.raw`(() => {
  if (window.__DEA__) return;
  const t0 = performance.now();
  const D = (window.__DEA__ = {
    shaders: [], contexts: [], programs: 0, webgpu: { adapters: 0, shaders: [] },
    three: { revision: null, renderers: [], scenes: [] },
    react: { renderers: [] },
    raf: { calls: 0, sources: {} },
    errors: [],
  });
  const now = () => Math.round(performance.now() - t0);
  const MAX_SHADERS = 400;
  const MAX_SRC = 200000;

  // Some sites show a static fallback when WebGL runs in software (SwiftShader, llvmpipe),
  // which is what a server or a GPU-less machine has. With DEA_GPU_MASK on, DEA answers the
  // renderer question with a common GPU name so the site shows its real 3D. It is recorded.
  D.renderer = null; D.gpuMasked = false;
  try {
    const MASK = window.__DEA_GPU_MASK__ !== false;
    const SOFT = /SwiftShader|llvmpipe|softpipe|Software/i;
    const maskGL = (C) => {
      if (!C || !C.prototype) return;
      const gp = C.prototype.getParameter;
      C.prototype.getParameter = function (p) {
        const v = gp.call(this, p);
        try {
          if (p === 0x9246 || p === 0x9245 || p === this.RENDERER) {
            if (p === 0x9246 || (p === this.RENDERER && !D.renderer)) D.renderer = D.renderer || String(v);
            if (MASK && SOFT.test(String(v))) {
              D.gpuMasked = true;
              if (p === 0x9245) return 'Google Inc. (NVIDIA)';
              return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)';
            }
          }
        } catch (e) {}
        return v;
      };
    };
    maskGL(window.WebGLRenderingContext);
    maskGL(window.WebGL2RenderingContext);
  } catch (e) { D.errors.push('gpu mask: ' + e); }

  // WebGL: canvas contexts and every shader source the site compiles
  try {
    const shaderType = new WeakMap();
    const wrapGL = (C, api) => {
      if (!C || !C.prototype) return;
      const P = C.prototype;
      const cs = P.createShader;
      P.createShader = function (type) {
        const s = cs.call(this, type);
        try { if (s) shaderType.set(s, type === this.VERTEX_SHADER ? 'vertex' : type === this.FRAGMENT_SHADER ? 'fragment' : String(type)); } catch (e) {}
        return s;
      };
      const ss = P.shaderSource;
      P.shaderSource = function (shader, source) {
        try {
          if (D.shaders.length < MAX_SHADERS) D.shaders.push({ api, type: shaderType.get(shader) || 'unknown', source: String(source).slice(0, MAX_SRC), t: now() });
        } catch (e) {}
        return ss.call(this, shader, source);
      };
      const lp = P.linkProgram;
      P.linkProgram = function (p) { D.programs++; return lp.call(this, p); };
    };
    wrapGL(window.WebGLRenderingContext, 'webgl');
    wrapGL(window.WebGL2RenderingContext, 'webgl2');
    const wrapCanvas = (C, kind) => {
      if (!C || !C.prototype || !C.prototype.getContext) return;
      const gc = C.prototype.getContext;
      C.prototype.getContext = function (type, attrs) {
        const ctx = gc.apply(this, arguments);
        try {
          if (ctx && /webgl|webgpu|experimental-webgl/i.test(String(type)) && !this.__deaSeen) {
            this.__deaSeen = true;
            const id = 'c' + D.contexts.length;
            if (this.setAttribute) this.setAttribute('data-dea-canvas', id);
            D.contexts.push({ id, kind, type: String(type), attrs: attrs || null, width: this.width, height: this.height, t: now() });
          }
        } catch (e) {}
        return ctx;
      };
    };
    wrapCanvas(window.HTMLCanvasElement, 'canvas');
    wrapCanvas(window.OffscreenCanvas, 'offscreen');
  } catch (e) { D.errors.push('webgl hook: ' + e); }

  // WebGPU: WGSL shader modules
  try {
    if (window.GPUDevice && GPUDevice.prototype.createShaderModule) {
      const csm = GPUDevice.prototype.createShaderModule;
      GPUDevice.prototype.createShaderModule = function (desc) {
        try { if (D.webgpu.shaders.length < MAX_SHADERS) D.webgpu.shaders.push({ api: 'webgpu', type: 'wgsl', source: String(desc && desc.code || '').slice(0, MAX_SRC), t: now() }); } catch (e) {}
        return csm.apply(this, arguments);
      };
    }
    if (window.GPU && GPU.prototype.requestAdapter) {
      const ra = GPU.prototype.requestAdapter;
      GPU.prototype.requestAdapter = function () { D.webgpu.adapters++; return ra.apply(this, arguments); };
    }
  } catch (e) { D.errors.push('webgpu hook: ' + e); }

  // three.js announces renderers and scenes to window.__THREE_DEVTOOLS__ (three's own hook)
  try {
    if (typeof window.__THREE_DEVTOOLS__ === 'undefined') {
      const hub = new EventTarget();
      hub.addEventListener('register', (e) => { try { D.three.revision = e.detail && e.detail.revision; } catch (x) {} });
      hub.addEventListener('observe', (e) => {
        const o = e.detail;
        if (!o) return;
        if (o.isScene) { if (D.three.scenes.length < 20) D.three.scenes.push(o); }
        else if (D.three.renderers.length < 20) D.three.renderers.push(o);
      });
      Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: hub, configurable: true, writable: true });
    }
  } catch (e) { D.errors.push('three hook: ' + e); }

  // React announces its renderer (with version) to the devtools hook
  try {
    if (typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
      let n = 0;
      const renderers = new Map();
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers, supportsFiber: true, isDisabled: false, __dea: true,
        inject(r) { const id = ++n; renderers.set(id, r); try { D.react.renderers.push({ version: r && r.version || null, packageName: r && r.rendererPackageName || null, bundleType: r && r.bundleType }); } catch (e) {} return id; },
        onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {}, setStrictMode() {},
      };
    }
  } catch (e) { D.errors.push('react hook: ' + e); }

  // requestAnimationFrame: count calls and note which scripts drive the loop
  try {
    const raf = window.requestAnimationFrame;
    let sampled = 0;
    window.requestAnimationFrame = function (cb) {
      D.raf.calls++;
      if (sampled < 300 && D.raf.calls % 10 === 1) {
        sampled++;
        try {
          const st = String(new Error().stack || '').split('\n').slice(2, 6).join('\n');
          const m = st.match(/(https?:\/\/[^\s)]+?):\d+:\d+/);
          if (m) { const src = m[1]; D.raf.sources[src] = (D.raf.sources[src] || 0) + 1; }
        } catch (e) {}
      }
      return raf.call(window, cb);
    };
  } catch (e) { D.errors.push('raf hook: ' + e); }
})();`;

/** tsx/esbuild may add __name() around functions passed to page.evaluate; give the page a no-op. */
export const NAME_SHIM = 'globalThis.__name = globalThis.__name || ((f) => f);';
