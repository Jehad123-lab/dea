// The editable-rebuild runner written into every kit that has a recording (rebuild/rebuild.js): builds the recorded
// render graph from pipeline.json as three.js objects. Plain JavaScript; three.js is its only dependency.

export const REBUILD_RUNNER = String.raw`// DEA editable rebuild (three.js). Builds the site's render graph from pipeline.json as three.js objects: one
// RawShaderMaterial per program and draw state (the GLSL is in shaders/, edit it), a BufferGeometry per draw, cameras
// and model matrices as three.js matrices, and a WebGLRenderTarget per framebuffer. The passes run in the site's order.
// Steps marked "gl" are WebGL calls three.js has no word for (uploads during the frame, blits, mipmaps), run as
// recorded. Geometry and texture bytes come from the recording (named "recorded" in pipeline.json): they belong to
// the site's owner unless you made the kit with --own-assets.
//
//   const data = await loadPipeline('/rebuild/');
//   const rb = createRebuild(canvas, data);         // or mountRebuild(element)
//   rb.renderFrames();                              // the recorded frames once (the picture DEA scored)
//   rb.start();                                     // live: the simulation runs on from the recorded moment, clock
//                                                   // uniforms follow real time, the camera holds the scored frame,
//                                                   // pointer / scroll / window-size uniforms follow live input
//   rb.setInput({ x: 0.7, y: 0.4 });                // drive the input yourself (x, y in 0..1, scroll in px, width, height)
//   rb.resize(1280, 720);                           // drawing buffer, screen-sized render targets and camera aspect
//   rb.materials[3].uniforms.uIntensity.value = 2;  // any uniform; blend, depth and side are material properties
//   rb.setPassEnabled(5, false);                    // switch a pass off
//   rb.cameras[0]                                   // the site's camera (matrixWorld / projectionMatrix)

import * as THREE_NS from 'three';

export async function loadPipeline(base = './rebuild/') {
  const root = new URL(base, location.href);
  const pipeline = await fetch(new URL('pipeline.json', root)).then((r) => r.json());
  const files = [];
  for (const m of pipeline.materials) files.push(m.vertex, m.fragment);
  const uniq = [...new Set(files)];
  const [bin, ...texts] = await Promise.all([
    fetch(new URL(pipeline.data, root)).then((r) => r.arrayBuffer()),
    ...uniq.map((f) => fetch(new URL(f, root)).then((r) => r.text())),
  ]);
  const shaders = {};
  uniq.forEach((f, i) => { shaders[f] = texts[i]; });
  return { pipeline, bin, shaders };
}

const FACTOR = { 0: 200, 1: 201, 768: 202, 769: 203, 770: 204, 771: 205, 772: 206, 773: 207, 774: 208, 775: 209, 776: 210, 32769: 211, 32770: 212, 32771: 213, 32772: 214 };
const EQUATION = { 32774: 100, 32778: 101, 32779: 102, 32775: 103, 32776: 104 };
const DEPTH = { 512: 0, 519: 1, 513: 2, 515: 3, 514: 4, 518: 5, 516: 6, 517: 7 };
const TYPED = { 5126: Float32Array, 5131: Uint16Array, 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5124: Int32Array, 5125: Uint32Array };

export function createRebuild(canvas, data, options = {}) {
  const THREE = options.THREE || THREE_NS;
  const p = data.pipeline;
  const bin = data.bin;
  const errors = [];
  const fail = (m) => { if (errors.length < 50) errors.push(m); };
  const at = p.attrs || {};
  canvas.width = p.canvas.w;
  canvas.height = p.canvas.h;
  // three.js (r163 on) always asks the browser for an alpha canvas; a site that drew into an opaque canvas
  // (alpha: false) writes alpha values the page would then show through, so the context is made here as recorded
  const context = canvas.getContext('webgl2', {
    alpha: at.alpha !== false,
    antialias: !!at.antialias,
    premultipliedAlpha: at.premultipliedAlpha !== false,
    preserveDrawingBuffer: !!options.preserveDrawingBuffer,
    depth: at.depth !== false,
    stencil: !!at.stencil,
    powerPreference: at.powerPreference || 'default',
  }) || undefined;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    alpha: at.alpha !== false,
    antialias: !!at.antialias,
    premultipliedAlpha: at.premultipliedAlpha !== false,
    preserveDrawingBuffer: !!options.preserveDrawingBuffer,
    depth: at.depth !== false,
    stencil: !!at.stencil,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(p.canvas.w, p.canvas.h, false);
  renderer.autoClear = false;
  renderer.sortObjects = false;
  if (p.toneMappingExposure != null) renderer.toneMappingExposure = p.toneMappingExposure;
  const gl = renderer.getContext();
  for (const n of (p.extensions || []).concat(['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear'])) gl.getExtension(n);
  const webgl1 = p.glVersion === 1;

  // ---- the recorded GPU objects (textures, renderbuffers, framebuffers), created as the recording met them --------
  const objs = new Map();
  const key = (k, id) => k + ':' + id;
  const get = (k, id) => (id ? objs.get(key(k, id)) || null : null);
  const view = (o, l, t) => {
    const C = globalThis[t] && globalThis[t].BYTES_PER_ELEMENT ? globalThis[t] : Uint8Array;
    return new C(bin, o, l / C.BYTES_PER_ELEMENT);
  };
  const arg = (a) => {
    if (a === null || typeof a !== 'object') return a;
    if (Array.isArray(a)) return a.map(arg);
    if (a.$ === 'bin') return view(a.o, a.l, a.t);
    if (a.$ === 'img') return new ImageData(new Uint8ClampedArray(bin.slice(a.o, a.o + a.l)), a.w, a.h);
    return get(a.$, a.id);
  };
  // a WebGL1 recording in this WebGL2 context: unsized float formats become sized ones
  const sized = (ifmt, fmt, type) => {
    if (!webgl1) return [ifmt, fmt, type];
    if (type === 0x8d61) type = 0x140b;
    if (type === 0x1406 && ifmt === 0x1908) return [0x8814, fmt, type];
    if (type === 0x1406 && ifmt === 0x1907) return [0x8815, fmt, type];
    if (type === 0x140b && ifmt === 0x1908) return [0x881a, fmt, type];
    if (type === 0x140b && ifmt === 0x1907) return [0x881b, fmt, type];
    return [ifmt, fmt, type];
  };
  const resetUnpack = () => {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    for (const q of [gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES]) gl.pixelStorei(q, 0);
  };
  const R = p.resources;
  gl.bindVertexArray(null);
  resetUnpack();
  gl.activeTexture(gl.TEXTURE0);
  const FLOATP = new Set([0x813a, 0x813b, 0x84fe]);
  for (const T of R.textures) {
    if (T.missing) continue;
    const t = gl.createTexture();
    gl.bindTexture(T.target, t);
    for (const c of T.comp || []) { try { gl[c.fn](...c.args.map(arg)); } catch (e) { fail('compressed upload: ' + e.message); } }
    let hasMips = false;
    for (const L of T.levels) {
      const target = T.target === 0x8513 ? 0x8515 + L.face : T.target;
      const three3 = T.target === 0x806f || T.target === 0x8c1a;
      if (L.level > 0) hasMips = true;
      if (L.skipped || L.alloc) {
        const al = L.alloc || [L.upFmt, L.upType];
        if (al[0]) {
          const [i, f, ty] = sized(L.ifmt, al[0], al[1]);
          try {
            if (three3) gl.texImage3D(target, L.level, i, L.w, L.h, L.d, 0, f, ty, null);
            else gl.texImage2D(target, L.level, i, L.w, L.h, 0, f, ty, null);
          } catch (e) { fail('texture ' + T.id + ': ' + e.message); }
        }
        continue;
      }
      if (L.upload) {
        const st = L.upload.store || {};
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !!st.flip);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!st.premul);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, st.align || 4);
        try { gl[L.upload.fn](...L.upload.args.map(arg)); } catch (e) { fail('upload: ' + e.message); }
        resetUnpack();
        continue;
      }
      const C = L.upType === 0x1406 ? 'Float32Array' : L.upType === 0x140b ? 'Uint16Array' : L.upType === 0x1404 ? 'Int32Array' : L.upType === 0x1405 ? 'Uint32Array' : 'Uint8Array';
      const px = view(L.o, L.l, C);
      const [i, f, ty] = sized(L.ifmt, L.upFmt, L.upType);
      try {
        if (three3) gl.texImage3D(target, L.level, i, L.w, L.h, L.d, 0, f, ty, px);
        else gl.texImage2D(target, L.level, i, L.w, L.h, 0, f, ty, px);
      } catch (e) { fail('texture ' + T.id + ': ' + e.message); }
    }
    for (const [k, v] of Object.entries(T.params || {})) { if (FLOATP.has(+k)) gl.texParameterf(T.target, +k, v); else gl.texParameteri(T.target, +k, v); }
    const minf = (T.params || {})[0x2801];
    if (!hasMips && !(T.comp && T.comp.length) && minf >= 0x2700 && minf <= 0x2703) { try { gl.generateMipmap(T.target); } catch (e) {} }
    objs.set(key('tex', T.id), t);
  }
  for (const Rb of R.renderbuffers) {
    const r = gl.createRenderbuffer();
    if (Rb.w) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, r);
      if (Rb.samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Rb.samples, Rb.internalformat, Rb.w, Rb.h);
      else gl.renderbufferStorage(gl.RENDERBUFFER, Rb.internalformat, Rb.w, Rb.h);
    }
    objs.set(key('rb', Rb.id), r);
  }
  const fbColors = new Map();
  for (const F of R.framebuffers) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    for (const a of F.atts) {
      if (a.tex) {
        const t = get('tex', a.tex);
        if (a.texTarget === 0x806f || a.texTarget === 0x8c1a) gl.framebufferTextureLayer(gl.FRAMEBUFFER, a.a, t, a.level || 0, a.layer || 0);
        else gl.framebufferTexture2D(gl.FRAMEBUFFER, a.a, a.face || a.texTarget || gl.TEXTURE_2D, t, a.level || 0);
      } else if (a.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, a.a, gl.RENDERBUFFER, get('rb', a.rb));
    }
    if (F.draw && F.draw.length) { gl.drawBuffers(F.draw); if (F.read) gl.readBuffer(F.read); }
    fbColors.set(F.id, F.atts.filter((a) => a.a >= 0x8ce0 && a.a <= 0x8cef).length || 1);
    objs.set(key('fb', F.id), f);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  renderer.resetState();

  // ---- three.js objects ----------------------------------------------------------------------------------------------
  // textures: three.js Texture objects that point at the recorded GPU textures
  const texWraps = new Map();
  const texOf = (id, kind) => {
    const k = kind + ':' + id;
    if (texWraps.has(k)) return texWraps.get(k);
    const T = kind === 'cube' ? new THREE.CubeTexture() : kind === '3d' ? new THREE.Data3DTexture() : kind === 'array' ? new THREE.DataArrayTexture() : new THREE.Texture();
    T.name = 'recorded texture ' + id;
    const pr = renderer.properties.get(T);
    pr.__webglTexture = get('tex', id) || undefined;
    pr.__webglInit = true;
    texWraps.set(k, T);
    return T;
  };
  const value = (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'tex' in v) return texOf(v.tex, v.kind);
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'tex' in v[0]) return v.map((x) => texOf(x.tex, x.kind));
    return Array.isArray(v) ? v.slice() : v;
  };
  // "light.color" / "lights[1].color" become the nested values three.js expects
  const setUniform = (uniforms, name, v) => {
    const parts = name.replace(/\[(\d+)\]/g, '.$1').split('.');
    if (parts.length === 1) {
      if (uniforms[name]) uniforms[name].value = value(v);
      else uniforms[name] = { value: value(v) };
      return;
    }
    const top = uniforms[parts[0]] || (uniforms[parts[0]] = { value: {} });
    let o = top.value;
    for (let i = 1; i < parts.length - 1; i++) o = o[parts[i]] || (o[parts[i]] = {});
    o[parts[parts.length - 1]] = value(v);
  };

  // materials: one per program and draw state, the site's GLSL as written
  const uniformSets = p.materials.map((m) => {
    const u = {};
    for (const [k, v] of Object.entries(m.uniforms)) setUniform(u, k, v);
    return u;
  });
  const dirty = p.materials.map(() => new Set());
  const materialVariants = new Map();
  const materialOf = (mi, side) => {
    const k = mi + ':' + side;
    if (materialVariants.has(k)) return materialVariants.get(k);
    const m = p.materials[mi];
    const s = m.state;
    // three.js writes its own #version and SHADER_NAME lines first: move the shader's #version to glslVersion and drop
    // its SHADER_NAME/SHADER_TYPE defines (the files on disk stay as the site wrote them)
    const prep = (src) => (src || '').replace(/^[ \t]*#define[ \t]+SHADER_(NAME|TYPE)\b.*$/gm, '').replace(/^\s*#version[ \t]+300[ \t]+es[ \t]*$/m, '');
    const glsl3 = /^\s*#version[ \t]+300[ \t]+es/m.test(data.shaders[m.vertex] || '');
    const mat = new THREE.RawShaderMaterial({ vertexShader: prep(data.shaders[m.vertex]), fragmentShader: prep(data.shaders[m.fragment]) });
    if (glsl3) mat.glslVersion = THREE.GLSL3;
    mat.uniforms = uniformSets[mi];
    mat.name = m.name;
    mat.side = side;
    mat.transparent = false;
    mat.premultipliedAlpha = false;
    if (s.blend) {
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = FACTOR[s.blend.src];
      mat.blendDst = FACTOR[s.blend.dst];
      mat.blendSrcAlpha = FACTOR[s.blend.srcA];
      mat.blendDstAlpha = FACTOR[s.blend.dstA];
      mat.blendEquation = EQUATION[s.blend.eq];
      mat.blendEquationAlpha = EQUATION[s.blend.eqA];
      if (mat.blendColor) mat.blendColor.setRGB(s.blend.color[0], s.blend.color[1], s.blend.color[2], THREE.LinearSRGBColorSpace);
      mat.blendAlpha = s.blend.color[3];
    } else mat.blending = THREE.NoBlending;
    mat.depthTest = s.depth.test;
    mat.depthWrite = s.depth.write;
    mat.depthFunc = DEPTH[s.depth.func] ?? THREE.LessEqualDepth;
    mat.colorWrite = s.colorMask.some(Boolean);
    if (s.stencil) {
      mat.stencilWrite = true;
      mat.stencilFunc = s.stencil.func;
      mat.stencilRef = s.stencil.ref;
      mat.stencilFuncMask = s.stencil.mask;
      mat.stencilFail = s.stencil.fail;
      mat.stencilZFail = s.stencil.zfail;
      mat.stencilZPass = s.stencil.zpass;
      mat.stencilWriteMask = s.stencil.write;
    }
    if (s.polygonOffset) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = s.polygonOffset[0];
      mat.polygonOffsetUnits = s.polygonOffset[1];
    }
    mat.alphaToCoverage = !!s.alphaToCoverage;
    mat.userData.dea = { program: m.program, material: mi };
    materialVariants.set(k, mat);
    return mat;
  };
  // three.js writes all four colour channels or none; a per-channel mask from the site goes through this hook
  let maskOverride = null;
  const cb = renderer.state.buffers.color;
  const setMask = cb.setMask.bind(cb);
  cb.setMask = (m) => {
    if (maskOverride) { gl.colorMask(maskOverride[0], maskOverride[1], maskOverride[2], maskOverride[3]); cb.reset(); } else setMask(m);
  };

  // cameras: the site's view and projection matrices as three.js cameras
  const cameras = p.cameras.map((c) => {
    const cam = c.orthographic ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera();
    cam.matrixAutoUpdate = false;
    cam.matrixWorldAutoUpdate = false;
    cam.matrixWorldInverse.fromArray(c.view);
    cam.matrixWorld.copy(cam.matrixWorldInverse).invert();
    cam.matrix.copy(cam.matrixWorld);
    cam.projectionMatrix.fromArray(c.projection);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    return cam;
  });
  const plainCamera = new THREE.Camera();
  plainCamera.matrixAutoUpdate = false;
  plainCamera.matrixWorldAutoUpdate = false;

  // geometry: each attribute read out of the recorded vertex buffers
  const raw = new Map();
  for (const B of R.buffers) raw.set(B.id, B.l ? new Uint8Array(bin, B.o, B.l).slice() : new Uint8Array(0));
  const attrCache = new Map();
  const unpack = (a) => {
    const src = raw.get(a.buf) || new Uint8Array(0);
    const C = TYPED[a.type] || Float32Array;
    const item = a.size * C.BYTES_PER_ELEMENT;
    const stride = a.stride || item;
    const n = src.byteLength >= a.off + item ? Math.floor((src.byteLength - a.off - item) / stride) + 1 : 0;
    const out = new C(n * a.size);
    const ob = new Uint8Array(out.buffer);
    if (stride === item) ob.set(src.subarray(a.off, a.off + n * item));
    else for (let i = 0; i < n; i++) ob.set(src.subarray(a.off + i * stride, a.off + i * stride + item), i * item);
    return out;
  };
  const attrOf = (a) => {
    const k = [a.buf, a.type, a.size, a.norm, a.stride, a.off, a.div, a.int].join(',');
    let e = attrCache.get(k);
    if (!e) {
      const arr = unpack(a);
      const A = a.type === 0x140b ? new THREE.Float16BufferAttribute(arr, a.size, a.norm) : a.div ? new THREE.InstancedBufferAttribute(arr, a.size, a.norm, a.div) : new THREE.BufferAttribute(arr, a.size, a.norm);
      if (a.int) A.gpuType = THREE.IntType;
      A.name = 'recorded buffer ' + a.buf;
      e = { a, attr: A };
      attrCache.set(k, e);
    }
    return e.attr;
  };
  const indexCache = new Map();
  const indexArray = (buf, type) => {
    const src = raw.get(buf) || new Uint8Array(0);
    const C = type === 0x1405 ? Uint32Array : type === 0x1401 ? Uint8Array : Uint16Array;
    return new C(src.slice(0, src.byteLength - (src.byteLength % C.BYTES_PER_ELEMENT)).buffer);
  };
  const indexOf = (buf, type) => {
    const k = buf + ',' + type;
    if (!indexCache.has(k)) indexCache.set(k, new THREE.BufferAttribute(indexArray(buf, type), 1));
    return indexCache.get(k);
  };
  // a vertex buffer changed during the frame: refresh the attributes read from it
  const bufferChanged = (buf) => {
    for (const e of attrCache.values()) {
      if (e.a.buf !== buf) continue;
      const arr = unpack(e.a);
      if (arr.length === e.attr.array.length) { e.attr.array.set(arr); e.attr.needsUpdate = true; } else e.stale = true;
    }
    for (const [k, A] of indexCache) {
      if (Number(k.split(',')[0]) !== buf) continue;
      const arr = indexArray(buf, Number(k.split(',')[1]));
      if (arr.length === A.array.length) { A.array.set(arr); A.needsUpdate = true; } else indexCache.delete(k);
    }
  };

  // triangle strips and fans have no three.js mode: they become indexed triangles
  const toTriangles = (step) => {
    const ids = [];
    if (step.index) {
      const all = indexArray(step.index.buf, step.index.type);
      const s0 = step.index.offset / all.BYTES_PER_ELEMENT;
      for (let i = 0; i < step.count; i++) ids.push(all[s0 + i]);
    } else for (let i = 0; i < step.count; i++) ids.push(step.first + i);
    const out = [];
    if (step.mode === 5) for (let i = 2; i < ids.length; i++) out.push(...(i % 2 ? [ids[i - 1], ids[i - 2], ids[i]] : [ids[i - 2], ids[i - 1], ids[i]]));
    else for (let i = 2; i < ids.length; i++) out.push(ids[0], ids[i - 1], ids[i]);
    return out;
  };
  const objectOf = (step) => {
    if (step._obj && !step.attrs.some((a) => (attrCache.get([a.buf, a.type, a.size, a.norm, a.stride, a.off, a.div, a.int].join(',')) || {}).stale)) return step._obj;
    let geo;
    let mode = step.mode;
    if (step.placeholder) {
      const mn = step.placeholder.min;
      const mx = step.placeholder.max;
      geo = new THREE.BoxGeometry(mx[0] - mn[0] || 1e-3, mx[1] - mn[1] || 1e-3, mx[2] - mn[2] || 1e-3);
      geo.translate((mx[0] + mn[0]) / 2, (mx[1] + mn[1]) / 2, (mx[2] + mn[2]) / 2);
      mode = 4;
    } else {
      geo = step.instances ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
      for (const a of step.attrs) {
        const k = [a.buf, a.type, a.size, a.norm, a.stride, a.off, a.div, a.int].join(',');
        const e = attrCache.get(k);
        if (e && e.stale) attrCache.delete(k);
        geo.setAttribute(a.name, attrOf(a));
      }
      if (step.mode === 5 || step.mode === 6) {
        const ids = toTriangles(step);
        geo.setIndex(new THREE.BufferAttribute(Math.max(0, ...ids) > 65535 ? new Uint32Array(ids) : new Uint16Array(ids), 1));
        geo.setDrawRange(0, ids.length);
        mode = 4;
      } else if (step.index) {
        geo.setIndex(indexOf(step.index.buf, step.index.type));
        geo.setDrawRange(step.index.offset / geo.index.array.BYTES_PER_ELEMENT, step.count);
      } else geo.setDrawRange(step.first, step.count);
      if (step.instances) geo.instanceCount = step.instances;
    }
    const det = step.model ? new THREE.Matrix4().fromArray(step.model).determinant() : 1;
    const s = p.materials[step.material].state;
    let side = THREE.DoubleSide;
    if (s.cull) {
      const flip = (s.cull.front === 0x0900) !== (s.cull.face === 0x0404);
      side = flip !== (mode === 4 && det < 0) ? THREE.BackSide : THREE.FrontSide;
    }
    const mat = materialOf(step.material, side);
    const O = mode === 0 ? THREE.Points : mode === 1 ? THREE.LineSegments : mode === 2 ? THREE.LineLoop : mode === 3 ? THREE.Line : THREE.Mesh;
    const obj = new O(geo, mat);
    obj.frustumCulled = false;
    obj.matrixAutoUpdate = false;
    obj.matrixWorldAutoUpdate = false;
    if (step.model) obj.matrixWorld.fromArray(step.model);
    obj.matrix.copy(obj.matrixWorld);
    obj.name = (step.sceneNode || 'draw') + ' (frame ' + step.frame + ', call ' + step.cmd + ')';
    step._obj = obj;
    return obj;
  };

  // render targets: each recorded framebuffer as a three.js WebGLRenderTarget
  const targets = new Map();
  const targetOf = (fb) => {
    if (targets.has(fb)) return targets.get(fb);
    const rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, count: fbColors.get(fb) || 1 });
    for (const t of rt.textures || [rt.texture]) t.generateMipmaps = false;
    renderer.setRenderTargetFramebuffer(rt, get('fb', fb));
    targets.set(fb, rt);
    return rt;
  };
  const setTarget = (fb, viewport, scissor) => {
    if (!fb) {
      renderer.setRenderTarget(null);
      renderer.setViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
      renderer.setScissorTest(!!scissor);
      if (scissor) renderer.setScissor(scissor[0], scissor[1], scissor[2], scissor[3]);
      return;
    }
    const rt = targetOf(fb);
    rt.viewport.set(viewport[0], viewport[1], viewport[2], viewport[3]);
    const sc = scissor || viewport;
    rt.scissor.set(sc[0], sc[1], sc[2], sc[3]);
    rt.scissorTest = !!scissor;
    renderer.setRenderTarget(rt);
  };

  // ---- live input: uniforms DEA measured following the pointer, the scroll or the window size -----------------------------
  // value = scale × input + offset, the input eased per frame the way the site eased it (pipeline.json "inputs")
  const inputs = (p.inputs || []).filter((m) => m.kind !== 'clock');
  const inputsOf = new Map();
  for (const m of inputs) { if (!inputsOf.has(m.program)) inputsOf.set(m.program, []); inputsOf.get(m.program).push(m); }
  const live = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, vx: 0, vy: 0, scroll: 0, width: p.viewport ? p.viewport.w : p.canvas.cssW || p.canvas.w, height: p.viewport ? p.viewport.h : p.canvas.cssH || p.canvas.h };
  // start where the recording was: the eased state of each input begins at its recorded value
  const eased = new Map();
  const live0 = Object.assign({}, live);
  const signalOf = (m, L = live) => {
    if (m.kind === 'pointer') return m.axis === 'y' ? L.y : L.x;
    if (m.kind === 'pointer-velocity') return m.axis === 'y' ? L.vy : L.vx;
    if (m.kind === 'scroll') return m.lo != null ? Math.min(m.hi, Math.max(m.lo, L.scroll)) : L.scroll;
    if (m.kind === 'viewport') return m.axis === 'height' ? L.height : m.axis === 'aspect' ? L.width / L.height : L.width;
    return 0;
  };
  // The fits are linear (value = scale × input + offset) and only as good as their r: written as absolute values they put
  // every fitted component at its regression line, residual and all, the moment the first input arrives (a model matrix
  // whose components are each set from their own line is no rotation any more, and the picture goes). So the input
  // moves the recorded value by what the fit says the move changes: recorded + scale × (input − the input at rest).
  const delta = (m, e, e2) => {
    const cl = (v, lo, hi) => (lo != null && hi != null ? Math.min(hi, Math.max(lo, v)) : v);
    const d = m.scale * (cl(e, m.lo, m.hi) - cl(signalOf(m, live0), m.lo, m.hi)) + (m.axis2 ? m.scale2 * (cl(e2 == null ? 0.5 : e2, m.lo2, m.hi2) - cl(0.5, m.lo2, m.hi2)) : 0);
    // and never by more than the value was seen to move while the probe watched
    return m.span != null ? Math.max(-m.span, Math.min(m.span, d)) : d;
  };

  const follow = new Map();
  const followed = (key, cur, d) => {
    const st = follow.get(key);
    const base = st && st.w === cur ? st.b : cur;
    const w = base + d;
    follow.set(key, { b: base, w });
    return w;
  };
  let inputTouched = !!options.liveFromStart;
  const stepInputs = () => {
    live.vx = live.x - live.px; live.vy = live.y - live.py; live.px = live.x; live.py = live.y;
    for (const m of inputs) {
      const k = m.program + '|' + m.uniform + '|' + m.component;
      const s = signalOf(m);
      const e = eased.has(k) ? eased.get(k) : signalOf(m, live0);
      eased.set(k, e + (m.k == null ? 1 : m.k) * (s - e));
      if (m.axis2) {
        const s2 = m.axis2 === 'y' ? live.y : live.x;
        const e2 = eased.has(k + '|2') ? eased.get(k + '|2') : 0.5;
        eased.set(k + '|2', e2 + (m.k == null ? 1 : m.k) * (s2 - e2));
      }
    }
  };
  // matrices followed per draw ("name#drawIndex"): the model, view and projection matrices of one draw of the frame
  const matIn = new Map();
  for (const m of inputs) {
    const h = m.uniform.indexOf('#');
    if (h < 0) continue;
    const ord = Number(m.uniform.slice(h + 1));
    if (!matIn.has(ord)) matIn.set(ord, { program: m.program, items: [] });
    matIn.get(ord).items.push({ name: m.uniform.slice(0, h), m });
  }
  for (const fr of p.frames) { let n = 0; for (const s of fr.steps) if (s.op === 'draw') s._ord = n++; }
  // A matrix moved component by component is no rotation any more (a column gets longer, two columns lean on each other)
  // and the object shears, flips or vanishes. After the inputs have moved a matrix its 3x3 block is made orthogonal again,
  // each column keeping the length it had in the recording, so what a fit can do to it is turn and slide it.
  const tidy3 = (el, base, stride) => {
    const col = (a, i) => [a[i * stride], a[i * stride + 1], a[i * stride + 2]];
    const len = (v) => Math.hypot(v[0], v[1], v[2]);
    const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const b = [col(base, 0), col(base, 1), col(base, 2)];
    const L3 = b.map(len);
    if (L3.some((l) => !(l > 1e-9))) return;
    const n0 = norm(col(el, 0));
    let c1 = col(el, 1);
    const d01 = c1[0] * n0[0] + c1[1] * n0[1] + c1[2] * n0[2];
    c1 = [c1[0] - d01 * n0[0], c1[1] - d01 * n0[1], c1[2] - d01 * n0[2]];
    if (!(len(c1) > 1e-9)) return;
    const n1 = norm(c1);
    let n2 = [n0[1] * n1[2] - n0[2] * n1[1], n0[2] * n1[0] - n0[0] * n1[2], n0[0] * n1[1] - n0[1] * n1[0]];
    const b2 = [b[0][1] * b[1][2] - b[0][2] * b[1][1], b[0][2] * b[1][0] - b[0][0] * b[1][2], b[0][0] * b[1][1] - b[0][1] * b[1][0]];
    if (b2[0] * b[2][0] + b2[1] * b[2][1] + b2[2] * b[2][2] < 0) n2 = [-n2[0], -n2[1], -n2[2]];
    [n0, n1, n2].forEach((n, i) => { for (let k = 0; k < 3; k++) el[i * stride + k] = n[k] * L3[i]; });
  };
  const applyMatrices = (step, obj, U, dirtySet) => {
    if (!inputTouched || !matIn.size) return;
    const L = matIn.get(step._ord);
    if (!L || L.program !== p.materials[step.material].program) return;
    const dv = (m) => { const k = m.program + '|' + m.uniform + '|' + m.component; const e = eased.get(k); if (e == null) return NaN; return delta(m, e, eased.get(k + '|2')); };
    const cam = step.camera != null ? cameras[step.camera] : null;
    const mv = (name) => L.items.filter((x) => x.name === name);
    if (cam) {
      if (!cam._rec) cam._rec = { view: cam.matrixWorldInverse.elements.slice(), proj: cam.projectionMatrix.elements.slice() };
      for (const x of mv('viewMatrix')) { const d = dv(x.m); if (Number.isFinite(d)) cam.matrixWorldInverse.elements[x.m.component] = cam._rec.view[x.m.component] + d; }
      if (mv('viewMatrix').length) { tidy3(cam.matrixWorldInverse.elements, cam._rec.view, 4); cam.matrixWorld.copy(cam.matrixWorldInverse).invert(); cam.matrix.copy(cam.matrixWorld); }
      // a projection keeps its depth range and its field of view's proportions: the sideways shift (8, 9) follows the input,
      // the two scales (0, 5) by at most 15 %
      for (const x of mv('projectionMatrix')) {
        const c = x.m.component;
        const d = dv(x.m);
        if (!Number.isFinite(d)) continue;
        const base = cam._rec.proj[c];
        if (c === 8 || c === 9) cam.projectionMatrix.elements[c] = base + d;
        else if (c === 0 || c === 5) cam.projectionMatrix.elements[c] = base + Math.max(-0.15 * Math.abs(base), Math.min(0.15 * Math.abs(base), d));
      }
      if (mv('projectionMatrix').length) cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }
    if (!obj._rec) obj._rec = obj.matrixWorld.clone();
    if (mv('modelMatrix').length || mv('modelViewMatrix').length) obj.matrixWorld.copy(obj._rec);
    for (const x of mv('modelMatrix')) { const d = dv(x.m); if (Number.isFinite(d)) obj.matrixWorld.elements[x.m.component] += d; }
    if (mv('modelMatrix').length) tidy3(obj.matrixWorld.elements, obj._rec.elements, 4);
    if (cam && mv('modelViewMatrix').length) {
      const MVm = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, obj.matrixWorld);
      const MV0 = MVm.elements.slice();
      for (const x of mv('modelViewMatrix')) { const d = dv(x.m); if (Number.isFinite(d)) MVm.elements[x.m.component] += d; }
      tidy3(MVm.elements, MV0, 4);
      obj.matrixWorld.multiplyMatrices(cam.matrixWorld, MVm);
    }
    if (mv('modelMatrix').length || mv('modelViewMatrix').length) obj.matrix.copy(obj.matrixWorld);
    const touched = new Set();
    for (const x of L.items) {
      if (/^(modelMatrix|viewMatrix|projectionMatrix|modelViewMatrix)$/.test(x.name)) continue;
      const u = U[x.name];
      const d = dv(x.m);
      if (!u || !Number.isFinite(d)) continue;
      const fk = 'M' + step._ord + '|' + x.name + '|' + x.m.component;
      if (Array.isArray(u.value)) { u.value = u.value.slice(); u.value[x.m.component] = followed(fk, u.value[x.m.component], d); }
      else if (u.value && u.value.elements) u.value.elements[x.m.component] = followed(fk, u.value.elements[x.m.component], d);
      if (x.name === 'normalMatrix') touched.add(x.name);
      dirtySet.add(x.name);
    }
    for (const n of touched) {
      const u = U[n];
      const el = u.value && u.value.elements ? u.value.elements : Array.isArray(u.value) ? u.value : null;
      if (!el || el.length !== 9) continue;
      const base = el.map((v, c) => { const st = follow.get('M' + step._ord + '|' + n + '|' + c); return st ? st.b : v; });
      tidy3(el, base, 3);
      el.forEach((v, c) => { const k = 'M' + step._ord + '|' + n + '|' + c; const st = follow.get(k); if (st) follow.set(k, { b: st.b, w: v }); });
    }
  };
  const applyInputs = (programId, U, dirtySet) => {
    if (!inputTouched) return;
    const list = inputsOf.get(programId);
    if (!list) return;
    for (const m of list) {
      const u = U[m.uniform];
      if (!u) continue;
      const ek = m.program + '|' + m.uniform + '|' + m.component;
      const d = delta(m, eased.get(ek), eased.get(ek + '|2'));
      if (!Number.isFinite(d)) continue;
      const fk = 'U' + ek;
      if (Array.isArray(u.value)) { u.value = u.value.slice(); u.value[m.component] = followed(fk, u.value[m.component], d); }
      else if (u.value && typeof u.value === 'object' && 'x' in u.value) u.value.setComponent(m.component, followed(fk, u.value.getComponent(m.component), d));
      else u.value = followed(fk, u.value, d);
      dirtySet.add(m.uniform);
    }
  };
  const setInput = (o) => {
    inputTouched = true;
    for (const k of ['x', 'y', 'scroll', 'width', 'height']) if (o[k] != null && Number.isFinite(+o[k])) live[k] = +o[k];
  };

  // ---- resize: the drawing buffer, the screen-sized render targets (full, half, quarter ... size) and their viewports ----
  const base = { w: p.canvas.w, h: p.canvas.h };
  const size = { w: base.w, h: base.h };
  const ratioOf = (w, h) => { for (let n = 0; n <= 8; n++) { const d = 2 ** n; if (Math.abs(w - base.w / d) <= 1.01 && Math.abs(h - base.h / d) <= 1.01) return d; } return 0; };
  const screenTex = [];
  for (const T of R.textures) {
    if (T.missing || T.target !== 0x0de1 || T.levels.length !== 1 || T.levels[0].level !== 0) continue;
    const d = ratioOf(T.levels[0].w, T.levels[0].h);
    if (d) screenTex.push({ T, d });
  }
  const screenRb = R.renderbuffers.filter((r) => r.w && ratioOf(r.w, r.h)).map((r) => ({ r, d: ratioOf(r.w, r.h) }));
  const screenTexIds = new Set(screenTex.map((s) => s.T.id));
  const screenFb = new Set(R.framebuffers.filter((F) => F.atts.some((a) => (a.tex && screenTexIds.has(a.tex)) || (a.rb && screenRb.some((s) => s.r.id === a.rb)))).map((F) => F.id));
  const scaleVp = (target, v) => {
    if (!v || (size.w === base.w && size.h === base.h) || (target && !screenFb.has(target))) return v;
    const sx = size.w / base.w; const sy = size.h / base.h;
    return [Math.round(v[0] * sx), Math.round(v[1] * sy), Math.round(v[2] * sx), Math.round(v[3] * sy)];
  };
  const resize = (W, H) => {
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
    if (W === size.w && H === size.h) return;
    size.w = W; size.h = H;
    canvas.width = W; canvas.height = H;
    renderer.setSize(W, H, false);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    resetUnpack();
    for (const s of screenTex) {
      const L = s.T.levels[0];
      const al = L.alloc || [L.upFmt, L.upType];
      if (!al[0]) continue;
      const [i, f, ty] = sized(L.ifmt, al[0], al[1]);
      gl.bindTexture(gl.TEXTURE_2D, get('tex', s.T.id));
      try { gl.texImage2D(gl.TEXTURE_2D, 0, i, Math.max(1, Math.round(W / s.d)), Math.max(1, Math.round(H / s.d)), 0, f, ty, null); } catch (e) { fail('resize texture ' + s.T.id + ': ' + e.message); }
    }
    for (const s of screenRb) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, get('rb', s.r.id));
      const w = Math.max(1, Math.round(W / s.d)); const h = Math.max(1, Math.round(H / s.d));
      if (s.r.samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s.r.samples, s.r.internalformat, w, h);
      else gl.renderbufferStorage(gl.RENDERBUFFER, s.r.internalformat, w, h);
    }
    // the site's cameras keep their field of view: only the horizontal scale follows the new aspect
    const k = (base.w / base.h) / (W / H);
    p.cameras.forEach((c, ci) => {
      const cam = cameras[ci];
      cam.projectionMatrix.fromArray(c.projection);
      cam.projectionMatrix.elements[0] *= k;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    });
    renderer.resetState();
  };

  // ---- live mode holds the recorded moment still --------------------------------------------------------------------
  // The recording has two frames so ping-pong simulations keep their read/write order; but values that differ between the
  // two (a camera mid-move, an intro fading in) would flip back and forth every frame and the picture would shake. Live,
  // every frame takes those values from the last recorded frame (the one DEA scored); clocks still follow real time and
  // the simulation passes still run forward on the live render targets.
  if (options.animate !== false && options.steady !== false && p.frames.length > 1) {
    const last = p.frames[p.frames.length - 1].steps;
    const keyed = (steps) => { const seen = new Map(); return steps.map((s) => { if (s.op !== 'draw') return null; const k = s.material + '#' + (seen.get(s.material) || 0); seen.set(s.material, (seen.get(s.material) || 0) + 1); return k; }); };
    const lastKeys = keyed(last);
    const byKey = new Map(lastKeys.map((k, i) => [k, last[i]]).filter(([k]) => k));
    const plain = (v) => typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'));
    for (const fr of p.frames.slice(0, -1)) {
      const ks = keyed(fr.steps);
      fr.steps.forEach((s, i) => {
        const L = ks[i] && byKey.get(ks[i]);
        if (!L) return;
        for (const [k, v] of Object.entries(L.uniforms)) if (plain(v) && (k in s.uniforms ? plain(s.uniforms[k]) : true)) s.uniforms[k] = v;
        if (L.camera != null) s.camera = L.camera;
        if (L.model) s.model = L.model;
      });
    }
  }

  // ---- steps -----------------------------------------------------------------------------------------------------------
  const clocks = p.clocks || [];
  const animate = options.animate !== false;
  const t0 = performance.now();
  const passOff = new Set();
  const draw = (step) => {
    const mi = step.material;
    const m = p.materials[mi];
    const U = uniformSets[mi];
    for (const k of dirty[mi]) if (!(k in step.uniforms)) setUniform(U, k, m.uniforms[k]);
    dirty[mi].clear();
    for (const [k, v] of Object.entries(step.uniforms)) { setUniform(U, k, v); dirty[mi].add(k); }
    if (animate) for (const c of clocks) if (c.program === m.program && U[c.uniform]) { U[c.uniform].value = c.base + c.rate * (performance.now() - t0); dirty[mi].add(c.uniform); }
    if (animate) applyInputs(m.program, U, dirty[mi]);
    const obj = objectOf(step);
    if (animate) applyMatrices(step, obj, U, dirty[mi]);
    obj.material.uniformsNeedUpdate = true;
    const cm = m.state.colorMask;
    maskOverride = cm.some(Boolean) && !cm.every(Boolean) ? cm : null;
    setTarget(step.target, scaleVp(step.target, step.viewport), scaleVp(step.target, step.scissor));
    renderer.render(obj, step.camera == null ? plainCamera : cameras[step.camera]);
    maskOverride = null;
  };
  const clear = (step) => {
    setTarget(step.target, [0, 0, size.w, size.h], scaleVp(step.target, step.scissor));
    gl.colorMask(step.colorMask[0], step.colorMask[1], step.colorMask[2], step.colorMask[3]);
    gl.depthMask(step.depthMask);
    gl.stencilMask(step.stencilMask);
    const sc = scaleVp(step.target, step.scissor);
    if (sc) { gl.enable(gl.SCISSOR_TEST); gl.scissor(sc[0], sc[1], sc[2], sc[3]); } else gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(step.color[0], step.color[1], step.color[2], step.color[3]);
    gl.clearDepth(step.depth);
    gl.clearStencil(step.stencil);
    gl.clear(step.bits);
    renderer.resetState();
  };
  const rawGl = (step) => {
    const b = step.bind || {};
    if (b.buf) {
      // vertex data changed during the frame: update the CPU copy and the three.js attributes read from it
      const a = step.args;
      const cur = raw.get(b.buf) || new Uint8Array(0);
      const src = arg(a[step.fn === 'bufferData' ? 1 : 2]);
      if (step.fn === 'bufferData') {
        if (typeof src === 'number') raw.set(b.buf, new Uint8Array(src));
        else if (src) raw.set(b.buf, new Uint8Array(src.buffer, src.byteOffset, src.byteLength).slice());
      } else if (src && src.buffer) {
        const dst = Number(a[1]);
        const E = src.BYTES_PER_ELEMENT || 1;
        const so = a[3] ? Number(a[3]) * E : 0;
        const len = a[4] ? Number(a[4]) * E : src.byteLength - so;
        const bytes = new Uint8Array(src.buffer, src.byteOffset + so, len);
        const next = dst + len > cur.byteLength ? (() => { const n = new Uint8Array(dst + len); n.set(cur); return n; })() : cur;
        next.set(bytes, dst);
        raw.set(b.buf, next);
      }
      bufferChanged(b.buf);
      return;
    }
    gl.bindVertexArray(null);
    if (b.tex !== undefined) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(b.texTarget, get('tex', b.tex)); }
    if (b.readFb !== undefined) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, get('fb', b.readFb));
    if (b.drawFb !== undefined) gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, get('fb', b.drawFb));
    if (b.fb !== undefined) gl.bindFramebuffer(gl.FRAMEBUFFER, get('fb', b.fb));
    if (b.rb !== undefined) gl.bindRenderbuffer(gl.RENDERBUFFER, get('rb', b.rb));
    resetUnpack();
    for (const [k, v] of Object.entries(step.store || {})) gl.pixelStorei(+k, v);
    try {
      let args = step.args.map(arg);
      if (webgl1 && (step.fn === 'texImage2D') && args.length === 9) { const [i, f, ty] = sized(args[2], args[6], args[7]); args[2] = i; args[6] = f; args[7] = ty; }
      if (step.fn === 'texImage2D' && args.length === 6) { /* (target, level, ifmt, format, type, source) */ }
      gl[step.fn](...args);
    } catch (e) { fail(step.fn + ': ' + e.message); }
    resetUnpack();
    renderer.resetState();
  };
  const runFrame = (i) => {
    for (const step of p.frames[i].steps) {
      if (passOff.has(step.pass)) continue;
      if (step.op === 'draw') draw(step);
      else if (step.op === 'clear') clear(step);
      else rawGl(step);
      if (options.debug) { const e = gl.getError(); if (e) fail('WebGL error 0x' + e.toString(16) + ' at frame ' + i + ' ' + step.op + ' pass ' + step.pass + (step.op === 'draw' ? ' material ' + step.material + ' (' + p.materials[step.material].name + ') call ' + step.cmd : step.fn || '')); }
    }
    const e = gl.getError();
    if (e) fail('WebGL error 0x' + e.toString(16) + ' after frame ' + i);
  };
  let frame = 0;
  let raf = 0;
  let unlisten = null;
  const api = {
    renderer,
    gl,
    pipeline: p,
    errors,
    cameras,
    targets,
    get materials() { return [...materialVariants.values()]; },
    uniforms: uniformSets,
    passes: p.passes,
    inputs,
    renderFrames(n = p.frames.length) { for (let k = 0; k < n; k++) { if (animate) stepInputs(); runFrame(frame); frame = (frame + 1) % p.frames.length; } },
    start() {
      const loop = () => { api.renderFrames(1); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
      if (options.listen !== false && typeof window !== 'undefined') {
        // real pointer, touch, scroll and window size drive the measured uniforms
        const onMove = (e) => { const t = e.touches ? e.touches[0] : e; if (t) setInput({ x: t.clientX / innerWidth, y: t.clientY / innerHeight }); };
        const canScroll = () => document.documentElement.scrollHeight > innerHeight + 2;
        let wheel = 0;
        const onWheel = (e) => { if (!canScroll()) { wheel = Math.max(0, wheel + e.deltaY); setInput({ scroll: wheel }); } };
        const onScroll = () => setInput({ scroll: scrollY });
        const onResize = () => { setInput({ width: innerWidth, height: innerHeight }); if (options.resize !== false) api.fit(); };
        addEventListener('pointermove', onMove, { passive: true });
        addEventListener('touchmove', onMove, { passive: true });
        addEventListener('wheel', onWheel, { passive: true });
        addEventListener('scroll', onScroll, { passive: true });
        addEventListener('resize', onResize);
        unlisten = () => { for (const [n, f] of [['pointermove', onMove], ['touchmove', onMove], ['wheel', onWheel], ['scroll', onScroll], ['resize', onResize]]) removeEventListener(n, f); };
      }
    },
    stop() { cancelAnimationFrame(raf); if (unlisten) unlisten(); unlisten = null; },
    /** drive the input yourself: x, y (0..1 of the window), scroll (px), width, height (CSS px) */
    setInput,
    /** resize the drawing buffer, the screen-sized render targets and the cameras' aspect */
    resize,
    /** fit the canvas to its element's size on screen (what a window resize calls) */
    fit() { const r = canvas.getBoundingClientRect(); if (r.width && r.height) resize(r.width * (options.pixelRatio || 1), r.height * (options.pixelRatio || 1)); },
    get size() { return { w: size.w, h: size.h }; },
    setPassEnabled(i, on) { if (on) passOff.delete(i); else passOff.add(i); },
    setUniform(materialIndex, name, v) { setUniform(uniformSets[materialIndex], name, v); p.materials[materialIndex].uniforms[name] = v; },
  };
  return api;
}

export async function mountRebuild(el = document.body, options = {}) {
  const data = await loadPipeline(options.base || './rebuild/');
  const b = data.pipeline.canvas;
  const c = document.createElement('canvas');
  const vp = data.pipeline.viewport;
  // a canvas that filled the window when DEA recorded it fills the window here too, and follows its size
  const full = vp && b.x <= 1 && b.y <= 1 && Math.abs(b.cssW - vp.w) <= 2 && Math.abs(b.cssH - vp.h) <= 2;
  c.style.cssText = full
    ? 'position:fixed;pointer-events:none;left:0;top:0;width:100vw;height:100vh'
    : 'position:absolute;pointer-events:none;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.cssW + 'px;height:' + b.cssH + 'px';
  if (!full) options = Object.assign({ resize: false }, options);
  el.appendChild(c);
  const rb = createRebuild(c, data, options);
  if (full && !options.once) rb.fit();
  if (options.once) rb.renderFrames();
  else rb.start();
  return rb;
}
`;
