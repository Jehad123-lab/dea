// The replay player written into every kit that has a recording (replay/replay.js). Plain JavaScript with no
// dependencies, so it runs in any bundler, framework or a bare <script type="module">.

export const REPLAY_PLAYER = String.raw`// DEA replay player. Re-runs the WebGL frames DEA recorded on the live site with the site's own shaders, buffers,
// textures, render targets and draw order, so the picture matches the original pass for pass.
// No dependencies. Recorded from a site: the shaders, geometry and textures in capture.bin belong to their owners.

export async function loadCapture(base = './replay/') {
  const [doc, bin] = await Promise.all([fetch(base + 'capture.json').then((r) => r.json()), fetch(base + 'capture.bin').then((r) => r.arrayBuffer())]);
  return { doc, bin };
}

const CREATE = { createBuffer: 'buf', createTexture: 'tex', createProgram: 'prog', createShader: 'sh', createFramebuffer: 'fb', createRenderbuffer: 'rb',
  createVertexArray: 'vao', createSampler: 'smp', createQuery: 'q', createTransformFeedback: 'tf', 'ext:OES_vertex_array_object.createVertexArrayOES': 'vao' };
const SKIP = new Set(['fenceSync', 'waitSync', 'deleteSync', 'beginQuery', 'endQuery', 'deleteQuery', 'createQuery', 'ext:EXT_disjoint_timer_query_webgl2.queryCounterEXT',
  'ext:WEBGL_lose_context.loseContext', 'ext:WEBGL_lose_context.restoreContext']);
const DRAWS = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'ext:ANGLE_instanced_arrays.drawArraysInstancedANGLE', 'ext:ANGLE_instanced_arrays.drawElementsInstancedANGLE']);

/**
 * createReplay(canvas, { doc, bin }, options)
 *  options.animate      advance clock uniforms with real time (default true); false replays the recorded values exactly
 *  options.preserveDrawingBuffer
 * returns { gl, renderFrames(n), start(), stop(), setUniform(program, name, value), setPassEnabled(index, on), passes, errors }
 */
export function createReplay(canvas, data, options = {}) {
  const { doc, bin } = data;
  const animate = options.animate !== false;
  const attrs = Object.assign({}, doc.attrs, { preserveDrawingBuffer: !!options.preserveDrawingBuffer });
  canvas.width = doc.canvas.w;
  canvas.height = doc.canvas.h;
  const gl = canvas.getContext(doc.version === 2 ? 'webgl2' : 'webgl', attrs);
  if (!gl) throw new Error('WebGL' + (doc.version === 2 ? '2' : '') + ' is not available in this browser');
  const errors = [];
  const fail = (m) => { if (errors.length < 50) errors.push(m); };
  const ext = {};
  for (const n of doc.extensions.concat(['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'WEBGL_color_buffer_float', 'OES_texture_float_linear'])) ext[n] = ext[n] || gl.getExtension(n);
  const objs = new Map();
  const key = (k, id) => k + ':' + id;
  const get = (k, id) => (id ? objs.get(key(k, id)) || null : null);
  const view = (o, l, t) => { const C = globalThis[t] && globalThis[t].BYTES_PER_ELEMENT ? globalThis[t] : Uint8Array; return new C(bin, o, l / C.BYTES_PER_ELEMENT); };
  const locs = new Map();
  const loc = (p, n) => {
    const k = p + '|' + n;
    if (!locs.has(k)) { const P = get('prog', p); locs.set(k, P ? gl.getUniformLocation(P, n) : null); }
    return locs.get(k);
  };
  const arg = (a) => {
    if (a === null || typeof a !== 'object') return a;
    if (Array.isArray(a)) return a.map(arg);
    switch (a.$) {
      case 'bin': return view(a.o, a.l, a.t);
      case 'img': return new ImageData(new Uint8ClampedArray(bin.slice(a.o, a.o + a.l)), a.w, a.h);
      case 'loc': return loc(a.p, a.n);
      default: return get(a.$, a.id);
    }
  };

  // ---- uniforms -------------------------------------------------------------------------------------------------------
  const MAT = { 0x8b5a: 'uniformMatrix2fv', 0x8b5b: 'uniformMatrix3fv', 0x8b5c: 'uniformMatrix4fv', 0x8b65: 'uniformMatrix2x3fv', 0x8b66: 'uniformMatrix2x4fv',
    0x8b67: 'uniformMatrix3x2fv', 0x8b68: 'uniformMatrix3x4fv', 0x8b69: 'uniformMatrix4x2fv', 0x8b6a: 'uniformMatrix4x3fv' };
  const VEC = { 0x1406: '1f', 0x8b50: '2fv', 0x8b51: '3fv', 0x8b52: '4fv', 0x1404: '1i', 0x8b53: '2iv', 0x8b54: '3iv', 0x8b55: '4iv', 0x8b56: '1i', 0x8b57: '2iv',
    0x8b58: '3iv', 0x8b59: '4iv', 0x1405: '1ui', 0x8dc6: '2uiv', 0x8dc7: '3uiv', 0x8dc8: '4uiv' };
  const setUniformValue = (l, type, v) => {
    if (!l) return;
    if (MAT[type]) return gl[MAT[type]](l, false, v);
    const s = VEC[type] || '1i'; // samplers are ints
    if (s.endsWith('v')) gl['uniform' + s](l, v);
    else gl['uniform' + s](l, Array.isArray(v) ? v[0] : v);
  };

  // ---- resources, as they were when the recording met them -------------------------------------------------------------
  const S = doc.snap;
  if (gl.bindVertexArray) gl.bindVertexArray(null);
  for (const P of S.programs) {
    const p = gl.createProgram();
    for (const s of P.shaders) {
      const sh = gl.createShader(s.type);
      gl.shaderSource(sh, s.src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) fail('shader of program ' + P.id + ': ' + gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    }
    for (const a of P.attribs) if (a.loc >= 0 && !a.name.startsWith('gl_')) gl.bindAttribLocation(p, a.loc, a.name.replace(/\[0\]$/, ''));
    if (P.tf && P.tf.length) gl.transformFeedbackVaryings(p, P.tf, P.tfMode);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) fail('program ' + P.id + ': ' + gl.getProgramInfoLog(p));
    objs.set(key('prog', P.id), p);
    gl.useProgram(p);
    for (const u of P.uniforms) setUniformValue(gl.getUniformLocation(p, u.name), u.type, u.v);
    for (const b of P.blocks || []) { const i = gl.getUniformBlockIndex(p, b.name); if (i !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, i, b.binding); }
  }
  for (const B of S.buffers) {
    const b = gl.createBuffer();
    const T = B.kind === 'element' ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
    gl.bindBuffer(T, b);
    gl.bufferData(T, B.l ? view(B.o, B.l, 'Uint8Array') : 0, B.usage || gl.STATIC_DRAW);
    objs.set(key('buf', B.id), b);
  }
  const resetUnpack = () => {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (doc.version === 2) { gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); for (const p of [gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) gl.pixelStorei(p, 0); }
  };
  resetUnpack();
  gl.activeTexture(gl.TEXTURE0);
  const FLOATP = new Set([0x813a, 0x813b, 0x84fe]);
  for (const T of S.textures) {
    if (T.missing) continue;
    const t = gl.createTexture();
    gl.bindTexture(T.target, t);
    for (const c of T.comp || []) { try { gl[c.fn](...c.args.map(arg)); } catch (e) { fail('compressed upload: ' + e.message); } }
    let hasMips = false;
    for (const L of T.levels) {
      const target0 = T.target === 0x8513 ? 0x8515 + L.face : T.target;
      if (L.skipped || L.alloc) {
        // no pixels: allocate the level so render targets stay complete (depth, or contents the frames overwrite)
        const [af, at] = L.alloc || [L.upFmt, L.upType];
        if (af) {
          if (T.target === 0x806f || T.target === 0x8c1a) gl.texImage3D(target0, L.level, L.ifmt, L.w, L.h, L.d, 0, af, at, null);
          else gl.texImage2D(target0, L.level, L.ifmt, L.w, L.h, 0, af, at, null);
        }
        if (L.skipped && !/^depth$/.test(L.skipped)) fail('texture ' + T.id + ' level ' + L.level + ': ' + L.skipped);
        if (L.level > 0) hasMips = true;
        continue;
      }
      if (L.level > 0) hasMips = true;
      if (L.upload) {
        const st = L.upload.store || {};
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!st.flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!st.premul);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, st.align || 4);
        try { gl[L.upload.fn](...L.upload.args.map(arg)); } catch (e) { fail('upload: ' + e.message); }
        resetUnpack();
        continue;
      }
      const C = L.upType === 0x1406 ? 'Float32Array' : L.upType === 0x140b ? 'Uint16Array' : L.upType === 0x1404 ? 'Int32Array' : L.upType === 0x1405 ? 'Uint32Array' : 'Uint8Array';
      const px = view(L.o, L.l, C);
      const target = T.target === 0x8513 ? 0x8515 + L.face : T.target;
      if (T.target === 0x806f || T.target === 0x8c1a) gl.texImage3D(target, L.level, L.ifmt, L.w, L.h, L.d, 0, L.upFmt, L.upType, px);
      else gl.texImage2D(target, L.level, L.ifmt, L.w, L.h, 0, L.upFmt, L.upType, px);
    }
    for (const [p, v] of Object.entries(T.params || {})) { if (FLOATP.has(+p)) gl.texParameterf(T.target, +p, v); else gl.texParameteri(T.target, +p, v); }
    const minf = (T.params || {})[0x2801];
    if (!hasMips && !(T.comp && T.comp.length) && minf >= 0x2700 && minf <= 0x2703) { try { gl.generateMipmap(T.target); } catch (e) {} }
    objs.set(key('tex', T.id), t);
  }
  for (const Rb of S.renderbuffers) {
    const r = gl.createRenderbuffer();
    if (Rb.w) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, r);
      if (Rb.samples && gl.renderbufferStorageMultisample) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Rb.samples, Rb.internalformat, Rb.w, Rb.h);
      else gl.renderbufferStorage(gl.RENDERBUFFER, Rb.internalformat, Rb.w, Rb.h);
    }
    objs.set(key('rb', Rb.id), r);
  }
  for (const Sm of S.samplers) {
    const s = gl.createSampler();
    for (const [p, v] of Object.entries(Sm.params || {})) { if (v == null) continue; if (+p === 0x813a || +p === 0x813b) gl.samplerParameterf(s, +p, v); else gl.samplerParameteri(s, +p, v); }
    objs.set(key('smp', Sm.id), s);
  }
  for (const F of S.framebuffers) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    for (const a of F.atts) {
      if (a.tex) {
        const t = get('tex', a.tex);
        if (a.texTarget === 0x806f || a.texTarget === 0x8c1a) gl.framebufferTextureLayer(gl.FRAMEBUFFER, a.a, t, a.level || 0, a.layer || 0);
        else gl.framebufferTexture2D(gl.FRAMEBUFFER, a.a, a.face || a.texTarget || gl.TEXTURE_2D, t, a.level || 0);
      } else if (a.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, a.a, gl.RENDERBUFFER, get('rb', a.rb));
    }
    if (doc.version === 2 && F.draw && F.draw.length) { gl.drawBuffers(F.draw); if (F.read) gl.readBuffer(F.read); }
    objs.set(key('fb', F.id), f);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const vaoExt = ext.OES_vertex_array_object;
  const bindVao = (v) => (doc.version === 2 ? gl.bindVertexArray(v) : vaoExt ? vaoExt.bindVertexArrayOES(v) : null);
  const inst = ext.ANGLE_instanced_arrays;
  const applyVao = (V) => {
    if (!V) return;
    const on = new Set();
    for (const a of V.attrs) {
      const b = get('buf', a.buf);
      if (b) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        if (a.int && gl.vertexAttribIPointer) gl.vertexAttribIPointer(a.i, a.size, a.type, a.stride, a.off);
        else gl.vertexAttribPointer(a.i, a.size, a.type, !!a.norm, a.stride, a.off);
      }
      if (a.en) { gl.enableVertexAttribArray(a.i); on.add(a.i); }
      if (a.div != null) { if (gl.vertexAttribDivisor) gl.vertexAttribDivisor(a.i, a.div); else if (inst) inst.vertexAttribDivisorANGLE(a.i, a.div); }
    }
    const n = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    for (let i = 0; i < n; i++) if (!on.has(i)) gl.disableVertexAttribArray(i);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, get('buf', V.el));
  };
  for (const V of S.vaos) {
    const v = doc.version === 2 ? gl.createVertexArray() : vaoExt ? vaoExt.createVertexArrayOES() : null;
    if (!v) continue;
    bindVao(v);
    applyVao(V);
    objs.set(key('vao', V.id), v);
  }
  bindVao(null);

  // ---- state at the start of each recorded frame ---------------------------------------------------------------------
  const applyState = (st) => {
    if (!st) return;
    for (const [c, on] of Object.entries(st.en)) (on ? gl.enable(+c) : gl.disable(+c));
    const p = st.p;
    const has = (...k) => k.every((x) => p[x] != null);
    if (has(0x8005)) gl.blendColor(...p[0x8005]);
    if (has(0x8009, 0x883d)) gl.blendEquationSeparate(p[0x8009], p[0x883d]);
    if (has(0x80c9, 0x80c8, 0x80cb, 0x80ca)) gl.blendFuncSeparate(p[0x80c9], p[0x80c8], p[0x80cb], p[0x80ca]);
    if (has(0x0c22)) gl.clearColor(...p[0x0c22]);
    if (has(0x0c23)) gl.colorMask(...p[0x0c23]);
    if (has(0x0b45)) gl.cullFace(p[0x0b45]);
    if (has(0x0b73)) gl.clearDepth(p[0x0b73]);
    if (has(0x0b74)) gl.depthFunc(p[0x0b74]);
    if (has(0x0b70)) gl.depthRange(...p[0x0b70]);
    if (has(0x0b72)) gl.depthMask(p[0x0b72]);
    if (has(0x0b46)) gl.frontFace(p[0x0b46]);
    if (has(0x8038, 0x2a00)) gl.polygonOffset(p[0x8038], p[0x2a00]);
    if (has(0x80aa, 0x80ab)) gl.sampleCoverage(p[0x80aa], p[0x80ab]);
    if (has(0x0c10)) gl.scissor(...p[0x0c10]);
    if (has(0x0b92, 0x0b97, 0x0b93)) gl.stencilFuncSeparate(gl.FRONT, p[0x0b92], p[0x0b97], p[0x0b93]);
    if (has(0x0b94, 0x0b95, 0x0b96)) gl.stencilOpSeparate(gl.FRONT, p[0x0b94], p[0x0b95], p[0x0b96]);
    if (has(0x0b98)) gl.stencilMaskSeparate(gl.FRONT, p[0x0b98]);
    if (has(0x8800, 0x8ca3, 0x8ca4)) gl.stencilFuncSeparate(gl.BACK, p[0x8800], p[0x8ca3], p[0x8ca4]);
    if (has(0x8801, 0x8802, 0x8803)) gl.stencilOpSeparate(gl.BACK, p[0x8801], p[0x8802], p[0x8803]);
    if (has(0x8ca5)) gl.stencilMaskSeparate(gl.BACK, p[0x8ca5]);
    if (has(0x0b91)) gl.clearStencil(p[0x0b91]);
    if (has(0x0ba2)) gl.viewport(...p[0x0ba2]);
    for (const k of [0x0cf5, 0x0d05, 0x9240, 0x9241, 0x9243, 0x0cf2, 0x806e, 0x0cf4, 0x0cf3, 0x806d, 0x0d02, 0x0d04, 0x0d03]) if (p[k] != null) gl.pixelStorei(k, typeof p[k] === 'boolean' ? (p[k] ? 1 : 0) : p[k]);
    if (has(0x8192)) gl.hint(0x8192, p[0x8192]);
    // default vertex array, then bindings
    bindVao(null);
    applyVao(st.defaultVao);
    const nUnits = Math.min(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS), 32);
    const units = new Map((st.units || []).map((u) => [u.u, u]));
    for (let u = 0; u < nUnits; u++) {
      const U = units.get(u) || {};
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, get('tex', U['2d']));
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, get('tex', U.cube));
      if (doc.version === 2) { gl.bindTexture(gl.TEXTURE_3D, get('tex', U['3d'])); gl.bindTexture(gl.TEXTURE_2D_ARRAY, get('tex', U.array)); gl.bindSampler(u, get('smp', U.smp)); }
    }
    gl.activeTexture(st.activeTexture || gl.TEXTURE0);
    if (doc.version === 2) {
      for (const b of st.ubos || []) { if (b.size) gl.bindBufferRange(gl.UNIFORM_BUFFER, b.i, get('buf', b.buf), b.start, b.size); else gl.bindBufferBase(gl.UNIFORM_BUFFER, b.i, get('buf', b.buf)); }
      gl.bindBuffer(gl.UNIFORM_BUFFER, get('buf', st.ubo));
      gl.bindBuffer(gl.COPY_READ_BUFFER, get('buf', st.copyRead));
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, get('buf', st.copyWrite));
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, get('buf', st.pack));
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, get('buf', st.unpack));
    }
    (st.current || []).forEach((v, i) => gl.vertexAttrib4fv(i, v));
    gl.useProgram(get('prog', st.program));
    bindVao(get('vao', st.vao));
    gl.bindBuffer(gl.ARRAY_BUFFER, get('buf', st.arrayBuffer));
    if (doc.version === 2) { gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, get('fb', st.drawFb)); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, get('fb', st.readFb)); }
    else gl.bindFramebuffer(gl.FRAMEBUFFER, get('fb', st.drawFb));
    gl.bindRenderbuffer(gl.RENDERBUFFER, get('rb', st.rb));
  };

  // ---- the commands --------------------------------------------------------------------------------------------------
  const overrides = new Map(); // "progId|name" -> value array
  const skipDraw = new Set(); // "frame:cmd"
  const anim = new Map(); // "frame:cmd" -> [{ arg, base, rate }]
  for (const a of doc.animate || []) { const k = a.frame + ':' + a.cmd; if (!anim.has(k)) anim.set(k, []); anim.get(k).push(a); }
  let t0 = 0;
  const exec = (f) => {
    const cmds = doc.frames[f].cmds;
    const now = performance.now();
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      const name = c[0];
      if (SKIP.has(name)) continue;
      let raw = c.slice(1);
      let ret = 0;
      const last = raw[raw.length - 1];
      if (last && typeof last === 'object' && last.$ret) { ret = last.$ret; raw = raw.slice(0, -1); }
      if (DRAWS.has(name) && skipDraw.has(f + ':' + i)) continue;
      const A = anim.get(f + ':' + i);
      if (animate && A && t0) { raw = raw.slice(); for (const x of A) raw[x.arg] = x.base + x.rate * (now - t0); }
      if (name.startsWith('uniform') && raw[0] && raw[0].$ === 'loc') {
        const o = overrides.get(raw[0].p + '|' + raw[0].n);
        if (o) { const l = loc(raw[0].p, raw[0].n); if (name.startsWith('uniformMatrix')) gl[name](l, false, o); else if (name.endsWith('v')) gl[name](l, o); else gl[name](l, ...o); continue; }
      }
      let args;
      try { args = raw.map(arg); } catch (e) { fail(name + ': ' + e.message); continue; }
      try {
        let r;
        if (name.startsWith('ext:')) {
          const dot = name.indexOf('.');
          const E = ext[name.slice(4, dot)];
          if (!E) { fail('missing extension for ' + name); continue; }
          r = E[name.slice(dot + 1)](...args);
        } else r = gl[name](...args);
        if (ret && CREATE[name]) objs.set(key(CREATE[name], ret), r);
        if (name === 'linkProgram') for (const k of [...locs.keys()]) locs.delete(k);
      } catch (e) { fail(name + ': ' + e.message); }
    }
  };
  // after the whole recorded frames, the program uniforms the replay overrides stay overridden
  const applyOverrides = () => {
    for (const [k, v] of overrides) {
      const [p, n] = k.split('|');
      const P = (S.programs.find((x) => String(x.id) === p) || { uniforms: [] }).uniforms.find((u) => u.name === n);
      const prog = get('prog', +p);
      if (!prog) continue;
      gl.useProgram(prog);
      setUniformValue(loc(+p, n), P ? P.type : 0x1406, v);
    }
  };

  let frame = 0;
  let raf = 0;
  const step = () => {
    if (!t0) t0 = performance.now();
    applyState(doc.frames[frame].state);
    exec(frame);
    frame = (frame + 1) % doc.frames.length;
  };
  return {
    gl,
    doc,
    errors,
    passes: (doc.graph && doc.graph.passes) || [],
    renderFrames(n = doc.frames.length) { for (let i = 0; i < n; i++) step(); gl.flush(); },
    start() { const tick = () => { step(); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); },
    stop() { cancelAnimationFrame(raf); },
    /** set a uniform of one program by the program's label or id (see render-graph.md) and keep it set */
    setUniform(program, name, value) {
      const P = (doc.graph && doc.graph.programs || []).find((x) => x.label === program || x.id === program);
      const id = P ? P.id : program;
      overrides.set(id + '|' + name, Array.isArray(value) ? value : [value]);
      applyOverrides();
    },
    /** switch one render pass on or off (its draws are skipped; state changes still run) */
    setPassEnabled(index, on) {
      const P = ((doc.graph && doc.graph.passes) || [])[index];
      if (!P) return;
      for (const d of P.draws) { const k = d.frame + ':' + d.cmd; if (on) skipDraw.delete(k); else skipDraw.add(k); }
    },
  };
}

/** Mount the replay into an element: a canvas sized and placed like the site's own canvas. Returns a stop function. */
export async function mountReplay(el = document.body, options = {}) {
  const data = await loadCapture(options.base || './replay/');
  const c = document.createElement('canvas');
  const st = data.doc.canvas.style || {};
  c.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;display:block;pointer-events:none;' +
    (st.zIndex && st.zIndex !== 'auto' ? 'z-index:' + st.zIndex + ';' : '') + (st.opacity && st.opacity !== '1' ? 'opacity:' + st.opacity + ';' : '') +
    (st.mixBlendMode && st.mixBlendMode !== 'normal' ? 'mix-blend-mode:' + st.mixBlendMode + ';' : '') + (st.filter && st.filter !== 'none' ? 'filter:' + st.filter + ';' : '');
  if (options.box) Object.assign(c.style, { left: options.box.x + 'px', top: options.box.y + 'px', width: options.box.w + 'px', height: options.box.h + 'px' });
  el.appendChild(c);
  const r = createReplay(c, data, options);
  if (options.frames) r.renderFrames(options.frames);
  else r.start();
  return Object.assign(() => { r.stop(); c.remove(); }, { replay: r });
}
`;
