// Recording a site's WebGL frames for the replay. The init script below runs before the site's scripts: it keeps a
// little bookkeeping on every WebGL context (texture sizes and formats, uniform location names, buffer kinds) and, when
// armed, records every call of the next frames with its arguments, plus every buffer, texture, program, framebuffer and
// vertex array as it was when the recording first met it (read back from the GPU). It never changes what the site draws;
// after the recording it can hold the page's animation frames so a screenshot shows exactly the last recorded frame.
//
// Kept as a string so bundlers cannot inject helpers into it.

import type { Page } from 'playwright';
import type { CaptureDoc } from './graph.ts';

export const REPLAY_CAPTURE_SCRIPT = String.raw`(() => {
  if (window.__DEA_CAP__) return;
  const CAP = (window.__DEA_CAP__ = { state: 'idle', errors: [], contexts: [] });
  const err = (m) => { if (CAP.errors.length < 200) CAP.errors.push(String(m)); };
  const C2 = window.WebGL2RenderingContext;
  const C1 = window.WebGLRenderingContext;
  if (!C1) return;

  // ---- ids for WebGL objects --------------------------------------------------------------------------------------
  const ids = new WeakMap();
  let nextId = 1;
  const KINDS = [
    ['WebGLBuffer', 'buf'], ['WebGLTexture', 'tex'], ['WebGLProgram', 'prog'], ['WebGLShader', 'sh'],
    ['WebGLFramebuffer', 'fb'], ['WebGLRenderbuffer', 'rb'], ['WebGLVertexArrayObject', 'vao'],
    ['WebGLVertexArrayObjectOES', 'vao'], ['WebGLSampler', 'smp'], ['WebGLQuery', 'q'], ['WebGLSync', 'sync'],
    ['WebGLTransformFeedback', 'tf'], ['WebGLUniformLocation', 'loc'],
  ].filter(([n]) => typeof window[n] === 'function').map(([n, k]) => [window[n], k]);
  const kindOf = (o) => { for (const [C, k] of KINDS) if (o instanceof C) return k; return null; };
  const idOf = (o) => { if (!o) return 0; let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; };
  const objs = new Map(); // id -> object (only while needed for snapshots)
  const keep = (o) => { const i = idOf(o); objs.set(i, new WeakRef(o)); return i; };
  const objOf = (i) => { const r = objs.get(i); return r ? r.deref() || null : null; };

  // ---- per-context tracking (always on, cheap) ----------------------------------------------------------------------
  const infos = new WeakMap();
  const infoOf = (gl) => {
    let I = infos.get(gl);
    if (!I) {
      I = {
        id: CAP.contexts.length + 1, gl, v2: !!(C2 && gl instanceof C2), canvas: gl.canvas,
        exts: new Map(), // name -> ext object
        tex: new Map(), // tex id -> { target, levels: {key: {...}}, comp: [], srcs: [] }
        bufKind: new Map(), // buf id -> 'element' | 'array'
        shadow: new Map(), // buf id -> Uint8Array (WebGL1 only)
        rb: new Map(), // rb id -> { internalformat, w, h, samples }
        locs: new WeakMap(), // loc -> { p, n }
        draws: 0, drawsLast: 0, frames: 0, curProg: 0,
        rec: null,
      };
      infos.set(gl, I);
      CAP.contexts.push(new WeakRef(gl));
    }
    return I;
  };

  const O = {}; // original functions, by "C1.name" / "C2.name"
  const orig = (gl, n) => (gl instanceof (C2 || Object) && O['2.' + n]) || O['1.' + n];
  const call = (gl, n, ...a) => orig(gl, n).apply(gl, a);

  const DRAW = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']);
  const SKIP = new Set(['getError', 'getParameter', 'getExtension', 'getSupportedExtensions', 'getContextAttributes', 'isContextLost',
    'getUniformLocation', 'getAttribLocation', 'getActiveAttrib', 'getActiveUniform', 'getAttachedShaders', 'getBufferParameter',
    'getFramebufferAttachmentParameter', 'getProgramParameter', 'getProgramInfoLog', 'getRenderbufferParameter', 'getShaderParameter',
    'getShaderPrecisionFormat', 'getShaderInfoLog', 'getShaderSource', 'getTexParameter', 'getUniform', 'getVertexAttrib',
    'getVertexAttribOffset', 'isBuffer', 'isEnabled', 'isFramebuffer', 'isProgram', 'isRenderbuffer', 'isShader', 'isTexture',
    'checkFramebufferStatus', 'readPixels', 'finish', 'flush', 'getBufferSubData', 'getIndexedParameter', 'getInternalformatParameter',
    'getQueryParameter', 'getQuery', 'getSamplerParameter', 'getSyncParameter', 'getTransformFeedbackVarying', 'getUniformIndices',
    'getActiveUniforms', 'getUniformBlockIndex', 'getActiveUniformBlockParameter', 'getActiveUniformBlockName', 'getFragDataLocation',
    'isQuery', 'isSampler', 'isSync', 'isTransformFeedback', 'isVertexArray', 'clientWaitSync', 'makeXRCompatible',
    'drawingBufferStorage', 'getContextAttributes']);

  // formats -------------------------------------------------------------------------------------------------------------
  // internalformat -> [upload format, channels, class]  class: f = float/half, i = signed int, u = unsigned int, n = normalized
  const GLc = C2 ? C2.prototype : C1.prototype;
  const E = (n) => C2 ? C2[n] : C1[n];
  const FMT = {};
  const def = (n, fmt, ch, cls) => { const v = C2 && C2[n]; if (v) FMT[v] = [C2[fmt], ch, cls]; };
  if (C2) {
    [['R8', 'RED', 1, 'n'], ['RG8', 'RG', 2, 'n'], ['RGB8', 'RGB', 3, 'n'], ['RGBA8', 'RGBA', 4, 'n'], ['SRGB8_ALPHA8', 'RGBA', 4, 'n'],
     ['RGB565', 'RGB', 3, 'n'], ['RGBA4', 'RGBA', 4, 'n'], ['RGB5_A1', 'RGBA', 4, 'n'], ['RGB10_A2', 'RGBA', 4, 'n'],
     ['R16F', 'RED', 1, 'f'], ['RG16F', 'RG', 2, 'f'], ['RGBA16F', 'RGBA', 4, 'f'], ['R32F', 'RED', 1, 'f'], ['RG32F', 'RG', 2, 'f'],
     ['RGBA32F', 'RGBA', 4, 'f'], ['R11F_G11F_B10F', 'RGB', 3, 'f'], ['RGB16F', 'RGB', 3, 'f'], ['RGB32F', 'RGB', 3, 'f'],
     ['R8I', 'RED_INTEGER', 1, 'i'], ['R8UI', 'RED_INTEGER', 1, 'u'], ['R16I', 'RED_INTEGER', 1, 'i'], ['R16UI', 'RED_INTEGER', 1, 'u'],
     ['R32I', 'RED_INTEGER', 1, 'i'], ['R32UI', 'RED_INTEGER', 1, 'u'], ['RG8I', 'RG_INTEGER', 2, 'i'], ['RG8UI', 'RG_INTEGER', 2, 'u'],
     ['RG16I', 'RG_INTEGER', 2, 'i'], ['RG16UI', 'RG_INTEGER', 2, 'u'], ['RG32I', 'RG_INTEGER', 2, 'i'], ['RG32UI', 'RG_INTEGER', 2, 'u'],
     ['RGBA8I', 'RGBA_INTEGER', 4, 'i'], ['RGBA8UI', 'RGBA_INTEGER', 4, 'u'], ['RGBA16I', 'RGBA_INTEGER', 4, 'i'],
     ['RGBA16UI', 'RGBA_INTEGER', 4, 'u'], ['RGBA32I', 'RGBA_INTEGER', 4, 'i'], ['RGBA32UI', 'RGBA_INTEGER', 4, 'u'],
     ['RGB10_A2UI', 'RGBA_INTEGER', 4, 'u']].forEach((r) => def(...r));
  }
  // unsized (WebGL1 style): the format is the internal format; float-ness comes from the type
  const UNSIZED = { 0x1908: 4 /* RGBA */, 0x1907: 3 /* RGB */, 0x1909: 1 /* LUMINANCE */, 0x190a: 2 /* LUMINANCE_ALPHA */, 0x1906: 1 /* ALPHA */ };
  const SAFE = new Set([0x1908, 0x8058, 0x8229, 0x822b, 0x881a, 0x8814, 0x822d, 0x822f, 0x822e, 0x8230, 0x8c3a, 0x8c43]);
  const FLOATT = new Set([0x1406 /* FLOAT */, 0x140b /* HALF_FLOAT */, 0x8d61 /* HALF_FLOAT_OES */]);
  const DEPTHF = new Set([0x1902, 0x81a5, 0x81a6, 0x81a7, 0x8cac, 0x88f0, 0x8cad, 0x84f9]);
  const isImg = (a) => a && typeof a === 'object' && !ArrayBuffer.isView(a) && !(a instanceof ArrayBuffer) &&
    ((window.HTMLImageElement && a instanceof HTMLImageElement) || (window.HTMLCanvasElement && a instanceof HTMLCanvasElement) ||
     (window.HTMLVideoElement && a instanceof HTMLVideoElement) || (window.ImageBitmap && a instanceof ImageBitmap) ||
     (window.ImageData && a instanceof ImageData) || (window.OffscreenCanvas && a instanceof OffscreenCanvas) ||
     (window.VideoFrame && a instanceof VideoFrame));
  const imgSize = (a) => [a.videoWidth || a.naturalWidth || a.displayWidth || a.width || 0, a.videoHeight || a.naturalHeight || a.displayHeight || a.height || 0];

  const TEXT = { 0x0de1: '2d', 0x8513: 'cube', 0x806f: '3d', 0x8c1a: 'array' };
  const texTarget = (t) => (t >= 0x8515 && t <= 0x851a ? 0x8513 : t);
  // texture bookkeeping: what each level is (size and format), and for formats a readback cannot reach, the upload itself
  const noteLevel = (I, gl, target, level, ifmt, fmt, type, w, h, d) => {
    const unit = boundTex(I, gl, texTarget(target));
    if (!unit) return;
    const T = texRec(I, unit, texTarget(target));
    const face = target >= 0x8515 && target <= 0x851a ? target - 0x8515 : 0;
    T.levels[level + ':' + face] = { level, face, ifmt, fmt, type, w, h, d: d || 1 };
    return T;
  };
  const texRec = (I, id, target) => {
    let T = I.tex.get(id);
    if (!T) { T = { target, levels: {}, comp: [], src: [] }; I.tex.set(id, T); }
    T.target = target;
    return T;
  };
  const BIND = { 0x0de1: 0x8069, 0x8513: 0x8514, 0x806f: 0x806a, 0x8c1a: 0x8c1d };
  const boundTex = (I, gl, target) => { const t = call(gl, 'getParameter', BIND[target]); return t ? keep(t) : 0; };

  // ---- serialising arguments for the recording -----------------------------------------------------------------------
  const bin = { parts: [], size: 0 };
  const addBin = (u8) => {
    const pad = (8 - (bin.size % 8)) % 8;
    if (pad) { bin.parts.push(new Uint8Array(pad)); bin.size += pad; }
    const o = bin.size;
    bin.parts.push(u8);
    bin.size += u8.byteLength;
    return o;
  };
  const copyView = (v) => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  const pixelsOf = (a) => {
    const [w, h] = imgSize(a);
    if (!w || !h) return null;
    if (window.ImageData && a instanceof ImageData) return { w, h, u8: new Uint8Array(a.data.buffer.slice(0)) };
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(a, 0, 0, w, h);
    return { w, h, u8: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer) };
  };
  const ser = (I, a) => {
    if (a === undefined || a === null) return null;
    const t = typeof a;
    if (t === 'number' || t === 'boolean' || t === 'string') return a;
    if (Array.isArray(a)) return a.map((x) => ser(I, x));
    if (ArrayBuffer.isView(a)) return { $: 'bin', o: addBin(copyView(a)), l: a.byteLength, t: a.constructor.name };
    if (a instanceof ArrayBuffer) return { $: 'bin', o: addBin(new Uint8Array(a.slice(0))), l: a.byteLength, t: 'Uint8Array' };
    if (isImg(a)) {
      const p = pixelsOf(a);
      if (!p) return null;
      return { $: 'img', w: p.w, h: p.h, o: addBin(p.u8), l: p.u8.byteLength };
    }
    const k = kindOf(a);
    if (k === 'loc') { const L = I.locs.get(a); return L ? { $: 'loc', p: L.p, n: L.n } : { $: 'loc', p: 0, n: '' }; }
    if (k) { const id = keep(a); touch(I, k, id); return { $: k, id }; }
    return null;
  };

  // ---- snapshots: what an object held when the recording first met it ---------------------------------------------------
  const snapTouched = (I, k, id) => (I.rec.snapped[k + ':' + id] ? true : ((I.rec.snapped[k + ':' + id] = true), false));
  const touch = (I, k, id) => {
    const R = I.rec;
    if (!R || !R.on || R.born.has(id) || snapTouched(I, k, id)) return;
    try {
      if (k === 'buf') snapBuf(I, id);
      else if (k === 'tex') snapTex(I, id);
      else if (k === 'prog') snapProg(I, id);
      else if (k === 'rb') snapRb(I, id);
      else if (k === 'smp') snapSmp(I, id);
      else if (k === 'fb') R.pendFb.add(id);
      else if (k === 'vao') R.pendVao.add(id);
    } catch (e) { err('snapshot ' + k + ' ' + id + ': ' + e); }
  };

  const snapBuf = (I, id) => {
    const gl = I.gl; const b = objOf(id); if (!b) return;
    const kind = I.bufKind.get(id) || 'array';
    let u8 = null; let usage = 0x88e4;
    if (I.v2) {
      const prev = call(gl, 'getParameter', 0x8f36 /* COPY_READ_BUFFER_BINDING */);
      call(gl, 'bindBuffer', 0x8f36, b);
      const size = call(gl, 'getBufferParameter', 0x8f36, 0x8764 /* BUFFER_SIZE */) || 0;
      usage = call(gl, 'getBufferParameter', 0x8f36, 0x8765) || usage;
      u8 = new Uint8Array(size);
      if (size) call(gl, 'getBufferSubData', 0x8f36, 0, u8);
      call(gl, 'bindBuffer', 0x8f36, prev);
    } else {
      u8 = I.shadow.get(id) || new Uint8Array(0);
    }
    I.rec.snap.buffers.push({ id, kind, usage, o: addBin(u8.slice(0)), l: u8.byteLength });
  };

  const readTarget = (gl, I, attach) => {
    // attach(fbTarget) attaches the image to COLOR_ATTACHMENT0 of a temporary framebuffer bound to READ_FRAMEBUFFER (v2) or FRAMEBUFFER
    const T = I.v2 ? 0x8ca8 : 0x8d40;
    const prevR = call(gl, 'getParameter', I.v2 ? 0x8caa : 0x8ca6);
    const fb = call(gl, 'createFramebuffer');
    call(gl, 'bindFramebuffer', T, fb);
    attach(T);
    const ok = call(gl, 'checkFramebufferStatus', T) === 0x8cd5;
    return { ok, done: () => { call(gl, 'bindFramebuffer', T, prevR); call(gl, 'deleteFramebuffer', fb); } };
  };
  const readPx = (gl, I, w, h, cls) => {
    // an error the page left pending would be read as this read's error (and lose the image): drain it first
    for (let k = 0; k < 8 && call(gl, 'getError'); k++);
    const prevPack = call(gl, 'getParameter', 0x0d05);
    call(gl, 'pixelStorei', 0x0d05, 1);
    let ppb = null;
    if (I.v2) { ppb = call(gl, 'getParameter', 0x88ed); if (ppb) call(gl, 'bindBuffer', 0x88eb, null); }
    let out;
    if (cls === 'f') { out = new Float32Array(w * h * 4); call(gl, 'readPixels', 0, 0, w, h, 0x1908, 0x1406, out); }
    else if (cls === 'i') { out = new Int32Array(w * h * 4); call(gl, 'readPixels', 0, 0, w, h, 0x8d99, 0x1404, out); }
    else if (cls === 'u') { out = new Uint32Array(w * h * 4); call(gl, 'readPixels', 0, 0, w, h, 0x8d99, 0x1405, out); }
    else { out = new Uint8Array(w * h * 4); call(gl, 'readPixels', 0, 0, w, h, 0x1908, 0x1401, out); }
    const e = call(gl, 'getError');
    call(gl, 'pixelStorei', 0x0d05, prevPack);
    if (ppb) call(gl, 'bindBuffer', 0x88eb, ppb);
    return e ? null : out;
  };
  // keep ch of the 4 channels read back
  const pack = (rgba, ch, Ctor) => {
    if (ch === 4) return rgba;
    const n = rgba.length / 4; const o = new Ctor(n * ch);
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) o[i * ch + c] = rgba[i * 4 + c];
    return o;
  };

  // a format and type to allocate a level with no pixels (depth, or a level the readback could not reach)
  const allocOf = (L) => {
    const d = { 0x81a5: [0x1902, 0x1403], 0x81a6: [0x1902, 0x1405], 0x8cac: [0x1902, 0x1406], 0x88f0: [0x84f9, 0x84fa], 0x8cad: [0x84f9, 0x8dad] }[L.ifmt];
    if (d) return d;
    const s = FMT[L.ifmt];
    if (s) return [s[0], s[2] === 'f' ? 0x1406 : s[2] === 'i' ? 0x1404 : s[2] === 'u' ? 0x1405 : 0x1401];
    return [L.fmt || L.ifmt, L.type || 0x1401];
  };
  const snapTex = (I, id) => {
    const gl = I.gl; const t = objOf(id); const T = I.tex.get(id);
    if (!t || !T) { I.rec.snap.textures.push({ id, missing: true }); return; }
    const target = T.target;
    // parameters (bind on the active unit, read, restore)
    const prev = call(gl, 'getParameter', BIND[target]);
    call(gl, 'bindTexture', target, t);
    const P = {};
    const names = [0x2801, 0x2800, 0x2802, 0x2803];
    if (I.v2) names.push(0x8072, 0x813c, 0x813d, 0x884c, 0x884d, 0x813a, 0x813b);
    if (I.exts.has('EXT_texture_filter_anisotropic')) names.push(0x84fe);
    for (const p of names) { try { const v = call(gl, 'getTexParameter', target, p); if (v != null) P[p] = v; } catch (e) {} }
    call(gl, 'bindTexture', target, prev);
    const S = { id, target, params: P, levels: [], comp: T.comp.map((c) => ({ fn: c.fn, args: c.args })) };
    for (const L of Object.values(T.levels)) {
      const ifmt = L.ifmt; let cls = 'n'; let ch = 4; let upFmt = 0x1908; let upType = 0x1401;
      const sized = FMT[ifmt];
      if (sized) { upFmt = sized[0]; ch = sized[1]; cls = sized[2]; upType = cls === 'f' ? 0x1406 : cls === 'i' ? 0x1404 : cls === 'u' ? 0x1405 : 0x1401; }
      else if (UNSIZED[ifmt]) { upFmt = ifmt; ch = UNSIZED[ifmt]; if (FLOATT.has(L.type)) { cls = 'f'; upType = 0x1406; } }
      else { S.levels.push({ ...L, skipped: 'format ' + ifmt + ' cannot be read back', alloc: allocOf(L) }); continue; }
      if (DEPTHF.has(ifmt) || DEPTHF.has(L.fmt)) { S.levels.push({ ...L, skipped: 'depth', alloc: allocOf(L) }); continue; }
      const layers = target === 0x806f || target === 0x8c1a ? L.d : 1;
      const parts = [];
      let ok = true;
      for (let z = 0; z < layers && ok; z++) {
        const r = readTarget(gl, I, (FT) => {
          if (layers > 1 || target === 0x806f || target === 0x8c1a) call(gl, 'framebufferTextureLayer', FT, 0x8ce0, t, L.level, z);
          else call(gl, 'framebufferTexture2D', FT, 0x8ce0, target === 0x8513 ? 0x8515 + L.face : target, t, L.level);
        });
        if (r.ok && !(UNSIZED[ifmt] && ifmt !== 0x1908 && ifmt !== 0x1907)) {
          const px = readPx(gl, I, L.w, L.h, cls);
          if (px) parts.push(pack(px, ch, px.constructor));
          else ok = false;
        } else ok = false;
        r.done();
      }
      if (!ok) {
        // not renderable: fall back to what was uploaded (an image source or a typed array kept at upload time)
        const s = T.src.find((x) => x.level === L.level && x.face === L.face);
        if (s) {
          const v = ser(I, s.data);
          if (v) { S.levels.push({ ...L, upload: { fn: s.fn, store: s.store, args: s.args.map((a, i) => (i === s.dataAt ? v : a)) } }); continue; }
        }
        S.levels.push({ ...L, skipped: 'not renderable and no upload kept', alloc: allocOf(L) });
        continue;
      }
      let bytes;
      if (parts.length === 1) bytes = new Uint8Array(parts[0].buffer, parts[0].byteOffset, parts[0].byteLength);
      else { const n = parts.reduce((s, p) => s + p.byteLength, 0); bytes = new Uint8Array(n); let o = 0; for (const p of parts) { bytes.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o); o += p.byteLength; } }
      S.levels.push({ ...L, upFmt, upType, ch, o: addBin(bytes.slice(0)), l: bytes.byteLength });
    }
    // compressed uploads keep their bytes
    S.comp = T.comp.map((c) => ({ fn: c.fn, args: c.args.map((a) => (ArrayBuffer.isView(a) ? ser(I, a) : a)) }));
    I.rec.snap.textures.push(S);
  };

  const UNIFORM_SET = {};
  const snapProg = (I, id) => {
    const gl = I.gl; const p = objOf(id); if (!p) return;
    const shaders = (call(gl, 'getAttachedShaders', p) || []).map((s) => ({ type: call(gl, 'getShaderParameter', s, 0x8b4f), src: call(gl, 'getShaderSource', s) }));
    const attribs = [];
    const na = call(gl, 'getProgramParameter', p, 0x8b89) || 0;
    for (let i = 0; i < na; i++) { const a = call(gl, 'getActiveAttrib', p, i); if (a) attribs.push({ name: a.name, type: a.type, size: a.size, loc: call(gl, 'getAttribLocation', p, a.name) }); }
    const uniforms = [];
    const nu = call(gl, 'getProgramParameter', p, 0x8b86) || 0;
    for (let i = 0; i < nu; i++) {
      const u = call(gl, 'getActiveUniform', p, i); if (!u) continue;
      const base = u.name.replace(/\[0\]$/, '');
      const n = u.name.endsWith('[0]') ? u.size : 1;
      for (let k = 0; k < n; k++) {
        const name = n > 1 || u.name.endsWith('[0]') ? base + '[' + k + ']' : u.name;
        const loc = call(gl, 'getUniformLocation', p, name);
        if (!loc) continue;
        let v = call(gl, 'getUniform', p, loc);
        if (ArrayBuffer.isView(v)) v = Array.from(v);
        else if (Array.isArray(v)) v = v.map((x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x));
        else if (typeof v === 'boolean') v = v ? 1 : 0;
        uniforms.push({ name, type: u.type, v });
      }
    }
    const blocks = [];
    if (I.v2) {
      const nb = call(gl, 'getProgramParameter', p, 0x8a36) || 0;
      for (let i = 0; i < nb; i++) blocks.push({ name: call(gl, 'getActiveUniformBlockName', p, i), binding: call(gl, 'getActiveUniformBlockParameter', p, i, 0x8a3f) });
    }
    const tf = [];
    let tfMode = 0;
    if (I.v2) {
      const nt = call(gl, 'getProgramParameter', p, 0x8c83) || 0;
      for (let i = 0; i < nt; i++) tf.push(call(gl, 'getTransformFeedbackVarying', p, i).name);
      tfMode = call(gl, 'getProgramParameter', p, 0x8c7f) || 0;
    }
    I.rec.snap.programs.push({ id, shaders, attribs, uniforms, blocks, tf, tfMode });
  };

  const snapRb = (I, id) => { const r = I.rb.get(id); I.rec.snap.renderbuffers.push({ id, ...(r || {}) }); };
  const snapSmp = (I, id) => {
    const gl = I.gl; const s = objOf(id); if (!s) return;
    const P = {};
    for (const p of [0x2801, 0x2800, 0x2802, 0x2803, 0x8072, 0x813a, 0x813b, 0x884c, 0x884d]) { try { P[p] = call(gl, 'getSamplerParameter', s, p); } catch (e) {} }
    I.rec.snap.samplers.push({ id, params: P });
  };

  // a framebuffer or vertex array is read right after it is bound (its state can only be queried while bound)
  const snapFbBound = (I, target, id) => {
    const gl = I.gl;
    const atts = [];
    const max = I.v2 ? call(gl, 'getParameter', 0x8cdf) : 1;
    const list = [];
    for (let i = 0; i < max; i++) list.push(0x8ce0 + i);
    list.push(0x8d00, 0x8d20);
    if (I.v2) list.push(0x821a); else list.push(0x821a);
    for (const a of list) {
      let type = 0;
      try { type = call(gl, 'getFramebufferAttachmentParameter', target, a, 0x8cd0); } catch (e) { continue; }
      if (!type) continue;
      const o = call(gl, 'getFramebufferAttachmentParameter', target, a, 0x8cd1);
      const at = { a, type };
      if (type === 0x1702) {
        at.tex = keep(o); touch(I, 'tex', at.tex);
        at.level = call(gl, 'getFramebufferAttachmentParameter', target, a, 0x8cd2);
        at.face = call(gl, 'getFramebufferAttachmentParameter', target, a, 0x8cd3);
        if (I.v2) at.layer = call(gl, 'getFramebufferAttachmentParameter', target, a, 0x8cd4);
        const T = I.tex.get(at.tex); at.texTarget = T ? T.target : 0x0de1;
      } else if (type === 0x8d41) { at.rb = keep(o); touch(I, 'rb', at.rb); }
      atts.push(at);
    }
    const draw = [];
    if (I.v2) for (let i = 0; i < max; i++) draw.push(call(gl, 'getParameter', 0x8825 + i));
    const read = I.v2 ? call(gl, 'getParameter', 0x0c02) : 0;
    I.rec.snap.framebuffers.push({ id, atts, draw, read });
  };
  const snapVaoBound = (I, id) => {
    const gl = I.gl;
    I.rec.snap.vaos.push({ id, ...vaoState(I) });
  };
  const vaoState = (I) => {
    const gl = I.gl;
    const n = Math.min(call(gl, 'getParameter', 0x8869) || 16, 32);
    const attrs = [];
    const inst = I.exts.get('ANGLE_instanced_arrays');
    for (let i = 0; i < n; i++) {
      const en = call(gl, 'getVertexAttrib', i, 0x8622);
      const b = call(gl, 'getVertexAttrib', i, 0x889f);
      if (!en && !b) continue;
      const a = { i, en, size: call(gl, 'getVertexAttrib', i, 0x8623), type: call(gl, 'getVertexAttrib', i, 0x8625),
        norm: call(gl, 'getVertexAttrib', i, 0x886a), stride: call(gl, 'getVertexAttrib', i, 0x8624), off: call(gl, 'getVertexAttribOffset', i, 0x8645) };
      if (I.v2) { a.int = call(gl, 'getVertexAttrib', i, 0x88fd); a.div = call(gl, 'getVertexAttrib', i, 0x88fe); }
      else if (inst) a.div = call(gl, 'getVertexAttrib', i, 0x88fe);
      if (b) { a.buf = keep(b); touch(I, 'buf', a.buf); }
      attrs.push(a);
    }
    const e = call(gl, 'getParameter', 0x8895);
    const el = e ? keep(e) : 0;
    if (el) touch(I, 'buf', el);
    return { attrs, el };
  };

  // global state at the start of a recorded frame
  const globalState = (I) => {
    const gl = I.gl; const g = (p) => { try { const v = call(gl, 'getParameter', p); return ArrayBuffer.isView(v) ? Array.from(v) : v; } catch (e) { return null; } };
    const S = { en: {}, p: {} };
    const caps = [0x0be2, 0x0b44, 0x0b71, 0x0bd0, 0x8037, 0x809e, 0x80a0, 0x0c11, 0x0b90];
    if (I.v2) caps.push(0x8c89);
    for (const c of caps) S.en[c] = call(gl, 'isEnabled', c);
    const ps = [0x8005, 0x8009, 0x883d, 0x80c9, 0x80c8, 0x80cb, 0x80ca, 0x0c22, 0x0c23, 0x0b45, 0x0b73, 0x0b74, 0x0b70, 0x0b72, 0x0b46,
      0x0b21, 0x8038, 0x2a00, 0x80aa, 0x80ab, 0x0c10, 0x0b92, 0x0b97, 0x0b93, 0x0b94, 0x0b95, 0x0b96, 0x0b98, 0x8800, 0x8ca3, 0x8ca4,
      0x8801, 0x8802, 0x8803, 0x8ca5, 0x0b91, 0x0ba2, 0x0cf5, 0x0d05, 0x9240, 0x9241, 0x9243, 0x8192];
    if (I.v2) ps.push(0x0cf2, 0x806e, 0x0cf4, 0x0cf3, 0x806d, 0x0d02, 0x0d04, 0x0d03, 0x8b8b);
    for (const p of ps) S.p[p] = g(p);
    const id = (o) => (o ? keep(o) : 0);
    S.program = id(g(0x8b8d)); if (S.program) touch(I, 'prog', S.program);
    S.arrayBuffer = id(g(0x8894)); if (S.arrayBuffer) touch(I, 'buf', S.arrayBuffer);
    const vaoExt = I.exts.get('OES_vertex_array_object');
    S.vao = I.v2 ? id(g(0x85b5)) : vaoExt ? id(g(0x85b5)) : 0;
    if (S.vao) { touch(I, 'vao', S.vao); }
    S.drawFb = id(g(I.v2 ? 0x8ca6 : 0x8ca6));
    S.readFb = I.v2 ? id(g(0x8caa)) : S.drawFb;
    if (S.drawFb) touch(I, 'fb', S.drawFb);
    if (S.readFb) touch(I, 'fb', S.readFb);
    S.rb = id(g(0x8ca7)); if (S.rb) touch(I, 'rb', S.rb);
    S.activeTexture = g(0x84e0);
    S.units = [];
    const nUnits = Math.min(g(0x8b4d) || 16, 32);
    for (let u = 0; u < nUnits; u++) {
      call(gl, 'activeTexture', 0x84c0 + u);
      const U = { u };
      for (const [k, p] of [['2d', 0x8069], ['cube', 0x8514], ['3d', 0x806a], ['array', 0x8c1d]]) {
        if (!I.v2 && (k === '3d' || k === 'array')) continue;
        const t = id(g(p)); if (t) { U[k] = t; touch(I, 'tex', t); }
      }
      if (I.v2) { const s = id(g(0x8919)); if (s) { U.smp = s; touch(I, 'smp', s); } }
      if (Object.keys(U).length > 1) S.units.push(U);
    }
    call(gl, 'activeTexture', S.activeTexture);
    if (I.v2) {
      S.ubo = id(g(0x8a28)); if (S.ubo) touch(I, 'buf', S.ubo);
      S.ubos = [];
      const nb = Math.min(g(0x8a2f) || 24, 36);
      for (let i = 0; i < nb; i++) {
        const b = call(gl, 'getIndexedParameter', 0x8a28, i);
        if (b) { const bi = keep(b); touch(I, 'buf', bi); S.ubos.push({ i, buf: bi, start: call(gl, 'getIndexedParameter', 0x8a29, i), size: call(gl, 'getIndexedParameter', 0x8a2a, i) }); }
      }
      for (const [k, p] of [['copyRead', 0x8f36], ['copyWrite', 0x8f37], ['pack', 0x88ed], ['unpack', 0x88ef]]) { const b = id(g(p)); if (b) { S[k] = b; touch(I, 'buf', b); } }
    }
    S.current = [];
    const n = Math.min(g(0x8869) || 16, 32);
    for (let i = 0; i < n; i++) { const v = call(gl, 'getVertexAttrib', i, 0x8626); S.current.push(v ? Array.from(v) : [0, 0, 0, 1]); }
    // the default vertex array (no VAO bound) also holds attribute state
    if (!S.vao) { S.defaultVao = vaoState(I); }
    else if (I.v2 || vaoExt) {
      // read the default VAO too: bind null, read, bind back
      if (I.v2) { call(gl, 'bindVertexArray', null); S.defaultVao = vaoState(I); call(gl, 'bindVertexArray', objOf(S.vao)); }
      else { vaoExt.__deaOrig.bindVertexArrayOES.call(vaoExt, null); S.defaultVao = vaoState(I); vaoExt.__deaOrig.bindVertexArrayOES.call(vaoExt, objOf(S.vao)); }
    }
    return S;
  };

  // ---- the recording ------------------------------------------------------------------------------------------------
  const record = (I, name, args) => {
    const R = I.rec;
    if (R.cmds.length >= R.maxCmds) { if (!R.overflow) { R.overflow = true; err('command limit reached'); } return null; }
    const a = args.map((x) => ser(I, x));
    const c = [name, ...a];
    R.cmds.push(c);
    return c;
  };
  const post = (I, name, args, ret, c) => {
    const R = I.rec;
    // objects created during the recording are created by the replay itself
    if (/^create/.test(name) && ret && typeof ret === 'object') { const id = keep(ret); R.born.add(id); if (c) c.push({ $ret: id }); }
    if (name === 'bindFramebuffer' && args[1]) { const id = idOf(args[1]); if (R.pendFb.has(id)) { R.pendFb.delete(id); snapFbBound(I, args[0], id); } }
    if ((name === 'bindVertexArray' || name === 'ext:OES_vertex_array_object.bindVertexArrayOES') && args[0]) {
      const id = idOf(args[0]); if (R.pendVao.has(id)) { R.pendVao.delete(id); snapVaoBound(I, id); }
    }
    if (DRAW.has(name) || name === 'clear' || name === 'drawBuffers' || name === 'blitFramebuffer') R.draws++;
  };

  // which context to record: visible, drew last frame, biggest
  const pick = () => {
    let best = null; let bestA = -1;
    for (const r of CAP.contexts) {
      const gl = r.deref(); if (!gl) continue;
      const I = infos.get(gl); const c = gl.canvas;
      if (!c || !c.isConnected || !I.drawsLast) continue;
      const b = c.getBoundingClientRect(); const a = b.width * b.height;
      if (a > bestA) { bestA = a; best = I; }
    }
    return best;
  };

  let lastTs = -1;
  // ---- input probe: the float uniforms' values at every animation frame, beside the pointer, scroll and window size --------
  CAP.probe = null;
  const onPointer = (e) => { if (CAP.probe) { CAP.probe.mx = e.clientX; CAP.probe.my = e.clientY; } };
  try { addEventListener('pointermove', onPointer, { capture: true, passive: true }); addEventListener('mousemove', onPointer, { capture: true, passive: true }); } catch (e) {}
  // the scroll signal: the page's own scroll when it can scroll, else the sum of the wheel it was given (a fixed-stage site that
  // moves its scene by wheel events scrolls nothing, and scrollY would stay 0)
  CAP.wheel = 0;
  try { addEventListener('wheel', (e) => { CAP.wheel = Math.max(0, CAP.wheel + e.deltaY); }, { capture: true, passive: true }); } catch (e) {}
  const scrollSignal = () => (document.documentElement.scrollHeight > innerHeight + 2 ? Math.round(scrollY) : Math.round(CAP.wheel));
  CAP.probeStart = () => { CAP.probe = { t0: performance.now(), cur: {}, series: {}, env: [], mx: -1, my: -1, mats: new Map(), nkeys: 0 }; CAP.wheel = 0; return true; };
  CAP.probeStop = () => { const P = CAP.probe; CAP.probe = null; return P ? { series: P.series, env: P.env } : null; };
  const probeNote = (I, name, a) => {
    const kind = name.slice(7);
    const isMat = kind.startsWith('Matrix');
    if (!isMat && kind.indexOf('f') < 0) return;
    const L = a[0] && I.locs.get(a[0]);
    if (!L) return;
    const v = [];
    if (isMat) {
      // matrices (model, view, projection, a custom one) are noted per draw: see probeDraw
      const arr = a[2];
      if (!arr || typeof arr.length !== 'number') return;
      for (let i = 0; i < Math.min(arr.length, 16); i++) v.push(+arr[i]);
      let m = CAP.probe.mats.get(L.p);
      if (!m) CAP.probe.mats.set(L.p, (m = new Map()));
      m.set(L.n.replace(/\[0\]$/, ''), v);
      return;
    }
    if (kind.endsWith('v')) { const arr = a[1]; if (!arr || typeof arr.length !== 'number') return; for (let i = 0; i < Math.min(arr.length, 4); i++) v.push(+arr[i]); }
    else for (let i = 1; i < a.length && i <= 4; i++) v.push(+a[i]);
    CAP.probe.cur[L.p + '|' + L.n] = v;
  };
  // at every draw: the matrices set for the current program, under "program|name#drawIndexInFrame"
  const probeDraw = (I) => {
    const P = CAP.probe;
    const m = I.curProg && P.mats.get(I.curProg);
    if (!m) return;
    const ord = I.draws - 1;
    for (const [n, v] of m) {
      const k = I.curProg + '|' + n + '#' + ord;
      if (!(k in P.cur)) { if (P.nkeys >= 700) continue; P.nkeys++; }
      P.cur[k] = v;
    }
  };

  const probeSample = () => {
    const P = CAP.probe;
    if (P.env.length >= 4000) return;
    const t = Math.round(performance.now() - P.t0);
    P.env.push([t, scrollSignal(), P.mx, P.my, innerWidth, innerHeight]);
    for (const k in P.cur) { const s = P.series[k] || (P.series[k] = []); s.push([t].concat(P.cur[k])); }
  };

  const boundary = () => {
    if (CAP.probe) { try { probeSample(); } catch (e) {} }
    for (const r of CAP.contexts) { const gl = r.deref(); if (!gl) continue; const I = infos.get(gl); I.drawsLast = I.draws; I.draws = 0; I.frames++; }
    if (CAP.state === 'armed') {
      const I = pick();
      if (!I) return;
      CAP.target = I;
      CAP.state = 'recording';
      I.rec = { on: true, frame: -1, frames: [], cmds: null, born: new Set(), snapped: {}, pendFb: new Set(), pendVao: new Set(), draws: 0,
        maxCmds: CAP.opts.maxCmds || 400000,
        snap: { buffers: [], textures: [], programs: [], renderbuffers: [], samplers: [], framebuffers: [], vaos: [] } };
    }
    if (CAP.state === 'recording') {
      const I = CAP.target; const R = I.rec;
      if (R.frame >= 0) R.frames[R.frame].ms = performance.now() - R.frames[R.frame].t0;
      R.frame++;
      if (R.frame >= CAP.opts.frames) {
        R.on = false; CAP.state = 'done'; CAP.hold = !!CAP.opts.hold;
        return;
      }
      R.cmds = [];
      let state = null;
      try { state = globalState(I); } catch (e) { err('state: ' + e); }
      // framebuffers / vertex arrays bound right now are read now
      try {
        if (state && state.drawFb && R.pendFb.has(state.drawFb)) { R.pendFb.delete(state.drawFb); snapFbBound(I, I.v2 ? 0x8ca9 : 0x8d40, state.drawFb); }
        if (state && state.readFb && R.pendFb.has(state.readFb)) { R.pendFb.delete(state.readFb); snapFbBound(I, I.v2 ? 0x8ca8 : 0x8d40, state.readFb); }
        if (state && state.vao && R.pendVao.has(state.vao)) { R.pendVao.delete(state.vao); snapVaoBound(I, state.vao); }
      } catch (e) { err('bound state: ' + e); }
      R.frames.push({ state, cmds: R.cmds, t0: performance.now(), ts: lastTs });
    }
  };

  const raf0 = window.requestAnimationFrame;
  const held = [];
  window.requestAnimationFrame = function (cb) {
    return raf0.call(window, function (ts) {
      if (ts !== lastTs) { lastTs = ts; try { boundary(); } catch (e) { err('boundary: ' + e); } }
      if (CAP.hold) { held.push(cb); return; }
      return cb.apply(this, arguments);
    });
  };
  CAP.release = () => { CAP.hold = false; const h = held.splice(0); for (const cb of h) raf0.call(window, cb); };
  CAP.arm = (opts) => {
    for (const r of CAP.contexts) { const gl = r.deref(); if (!gl) continue; for (const n of ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'WEBGL_color_buffer_float']) { try { call(gl, 'getExtension', n); } catch (e) {} } }
    CAP.opts = Object.assign({ frames: 2, hold: true }, opts || {}); CAP.state = 'armed'; CAP.errors.length = 0; return true; };

  // ---- wrapping -------------------------------------------------------------------------------------------------------
  const wrap = (C, tag) => {
    const P = C.prototype;
    for (const name of Object.getOwnPropertyNames(P)) {
      const d = Object.getOwnPropertyDescriptor(P, name);
      if (!d || typeof d.value !== 'function' || name === 'constructor') continue;
      const f = d.value;
      O[tag + '.' + name] = f;
      const skip = SKIP.has(name);
      P[name] = function () {
        const I = infoOf(this);
        const R = I.rec;
        let c = null;
        if (R && R.on && !skip) { try { c = record(I, name, Array.prototype.slice.call(arguments)); } catch (e) { err(name + ': ' + e); } }
        const ret = f.apply(this, arguments);
        try { track(I, this, name, arguments, ret); } catch (e) {}
        if (R && R.on && !skip) { try { post(I, name, arguments, ret, c); } catch (e) { err(name + ' post: ' + e); } }
        return ret;
      };
    }
  };
  // bookkeeping that runs whether or not a recording is on
  const track = (I, gl, name, a, ret) => {
    switch (name) {
      case 'drawArrays': case 'drawElements': case 'drawArraysInstanced': case 'drawElementsInstanced': case 'drawRangeElements':
        I.draws++; if (CAP.probe) { try { probeDraw(I); } catch (e) {} } break;
      case 'useProgram': I.curProg = a[0] ? keep(a[0]) : 0; break;
      case 'getUniformLocation': if (ret) I.locs.set(ret, { p: keep(a[0]), n: a[1] }); break;
      case 'getExtension': if (ret) { I.exts.set(a[0], ret); wrapExt(I, a[0], ret); } break;
      case 'bindBuffer': if (a[1]) { const id = keep(a[1]); if (!I.bufKind.has(id)) I.bufKind.set(id, a[0] === 0x8893 ? 'element' : 'array'); } break;
      case 'bufferData': if (!I.v2) shadowData(I, gl, a); break;
      case 'bufferSubData': if (!I.v2) shadowSub(I, gl, a); break;
      case 'texImage2D': {
        let w, h, ifmt = a[2], fmt, type, data, at;
        if (a.length >= 8) { w = a[3]; h = a[4]; fmt = a[6]; type = a[7]; data = a[8]; at = 8; }
        else { fmt = a[3]; type = a[4]; data = a[5]; at = 5; [w, h] = isImg(data) ? imgSize(data) : [0, 0]; }
        const T = noteLevel(I, gl, a[0], a[1], ifmt, fmt, type, w, h, 1);
        // keep the upload when a readback may not reach it: an image source (a reference, cheap) or an unusual format
        if (T && (isImg(data) || !SAFE.has(ifmt))) keepSrc(T, 'texImage2D', a, at, gl);
        break;
      }
      case 'texImage3D': noteLevel(I, gl, a[0], a[1], a[2], a[7], a[8], a[3], a[4], a[5]); break;
      case 'texStorage2D': { for (let l = 0; l < a[1]; l++) for (let f = 0; f < (a[0] === 0x8513 ? 6 : 1); f++) noteLevel(I, gl, a[0] === 0x8513 ? 0x8515 + f : a[0], l, a[2], 0, 0, Math.max(1, a[3] >> l), Math.max(1, a[4] >> l), 1); break; }
      case 'texStorage3D': { for (let l = 0; l < a[1]; l++) noteLevel(I, gl, a[0], l, a[2], 0, 0, Math.max(1, a[3] >> l), Math.max(1, a[4] >> l), a[0] === 0x806f ? Math.max(1, a[5] >> l) : a[5]); break; }
      case 'compressedTexImage2D': case 'compressedTexImage3D': case 'compressedTexSubImage2D': case 'compressedTexSubImage3D': {
        const tgt = texTarget(a[0]); const unit = boundTex(I, gl, tgt); if (!unit) break;
        const T = texRec(I, unit, tgt);
        if (name === 'compressedTexImage2D' || name === 'compressedTexImage3D') {
          T.compressed = true;
          T.comp = T.comp.filter((c) => !(c.args[0] === a[0] && c.args[1] === a[1]));
        }
        T.comp.push({ fn: name, args: Array.prototype.map.call(a, (x) => (ArrayBuffer.isView(x) ? copyView(x) : x)) });
        if (T.comp.length > 64) T.comp.shift();
        break;
      }
      case 'copyTexImage2D': noteLevel(I, gl, a[0], a[1], a[2], a[2], 0x1401, a[5], a[6], 1); break;
      case 'renderbufferStorage': { const rb = call(gl, 'getParameter', 0x8ca7); if (rb) I.rb.set(keep(rb), { internalformat: a[1], w: a[2], h: a[3], samples: 0 }); break; }
      case 'renderbufferStorageMultisample': { const rb = call(gl, 'getParameter', 0x8ca7); if (rb) I.rb.set(keep(rb), { internalformat: a[2], w: a[3], h: a[4], samples: a[1] }); break; }
      default: if (CAP.probe && name.startsWith('uniform')) probeNote(I, name, a);
    }
  };
  const keepSrc = (T, fn, a, at, gl) => {
    const level = a[1]; const face = a[0] >= 0x8515 && a[0] <= 0x851a ? a[0] - 0x8515 : 0;
    T.src = T.src.filter((s) => !(s.level === level && s.face === face));
    const data = a[at];
    const store = gl ? { flip: call(gl, 'getParameter', 0x9240), premul: call(gl, 'getParameter', 0x9241), align: call(gl, 'getParameter', 0x0cf5) } : {};
    T.src.push({ fn, level, face, dataAt: at, store, args: Array.prototype.slice.call(a).map((x, i) => (i === at ? null : x)), data: ArrayBuffer.isView(data) ? copyView(data) : data });
  };
  const shadowData = (I, gl, a) => {
    const b = call(gl, 'getParameter', a[0] === 0x8893 ? 0x8895 : 0x8894); if (!b) return;
    const id = keep(b);
    if (typeof a[1] === 'number') I.shadow.set(id, new Uint8Array(a[1]));
    else if (ArrayBuffer.isView(a[1])) I.shadow.set(id, copyView(a[1]));
    else if (a[1] instanceof ArrayBuffer) I.shadow.set(id, new Uint8Array(a[1].slice(0)));
  };
  const shadowSub = (I, gl, a) => {
    const b = call(gl, 'getParameter', a[0] === 0x8893 ? 0x8895 : 0x8894); if (!b) return;
    const s = I.shadow.get(keep(b)); if (!s) return;
    const src = ArrayBuffer.isView(a[2]) ? new Uint8Array(a[2].buffer, a[2].byteOffset, a[2].byteLength) : new Uint8Array(a[2]);
    s.set(src.subarray(0, Math.max(0, s.length - a[1])), a[1]);
  };
  const wrapExt = (I, name, ext) => {
    if (ext.__deaOrig) return;
    const orig = {};
    Object.defineProperty(ext, '__deaOrig', { value: orig, enumerable: false });
    for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(ext))) {
      const f = ext[k];
      if (typeof f !== 'function' || k === 'constructor') continue;
      orig[k] = f;
      const full = 'ext:' + name + '.' + k;
      ext[k] = function () {
        const R = I.rec; let c = null;
        if (R && R.on && !/^(is|get)/.test(k)) { try { c = record(I, full, Array.prototype.slice.call(arguments)); } catch (e) { err(full + ': ' + e); } }
        const ret = f.apply(ext, arguments);
        if (/^draw/.test(k)) I.draws++;
        if (R && R.on && !/^(is|get)/.test(k)) { try { post(I, full, arguments, ret, c); } catch (e) {} }
        return ret;
      };
    }
  };
  wrap(C1, '1');
  if (C2) wrap(C2, '2');

  // ---- handing the recording over -------------------------------------------------------------------------------------
  CAP.result = () => {
    const I = CAP.target; if (!I || !I.rec) return null;
    const R = I.rec; const gl = I.gl; const c = gl.canvas;
    const b = c.getBoundingClientRect(); const cs = getComputedStyle(c);
    const attrs = gl.getContextAttributes() || {};
    const doc = {
      version: I.v2 ? 2 : 1,
      canvas: { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight, cssW: b.width, cssH: b.height, x: b.left, y: b.top,
        style: { position: cs.position, zIndex: cs.zIndex, opacity: cs.opacity, mixBlendMode: cs.mixBlendMode, filter: cs.filter, background: cs.backgroundColor } },
      dpr: devicePixelRatio, attrs, extensions: [...I.exts.keys()],
      snap: R.snap, frames: R.frames.map((f) => ({ state: f.state, cmds: f.cmds, ms: f.ms || 0, ts: f.ts })),
      errors: CAP.errors.slice(), overflow: !!R.overflow, binBytes: bin.size, url: location.href, at: new Date().toISOString(),
      contexts: CAP.contexts.length,
    };
    // pack the binary
    const all = new Uint8Array(bin.size); let o = 0;
    for (const p of bin.parts) { all.set(p, o); o += p.byteLength; }
    CAP.bin = all; bin.parts = [all];
    CAP.doc = JSON.stringify(doc);
    return { json: CAP.doc.length, bin: all.byteLength };
  };
  CAP.text = (from, n) => CAP.doc.slice(from, from + n);
  CAP.chunk = (from, n) => new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.readAsDataURL(new Blob([CAP.bin.subarray(from, from + n)]));
  });
})();`;

export interface Recording {
  doc: CaptureDoc;
  bin: Buffer;
}

/**
 * Record the next `frames` frames of the busiest visible WebGL canvas. Resolves once the frames are recorded and the
 * page's animation frames are held (call `releaseFrames` after taking the screenshot), or with an error.
 */
export async function recordFrames(page: Page, opts: { frames?: number; timeoutMs?: number } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const armed = await page
    .evaluate(
      (f) => (window as unknown as { __DEA_CAP__?: { arm: (o: object) => boolean } }).__DEA_CAP__?.arm({ frames: f, hold: true }) ?? false,
      opts.frames ?? 2,
    )
    .catch(() => false);
  if (!armed) return { ok: false, error: 'the recorder was not in the page' };
  const t0 = Date.now();
  while (Date.now() - t0 < (opts.timeoutMs ?? 90_000)) {
    const st = await page.evaluate(() => (window as unknown as { __DEA_CAP__: { state: string } }).__DEA_CAP__.state).catch(() => 'gone');
    if (st === 'done') return { ok: true };
    if (st === 'gone') return { ok: false, error: 'the page went away while recording' };
    await page.waitForTimeout(300);
  }
  return { ok: false, error: 'no WebGL canvas drew a frame while DEA waited (the scene may render only on demand)' };
}

/** Let the page's animation frames run again after a recording. */
export async function releaseFrames(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __DEA_CAP__?: { release: () => void } }).__DEA_CAP__?.release()).catch(() => {});
}

/** Pull the recording out of the page: the JSON description and the binary (buffers, textures, typed arrays). */
export async function pullRecording(page: Page): Promise<Recording | null> {
  type Cap = { result: () => { json: number; bin: number } | null; text: (o: number, n: number) => string; chunk: (o: number, n: number) => Promise<string> };
  const sizes = await page.evaluate(() => (window as unknown as { __DEA_CAP__: Cap }).__DEA_CAP__.result());
  if (!sizes) return null;
  let json = '';
  for (let o = 0; o < sizes.json; o += 4_000_000)
    json += await page.evaluate(([from, n]) => (window as unknown as { __DEA_CAP__: Cap }).__DEA_CAP__.text(from, n), [o, 4_000_000] as const);
  const parts: Buffer[] = [];
  for (let o = 0; o < sizes.bin; o += 8_000_000)
    parts.push(
      Buffer.from(
        await page.evaluate(([from, n]) => (window as unknown as { __DEA_CAP__: Cap }).__DEA_CAP__.chunk(from, n), [o, 8_000_000] as const),
        'base64',
      ),
    );
  return { doc: JSON.parse(json) as CaptureDoc, bin: Buffer.concat(parts) };
}
