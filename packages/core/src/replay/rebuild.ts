// The editable rebuild of a recorded WebGL frame sequence (dea extract): the render graph the recording shows, turned
// into a three.js pipeline you can change. Every draw becomes a three.js object with a RawShaderMaterial (the site's
// own GLSL, one file per program), a BufferGeometry, a camera and a model matrix; every framebuffer becomes a
// WebGLRenderTarget; every pass is a list of steps in pipeline.json, in the site's order. What three.js has no words for
// (texture uploads during the frame, blits, mip generation, clears with masks) runs as a labelled raw WebGL step.
//
// Labels: the structure (passes, targets, programs, state, uniform values, cameras, matrices) is read from the
// recording (Verified). Vertex buffers and texture pixels are the recorded bytes, named "recorded" in pipeline.json
// wherever they are used; with --own-assets the site's images become placeholders and large meshes become coarse stand-ins (proxyMesh) or boxes.

import { type Arg, type CaptureDoc, type Cmd, numbers, TEX_GRID, type VaoAttr } from './graph.ts';
import { invert, mul } from './scene.ts';

export interface DrawState {
  blend: null | { src: number; dst: number; srcA: number; dstA: number; eq: number; eqA: number; color: number[] };
  depth: { test: boolean; write: boolean; func: number };
  cull: null | { face: number; front: number };
  colorMask: boolean[];
  stencil: null | { func: number; ref: number; mask: number; fail: number; zfail: number; zpass: number; write: number };
  polygonOffset: null | number[];
  alphaToCoverage: boolean;
}

export interface GeometryAttr {
  name: string;
  buf: number;
  size: number;
  type: number;
  norm: boolean;
  stride: number;
  off: number;
  div: number;
  int: boolean;
}

export type UniformValue = number | number[] | { tex: number; kind: string } | Array<{ tex: number; kind: string }>;

export interface DrawStep {
  op: 'draw';
  pass: number;
  frame: number;
  cmd: number;
  material: number;
  mode: number;
  first: number;
  count: number;
  instances: number;
  index: null | { buf: number; type: number; offset: number };
  attrs: GeometryAttr[];
  target: number;
  viewport: number[];
  scissor: number[] | null;
  camera: number | null;
  model: number[] | null;
  /** uniform buffers bound to binding points for this draw (the buffer's bytes are carried in the recording) */
  ubos?: Array<{ i: number; buf: number; start: number; size: number }>;
  /** tape frames: for each uniform that follows the pointer, which of the frame's sets of it this draw saw (see tape.ts) */
  tk?: Record<string, number>;
  /** uniforms whose value differs from the material's defaults for this draw */
  uniforms: Record<string, UniformValue>;
  /** with --own-assets: a box of this size stands in for the mesh */
  placeholder?: { min: number[]; max: number[] };
  /** with --own-assets: a coarse stand-in of the mesh's shape (vertex clustering, see proxyMesh), drawn instead of the box */
  /** --own-assets stand-in: clustered positions, triangles, and each other float vertex attribute averaged per cluster */
  proxy?: { pos: number[]; idx: number[]; attrs?: Record<string, { size: number; data: number[] }> };
  /** a mesh of the recovered scene (scene.glb) drawn here */
  sceneNode?: string;
}

export interface ClearStep {
  op: 'clear';
  pass: number;
  frame: number;
  target: number;
  bits: number;
  color: number[];
  depth: number;
  stencil: number;
  colorMask: boolean[];
  depthMask: boolean;
  stencilMask: number;
  scissor: number[] | null;
}

/** a WebGL call three.js has no word for, run as recorded on the pipeline's own objects */
export interface GlStep {
  op: 'gl';
  pass: number;
  frame: number;
  /** the command's index in its recorded frame (the pointer tape finds its uploads by it) */
  cmd?: number;
  fn: string;
  args: Arg[];
  /** objects to bind first */
  bind: {
    tex?: number;
    texTarget?: number;
    fb?: number;
    readFb?: number;
    drawFb?: number;
    rb?: number;
    buf?: number;
    bufTarget?: number;
    make?: { kind: 'tex' | 'fb' | 'rb'; id: number };
  };
  store?: Record<string, number>;
  why: string;
}

export type Step = DrawStep | ClearStep | GlStep;

export interface RebuildMaterial {
  id: number;
  program: number;
  name: string;
  vertex: string;
  fragment: string;
  state: DrawState;
  uniforms: Record<string, UniformValue>;
  /** uniforms three.js sets from the camera and the object (not in `uniforms`) */
  builtins: string[];
  /** uniform blocks the program declares and the binding point each one reads */
  blocks?: Array<{ name: string; binding: number }>;
}

export interface RebuildCamera {
  id: number;
  /** column-major view matrix (world -> camera) */
  view: number[];
  projection: number[];
  orthographic: boolean;
  draws: number;
}

export interface PipelineDoc {
  version: 1;
  /** the WebGL version of the recorded context (the rebuild always runs on WebGL2 through three.js) */
  glVersion: 1 | 2;
  url: string;
  at: string;
  /** the binary every { o, l } refers to, relative to this file */
  data: string;
  canvas: CaptureDoc['canvas'];
  attrs: Record<string, unknown>;
  extensions: string[];
  resources: Pick<CaptureDoc['snap'], 'textures' | 'renderbuffers' | 'samplers' | 'framebuffers' | 'buffers'>;
  materials: RebuildMaterial[];
  cameras: RebuildCamera[];
  passes: Array<{ index: number; frame: number; role: string; why: string; target: string; programs: string[] }>;
  frames: Array<{ steps: Step[] }>;
  /** the last `n` frames are the pointer tape (see tape.ts): played while the pointer moves, uploads re-anchored to the live pointer's path */
  tape?: { n: number; move: number; still: number; drag?: boolean; w: number; h: number; anchors: unknown[]; uniforms?: unknown[] };
  /** after the tape: the scroll tape (see scrolltape.ts), `n` frames, the stops with tape-relative frame indices */
  scroll?: { n: number; k: number; ratio: number; aligned: boolean; stops: Array<{ sc: number; wh: number; f0: number; f1: number }> };
  clocks: Array<{ program: number; uniform: string; base: number; rate: number }>;
  /** uniforms that follow the pointer, scroll or window size: value = scale × eased input + offset */
  inputs: import('./inputs.ts').InputMap[];
  /** the window size (CSS px) when the recording was made */
  viewport: { w: number; h: number } | null;
  toneMappingExposure: number | null;
  labels: Record<string, string>;
}

export interface RebuildStats {
  draws: number;
  materials: number;
  programs: number;
  cameras: number;
  renderTargets: number;
  glSteps: number;
  clears: number;
  /** draws whose recorded matrices three.js reproduces from the camera and the model matrix */
  matricesExact: number;
  matricesOff: Array<{ frame: number; cmd: number; what: string }>;
  recordedBuffers: number;
  recordedBufferBytes: number;
  recordedTextures: number;
  recordedTextureBytes: number;
  placeholders: number;
  /** of those, how many are drawn as a coarse stand-in of their shape rather than a box */
  proxies: number;
  /** why each of the rest is still a box (e.g. "mode 0", "index buffer unreadable", "too few triangles left after clustering") */
  boxReasons: Record<string, number>;
  skipped: Record<string, number>;
}

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const MATRIX_BUILTINS = new Set(['modelMatrix', 'modelViewMatrix', 'projectionMatrix', 'viewMatrix', 'normalMatrix', 'cameraPosition', 'isOrthographic']);
const SAMPLER_KIND: Record<number, string> = {
  35678: '2d',
  35682: '2d',
  36298: '2d',
  36306: '2d',
  35680: 'cube',
  36293: 'cube',
  36300: 'cube',
  36308: 'cube',
  35679: '3d',
  36299: '3d',
  36307: '3d',
  36289: 'array',
  36292: 'array',
  36303: 'array',
  36311: 'array',
};
const COMPONENTS: Record<number, number> = {
  5126: 1,
  35664: 2,
  35665: 3,
  35666: 4,
  5124: 1,
  35667: 2,
  35668: 3,
  35669: 4,
  5125: 1,
  36294: 2,
  36295: 3,
  36296: 4,
  35670: 1,
  35671: 2,
  35672: 3,
  35673: 4,
  35674: 4,
  35675: 9,
  35676: 16,
  35685: 6,
  35686: 8,
  35687: 6,
  35688: 12,
  35689: 8,
  35690: 12,
};
const MAT_COLS: Record<number, number> = { 35674: 2, 35675: 3, 35676: 4, 35685: 2, 35686: 2, 35687: 3, 35688: 3, 35689: 4, 35690: 4 };
const DRAWS = new Set([
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'drawRangeElements',
  'ext:ANGLE_instanced_arrays.drawArraysInstancedANGLE',
  'ext:ANGLE_instanced_arrays.drawElementsInstancedANGLE',
]);
const TEX_CALLS = new Set([
  'texImage2D',
  'texSubImage2D',
  'texImage3D',
  'texSubImage3D',
  'texStorage2D',
  'texStorage3D',
  'compressedTexImage2D',
  'compressedTexSubImage2D',
  'compressedTexImage3D',
  'compressedTexSubImage3D',
  'copyTexImage2D',
  'copyTexSubImage2D',
  'copyTexSubImage3D',
  'generateMipmap',
  'texParameteri',
  'texParameterf',
]);
const IGNORE = new Set([
  'flush',
  'finish',
  'invalidateFramebuffer',
  'invalidateSubFramebuffer',
  'hint',
  'lineWidth',
  'getError',
  'readPixels',
  'fenceSync',
  'clientWaitSync',
  'waitSync',
  'deleteSync',
  'beginQuery',
  'endQuery',
  'deleteQuery',
  'createQuery',
  'validateProgram',
]);

const ref = (a: Arg, kind: string): number => (a && typeof a === 'object' && !Array.isArray(a) && a.$ === kind ? Number(a.id) : 0);
const locOf = (a: Arg): { p: number; n: string } | null =>
  a && typeof a === 'object' && !Array.isArray(a) && a.$ === 'loc' ? { p: Number(a.p), n: String(a.n) } : null;
const texKind = (t: number) => (t === 0x8513 || (t >= 0x8515 && t <= 0x851a) ? 'cube' : t === 0x806f ? '3d' : t === 0x8c1a ? 'array' : '2d');

/**
 * WEBGL_multi_draw: one call that draws several ranges. Each range is the plain draw it stands for, so the rebuild gets
 * one three.js draw per range (the same state, geometry slice and uniforms).
 */
export function multiDrawParts(name: string, a: Arg[], bin: Uint8Array): Cmd[] | null {
  const m = /multiDraw(Elements|Arrays)(Instanced)?WEBGL$/.exec(name);
  if (!m) return null;
  const nums = (x: Arg, off: Arg) => numbers(x, bin).slice(Number(off) || 0);
  const out: Cmd[] = [];
  if (m[1] === 'Elements') {
    const counts = nums(a[1], a[2]);
    const offsets = nums(a[4], a[5]);
    const inst = m[2] ? nums(a[6], a[7]) : null;
    const n = Number(a[m[2] ? 8 : 6]) || counts.length;
    for (let i = 0; i < n && i < counts.length; i++) {
      if (!counts[i]) continue;
      out.push(
        inst ? ['drawElementsInstanced', a[0], counts[i], a[3], offsets[i] ?? 0, inst[i] ?? 1] : ['drawElements', a[0], counts[i], a[3], offsets[i] ?? 0],
      );
    }
  } else {
    const firsts = nums(a[1], a[2]);
    const counts = nums(a[3], a[4]);
    const inst = m[2] ? nums(a[5], a[6]) : null;
    const n = Number(a[m[2] ? 7 : 5]) || counts.length;
    for (let i = 0; i < n && i < counts.length; i++) {
      if (!counts[i]) continue;
      out.push(inst ? ['drawArraysInstanced', a[0], firsts[i] ?? 0, counts[i], inst[i] ?? 1] : ['drawArrays', a[0], firsts[i] ?? 0, counts[i]]);
    }
  }
  return out;
}

/** The 3×3 normal matrix three.js derives from a model-view matrix (inverse transpose of its upper 3×3). */
export function normalMatrixOf(mv: number[]): number[] | null {
  const [a, b, c, , d, e, f, , g, h, i] = mv;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!det || !Number.isFinite(det)) return null;
  const k = 1 / det;
  // inverse, then transposed
  return [
    (e * i - f * h) * k,
    (f * g - d * i) * k,
    (d * h - e * g) * k,
    (c * h - b * i) * k,
    (a * i - c * g) * k,
    (b * g - a * h) * k,
    (b * f - c * e) * k,
    (c * d - a * f) * k,
    (a * e - b * d) * k,
  ];
}

const close = (a: number[] | undefined, b: number[] | null | undefined, eps = 1e-3) =>
  Boolean(a && b && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps * Math.max(1, Math.abs(x))));

const slug = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'program';

/** "3 mesh(es) are stand-ins (3 coarse shapes, 0 boxes)": the --own-assets summary, from the stats (boxes were over-reported before) */
export function standinSummary(stats: Pick<RebuildStats, 'placeholders' | 'proxies'>): string {
  const shapes = stats.proxies ?? 0;
  const boxes = Math.max(0, stats.placeholders - shapes);
  return `${stats.placeholders} mesh(es) are stand-ins (${shapes} coarse shape${shapes === 1 ? '' : 's'}, ${boxes} box${boxes === 1 ? '' : 'es'})`;
}

/** cells per side of the bounding box when a mesh is clustered into its coarse stand-in */
export const PROXY_GRID = 16;

/**
 * The vertex ids of each triangle of a TRIANGLES, TRIANGLE_STRIP or TRIANGLE_FAN draw (indexed or not), read from the
 * recording; null if unreadable. Strips alternate winding like GL; an index equal to the type's max value is WebGL2's
 * fixed primitive restart (always on), so a strip or fan starts over after it.
 */
export function triangleIds(doc: CaptureDoc, bin: Uint8Array, step: Pick<DrawStep, 'mode' | 'first' | 'count' | 'index'>): Uint32Array | null {
  if (step.mode !== 4 && step.mode !== 5 && step.mode !== 6) return null;
  if (step.count < 3) return null;
  let ids: ArrayLike<number>;
  let restart = -1;
  if (!step.index) {
    const a = new Uint32Array(step.count);
    for (let i = 0; i < step.count; i++) a[i] = step.first + i;
    ids = a;
  } else {
    const B = doc.snap.buffers.find((b) => b.id === step.index?.buf);
    const size = step.index.type === 0x1405 ? 4 : step.index.type === 0x1403 ? 2 : step.index.type === 0x1401 ? 1 : 0;
    if (!B || !size || step.index.offset + step.count * size > B.l) return null;
    const dv = new DataView(bin.buffer, bin.byteOffset + B.o + step.index.offset, step.count * size);
    const a = new Uint32Array(step.count);
    for (let i = 0; i < step.count; i++) a[i] = size === 4 ? dv.getUint32(i * 4, true) : size === 2 ? dv.getUint16(i * 2, true) : dv.getUint8(i);
    ids = a;
    restart = size === 4 ? 0xffffffff : size === 2 ? 0xffff : 0xff;
  }
  if (step.mode === 4) {
    const n = ids.length - (ids.length % 3);
    return n >= 3 ? Uint32Array.from({ length: n }, (_, i) => ids[i]) : null;
  }
  const out: number[] = [];
  let run: number[] = [];
  const flush = () => {
    if (step.mode === 5) for (let i = 2; i < run.length; i++) out.push(...(i % 2 ? [run[i - 1], run[i - 2], run[i]] : [run[i - 2], run[i - 1], run[i]]));
    else for (let i = 2; i < run.length; i++) out.push(run[0], run[i - 1], run[i]);
    run = [];
  };
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === restart) flush();
    else run.push(ids[i]);
  }
  flush();
  return out.length >= 3 ? Uint32Array.from(out) : null;
}

/**
 * A coarse stand-in for a mesh (vertex clustering): its bounding box is cut into at most `grid` cells per side, every
 * vertex moves to the average of its cell, and triangles that collapse are dropped. What is left keeps the outline and
 * the big volumes (what the visual score sees) and loses the detail, the UVs and the original vertex order: about as
 * much as a 16x16x16 voxel sketch. Null when too little is left to be better than a box.
 */
export function proxyMesh(
  tris: ArrayLike<number>,
  posOf: (v: number) => number[],
  min: number[],
  max: number[],
  grid = PROXY_GRID,
  extra: Array<{ name: string; size: number; read: (v: number) => number[] }> = [],
): { pos: number[]; idx: number[]; attrs?: Record<string, { size: number; data: number[] }> } | null {
  const ext = [0, 1, 2].map((k) => Math.max(max[k] - min[k], 1e-9));
  const big = Math.max(...ext);
  const cells = ext.map((e) => Math.max(1, Math.round((grid * e) / big)));
  const cellOf = new Map<number, number>();
  const sums: number[][] = [];
  const vertCell = new Map<number, number>();
  const xsums: Array<number[] & { size: number }> = extra.map((e) => Object.assign([] as number[], { size: e.size }));
  const cluster = (v: number): number => {
    const known = vertCell.get(v);
    if (known != null) return known;
    const p = posOf(v);
    let key = 0;
    for (let k = 0; k < 3; k++) {
      const c = Math.min(cells[k] - 1, Math.max(0, Math.floor(((p[k] - min[k]) / ext[k]) * cells[k])));
      key = key * (grid + 1) + c;
    }
    let id = cellOf.get(key);
    if (id == null) {
      id = sums.length;
      cellOf.set(key, id);
      sums.push([0, 0, 0, 0]);
      for (const x of xsums) x.push(...new Array(x.size).fill(0));
    }
    const s = sums[id];
    s[0] += p[0];
    s[1] += p[1];
    s[2] += p[2];
    s[3]++;
    // the other attributes (normals, UVs, a wireframe's barycentrics, colours) averaged the same way, so the site's shader
    // still gets the inputs it reads instead of zeros
    extra.forEach((e, j) => {
      const val = e.read(v);
      const X = xsums[j];
      for (let k = 0; k < e.size; k++) X[id * e.size + k] += Number.isFinite(val[k]) ? val[k] : 0;
    });
    vertCell.set(v, id);
    return id;
  };
  const idx: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const a = cluster(tris[i]);
    const b = cluster(tris[i + 1]);
    const c = cluster(tris[i + 2]);
    if (a === b || b === c || a === c) continue;
    // the same triangle twice (either winding) only once
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    idx.push(a, b, c);
  }
  if (idx.length < 12) return null;
  const pos: number[] = [];
  for (const s of sums) for (let k = 0; k < 3; k++) pos.push(Math.round((s[k] / s[3]) * 1e4) / 1e4);
  if (!extra.length) return { pos, idx };
  const attrs: Record<string, { size: number; data: number[] }> = {};
  extra.forEach((e, j) => {
    const X = xsums[j];
    const data: number[] = [];
    sums.forEach((s, id) => {
      for (let k = 0; k < e.size; k++) data.push(Math.round((X[id * e.size + k] / s[3]) * 1e4) / 1e4);
    });
    attrs[e.name] = { size: e.size, data };
  });
  return { pos, idx, attrs };
}

/**
 * Turn a recording into the editable pipeline: pipeline.json + one GLSL file per shader. The binary is the recording's
 * own (`data`), so nothing is copied; with `ownAssets`, large mesh buffers are zeroed in `bin` (pass a copy) and drawn as
 * boxes, and the caller has already painted the site's images as placeholders.
 */
export function rebuildPipeline(
  doc: CaptureDoc,
  bin: Uint8Array,
  opts: { data: string; ownAssets?: boolean; sceneNodes?: Map<string, string> } = { data: 'data.bin' },
): { pipeline: PipelineDoc; shaders: Record<string, string>; stats: RebuildStats } {
  const stats: RebuildStats = {
    draws: 0,
    materials: 0,
    programs: 0,
    cameras: 0,
    renderTargets: 0,
    glSteps: 0,
    clears: 0,
    matricesExact: 0,
    matricesOff: [],
    recordedBuffers: 0,
    recordedBufferBytes: 0,
    recordedTextures: 0,
    recordedTextureBytes: 0,
    placeholders: 0,
    proxies: 0,
    boxReasons: {},
    skipped: {},
  };
  const skip = (n: string) => {
    stats.skipped[n] = (stats.skipped[n] ?? 0) + 1;
  };
  const boxBecause = (n: string) => {
    stats.boxReasons[n] = (stats.boxReasons[n] ?? 0) + 1;
  };
  const progs = new Map(doc.snap.programs.map((p) => [p.id, p]));
  const shaders: Record<string, string> = {};
  const progFiles = new Map<number, { vertex: string; fragment: string; name: string }>();
  const filesOf = (pid: number) => {
    let f = progFiles.get(pid);
    if (f) return f;
    const p = progs.get(pid);
    const src = p?.shaders.map((s) => s.src).join('\n') ?? '';
    const named = /#define[ \t]+SHADER_NAME[ \t]+([^\s]+)/.exec(src)?.[1] ?? 'program';
    const base = `${slug(named)}-${pid}`;
    f = { vertex: `shaders/${base}.vert`, fragment: `shaders/${base}.frag`, name: `${named} #${pid}` };
    shaders[f.vertex] = p?.shaders.find((s) => s.type === 0x8b31)?.src ?? '';
    shaders[f.fragment] = p?.shaders.find((s) => s.type === 0x8b30)?.src ?? '';
    progFiles.set(pid, f);
    return f;
  };

  // uniform values per program: the snapshot, then every uniform* call
  const uni = new Map<number, Map<string, number[]>>();
  const utype = new Map<number, Map<string, { type: number; size: number }>>();
  for (const p of doc.snap.programs) {
    uni.set(p.id, new Map(p.uniforms.map((u) => [u.name, Array.isArray(u.v) ? u.v.map(Number) : [Number(u.v)]])));
    utype.set(p.id, new Map(p.uniforms.map((u) => [u.name, { type: u.type, size: (u as { size?: number }).size ?? 1 }])));
  }
  const activeName = (pid: number, n: string): string | null => {
    const t = utype.get(pid);
    if (!t) return n;
    if (t.has(n)) return n;
    if (t.has(`${n}[0]`)) return `${n}[0]`;
    if (n.endsWith('[0]') && t.has(n.slice(0, -3))) return n.slice(0, -3);
    return null;
  };
  // animated clock uniforms (from the recording's animate list)
  const clockAt = new Map<string, { base: number; rate: number }>();
  for (const a of doc.animate ?? []) clockAt.set(`${a.frame}|${a.cmd}`, { base: a.base, rate: a.rate });
  const clocks: PipelineDoc['clocks'] = [];

  // passes: which pass each draw belongs to
  const passOf = new Map<string, number>();
  for (const p of doc.graph?.passes ?? []) for (const d of p.draws) passOf.set(`${d.frame}|${d.cmd}`, p.index);

  const materials: RebuildMaterial[] = [];
  const matKey = new Map<string, number>();
  const cameras: RebuildCamera[] = [];
  const camKey = new Map<string, number>();
  const frames: PipelineDoc['frames'] = [];
  const targets = new Set<number>();
  const bufUse = new Map<number, { mesh: boolean; other: boolean }>();
  const meshDraws: Array<{ step: DrawStep; pos: GeometryAttr }> = [];
  let exposure: number | null = null;

  const vaosInit = new Map<number, { attrs: Map<number, VaoAttr>; el: number }>();
  for (const v of doc.snap.vaos) vaosInit.set(v.id, { attrs: new Map(v.attrs.map((a) => [a.i, { ...a }])), el: v.el });

  [...doc.frames, ...(doc.tapeFrames ?? []), ...(doc.scrollFrames ?? [])].forEach((f, fi) => {
    const steps: Step[] = [];
    frames.push({ steps });
    const st = f.state;
    if (!st) return;
    const vaos = new Map([...vaosInit].map(([k, v]) => [k, { attrs: new Map([...v.attrs].map(([i, a]) => [i, { ...a }])), el: v.el }]));
    if (st.defaultVao) vaos.set(0, { attrs: new Map(st.defaultVao.attrs.map((a) => [a.i, { ...a }])), el: st.defaultVao.el });
    const p = { ...st.p } as Record<string, unknown>;
    const num = (k: number, d = 0) => Number((p[String(k)] as number) ?? d);
    const arr = (k: number, d: number[]) => ((p[String(k)] as number[]) ?? d).map(Number);
    const s = {
      program: st.program,
      drawFb: st.drawFb,
      readFb: st.readFb,
      active: (st.activeTexture ?? 0x84c0) - 0x84c0,
      units: new Map(st.units.map((u) => [u.u, { ...u } as unknown as Record<string, number>])),
      vao: st.vao,
      arrayBuffer: st.arrayBuffer,
      uboBuffer: ((st as unknown as { ubo?: number }).ubo ?? 0) as number,
      ubos: new Map<number, { i: number; buf: number; start: number; size: number }>(
        ((st as unknown as { ubos?: Array<{ i: number; buf: number; start: number; size: number }> }).ubos ?? []).map((u) => [u.i, { ...u }]),
      ),
      rb: st.rb,
      en: { ...st.en } as Record<string, boolean>,
      store: {} as Record<string, number>,
    };
    const vao = () => {
      let v = vaos.get(s.vao);
      if (!v) {
        v = { attrs: new Map(), el: 0 };
        vaos.set(s.vao, v);
      }
      return v;
    };
    const en = (k: number) => Boolean(s.en[String(k)]);
    let lastPass = -1;
    const passNow = (fi2: number, ci: number) => {
      const k = passOf.get(`${fi2}|${ci}`);
      if (k !== undefined) lastPass = k;
      return lastPass;
    };
    const boundTex = (target: number) => {
      const u = s.units.get(s.active) ?? {};
      return Number(u[texKind(target)] ?? 0);
    };

    const occ = new Map<string, number>();
    const lastOcc = new Map<string, number>();
    const tapeTk = (pid: number): Record<string, number> | undefined => {
      if (fi < doc.frames.length || fi >= doc.frames.length + (doc.tapeFrames?.length ?? 0) || !doc.tape?.uniforms?.length) return undefined;
      const tk: Record<string, number> = {};
      for (const u of doc.tape.uniforms) {
        const o = lastOcc.get(`${u.p}|${u.n}`);
        if (u.p === pid && o != null) tk[u.n] = o;
      }
      return Object.keys(tk).length ? tk : undefined;
    };
    const onCmd = (c: Cmd, ci: number): void => {
      const [name, ...a] = c;
      const sub = multiDrawParts(name, a, bin);
      if (sub) {
        for (const x of sub) onCmd(x, ci);
        return;
      }
      if (DRAWS.has(name)) {
        const pid = s.program;
        const prog = progs.get(pid);
        if (!prog) {
          skip('draw with a program made during the recording');
          return;
        }
        const files = filesOf(pid);
        const indexed = /Elements/.test(name);
        const mode = Number(a[0]);
        const count = Number(name === 'drawRangeElements' ? a[3] : indexed ? a[1] : a[2]);
        let first = 0;
        let index: DrawStep['index'] = null;
        if (indexed) {
          const type = Number(name === 'drawRangeElements' ? a[4] : a[2]);
          const offset = Number(name === 'drawRangeElements' ? a[5] : a[3]);
          index = { buf: vao().el, type, offset };
        } else first = Number(a[1]);
        const instances = /Instanced/.test(name) ? Number(indexed ? a[4] : a[3]) : 0;
        // geometry: the program's attributes, read through the bound vertex array
        const attrs: GeometryAttr[] = [];
        for (const at of prog.attribs) {
          if (at.name.startsWith('gl_')) continue;
          const v = vao().attrs.get(at.loc);
          if (!v?.en || !v.buf) {
            skip('attribute left as a constant value');
            continue;
          }
          // a matrix attribute (instanceMatrix) spans one location per column; three.js wants it as one attribute
          const cols = MAT_COLS[at.type] ?? 1;
          attrs.push({
            name: at.name,
            buf: v.buf,
            size: v.size * cols,
            type: v.type,
            norm: v.norm,
            stride: v.stride,
            off: v.off,
            div: v.div ?? 0,
            int: Boolean(v.int),
          });
        }
        // uniforms and textures
        const values = uni.get(pid) ?? new Map<string, number[]>();
        const types = utype.get(pid) ?? new Map();
        const own: Record<string, UniformValue> = {};
        const builtin: Record<string, number[]> = {};
        for (const [n, t] of types) {
          const isArray = n.endsWith('[0]');
          const key = isArray ? n.slice(0, -3) : n;
          const val = values.get(n) ?? [];
          if (MATRIX_BUILTINS.has(key)) {
            builtin[key] = val;
            continue;
          }
          if (key === 'toneMappingExposure') exposure = val[0] ?? null;
          const kind = SAMPLER_KIND[t.type];
          if (kind) {
            const units = val.length ? val : [0];
            const texs = units.map((u) => ({ tex: Number(s.units.get(u)?.[kind] ?? 0), kind }));
            own[key] = isArray ? texs : texs[0];
          } else own[key] = !isArray && val.length === 1 && (COMPONENTS[t.type] ?? 1) === 1 ? val[0] : val;
        }
        // camera and model matrix, in three.js terms
        let V = builtin.viewMatrix?.length === 16 ? builtin.viewMatrix : null;
        const P = builtin.projectionMatrix?.length === 16 ? builtin.projectionMatrix : null;
        const MV = builtin.modelViewMatrix?.length === 16 ? builtin.modelViewMatrix : null;
        let M = builtin.modelMatrix?.length === 16 ? builtin.modelMatrix : null;
        // a program that is handed the model matrix AND the model-view matrix but no view matrix: the camera is what turns one
        // into the other (view = modelView x model^-1), so three.js gets a camera that reproduces the site's model-view
        let derivedView = false;
        if (!V && M && MV) {
          const mi = invert(M);
          const v = mi ? mul(MV, mi) : null;
          if (v?.every(Number.isFinite)) {
            V = v;
            derivedView = true;
          }
        }
        const usesMatrices = Boolean(V || P || MV || M || builtin.normalMatrix || builtin.cameraPosition);
        let camera: number | null = null;
        let model: number[] | null = null;
        if (usesMatrices) {
          const view = V ?? IDENT;
          if (!M && MV) M = mul(invert(view) ?? IDENT, MV);
          model = M ?? IDENT;
          const ortho = Boolean(builtin.isOrthographic?.[0]);
          const ck = JSON.stringify([view.map((x) => +x.toFixed(derivedView ? 3 : 6)), (P ?? IDENT).map((x) => +x.toFixed(6)), ortho]);
          if (!camKey.has(ck)) {
            camKey.set(ck, cameras.length);
            cameras.push({ id: cameras.length, view, projection: P ?? IDENT, orthographic: ortho, draws: 0 });
          }
          camera = camKey.get(ck) as number;
          cameras[camera].draws++;
          // does three.js reproduce what the site uploaded?
          const mv3 = mul(view, model);
          const off: string[] = [];
          if (MV && !close(MV, mv3)) off.push('modelViewMatrix');
          if (builtin.normalMatrix?.length === 9 && !close(builtin.normalMatrix, normalMatrixOf(mv3), 2e-3)) off.push('normalMatrix');
          if (builtin.cameraPosition?.length === 3) {
            const w = invert(view);
            if (w && !close(builtin.cameraPosition, [w[12], w[13], w[14]], 2e-3)) off.push('cameraPosition');
          }
          if (off.length) stats.matricesOff.push({ frame: fi, cmd: ci, what: off.join(', ') });
          else stats.matricesExact++;
        }
        // state
        const blendOn = en(0x0be2);
        const state: DrawState = {
          blend: blendOn
            ? {
                src: num(0x80c9, 1),
                dst: num(0x80c8, 0),
                srcA: num(0x80cb, 1),
                dstA: num(0x80ca, 0),
                eq: num(0x8009, 0x8006),
                eqA: num(0x883d, 0x8006),
                color: arr(0x8005, [0, 0, 0, 0]),
              }
            : null,
          depth: { test: en(0x0b71), write: Boolean(p[String(0x0b72)] ?? true), func: num(0x0b74, 0x0201) },
          cull: en(0x0b44) ? { face: num(0x0b45, 0x0405), front: num(0x0b46, 0x0901) } : null,
          colorMask: ((p[String(0x0c23)] as boolean[]) ?? [true, true, true, true]).map(Boolean),
          stencil: en(0x0b90)
            ? {
                func: num(0x0b92, 0x0207),
                ref: num(0x0b97, 0),
                mask: num(0x0b93, 0xffffffff),
                fail: num(0x0b94, 0x1e00),
                zfail: num(0x0b95, 0x1e00),
                zpass: num(0x0b96, 0x1e00),
                write: num(0x0b98, 0xffffffff),
              }
            : null,
          polygonOffset: en(0x8037) ? [num(0x8038, 0), num(0x2a00, 0)] : null,
          alphaToCoverage: en(0x809e),
        };
        const mk = `${pid}|${JSON.stringify(state)}`;
        let mi = matKey.get(mk);
        if (mi === undefined) {
          mi = materials.length;
          matKey.set(mk, mi);
          materials.push({
            id: mi,
            program: pid,
            name: files.name,
            vertex: files.vertex,
            fragment: files.fragment,
            state,
            uniforms: structuredClone(own),
            builtins: Object.keys(builtin),
            blocks: prog.blocks?.length ? prog.blocks.map((b) => ({ name: b.name, binding: b.binding })) : undefined,
          });
        }
        const defaults = materials[mi].uniforms;
        const delta: Record<string, UniformValue> = {};
        for (const [k, v] of Object.entries(own)) if (JSON.stringify(v) !== JSON.stringify(defaults[k])) delta[k] = v;
        const viewport = arr(0x0ba2, [0, 0, doc.canvas.w, doc.canvas.h]);
        const step: DrawStep = {
          op: 'draw',
          pass: passNow(fi, ci),
          frame: fi,
          cmd: ci,
          material: mi,
          tk: tapeTk(pid),
          mode,
          ubos: s.ubos.size ? [...s.ubos.values()].map((u) => ({ ...u })) : undefined,
          first,
          count,
          instances,
          index,
          attrs,
          target: s.drawFb,
          viewport,
          scissor: en(0x0c11) ? arr(0x0c10, viewport) : null,
          camera,
          model,
          uniforms: delta,
        };
        const node = opts.sceneNodes?.get(`${fi}|${ci}`);
        if (node) step.sceneNode = node;
        if (s.drawFb) targets.add(s.drawFb);
        const isMesh = (mode === 4 || mode === 5 || mode === 6) && count > 6;
        for (const at of attrs) {
          const u = bufUse.get(at.buf) ?? { mesh: false, other: false };
          if (isMesh && !at.div) u.mesh = true;
          else u.other = true;
          bufUse.set(at.buf, u);
        }
        if (index) {
          const u = bufUse.get(index.buf) ?? { mesh: false, other: false };
          if (isMesh) u.mesh = true;
          else u.other = true;
          bufUse.set(index.buf, u);
        }
        const pos = attrs.find((x) => /^(position|aPosition|a_position|pos)$/i.test(x.name) && !x.div);
        if (isMesh && pos) meshDraws.push({ step, pos });
        steps.push(step);
        stats.draws++;
        return;
      }
      switch (name) {
        case 'useProgram':
          s.program = ref(a[0], 'prog');
          return;
        case 'bindFramebuffer': {
          const fb = ref(a[1], 'fb');
          if (a[0] === 0x8d40 || a[0] === 0x8ca9) s.drawFb = fb;
          if (a[0] === 0x8d40 || a[0] === 0x8ca8) s.readFb = fb;
          return;
        }
        case 'bindRenderbuffer':
          s.rb = ref(a[1], 'rb');
          return;
        case 'activeTexture':
          s.active = Number(a[0]) - 0x84c0;
          return;
        case 'bindTexture': {
          const u = s.units.get(s.active) ?? {};
          u[texKind(Number(a[0]))] = ref(a[1], 'tex');
          s.units.set(s.active, u);
          return;
        }
        case 'bindSampler':
          skip('sampler objects (their settings apply through the texture here)');
          return;
        case 'bindVertexArray':
        case 'ext:OES_vertex_array_object.bindVertexArrayOES':
          s.vao = ref(a[0], 'vao');
          return;
        case 'bindBuffer':
          if (a[0] === 0x8892) s.arrayBuffer = ref(a[1], 'buf');
          else if (a[0] === 0x8893) vao().el = ref(a[1], 'buf');
          else if (a[0] === 0x8a11) s.uboBuffer = ref(a[1], 'buf');
          return;
        case 'bindBufferBase':
        case 'bindBufferRange':
          // uniform blocks: which buffer (and slice) feeds each binding point, as each draw sees it
          if (Number(a[0]) === 0x8a11) {
            const bufId = ref(a[2], 'buf');
            if (bufId)
              s.ubos.set(Number(a[1]), {
                i: Number(a[1]),
                buf: bufId,
                start: name === 'bindBufferRange' ? Number(a[3]) : 0,
                size: name === 'bindBufferRange' ? Number(a[4]) : 0,
              });
            else s.ubos.delete(Number(a[1]));
            s.uboBuffer = bufId;
          }
          return;
        case 'vertexAttribPointer':
        case 'vertexAttribIPointer': {
          const int = name === 'vertexAttribIPointer';
          vao().attrs.set(Number(a[0]), {
            ...(vao().attrs.get(Number(a[0])) ?? { en: false }),
            i: Number(a[0]),
            size: Number(a[1]),
            type: Number(a[2]),
            norm: int ? false : Boolean(a[3]),
            stride: Number(int ? a[3] : a[4]),
            off: Number(int ? a[4] : a[5]),
            int,
            buf: s.arrayBuffer,
          });
          return;
        }
        case 'enableVertexAttribArray':
        case 'disableVertexAttribArray': {
          const at = vao().attrs.get(Number(a[0])) ?? ({ i: Number(a[0]), size: 4, type: 0x1406, norm: false, stride: 0, off: 0 } as VaoAttr);
          at.en = name === 'enableVertexAttribArray';
          vao().attrs.set(Number(a[0]), at);
          return;
        }
        case 'vertexAttribDivisor':
        case 'ext:ANGLE_instanced_arrays.vertexAttribDivisorANGLE': {
          const at = vao().attrs.get(Number(a[0]));
          if (at) at.div = Number(a[1]);
          return;
        }
        case 'enable':
        case 'disable':
          s.en[String(a[0])] = name === 'enable';
          return;
        case 'blendFunc':
          p[String(0x80c9)] = a[0];
          p[String(0x80cb)] = a[0];
          p[String(0x80c8)] = a[1];
          p[String(0x80ca)] = a[1];
          return;
        case 'blendFuncSeparate':
          p[String(0x80c9)] = a[0];
          p[String(0x80c8)] = a[1];
          p[String(0x80cb)] = a[2];
          p[String(0x80ca)] = a[3];
          return;
        case 'blendEquation':
          p[String(0x8009)] = a[0];
          p[String(0x883d)] = a[0];
          return;
        case 'blendEquationSeparate':
          p[String(0x8009)] = a[0];
          p[String(0x883d)] = a[1];
          return;
        case 'blendColor':
          p[String(0x8005)] = a.slice(0, 4);
          return;
        case 'depthFunc':
          p[String(0x0b74)] = a[0];
          return;
        case 'depthMask':
          p[String(0x0b72)] = Boolean(a[0]);
          return;
        case 'colorMask':
          p[String(0x0c23)] = a.slice(0, 4).map(Boolean);
          return;
        case 'cullFace':
          p[String(0x0b45)] = a[0];
          return;
        case 'frontFace':
          p[String(0x0b46)] = a[0];
          return;
        case 'viewport':
          p[String(0x0ba2)] = a.slice(0, 4).map(Number);
          return;
        case 'scissor':
          p[String(0x0c10)] = a.slice(0, 4).map(Number);
          return;
        case 'clearColor':
          p[String(0x0c22)] = a.slice(0, 4).map(Number);
          return;
        case 'clearDepth':
          p[String(0x0b73)] = Number(a[0]);
          return;
        case 'clearStencil':
          p[String(0x0b91)] = Number(a[0]);
          return;
        case 'polygonOffset':
          p[String(0x8038)] = Number(a[0]);
          p[String(0x2a00)] = Number(a[1]);
          return;
        case 'stencilFunc':
        case 'stencilFuncSeparate': {
          const o = name === 'stencilFunc' ? 0 : 1;
          if (o && a[0] === 0x0405) return;
          p[String(0x0b92)] = a[o];
          p[String(0x0b97)] = a[o + 1];
          p[String(0x0b93)] = a[o + 2];
          return;
        }
        case 'stencilOp':
        case 'stencilOpSeparate': {
          const o = name === 'stencilOp' ? 0 : 1;
          if (o && a[0] === 0x0405) return;
          p[String(0x0b94)] = a[o];
          p[String(0x0b95)] = a[o + 1];
          p[String(0x0b96)] = a[o + 2];
          return;
        }
        case 'stencilMask':
        case 'stencilMaskSeparate': {
          const o = name === 'stencilMask' ? 0 : 1;
          if (o && a[0] === 0x0405) return;
          p[String(0x0b98)] = a[o];
          return;
        }
        case 'pixelStorei':
          s.store[String(a[0])] = Number(a[1]);
          return;
        case 'clear': {
          const viewport = arr(0x0ba2, [0, 0, doc.canvas.w, doc.canvas.h]);
          steps.push({
            op: 'clear',
            pass: passNow(fi, ci),
            frame: fi,
            target: s.drawFb,
            bits: Number(a[0]),
            color: arr(0x0c22, [0, 0, 0, 0]),
            depth: num(0x0b73, 1),
            stencil: num(0x0b91, 0),
            colorMask: ((p[String(0x0c23)] as boolean[]) ?? [true, true, true, true]).map(Boolean),
            depthMask: Boolean(p[String(0x0b72)] ?? true),
            stencilMask: num(0x0b98, 0xffffffff),
            scissor: en(0x0c11) ? arr(0x0c10, viewport) : null,
          });
          stats.clears++;
          return;
        }
        case 'blitFramebuffer':
          steps.push({
            op: 'gl',
            pass: passNow(fi, ci),
            frame: fi,
            fn: name,
            args: a,
            bind: { readFb: s.readFb, drawFb: s.drawFb },
            why: 'three.js has no blit',
          });
          stats.glSteps++;
          return;
        case 'framebufferTexture2D':
        case 'framebufferTextureLayer':
        case 'framebufferRenderbuffer':
        case 'drawBuffers':
        case 'readBuffer': {
          const fb = name === 'readBuffer' ? s.readFb : a[0] === 0x8ca8 ? s.readFb : s.drawFb;
          steps.push({ op: 'gl', pass: passNow(fi, ci), frame: fi, fn: name, args: a, bind: { fb }, why: 'changes what a render target writes to' });
          stats.glSteps++;
          return;
        }
        case 'renderbufferStorage':
        case 'renderbufferStorageMultisample':
          steps.push({ op: 'gl', pass: passNow(fi, ci), frame: fi, fn: name, args: a, bind: { rb: s.rb }, why: 'sizes a depth or colour buffer' });
          stats.glSteps++;
          return;
        case 'bufferData':
        case 'bufferSubData': {
          const target = Number(a[0]);
          const buf = target === 0x8892 ? s.arrayBuffer : target === 0x8893 ? vao().el : target === 0x8a11 ? s.uboBuffer : 0;
          if (!buf) {
            skip(`${name} on a buffer that is not vertex, index or uniform-block data`);
            return;
          }
          steps.push({
            op: 'gl',
            pass: passNow(fi, ci),
            frame: fi,
            cmd: ci,
            fn: name,
            args: a,
            bind: { buf, bufTarget: target },
            why: target === 0x8a11 ? 'updates uniform-block data during the frame' : 'updates vertex data during the frame',
          });
          stats.glSteps++;
          return;
        }
        default:
          break;
      }
      if (TEX_CALLS.has(name)) {
        const target = Number(a[0]);
        const tex = boundTex(target);
        const why = /^copy/.test(name)
          ? 'copies from a framebuffer'
          : name === 'generateMipmap'
            ? 'builds mipmaps'
            : /^tex(Parameter)/.test(name)
              ? 'texture settings'
              : 'texture data uploaded during the frame';
        steps.push({
          op: 'gl',
          pass: passNow(fi, ci),
          frame: fi,
          fn: name,
          args: a,
          bind: {
            tex,
            texTarget: texKind(target) === 'cube' ? 0x8513 : texKind(target) === '3d' ? 0x806f : texKind(target) === 'array' ? 0x8c1a : 0x0de1,
            readFb: /^copy/.test(name) ? s.readFb : undefined,
          },
          store: { ...s.store },
          why,
        });
        stats.glSteps++;
        return;
      }
      if (/^uniform/.test(name)) {
        const l = locOf(a[0]);
        if (!l) return;
        const n = activeName(l.p, l.n);
        if (!n) return;
        const vals = /Matrix/.test(name) ? numbers(a[2], bin) : /v$/.test(name) ? numbers(a[1], bin) : a.slice(1).flatMap((x) => numbers(x, bin));
        uni.get(l.p)?.set(n, vals);
        if (/^uniform[234]f(v)?$/.test(name)) {
          const ok = `${l.p}|${l.n}`;
          const o = occ.get(ok) ?? 0;
          occ.set(ok, o + 1);
          lastOcc.set(ok, o);
        }
        const ck = clockAt.get(`${fi}|${ci}`);
        if (ck && !clocks.some((x) => x.program === l.p && x.uniform === n))
          clocks.push({ program: l.p, uniform: n.replace(/\[0\]$/, ''), base: ck.base, rate: ck.rate });
        return;
      }
      // a texture or render target the site made while the pointer moved: made when the step runs (the others exist from the start)
      if (/^create(Texture|Framebuffer|Renderbuffer)$/.test(name)) {
        const last = a[a.length - 1] as unknown;
        const id = last && typeof last === 'object' && '$ret' in (last as object) ? Number((last as { $ret: number }).$ret) : 0;
        if (id) {
          const kind = name === 'createTexture' ? 'tex' : name === 'createFramebuffer' ? 'fb' : 'rb';
          steps.push({
            op: 'gl',
            pass: passNow(fi, ci),
            frame: fi,
            fn: name,
            args: [],
            bind: { make: { kind, id } },
            why: 'an object the site made while the pointer moved',
          });
          stats.glSteps++;
        }
        return;
      }
      if (
        /^create|^delete|^is[A-Z]|^get|^check|^shaderSource|^compileShader|^attachShader|^linkProgram|^bindAttribLocation|^deleteShader|^detachShader/.test(
          name,
        )
      )
        return;
      if (IGNORE.has(name)) return;
      skip(name);
    };
    f.cmds.forEach(onCmd);
  });

  // with --own-assets: meshes become coarse stand-ins (or boxes) and their buffers are not shipped
  if (opts.ownAssets) {
    for (const { step, pos } of meshDraws) {
      const B = doc.snap.buffers.find((b) => b.id === pos.buf);
      // anything bigger than a few hundred vertices is a model of the site's, not a helper quad or a gizmo
      if (!B || B.l < 16384) continue;
      if (bufUse.get(pos.buf)?.other) continue;
      if (pos.type !== 0x1406) continue;
      const dv = new DataView(bin.buffer, bin.byteOffset + B.o, B.l);
      const stride = pos.stride || pos.size * 4;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let o = pos.off; o + pos.size * 4 <= B.l; o += stride)
        for (let k = 0; k < Math.min(3, pos.size); k++) {
          const x = dv.getFloat32(o + k * 4, true);
          if (Number.isFinite(x)) {
            min[k] = Math.min(min[k], x);
            max[k] = Math.max(max[k], x);
          }
        }
      if (!Number.isFinite(min[0])) continue;
      step.placeholder = { min, max };
      stats.placeholders++;
      // a coarse stand-in of the shape instead of the box: triangle lists, strips and fans, instanced or not (the runner keeps
      // the instance attributes and count, so every instance still draws)
      const tris = triangleIds(doc, bin, step);
      if (!tris) {
        boxBecause(step.mode === 4 || step.mode === 5 || step.mode === 6 ? 'index buffer unreadable' : `mode ${step.mode}`);
        continue;
      }
      const at = (v: number, k: number) => {
        const o = pos.off + v * stride + k * 4;
        return o + 4 <= B.l ? dv.getFloat32(o, true) : 0;
      };
      // per-vertex float attributes besides the position (not per-instance ones: those stay as recorded)
      const extra = step.attrs
        .filter((a) => a !== pos && a.name !== pos.name && !a.div && a.type === 0x1406 && a.size >= 1 && a.size <= 4)
        .flatMap((a) => {
          const AB = doc.snap.buffers.find((b) => b.id === a.buf);
          if (!AB) return [];
          const adv = new DataView(bin.buffer, bin.byteOffset + AB.o, AB.l);
          const ast = a.stride || a.size * 4;
          return [
            {
              name: a.name,
              size: a.size,
              read: (v: number) =>
                Array.from({ length: a.size }, (_, k) => {
                  const o = a.off + v * ast + k * 4;
                  return o + 4 <= AB.l ? adv.getFloat32(o, true) : 0;
                }),
            },
          ];
        });
      const px = proxyMesh(tris, (v) => [at(v, 0), at(v, 1), Math.min(3, pos.size) > 2 ? at(v, 2) : 0], min, max, PROXY_GRID, extra);
      if (px) {
        step.proxy = px;
        stats.proxies++;
      } else boxBecause('too few triangles left after clustering');
    }
    for (const { step } of meshDraws) {
      if (!step.placeholder) continue;
      for (const at of step.attrs) {
        const B = doc.snap.buffers.find((b) => b.id === at.buf);
        if (B && !bufUse.get(at.buf)?.other) bin.fill(0, B.o, B.o + B.l);
      }
      if (step.index) {
        const B = doc.snap.buffers.find((b) => b.id === step.index?.buf);
        if (B && !bufUse.get(step.index.buf)?.other) bin.fill(0, B.o, B.o + B.l);
      }
    }
  }

  // what of the recording the pipeline still reads
  const usedBufs = new Set<number>();
  for (const fr of frames)
    for (const st of fr.steps)
      if (st.op === 'draw' && !st.placeholder) {
        for (const at of st.attrs) usedBufs.add(at.buf);
        if (st.index) usedBufs.add(st.index.buf);
      }
  for (const b of doc.snap.buffers)
    if (usedBufs.has(b.id)) {
      stats.recordedBuffers++;
      stats.recordedBufferBytes += b.l;
    }
  for (const t of doc.snap.textures) {
    const bytes = (t.levels ?? []).reduce((n, l) => n + (l.l ?? 0), 0);
    if (bytes) {
      stats.recordedTextures++;
      stats.recordedTextureBytes += bytes;
    }
  }
  stats.materials = materials.length;
  stats.programs = progFiles.size;
  stats.cameras = cameras.length;
  stats.renderTargets = targets.size;

  const pipeline: PipelineDoc = {
    version: 1,
    glVersion: doc.version,
    url: doc.url,
    at: doc.at,
    data: opts.data,
    canvas: doc.canvas,
    attrs: doc.attrs,
    extensions: doc.extensions,
    resources: {
      textures: doc.snap.textures,
      renderbuffers: doc.snap.renderbuffers,
      samplers: doc.snap.samplers,
      framebuffers: doc.snap.framebuffers,
      buffers: doc.snap.buffers,
    },
    materials,
    cameras,
    passes: (doc.graph?.passes ?? []).map((ps) => ({
      index: ps.index,
      frame: ps.frame,
      role: ps.role,
      why: ps.why,
      target: ps.target.label,
      programs: ps.programs,
    })),
    frames,
    ...(doc.tape && doc.tapeFrames?.length
      ? {
          tape: {
            n: doc.tapeFrames.length,
            move: doc.tape.move,
            still: doc.tape.still,
            ...(doc.tape.drag ? { drag: true } : {}),
            w: doc.canvas.cssW || doc.canvas.w,
            h: doc.canvas.cssH || doc.canvas.h,
            anchors: doc.tape.anchors ?? [],
            uniforms: doc.tape.uniforms ?? [],
          },
        }
      : {}),
    ...(doc.scroll?.fit && doc.scrollFrames?.length
      ? {
          scroll: {
            n: doc.scrollFrames.length,
            k: doc.scroll.fit.k,
            ratio: doc.scroll.fit.ratio,
            aligned: doc.scroll.fit.aligned,
            stops: doc.scroll.fit.stops.map((x) => ({ sc: x.sc, wh: x.wh, f0: x.f0, f1: x.f1 })),
          },
        }
      : {}),
    clocks,
    inputs: (doc.inputs ?? []).filter((m) => m.kind !== 'clock'),
    viewport: doc.viewport ?? null,
    toneMappingExposure: exposure,
    labels: {
      structure: 'Verified: passes, order, render targets, programs, draw state, uniform values, cameras and model matrices are read from the recording',
      roles: "Inferred: each pass's role (simulation, bloom, composite...) is DEA's reading of it",
      shaders: "the site's own GLSL as the browser compiled it, one file per program (edit them)",
      geometry: 'recorded: vertex and index buffers are the bytes the site uploaded (resources.buffers -> data)',
      textures: 'recorded: texture pixels and the starting state of render targets are the bytes read back from the GPU (resources.textures -> data)',
      raw: 'steps with op "gl" are WebGL calls three.js has no word for, run as recorded on the pipeline objects',
    },
  };
  return { pipeline, shaders, stats };
}

/** rebuild.md: what the editable rebuild is made of, and which parts still read recorded bytes. */
export function rebuildMd(p: PipelineDoc, stats: RebuildStats, score: { canvas: number | null; page: number | null } | null, ownAssets: boolean): string {
  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
  const pct = (n: number | null) => (n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`);
  const L: string[] = [];
  L.push(`# Editable rebuild of ${p.url}`);
  L.push('');
  L.push(
    "A three.js project made from the render graph DEA recorded: each draw is a three.js object with a RawShaderMaterial (the site's GLSL in `shaders/`), a BufferGeometry, a camera and a model matrix; each framebuffer is a WebGLRenderTarget; the passes run in the site's order from `pipeline.json`. Change a uniform, a blend mode, a shader file, the camera, or switch a pass off, and the picture follows.",
  );
  L.push('');
  if (score) L.push(`**Editable rebuild score: canvas ${pct(score.canvas)}, page ${pct(score.page)}** (against the original first screen).`, '');
  L.push('| | |', '|---|---|');
  L.push(`| draws | ${stats.draws} (${p.frames.length} frames, alternating) |`);
  L.push(`| materials | ${stats.materials} RawShaderMaterials from ${stats.programs} programs |`);
  L.push(`| render targets | ${stats.renderTargets} |`);
  L.push(`| cameras | ${stats.cameras} |`);
  L.push(
    `| matrices | ${stats.matricesExact} draws: three.js derives exactly the matrices the site uploaded from the camera and the model matrix${stats.matricesOff.length ? `; ${stats.matricesOff.length} differ (${[...new Set(stats.matricesOff.map((m) => m.what))].join('; ')})` : ''} |`,
  );
  L.push(`| raw WebGL steps | ${stats.glSteps} (uploads, blits, mipmaps, attachments) |`);
  L.push(`| clears | ${stats.clears} |`);
  L.push('');
  L.push('## Where recorded bytes are still used');
  L.push('');
  L.push(`- recorded: ${stats.recordedBuffers} vertex/index buffers, ${mb(stats.recordedBufferBytes)} (the geometry of each draw)`);
  L.push(`- recorded: ${stats.recordedTextures} textures, ${mb(stats.recordedTextureBytes)} (image pixels and the starting state of simulation targets)`);
  if (ownAssets)
    L.push(
      `- --own-assets: the site's images are the average colours of a ${TEX_GRID}×${TEX_GRID} grid and ${stats.placeholders} large mesh(es) are stand-ins (${stats.proxies} a coarse shape of at most ${PROXY_GRID} cells per side, ${stats.placeholders - stats.proxies} boxes); their bytes are not in the kit`,
    );
  // why a mesh is still a box, so the next fix is visible (lusion.co: 50 boxes before strips, fans and instanced draws counted)
  const why = Object.entries(stats.boxReasons ?? {}).sort((a, b) => b[1] - a[1]);
  if (ownAssets) {
    if (why.length) L.push(`- boxes, by reason: ${why.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  } else L.push("- these bytes are the site's: for study and prototyping; swap them for your own (`--own-assets`) before you ship");
  L.push('');
  const skipped = Object.entries(stats.skipped);
  if (skipped.length) {
    L.push('## Not carried over');
    L.push('');
    for (const [k, n] of skipped) L.push(`- ${k} (${n}×)`);
    L.push('');
  }
  L.push('## Passes');
  L.push('');
  const restLen = p.frames.length - (p.tape?.n ?? 0) - (p.scroll?.n ?? 0);
  for (const ps of p.passes.filter((x) => x.frame === restLen - 1 || restLen === 1))
    L.push(`- ${ps.index}: ${ps.role} → ${ps.target} (${ps.programs.length} program${ps.programs.length === 1 ? '' : 's'}) ≈ ${ps.why}`);
  L.push('');
  return `${L.join('\n')}\n`;
}
