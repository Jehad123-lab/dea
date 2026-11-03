/**
 * Runs in the page before the site's scripts (with DEA's other observers). It watches WebGL texture uploads and
 * draws, and records: each texture's size, format, wrap/filter/mipmaps, where its pixels came from (an image URL,
 * a canvas, a video, data computed in JavaScript), a small preview of what was uploaded, which shader program and
 * sampler uniform each texture is drawn with, and which textures are render targets. It never changes what is drawn.
 *
 * Kept as a string so bundlers cannot inject helpers into it.
 */
export const ASSET_INIT_SCRIPT = String.raw`(() => {
  if (window.__DEA_ASSETS__) return;
  const A = (window.__DEA_ASSETS__ = { textures: {}, programs: {}, bindings: [], gpu: [], errors: [], previews: 0, capture: { armed: false, on: false, ts: 0, done: false, draws: [] } });
  const stackNow = () => String(new Error().stack || '').split('\n').slice(3, 15).map((s) => s.trim()).filter((s) => s.startsWith('at '));
  const fbTex = new WeakMap();
  const MAX_TEX = 400, MAX_PREVIEWS = 80, MAX_BIND = 3000, PREVIEW = 512;
  let texN = 0, progN = 0;
  const texObj = new Map(), texId = new WeakMap(), progId = new WeakMap(), shaderSrc = new WeakMap(), state = new WeakMap(), texCtx = new Map();
  const st = (gl) => { let s = state.get(gl); if (!s) { s = { unit: 0, units: {}, fb: null }; state.set(gl, s); } return s; };
  const T2D = 0x0DE1, CUBE = 0x8513, T3D = 0x806F, TARR = 0x8C1A;
  const targetOf = (t) => (t >= 0x8515 && t <= 0x851A ? CUBE : t);
  const boundTex = (gl, target) => { const s = st(gl); const u = s.units[s.unit] || {}; return u[targetOf(target)] || null; };
  const rec = (tex) => { if (!tex) return null; let id = texId.get(tex); if (!id) { if (texN >= MAX_TEX) return null; id = 't' + (++texN); texId.set(tex, id); texObj.set(id, tex); A.textures[id] = { id, uploads: 0, params: {} }; } return A.textures[id]; };

  const preview = (src, w, h, fmt, type) => {
    if (A.previews >= MAX_PREVIEWS) return null;
    try {
      const k = Math.min(1, PREVIEW / Math.max(w || 1, h || 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((w || 1) * k)); c.height = Math.max(1, Math.round((h || 1) * k));
      const x = c.getContext('2d');
      if (ArrayBuffer.isView(src)) {
        if (!w || !h || w * h > 4096 * 4096) return null;
        const ch = fmt === 0x1908 ? 4 : fmt === 0x1907 ? 3 : fmt === 0x8227 ? 2 : 1; // RGBA, RGB, RG, single
        const n = w * h;
        if (src.length < n * ch) return null;
        const out = new ImageData(w, h);
        let lo = 0, hi = 255;
        const isFloat = src instanceof Float32Array || src instanceof Uint16Array && type !== 0x1403;
        if (isFloat) { lo = Infinity; hi = -Infinity; for (let i = 0; i < Math.min(src.length, n * ch); i += Math.max(1, Math.floor(n * ch / 50000))) { const v = src[i]; if (v < lo) lo = v; if (v > hi) hi = v; } if (!(hi > lo)) { lo = 0; hi = 1; } }
        const sc = 255 / (hi - lo);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < 3; j++) out.data[i * 4 + j] = ((src[i * ch + Math.min(j, ch - 1)] - lo) * sc) | 0;
          out.data[i * 4 + 3] = ch === 4 && !isFloat ? src[i * ch + 3] : 255;
        }
        const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(out, 0, 0);
        x.drawImage(t, 0, 0, c.width, c.height);
        A.previews++;
        return { url: c.toDataURL('image/png'), normalized: isFloat ? [lo, hi] : null };
      }
      if (typeof ImageData !== 'undefined' && src instanceof ImageData) { const t = document.createElement('canvas'); t.width = src.width; t.height = src.height; t.getContext('2d').putImageData(src, 0, 0); src = t; }
      x.drawImage(src, 0, 0, c.width, c.height);
      A.previews++;
      return { url: c.toDataURL('image/png'), normalized: null };
    } catch (e) { return { error: String(e && e.message || e).slice(0, 120) }; }
  };
  const describe = (src) => {
    try {
      if (!src) return { kind: 'empty' };
      if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) return { kind: 'image', url: src.currentSrc || src.src, w: src.naturalWidth, h: src.naturalHeight };
      if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return { kind: 'video', url: src.currentSrc || src.src, w: src.videoWidth, h: src.videoHeight };
      if (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement) return { kind: 'canvas', w: src.width, h: src.height, id: src.id || src.getAttribute('data-dea-canvas') || null };
      if (typeof OffscreenCanvas !== 'undefined' && src instanceof OffscreenCanvas) return { kind: 'canvas', w: src.width, h: src.height };
      if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) return { kind: 'imagebitmap', w: src.width, h: src.height };
      if (typeof ImageData !== 'undefined' && src instanceof ImageData) return { kind: 'imagedata', w: src.width, h: src.height };
      if (ArrayBuffer.isView(src)) return { kind: 'data', array: src.constructor.name, length: src.length };
    } catch (e) {}
    return { kind: typeof src };
  };
  const upload = (gl, target, level, a, kind) => {
    try {
      const t = rec(boundTex(gl, target));
      if (!t || level !== 0) return;
      t.uploads++;
      if (t.uploads === 1) t.stack = stackNow();
      texCtx.set(t.id, gl);
      t.target = targetOf(target) === CUBE ? 'cube' : targetOf(target) === T3D ? '3d' : targetOf(target) === TARR ? '2d-array' : '2d';
      if (t.uploads > 3 && t.source && t.source.kind !== 'video') { t.dynamic = true; return; }
      Object.assign(t, a.meta);
      if (a.src !== undefined) {
        t.source = describe(a.src);
        const w = t.source.w || a.meta.width, h = t.source.h || a.meta.height;
        if (t.source.kind === 'video' && t.uploads > 1) { t.dynamic = true; return; }
        if (!t.preview && kind !== 'compressed') t.preview = preview(a.src, w, h, a.meta.format, a.meta.type);
      }
    } catch (e) { if (A.errors.length < 20) A.errors.push('upload: ' + e); }
  };

  const wrap = (C, api) => {
    if (!C || !C.prototype) return;
    const P = C.prototype;
    const f = (name, fn) => { const o = P[name]; if (!o) return; P[name] = function () { try { fn.call(this, arguments); } catch (e) { if (A.errors.length < 20) A.errors.push(name + ': ' + e); } return o.apply(this, arguments); }; };
    const after = (name, fn) => { const o = P[name]; if (!o) return; P[name] = function () { const r = o.apply(this, arguments); try { fn.call(this, r, arguments); } catch (e) {} return r; }; };
    after('createTexture', function (tex) { rec(tex); });
    f('activeTexture', function (a) { st(this).unit = a[0] - 0x84C0; });
    f('bindTexture', function (a) { const s = st(this); (s.units[s.unit] = s.units[s.unit] || {})[a[0]] = a[1]; });
    f('texParameteri', function (a) { const t = rec(boundTex(this, a[0])); if (!t) return; const k = { 0x2802: 'wrapS', 0x2803: 'wrapT', 0x2800: 'magFilter', 0x2801: 'minFilter' }[a[1]]; if (k) t.params[k] = a[2]; });
    f('generateMipmap', function (a) { const t = rec(boundTex(this, a[0])); if (t) t.mipmaps = true; });
    f('texImage2D', function (a) {
      if (a.length === 6) upload(this, a[0], a[1], { src: a[5], meta: { internalFormat: a[2], format: a[3], type: a[4] } }, 'image');
      else upload(this, a[0], a[1], { src: a[8] && typeof a[8] === 'object' ? a[8] : undefined, meta: { internalFormat: a[2], width: a[3], height: a[4], format: a[6], type: a[7] } }, 'pixels');
    });
    f('texSubImage2D', function (a) {
      if (a.length === 7) upload(this, a[0], a[1], { src: a[6], meta: { format: a[4], type: a[5] } }, 'image');
      else upload(this, a[0], a[1], { src: a[8] && typeof a[8] === 'object' ? a[8] : undefined, meta: { width: a[4], height: a[5], format: a[6], type: a[7] } }, 'pixels');
    });
    f('texStorage2D', function (a) { const t = rec(boundTex(this, a[0])); if (!t) return; Object.assign(t, { levels: a[1], internalFormat: a[2], width: a[3], height: a[4] }); if (a[1] > 1) t.mipmaps = true; });
    f('texImage3D', function (a) { upload(this, a[0], a[1], { meta: { internalFormat: a[2], width: a[3], height: a[4], depth: a[5], format: a[7], type: a[8] } }, 'pixels'); });
    f('compressedTexImage2D', function (a) { const t = rec(boundTex(this, a[0])); if (!t || a[1] !== 0) return; texCtx.set(t.id, this); t.uploads++; Object.assign(t, { compressed: true, internalFormat: a[2], width: a[3], height: a[4], source: { kind: 'compressed', bytes: a[6] && a[6].byteLength } }); });
    f('framebufferTexture2D', function (a) { const t = rec(a[3]); if (t) { t.renderTarget = true; texCtx.set(t.id, this); if (a[1] === 0x8CE0) { const fb = st(this).fb; if (fb) fbTex.set(fb, t.id); } } });
    f('bindFramebuffer', function (a) { if (a[0] === 0x8D40 || a[0] === 0x8CA9) st(this).fb = a[1]; });
    f('attachShader', function (a) { let p = progId.get(a[0]); if (!p) { p = 'p' + (++progN); progId.set(a[0], p); A.programs[p] = { id: p, shaders: [] }; } const s = shaderSrc.get(a[1]); if (s) A.programs[p].shaders.push(s); else A.programs[p].pending = (A.programs[p].pending || []).concat([a[1]]); });
    f('shaderSource', function (a) { shaderSrc.set(a[0], String(a[1]).slice(0, 60000)); });
    f('linkProgram', function (a) { const p0 = A.programs[progId.get(a[0])]; if (p0 && !p0.stack) p0.stack = stackNow(); const p = p0; if (p && p.pending) { for (const sh of p.pending) { const s = shaderSrc.get(sh); if (s) p.shaders.push(s); } delete p.pending; } });
    const sampled = new WeakMap();
    const SAMPLERS = [0x8B5E, 0x8B60, 0x8B5F, 0x8DC1, 0x8B62, 0x8DC5, 0x8DCA, 0x8DCF, 0x8DD2];
    const samplersNow = (gl, prog) => {
      const s = st(gl);
      const out = [];
      const count = gl.getProgramParameter(prog, 0x8B86); // ACTIVE_UNIFORMS
      for (let i = 0; i < count; i++) {
        const u = gl.getActiveUniform(prog, i);
        if (!u || !SAMPLERS.includes(u.type)) continue;
        const loc = gl.getUniformLocation(prog, u.name);
        const unit = loc ? gl.getUniform(prog, loc) : null;
        const tgt = u.type === 0x8B60 ? CUBE : u.type === 0x8B5F ? T3D : u.type === 0x8DC1 ? TARR : T2D;
        const tex = unit != null && s.units[unit] ? s.units[unit][tgt] : null;
        out.push({ name: u.name.replace(/\[0\]$/, ''), unit, tid: tex ? texId.get(tex) || null : null });
      }
      return out;
    };
    const onDraw = function () {
      const cap = A.capture;
      const prog = this.getParameter(0x8B8D); // CURRENT_PROGRAM
      if (!prog) return;
      const pid = progId.get(prog);
      if (cap.on && cap.draws.length < 400) {
        const fb = st(this).fb;
        cap.draws.push({ program: pid, target: fb ? fbTex.get(fb) || 'framebuffer' : 'screen', inputs: samplersNow(this, prog).map((x) => x.tid).filter(Boolean) });
      }
      if (A.bindings.length >= MAX_BIND) return;
      const n = sampled.get(prog) || 0;
      if (n >= 3) return;
      sampled.set(prog, n + 1);
      for (const x of samplersNow(this, prog)) {
        const key = pid + '|' + x.name + '|' + x.tid;
        if (!A.bindings.some((b) => b.key === key)) A.bindings.push({ key, program: pid, sampler: x.name, texture: x.tid, unit: x.unit });
      }
    };
    for (const d of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) f(d, onDraw);
  };
  wrap(window.WebGLRenderingContext, 'webgl');
  wrap(window.WebGL2RenderingContext, 'webgl2');

  // one-frame capture of every draw (armed by DEA): starts at the next animation frame, stops at the one after
  try {
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (cb) {
      return raf.call(window, function (ts) {
        const c = A.capture;
        if (c.armed && !c.on && !c.done) { c.on = true; c.ts = ts; }
        else if (c.on && ts > c.ts) { c.on = false; c.armed = false; c.done = true; }
        return cb(ts);
      });
    };
  } catch (e) {}

  // WebGPU: images copied into textures
  try {
    if (window.GPUQueue && GPUQueue.prototype.copyExternalImageToTexture) {
      const o = GPUQueue.prototype.copyExternalImageToTexture;
      GPUQueue.prototype.copyExternalImageToTexture = function (src, dst, size) {
        try { if (A.gpu.length < 200) { const s = describe(src && src.source); A.gpu.push({ source: s, size: size && (size.width || size[0]) + 'x' + (size.height || size[1]), format: dst && dst.texture && dst.texture.format, preview: A.previews < MAX_PREVIEWS ? preview(src.source, s.w, s.h) : null }); } } catch (e) {}
        return o.apply(this, arguments);
      };
    }
  } catch (e) {}

  // read a render target's pixels after the page has run for a while (called by DEA, not by the page)
  A.readTargets = (max) => {
    const out = [];
    for (const t of Object.values(A.textures)) {
      if (!t.renderTarget || out.length >= max) continue;
      const gl = texCtx.get(t.id);
      if (!gl || !t.width || !t.height || t.width * t.height > 2048 * 2048) continue;
      try {
        const tex = texObj.get(t.id);
        if (!tex) continue;
        const prev = gl.getParameter(0x8CA6); // FRAMEBUFFER_BINDING
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(0x8D40, fb);
        gl.framebufferTexture2D(0x8D40, 0x8CE0, 0x0DE1, tex, 0);
        let ok = gl.checkFramebufferStatus(0x8D40) === 0x8CD5;
        if (!ok && gl.getExtension) { gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float'); ok = gl.checkFramebufferStatus(0x8D40) === 0x8CD5; }
        if (ok) {
          const px = new Uint8Array(t.width * t.height * 4);
          gl.readPixels(0, 0, t.width, t.height, 0x1908, 0x1401, px);
          if (gl.getError() === 0) out.push({ id: t.id, preview: preview(px, t.width, t.height, 0x1908, 0x1401) });
          else {
            // float and half-float targets: read as 32-bit floats (needs EXT_color_buffer_float), shown normalised
            gl.getExtension && gl.getExtension('EXT_color_buffer_float');
            const fx = new Float32Array(t.width * t.height * 4);
            gl.readPixels(0, 0, t.width, t.height, 0x1908, 0x1406, fx);
            if (gl.getError() === 0) out.push({ id: t.id, float: true, preview: preview(fx, t.width, t.height, 0x1908, 0x1406) });
            else out.push({ id: t.id, error: 'readPixels refused (depth or unsupported float target)' });
          }
        } else out.push({ id: t.id, error: 'framebuffer incomplete for this texture (cube, array, depth or float without extension)' });
        gl.bindFramebuffer(0x8D40, prev);
        gl.deleteFramebuffer(fb);
      } catch (e) { out.push({ id: t.id, error: String(e).slice(0, 100) }); }
    }
    return out;
  };
})();`;
