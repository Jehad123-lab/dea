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
//   rb.start();                                     // animate: frames alternate, clock uniforms follow real time
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
    const obj = objectOf(step);
    obj.material.uniformsNeedUpdate = true;
    const cm = m.state.colorMask;
    maskOverride = cm.some(Boolean) && !cm.every(Boolean) ? cm : null;
    setTarget(step.target, step.viewport, step.scissor);
    renderer.render(obj, step.camera == null ? plainCamera : cameras[step.camera]);
    maskOverride = null;
  };
  const clear = (step) => {
    setTarget(step.target, [0, 0, p.canvas.w, p.canvas.h], step.scissor);
    gl.colorMask(step.colorMask[0], step.colorMask[1], step.colorMask[2], step.colorMask[3]);
    gl.depthMask(step.depthMask);
    gl.stencilMask(step.stencilMask);
    if (step.scissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(step.scissor[0], step.scissor[1], step.scissor[2], step.scissor[3]); } else gl.disable(gl.SCISSOR_TEST);
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
    renderFrames(n = p.frames.length) { for (let k = 0; k < n; k++) { runFrame(frame); frame = (frame + 1) % p.frames.length; } },
    start() { const loop = () => { api.renderFrames(1); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); },
    stop() { cancelAnimationFrame(raf); },
    setPassEnabled(i, on) { if (on) passOff.delete(i); else passOff.add(i); },
    setUniform(materialIndex, name, v) { setUniform(uniformSets[materialIndex], name, v); p.materials[materialIndex].uniforms[name] = v; },
  };
  return api;
}

export async function mountRebuild(el = document.body, options = {}) {
  const data = await loadPipeline(options.base || './rebuild/');
  const b = data.pipeline.canvas;
  const c = document.createElement('canvas');
  c.style.cssText = 'position:absolute;pointer-events:none;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.cssW + 'px;height:' + b.cssH + 'px';
  el.appendChild(c);
  const rb = createRebuild(c, data, options);
  if (options.once) rb.renderFrames();
  else rb.start();
  return rb;
}
`;
