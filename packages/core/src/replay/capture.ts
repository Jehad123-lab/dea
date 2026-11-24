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
      if (CAP.tCanvas == null) CAP.tCanvas = Math.round(performance.now());
    }
    return I;
  };

  const O = {}; // original functions, by "C1.name" / "C2.name"
  const orig = (gl, n) => (gl instanceof (C2 || Object) && O['2.' + n]) || O['1.' + n];
  const call = (gl, n, ...a) => orig(gl, n).apply(gl, a);

  const DRAW = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']);
  // deletes are not recorded: the replay loops a few frames, so what the site freed in one pass would be gone for the next
  const SKIP = new Set(['deleteTexture', 'deleteFramebuffer', 'deleteRenderbuffer', 'deleteBuffer', 'deleteVertexArray', 'deleteProgram', 'deleteSampler', 'deleteTransformFeedback', 'getError', 'getParameter', 'getExtension', 'getSupportedExtensions', 'getContextAttributes', 'isContextLost',
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
  // the same bytes uploaded again (a buffer re-sent every frame, a texture that did not change) are stored once: the second reference points at the first
  const binIndex = new Map();
  const sameBytes = (a, b) => { if (a.byteLength !== b.byteLength) return false; for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false; return true; };
  const addBin = (u8) => {
    const n = u8.byteLength;
    let key = null;
    if (n >= 64) {
      let h = 2166136261; const st = n > 65536 ? 7 : 1;
      for (let i = 0; i < n; i += st) h = Math.imul(h ^ u8[i], 16777619);
      key = n + ':' + (h >>> 0);
      const hit = binIndex.get(key);
      if (hit) for (const c of hit) if (sameBytes(c.u8, u8)) return c.o;
    }
    const pad = (8 - (bin.size % 8)) % 8;
    if (pad) { bin.parts.push(new Uint8Array(pad)); bin.size += pad; }
    const o = bin.size;
    bin.parts.push(u8);
    bin.size += n;
    if (key) { const l = binIndex.get(key); if (l) l.push({ o, u8 }); else binIndex.set(key, [{ o, u8 }]); }
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
      // rank by the part of the canvas that is on screen (a taller canvas further down the page is not the first screen's);
      // a canvas wholly off screen stays a fallback, behind every canvas that shows
      const b = c.getBoundingClientRect(); const full = b.width * b.height;
      const vw = Math.max(0, Math.min(b.right, innerWidth) - Math.max(b.left, 0)); const vh = Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0));
      const a = vw * vh > 0 ? 1e9 + vw * vh : full;
      if (a > bestA) { bestA = a; best = I; }
    }
    return best;
  };

  let lastTs = -1;
  // ---- input probe: the float uniforms' values at every animation frame, beside the pointer, scroll and window size --------
  CAP.probe = null;
  CAP.ptr = null;
  const onPointer = (e) => { CAP.ptr = [e.clientX, e.clientY]; if (CAP.probe) { CAP.probe.mx = e.clientX; CAP.probe.my = e.clientY; } };
  // does the page listen for a press (mousedown, pointerdown, touchstart)? Then some of what it draws may need the button held
  CAP.down = 0;
  try {
    const ael = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (t, ...r) { if (t === 'mousedown' || t === 'pointerdown' || t === 'touchstart') CAP.down++; return ael.call(this, t, ...r); };
  } catch (e) {}
  try { addEventListener('pointermove', onPointer, { capture: true, passive: true }); addEventListener('mousemove', onPointer, { capture: true, passive: true }); } catch (e) {}
  // the scroll signal: the page's own scroll when it can scroll, else the sum of the wheel it was given (a fixed-stage site that
  // moves its scene by wheel events scrolls nothing, and scrollY would stay 0)
  CAP.wheel = 0;
  CAP.moved = false;
  CAP.links = []; CAP.tCanvas = null; CAP.tDraw = null; CAP.tArm = null;
  try { addEventListener('wheel', (e) => { CAP.wheel = Math.max(0, CAP.wheel + e.deltaY); }, { capture: true, passive: true }); } catch (e) {}
  // a page scrolls natively once its own scroll position has moved by a real amount (a page whose document is a few px taller than the
  // window, or that moves its content by a transform, answers the wheel without scrolling: the sum of the wheel is its signal)
  try { addEventListener('scroll', () => { if (scrollY >= Math.max(40, innerHeight * 0.2)) CAP.moved = true; }, { capture: true, passive: true }); } catch (e) {}
  const scrollSignal = () => (CAP.moved ? Math.round(scrollY) : Math.round(CAP.wheel));
  CAP.signal = scrollSignal;

  // ---- state diff: what the page changed during a window (uniforms, CPU uploads, texture uploads, draw sizes) -------------
  // Used by the interaction check, on the site and on the kit with the same script, so what moved on one and not on the other
  // is a named list. Only counts and ranges are kept, no data.
  CAP.diff = null;
  CAP.diffStart = () => { CAP.diff = { frames: 0, draws: 0, verts: 0, uni: new Map(), buf: new Map(), tex: new Map(), sig: new Map(), t0: performance.now() }; return true; };
  const sumOf = (v) => { let s = 0; const n = v.length; const st = Math.max(1, (n / 64) | 0); for (let i = 0; i < n; i += st) s += (+v[i] || 0) * ((i % 7) + 1); return Math.round(s * 1e4) / 1e4; };
  const diffNote = (I, name, a, ret) => {
    const D = CAP.diff;
    if (name.startsWith('uniform')) {
      const L = a[0] && I.locs.get(a[0]); if (!L) return;
      const kind = name.slice(7); const isMat = kind.startsWith('Matrix');
      if (!isMat && kind.indexOf('f') < 0) return;
      const arr = isMat ? a[2] : kind.endsWith('v') ? a[1] : null;
      const v = [];
      if (arr) { for (let i = 0; i < Math.min(arr.length, 16); i++) v.push(+arr[i]); } else for (let i = 1; i < a.length && i <= 4; i++) v.push(+a[i]);
      const key = L.n.replace(/\[0\]$/, '');
      let u = D.uni.get(key);
      if (!u) { if (D.uni.size >= 600) return; u = { first: v, dev: 0, sets: 0, comps: v.length }; D.uni.set(key, u); }
      u.sets++;
      for (let i = 0; i < Math.min(v.length, u.first.length); i++) { const d = Math.abs(v[i] - u.first[i]) / (1 + Math.abs(u.first[i])); if (d > u.dev) u.dev = d; }
      return;
    }
    if (name === 'bufferSubData' || name === 'bufferData') {
      const d = name === 'bufferSubData' ? a[2] : a[1];
      if (!d || typeof d === 'number') return;
      const size = d.byteLength; const f = d instanceof ArrayBuffer ? new Float32Array(d, 0, size >> 2) : new Float32Array(d.buffer, d.byteOffset, size >> 2);
      let e = D.buf.get(name + ':' + size); if (!e) { e = { n: 0, sums: new Set() }; D.buf.set(name + ':' + size, e); }
      e.n++; if (e.sums.size < 50) e.sums.add(sumOf(f));
      return;
    }
    if (name === 'texSubImage2D' || name === 'texImage2D' || name === 'texSubImage3D' || name === 'texImage3D') {
      const src = a[a.length - 1]; const k = name + ':' + (src && src.constructor ? src.constructor.name : typeof src);
      D.tex.set(k, (D.tex.get(k) || 0) + 1);
      return;
    }
    if (DRAW.has(name)) {
      const n = name === 'drawArrays' || name === 'drawArraysInstanced' ? a[2] : name === 'drawRangeElements' ? a[3] : a[1];
      const inst = /Instanced/.test(name) ? a[a.length - 1] : 1;
      D.draws++; D.verts += (n | 0) * (inst | 0 || 1);
      const k = I.curProg + '|' + a[0] + '|' + (inst > 1 ? 'i' : '1');
      let s = D.sig.get(k); if (!s) { s = new Set(); D.sig.set(k, s); }
      if (s.size < 40) s.add(n + 'x' + inst);
    }
  };
  CAP.diffTake = () => {
    const D = CAP.diff; CAP.diff = null; if (!D) return null;
    const uniforms = []; for (const [n, u] of D.uni) if (u.dev > 1e-4) uniforms.push({ name: n, dev: Math.round(u.dev * 1e4) / 1e4, sets: u.sets, comps: u.comps });
    const uploads = []; for (const [k, e] of D.buf) { const [fn, size] = k.split(':'); uploads.push({ fn, size: +size, n: e.n, distinct: e.sums.size }); }
    const tex = []; for (const [k, n] of D.tex) tex.push({ call: k, n });
    const varying = []; for (const [k, s] of D.sig) if (s.size > 1) varying.push({ draw: k, sizes: [...s].slice(0, 6) });
    return { frames: D.frames, draws: D.draws, verts: D.verts, uniforms, uploads, tex, varying, ms: Math.round(performance.now() - D.t0) };
  };
  CAP.probeStart = () => { CAP.probe = { t0: performance.now(), cur: {}, series: {}, env: [], phases: [], mx: -1, my: -1, mats: new Map(), nkeys: 0 }; CAP.wheel = 0; CAP.moved = false; return true; };
  CAP.probeStop = () => { const P = CAP.probe; CAP.probe = null; return P ? { series: P.series, env: P.env, phases: P.phases } : null; };
  CAP.probeMark = (name) => { if (CAP.probe) CAP.probe.phases.push([name, CAP.probe.env.length]); return true; };
  CAP.probeFrames = () => (CAP.probe ? CAP.probe.env.length : -1);
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
    if (CAP.diff) CAP.diff.frames++;
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
    if (CAP.state === 'done' && CAP.contPending && CAP.target && CAP.target.rec) {
      // continue the same recording: the objects it already met keep their snapshots, new ones are read when first met
      const R = CAP.target.rec;
      R.on = true; R.frame = R.frames.length - 1; CAP.opts.frames = R.frames.length + CAP.contPending; CAP.contPending = 0; CAP.state = 'recording';
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
      R.frames.push({ state, cmds: R.cmds, t0: performance.now(), ts: lastTs, ptr: CAP.ptr ? [CAP.ptr[0], CAP.ptr[1]] : null, sc: scrollSignal() });
    }
  };

  const raf0 = window.requestAnimationFrame;
  const held = [];
  // The canvas as it is drawn in the last recorded frame, copied in the same task as the site's own draw calls: a canvas
  // without preserveDrawingBuffer holds nothing once that task ends, and a screenshot taken later (after the frames are
  // held, while the kit is built) would show an empty canvas or whatever the site paints next — so DEA keeps the frame
  // itself and compares the replay with it.
  let frameCopy = null;
  const grabFrame = () => {
    const I = CAP.target;
    if (!I || !I.rec || I.rec.frame !== CAP.opts.frames - 1) return;
    const c = I.gl && I.gl.canvas;
    if (!c || !c.width || !c.height) return;
    try {
      if (!frameCopy || frameCopy.width !== c.width || frameCopy.height !== c.height) {
        frameCopy = document.createElement('canvas');
        frameCopy.width = c.width; frameCopy.height = c.height;
      }
      const g = frameCopy.getContext('2d');
      g.clearRect(0, 0, frameCopy.width, frameCopy.height);
      g.drawImage(c, 0, 0);
    } catch (e) { err('canvas copy: ' + e); }
  };
  window.requestAnimationFrame = function (cb) {
    return raf0.call(window, function (ts) {
      if (ts !== lastTs) { lastTs = ts; try { boundary(); } catch (e) { err('boundary: ' + e); } }
      if (CAP.hold) { held.push(cb); return; }
      const r = cb.apply(this, arguments);
      try { grabFrame(); } catch (e) { err('grab: ' + e); }
      return r;
    });
  };
  CAP.canvasPng = () => (frameCopy ? frameCopy.toDataURL('image/png') : null);
  CAP.canvasSize = () => (frameCopy ? { w: frameCopy.width, h: frameCopy.height } : null);
  CAP.binSize = () => bin.size;
  CAP.nframes = () => (CAP.target && CAP.target.rec ? CAP.target.rec.frames.length : 0);
  CAP.cont = (n, hold) => { if (CAP.state !== 'done') return false; CAP.opts.hold = hold !== false; CAP.contPending = n; CAP.hold = false; const h = held.splice(0); for (const cb of h) raf0.call(window, cb); return true; };
  CAP.release = () => { CAP.hold = false; const h = held.splice(0); for (const cb of h) raf0.call(window, cb); };
  CAP.arm = (opts) => {
    for (const r of CAP.contexts) { const gl = r.deref(); if (!gl) continue; for (const n of ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'WEBGL_color_buffer_float']) { try { call(gl, 'getExtension', n); } catch (e) {} } }
    CAP.tArm = Math.round(performance.now());
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
    if (CAP.diff) { try { diffNote(I, name, a, ret); } catch (e) {} }
    switch (name) {
      case 'drawArrays': case 'drawElements': case 'drawArraysInstanced': case 'drawElementsInstanced': case 'drawRangeElements':
        I.draws++; if (CAP.tDraw == null) CAP.tDraw = Math.round(performance.now()); if (CAP.probe) { try { probeDraw(I); } catch (e) {} } break;
      case 'linkProgram': if (CAP.links.length < 400) CAP.links.push(Math.round(performance.now())); break;
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
      snap: R.snap, frames: R.frames.map((f) => ({ state: f.state, cmds: f.cmds, ms: f.ms || 0, ts: f.ts, ptr: f.ptr, sc: f.sc })),
      errors: CAP.errors.slice(), overflow: !!R.overflow, binBytes: bin.size, url: location.href, at: new Date().toISOString(),
      contexts: CAP.contexts.length,
      boot: { canvas: CAP.tCanvas, draw: CAP.tDraw, links: CAP.links.slice(), armed: CAP.tArm },
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
  /** the canvas as the last recorded frame drew it, as a data URL (a canvas without preserveDrawingBuffer holds nothing after its task) */
  canvasPng?: string;
}

/**
 * The canvas as the last recorded frame drew it. The recorder copies it in the same task as the site's own draw calls
 * (a canvas without `preserveDrawingBuffer` holds nothing once that task ends), so this is the picture the recorded
 * frame put on screen, even when something is painted over the canvas later.
 */
export async function grabCanvasFrame(page: Page): Promise<string | null> {
  type Cap = { canvasPng?: () => string | null };
  return page
    .evaluate(() => {
      const cap = (window as unknown as { __DEA_CAP__?: Cap }).__DEA_CAP__;
      return cap?.canvasPng ? cap.canvasPng() : null;
    })
    .catch(() => null);
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

/** The pointer path of the tape: starts at the centre moving right, then curves up and back (a turning path, so a trail's
 *  direction is not one fixed line), as fractions of the window. `move` frames with the pointer moving, `still` frames after it stops. */
export function tapePointer(i: number, move: number): [number, number] {
  const s = move <= 1 ? 0 : Math.min(i, move - 1) / (move - 1);
  const phi = s * 1.6 * Math.PI;
  return [0.5 + 0.2 * Math.sin(phi), 0.5 - 0.15 * (1 - Math.cos(phi))];
}

/**
 * Continue the recording for `move + still` more frames while the pointer moves along tapePointer (the recorded "tape":
 * what the site draws, and uploads from the CPU, while the pointer moves and as it settles). The page's frames are held
 * again afterwards. Returns how many frames were added.
 */
export async function recordTape(
  page: Page,
  opts: { move?: number; still?: number; timeoutMs?: number; drag?: boolean } = {},
): Promise<{ ok: true; move: number; still: number } | { ok: false; error: string }> {
  const move = opts.move ?? 8;
  const still = opts.still ?? 4;
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  type Cap = { cont: (n: number, hold: boolean) => boolean; nframes: () => number; state: string };
  const ok = await page.evaluate((n) => (window as unknown as { __DEA_CAP__: Cap }).__DEA_CAP__.cont(n, true), move + still).catch(() => false);
  if (!ok) return { ok: false, error: 'the recorder could not continue' };
  const nf = () => page.evaluate(() => (window as unknown as { __DEA_CAP__: Cap }).__DEA_CAP__.nframes()).catch(() => -1);
  const stateOf = () => page.evaluate(() => (window as unknown as { __DEA_CAP__: Cap }).__DEA_CAP__.state).catch(() => 'gone');
  const t0 = Date.now();
  const limit = opts.timeoutMs ?? 240_000;
  const base = await nf();
  // the pointer for tape frame i moves right after frame i - 1 was recorded, so frame i is the first to see it
  for (let i = 0; i < move + still; i++) {
    while (i > 0 && Date.now() - t0 < limit && (await nf()) < base + i && (await stateOf()) !== 'done') await page.waitForTimeout(60);
    if (Date.now() - t0 >= limit) return { ok: false, error: 'the tape timed out' };
    if (i < move) {
      const [x, y] = tapePointer(i, move);
      await page.mouse.move(vp.width * x, vp.height * y, { steps: 1 }).catch(() => {});
      // a drag: the button goes down where the path starts and stays down while the pointer moves
      if (opts.drag && i === 0) await page.mouse.down().catch(() => {});
    } else if (opts.drag && i === move) await page.mouse.up().catch(() => {});
  }
  if (opts.drag) await page.mouse.up().catch(() => {});
  while (Date.now() - t0 < limit && (await stateOf()) !== 'done') await page.waitForTimeout(150);
  return { ok: true, move, still };
}

/** One stop of the scroll tape: the scroll signal there, the recorded frames that belong to it (indices within the tape), the DOM then. */
export interface ScrollStop {
  /** the scroll signal: the page's scrollY once it scrolls natively, else the sum of the wheel it was given (px) */
  sc: number;
  /** the sum of the wheel it was given by then (px): the one input a kit can be given the same way as the site */
  wh: number;
  /** first and last tape frame of this stop; the last one is the settled picture */
  f0: number;
  f1: number;
  /** what the page looked like in the DOM at this stop (the sections in view, the scroll metrics) */
  dom?: StopDom | null;
}

export interface StopDom {
  scrollY: number;
  docHeight: number;
  viewport: [number, number];
  /** sections (landmarks) with the share of the window they cover, largest first */
  inView: Array<{ sel: string; heading: string; share: number }>;
  /** visible canvases: selector and the share of the window */
  canvases: Array<{ sel: string; share: number }>;
}

export interface ScrollTapeRecording {
  /** frames added after the rest and pointer-tape frames */
  frames: number;
  /** ordered as recorded: the stops going down, then home (scroll 0 again, which puts back the state the site had at the top) */
  stops: ScrollStop[];
  /** the page scrolls natively, or only answers the wheel */
  mechanism: 'native' | 'virtual';
  step: number;
  settle: number;
  /** the document height and the furthest scroll the tape reached (px; 0 when the page does not scroll natively) */
  docHeight?: number;
  reach?: number;
  /** why the tape stopped short of the end of the page, when it did */
  ended?: string;
}

/** What a section and the canvases in view are, read at a scroll stop (runs in the page). */
export const STOP_DOM = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const sel = (el) => { if (el.id) return '#' + el.id; const c = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.'); return el.tagName.toLowerCase() + (c ? '.' + c : ''); };
  const share = (r) => { const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)); const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)); return (w * h) / (vw * vh); };
  const heading = (el) => { const h = el.querySelector('h1, h2, h3, [role=heading]'); return h ? (h.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : ''; };
  const big = (el) => { const r = el.getBoundingClientRect(); return r.width >= vw * 0.5 && r.height >= vh * 0.2; };
  const set = new Set();
  for (const el of document.querySelectorAll('header, nav, main > *, section, footer, [data-section], article, body > *, #root > *, #app > *, #__next > *')) if (big(el) && !/^(script|style|canvas|noscript)$/i.test(el.tagName)) set.add(el);
  // a wrapper that contains another section is not itself a section of the page: the innermost ones are listed
  const all = [...set]; for (const el of all) if (all.some((o) => o !== el && el.contains(o))) set.delete(el);
  const inView = [...set].map((el) => ({ sel: sel(el), heading: heading(el), share: Math.round(share(el.getBoundingClientRect()) * 100) / 100 })).filter((x) => x.share > 0.05).sort((a, b) => b.share - a.share).slice(0, 6);
  // shadow roots are searched too, open or closed (the observers record every attachShadow): a canvas inside a web component is still the page's canvas
  const deep = (q) => { if (window.__DEA__ && window.__DEA__.deep) return window.__DEA__.deep(q); const out = [...document.querySelectorAll(q)]; let hosts = 0; const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot && hosts++ < 300) { out.push(...el.shadowRoot.querySelectorAll(q)); walk(el.shadowRoot); } } }; walk(document); return out; };
  const canvases = deep('canvas').map((el) => ({ sel: sel(el), share: Math.round(share(el.getBoundingClientRect()) * 100) / 100 })).filter((x) => x.share > 0.05).slice(0, 6);
  return { scrollY: Math.round(scrollY), docHeight: document.documentElement.scrollHeight, viewport: [vw, vh], inView, canvases };
})()`;

/**
 * How far the next scroll stop goes, in wheel px. After the first stops (close together: the first screens are where intros and
 * hero scenes play) the rest of a long page is covered by stops that spread what is left evenly over the stops the budgets still
 * allow, so a bounded number of stops reaches the end of the page instead of only its first screens. Called again after every stop
 * with where the page actually is, so a stop that moved less than planned (or a budget that shrank) is absorbed by the next ones.
 * Pure. `left` is the page px still to cover, `stopsLeft` the stops the stop count, the time and the size allow (0 = none),
 * `minStep` the shortest stop (page px), `ratio` wheel px per page px (1 for a page that scrolls 1:1, 2 for one that moves half
 * a page px per wheel px). Returns null when there is nothing left to cover or no stop left to do it with.
 */
export function nextScrollStep(o: { left: number; stopsLeft: number; minStep: number; ratio: number }): { wheel: number; page: number } | null {
  const ratio = o.ratio > 0 ? o.ratio : 1;
  if (o.stopsLeft <= 0 || o.left <= o.minStep / 2) return null;
  const page = Math.min(o.left, Math.max(o.minStep, o.left / o.stopsLeft));
  return { wheel: Math.max(1, Math.round(page * ratio)), page };
}

export interface ScrollTapeOpts {
  /** stops spaced by `step` at the top (default 8) */
  stops?: number;
  /** the most stops in all (default 40): the rest of a long page is spread over what is left */
  maxStops?: number;
  /** the wheel px of a head stop (default 0.45 of the window) */
  step?: number;
  /** frames recorded at each stop before it is checked for having settled (default 2; one more is recorded to check) */
  settle?: number;
  /** the whole tape's time (default 15 minutes: a stop costs seconds on a GPU and up to a minute in software WebGL) */
  timeoutMs?: number;
  /** called after each stop with the stop, its number and the time it took (ms) */
  onStop?: (s: ScrollStop, i: number, ms: number) => void;
  /** what the tape may add to the recording's binary (default 64 MB): the stops are spread to reach the end of the page within it, and it ends there, saying so */
  maxBytes?: number;
  /** true when the run's own budget is spent: the tape ends there */
  shouldStop?: () => boolean;
}

/**
 * Continue the recording while the page is scrolled, a stop at a time: a wheel step, then frames until the page has stopped
 * moving. The wheel is the one input every scroll mechanism answers (a native scroll, a virtual scroll that moves one container
 * by a transform, a fixed stage that moves its scene by the wheel). The first stops are close together; the rest of a long
 * page is covered by evenly spaced stops (nextScrollStep), bounded by a stop count, the time and the recording's size, and
 * what ended it is stated in `ended`. The last stop returns to the top, so the buffers the site uploads only when something
 * changes hold the state of the top again. Frames carry the scroll signal (`sc`); each stop's DOM is read beside them.
 */
export async function recordScrollTape(page: Page, opts: ScrollTapeOpts = {}): Promise<{ ok: true; rec: ScrollTapeRecording } | { ok: false; error: string }> {
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  // a long page gets a shorter dense head (the first screens), so the stops that are left reach the end of it
  const height0 = ((await page.evaluate('document.documentElement.scrollHeight').catch(() => 0)) as number) || 0;
  const headN = opts.stops ?? (height0 > vp.height * 8 ? 5 : 8);
  const maxN = Math.max(headN, opts.maxStops ?? 40);
  const step = opts.step ?? Math.round(vp.height * 0.45);
  const settle = opts.settle ?? 2;
  const limit = opts.timeoutMs ?? 900_000;
  const maxBytes = opts.maxBytes ?? 64_000_000;
  type Cap = {
    cont: (n: number, hold: boolean) => boolean;
    nframes: () => number;
    state: string;
    wheel: number;
    binSize?: () => number;
    signal: () => number;
  };
  const cap = <T>(expr: string, dflt: T) =>
    page.evaluate(`(() => { const c = window.__DEA_CAP__; return ${expr}; })()`).then(
      (v) => v as T,
      () => dflt,
    );
  const nf = () => cap<number>('c.nframes()', -1);
  const stateOf = () => cap<string>('c.state', 'gone');
  const signal = () => cap<number>('c.signal()', 0);
  const binSize = () => cap<number>('c.binSize ? c.binSize() : 0', 0);
  const t0 = Date.now();
  const base = await nf();
  if (base < 0) return { ok: false, error: 'the recorder was not in the page' };
  const bin0 = await binSize();
  let at = 0;
  const stops: ScrollStop[] = [];
  let ended = '';
  /** record `n` more frames (the page's animation frames are released for them) and wait until they are in */
  const frames = async (n: number): Promise<boolean> => {
    const before = await nf();
    const ok = await page.evaluate((k) => (window as unknown as { __DEA_CAP__: Cap }).__DEA_CAP__.cont(k, true), n).catch(() => false);
    if (!ok) return false;
    const tf = Date.now();
    // one stop may not take longer than 3 minutes (a scene that stops drawing frames would hold the whole tape)
    const alive = () => Date.now() - t0 < limit && Date.now() - tf < 180_000;
    while (alive() && (await nf()) < before + n) await page.waitForTimeout(80);
    while (alive() && (await stateOf()) !== 'done') await page.waitForTimeout(120);
    return alive();
  };
  /** a wheel input of any size: a long one is given as a stream of notches of one head step (a site may limit what one event moves) */
  const chunk = Math.max(100, step);
  const wheel = async (delta: number) => {
    const sign = delta < 0 ? -1 : 1;
    let left = Math.abs(delta);
    while (left > 0) {
      const d = Math.min(left, chunk);
      await page.mouse.wheel(0, sign * d).catch(() => {});
      left -= d;
      if (left > 0) await page.waitForTimeout(50);
    }
  };
  const segment = async (delta: number): Promise<ScrollStop | null> => {
    if (delta) await wheel(delta);
    if (!(await frames(settle))) return null;
    // a page that eases its scroll is still moving after a few frames: more are recorded until the signal holds (a few rounds at most)
    let prev = await signal();
    let confirm = false;
    for (let k = 0; k < 4; k++) {
      if (!(await frames(1))) return null;
      const cur = await signal();
      // still moving by more than a couple of px (or a thousandth of a stop) between two frames: more frames, a few at most
      if (Math.abs(cur - prev) < Math.max(2, step / Math.max(1, ratio) / 400)) {
        confirm = true;
        break;
      }
      prev = cur;
    }
    const n = await nf();
    const dom = (await page.evaluate(STOP_DOM).catch(() => null)) as StopDom | null;
    const wh = await cap<number>('c.wheel', 0);
    // the frame that only confirmed the scroll had stopped is not the stop: a scene that uploads only when something changes has
    // nothing to upload in it, so the stop is the frame before (the same picture, with the commands the scene issued to get there)
    const stop: ScrollStop = { sc: await signal(), wh: Math.round(wh), f0: at, f1: n - base - 1 - (confirm ? 1 : 0), dom };
    at = n - base;
    return stop;
  };
  let total = 0;
  let docHeight = 0;
  let perStop = 0;
  let perBytes = 0;
  let ratio = 1;
  let native = false;
  let binPrev = bin0;
  // the first stops: close together, as before
  const headDeltas: number[] = Array.from({ length: headN }, () => step);
  for (let i = 0; ; i++) {
    let delta: number;
    if (i < headN) delta = headDeltas[i];
    else {
      // what is left of the page, and how many stops the count, the time and the size still allow
      const pos = Math.max(0, stops[stops.length - 1]?.sc ?? 0);
      const timeLeft = limit - (Date.now() - t0) - 60_000; // a minute is kept for the way back to the top
      const byTime = Math.floor(timeLeft / Math.max(1, perStop));
      const byBytes = perBytes > 0 ? Math.floor((maxBytes - (binPrev - bin0)) / perBytes) : Number.POSITIVE_INFINITY;
      const byCount = maxN - i;
      const allowed = Math.min(byTime, byBytes, byCount);
      const left = docHeight - vp.height - pos;
      const nxt = native ? nextScrollStep({ left, stopsLeft: allowed, minStep: Math.round(step / ratio), ratio }) : null;
      if (!nxt) {
        if (native && left > step / ratio / 2)
          ended = `${allowed <= 0 ? (byTime <= 0 ? 'the time allowed for the tape' : byBytes <= 0 ? `the ${Math.round(maxBytes / 1e6)} MB allowed for the tape` : 'the stop count') : 'the page'} ended it at ${Math.round(pos)} px of ${docHeight} px`;
        break;
      }
      delta = nxt.wheel;
    }
    if (opts.shouldStop?.()) {
      ended = 'the run budget was spent';
      break;
    }
    const ts = Date.now();
    const s = await segment(delta);
    if (!s) {
      if (!stops.length) return { ok: false, error: 'the scroll tape timed out or the recorder stopped' };
      ended = 'the tape time was spent';
      break;
    }
    stops.push(s);
    total += delta;
    const took = Date.now() - ts;
    perStop = perStop ? perStop * 0.6 + took * 0.4 : took;
    const nb = await binSize();
    const grew = Math.max(0, nb - binPrev);
    perBytes = perBytes ? perBytes * 0.6 + grew * 0.4 : grew;
    binPrev = nb;
    opts.onStop?.(s, i, took);
    if (i === headN - 1) {
      // the head is in: how the page answers the wheel is known now
      ratio = s.sc > 1 && s.wh > 1 ? s.wh / s.sc : 1;
      docHeight = ((await page.evaluate('document.documentElement.scrollHeight').catch(() => 0)) as number) || 0;
      native = (await cap<boolean>('c.moved === true', false)) && docHeight > vp.height * 1.2;
      // the head's own bytes do not set the rate: the first tail stops do (new sections bring new textures)
      perBytes = 0;
      if (!native) break;
    }
  }
  // back to the top: the whole way up (a long page in a few steps), then the stop that holds the state of the top
  const up = -Math.ceil(total * 1.05 + step);
  let top = await segment(up);
  if (top && top.sc > 2) {
    await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
    top = (await segment(0)) ?? top;
  }
  if (top) stops.push({ ...top, sc: 0, wh: 0 });
  const moved = await cap<boolean>('c.moved === true', false);
  // a page that scrolls natively is put back at the top whatever the tape did
  await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
  const reach = Math.max(0, ...stops.map((x) => x.sc));
  if (!ended && native && docHeight && reach < docHeight - vp.height - step) ended = `the stops reached ${Math.round(reach)} px of ${docHeight} px`;
  return { ok: true, rec: { frames: at, stops, mechanism: moved ? 'native' : 'virtual', step, settle, docHeight, reach, ended: ended || undefined } };
}

/** How many press listeners (mousedown, pointerdown, touchstart) the page has registered. */
export async function pressListeners(page: Page): Promise<number> {
  return ((await page.evaluate(() => (window as unknown as { __DEA_CAP__?: { down?: number } }).__DEA_CAP__?.down ?? 0).catch(() => 0)) as number) || 0;
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
