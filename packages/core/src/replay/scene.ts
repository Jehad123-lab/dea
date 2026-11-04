// The 3D scene of a recorded frame: each mesh draw's geometry read back from the GPU buffers it was drawn from, its
// model matrix (and instance matrices), and the camera from the view and projection uniforms, written as a glTF
// binary (.glb) any 3D tool opens. Matching a mesh to a model file the site loaded (dea assets) is by vertex count.

import { type CaptureDoc, type DrawInfo, listDraws, type VaoAttr } from './graph.ts';

export interface SceneMesh {
  /** which draw it came from */
  frame: number;
  cmd: number;
  program: number;
  mode: number;
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  indices: Uint32Array | null;
  /** column-major 4×4, world from model; null when the shader names none */
  model: number[] | null;
  /** per-instance matrices (instanced draws), applied after the model matrix */
  instances: number[][] | null;
  vertexCount: number;
  /** how the model matrix was found */
  modelFrom: string;
  /** a model file from dea assets with the same vertex count */
  match?: string;
}

export interface SceneCamera {
  /** column-major 4×4 */
  view: number[];
  projection: number[];
  perspective: { yfov: number; aspect: number; znear: number; zfar: number } | null;
  from: string;
}

export interface RecoveredScene {
  meshes: SceneMesh[];
  camera: SceneCamera | null;
  skipped: string[];
}

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

export function invert(m: number[]): number[] | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det || !Number.isFinite(det)) return null;
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d,
    (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d,
    (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d,
    (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d,
    (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d,
    (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d,
    (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d,
    (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d,
    (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

/** A perspective projection's field of view, aspect and clip planes (null for an orthographic one). */
export function perspectiveOf(p: number[]): SceneCamera['perspective'] {
  if (Math.abs(p[11] + 1) > 1e-3 || Math.abs(p[15]) > 1e-3) return null;
  const yfov = 2 * Math.atan(1 / p[5]);
  const aspect = p[5] / p[0];
  const znear = p[14] / (p[10] - 1);
  const zfar = p[14] / (p[10] + 1);
  return { yfov, aspect, znear, zfar: Number.isFinite(zfar) && zfar > 0 ? zfar : znear * 10000 };
}

const find = (u: Record<string, number[]>, re: RegExp): number[] | null => {
  for (const [k, v] of Object.entries(u)) if (re.test(k) && v.length === 16) return v;
  return null;
};
const MODEL = /^(u_?|u)?model(Matrix)?$|^modelMatrix$|^u_?world(Matrix)?$/i;
const VIEW = /^(u_?)?view(Matrix)?$/i;
const PROJ = /^(u_?)?proj(ection)?(Matrix)?$/i;
const MODELVIEW = /^(u_?)?modelView(Matrix)?$/i;

/** read `count` vertices of an attribute (any type, normalized or not) as floats */
function readAttr(bufs: Map<number, Uint8Array>, a: VaoAttr, first: number, count: number, comps = a.size): Float32Array | null {
  const b = a.buf ? bufs.get(a.buf) : undefined;
  if (!b) return null;
  const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5124: 4, 5125: 4, 5126: 4, 5131: 2 };
  const bytes = sizes[a.type] ?? 4;
  const stride = a.stride || bytes * a.size;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = new Float32Array(count * comps);
  const half = (h: number) => {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    return e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? (m ? Number.NaN : s * Number.POSITIVE_INFINITY) : s * 2 ** (e - 15) * (1 + m / 1024);
  };
  for (let v = 0; v < count; v++) {
    const base = a.off + (first + v) * stride;
    if (base + bytes * Math.min(comps, a.size) > b.byteLength) return null;
    for (let c = 0; c < comps; c++) {
      if (c >= a.size) {
        out[v * comps + c] = c === 3 ? 1 : 0;
        continue;
      }
      const o = base + c * bytes;
      let x: number;
      switch (a.type) {
        case 0x1406:
          x = dv.getFloat32(o, true);
          break;
        case 0x140b:
          x = half(dv.getUint16(o, true));
          break;
        case 0x1400:
          x = dv.getInt8(o);
          if (a.norm) x = Math.max(-1, x / 127);
          break;
        case 0x1401:
          x = dv.getUint8(o);
          if (a.norm) x /= 255;
          break;
        case 0x1402:
          x = dv.getInt16(o, true);
          if (a.norm) x = Math.max(-1, x / 32767);
          break;
        case 0x1403:
          x = dv.getUint16(o, true);
          if (a.norm) x /= 65535;
          break;
        case 0x1404:
          x = dv.getInt32(o, true);
          break;
        default:
          x = dv.getUint32(o, true);
      }
      out[v * comps + c] = x;
    }
  }
  return out;
}

/**
 * The meshes of the recorded frames (the last frame's draws, deduplicated): geometry from the GPU buffers, transforms
 * and camera from the uniforms. Full-screen passes and point draws are not meshes and are left to the replay.
 */
export function recoverScene(doc: CaptureDoc, bin: Uint8Array, opts: { models?: Array<{ name: string; vertices: number | null }> } = {}): RecoveredScene {
  const draws = listDraws(doc, bin);
  const last = Math.max(0, doc.frames.length - 1);
  const bufs = new Map<number, Uint8Array>();
  for (const b of doc.snap.buffers) bufs.set(b.id, bin.subarray(b.o, b.o + b.l));
  // buffers filled during the recording
  for (const f of doc.frames)
    for (const c of f.cmds) {
      if (c[0] !== 'bufferData') continue;
      // the bound buffer is not in the command; the replay knows it, the scene reader skips these
    }
  const progs = new Map(doc.snap.programs.map((p) => [p.id, p]));
  const meshes: SceneMesh[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let camera: SceneCamera | null = null;
  for (const d of draws.filter((x) => x.frame === last)) {
    if (d.mode < 4 || d.count <= 6) continue;
    const P = progs.get(d.program);
    if (!P) continue;
    const pa = P.attribs.find((a) => /^(a_?|in_?)?pos(ition)?$/i.test(a.name) || a.name === 'position');
    if (!pa) {
      skipped.push(`draw ${d.frame}:${d.cmd} (${d.count} vertices): no position attribute`);
      continue;
    }
    const attr = (re: RegExp) => {
      const a = P.attribs.find((x) => re.test(x.name));
      return a ? d.attrs.find((x) => x.i === a.loc) : undefined;
    };
    const posA = d.attrs.find((x) => x.i === pa.loc);
    if (!posA || (posA.div ?? 0) > 0) continue;
    // indices
    let indices: Uint32Array | null = null;
    let first = 0;
    let vcount = d.count;
    if (d.index) {
      const eb = bufs.get(d.index.buf);
      if (!eb) {
        skipped.push(`draw ${d.frame}:${d.cmd}: index buffer not in the recording`);
        continue;
      }
      const sz = d.index.type === 0x1401 ? 1 : d.index.type === 0x1403 ? 2 : 4;
      const dv = new DataView(eb.buffer, eb.byteOffset, eb.byteLength);
      indices = new Uint32Array(d.count);
      let max = 0;
      for (let i = 0; i < d.count; i++) {
        const o = d.index.offset + i * sz;
        if (o + sz > eb.byteLength) break;
        const v = sz === 1 ? dv.getUint8(o) : sz === 2 ? dv.getUint16(o, true) : dv.getUint32(o, true);
        indices[i] = v;
        if (v > max) max = v;
      }
      vcount = max + 1;
    } else first = d.first ?? 0;
    if (vcount > 2_000_000) {
      skipped.push(`draw ${d.frame}:${d.cmd}: ${vcount} vertices, too many`);
      continue;
    }
    const k = `${posA.buf}|${posA.off}|${d.index?.buf ?? 0}|${d.index?.offset ?? first}|${d.count}|${JSON.stringify(d.uniforms.modelMatrix ?? '')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const positions = readAttr(bufs, posA, first, vcount, 3);
    if (!positions) {
      skipped.push(`draw ${d.frame}:${d.cmd}: position buffer not readable`);
      continue;
    }
    const nA = attr(/^(a_?)?normal$/i);
    const uA = attr(/^(a_?)?(uv|texcoord|tex_?coord0?|uv0)$/i);
    const normals = nA && !(nA.div ?? 0) ? readAttr(bufs, nA, first, vcount, 3) : null;
    const uvs = uA && !(uA.div ?? 0) ? readAttr(bufs, uA, first, vcount, 2) : null;
    // transforms
    const u = d.uniforms;
    const view = find(u, VIEW);
    const proj = find(u, PROJ);
    const mv = find(u, MODELVIEW);
    let model = find(u, MODEL);
    let modelFrom = model ? 'the model matrix uniform' : '';
    if (!model && mv && view) {
      const iv = invert(view);
      if (iv) {
        model = mul(iv, mv);
        modelFrom = 'inverse(view) × modelView';
      }
    }
    if (!model && mv) {
      model = mv;
      modelFrom = 'the modelView matrix (no view matrix: the camera is at the origin)';
    }
    if (proj && !camera) {
      camera = {
        view: view ?? (mv && model && model !== mv ? IDENT : IDENT),
        projection: proj,
        perspective: perspectiveOf(proj),
        from: view ? `draw ${d.frame}:${d.cmd}'s view and projection uniforms` : `draw ${d.frame}:${d.cmd}'s projection uniform (no view matrix)`,
      };
    }
    // instancing: a mat4 attribute with a divisor
    let instances: number[][] | null = null;
    const ia = P.attribs.find((a) => /instance.*matrix|^i?matrix$|instanceMatrix/i.test(a.name));
    if (ia && d.instances > 1) {
      const cols = [0, 1, 2, 3].map((c) => d.attrs.find((x) => x.i === ia.loc + c));
      if (cols.every((c) => c && c.size === 4 && (c.div ?? 0) > 0)) {
        instances = [];
        const n = Math.min(d.instances, 2000);
        const colData = (cols as VaoAttr[]).map((c) => readAttr(bufs, c, 0, n, 4));
        if (colData.every(Boolean))
          for (let i = 0; i < n; i++) instances.push((colData as Float32Array[]).flatMap((cd) => Array.from(cd.subarray(i * 4, i * 4 + 4))));
        else instances = null;
      }
    }
    const match = opts.models?.find((m) => m.vertices && m.vertices === vcount)?.name;
    meshes.push({
      frame: d.frame,
      cmd: d.cmd,
      program: d.program,
      mode: d.mode,
      positions,
      normals,
      uvs,
      indices,
      model,
      instances,
      vertexCount: vcount,
      modelFrom: modelFrom || 'none (drawn in clip space or a custom transform)',
      match,
    });
  }
  return { meshes, camera, skipped };
}

/** The recovered scene as a glTF 2.0 binary: one node per mesh (and per instance), the camera as a camera node. */
export function sceneGlb(s: RecoveredScene, opts: { placeholders?: boolean; maxInstances?: number } = {}): Buffer {
  const chunks: Buffer[] = [];
  let size = 0;
  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const add = (data: Float32Array | Uint32Array, type: string, comps: number, target?: number, minmax = false) => {
    const pad = (4 - (size % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      size += pad;
    }
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: size, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf);
    size += buf.length;
    const acc: Record<string, unknown> = {
      bufferView: bufferViews.length - 1,
      componentType: data instanceof Uint32Array ? 5125 : 5126,
      count: data.length / comps,
      type,
    };
    if (minmax) {
      const min = new Array(comps).fill(Number.POSITIVE_INFINITY);
      const max = new Array(comps).fill(Number.NEGATIVE_INFINITY);
      for (let i = 0; i < data.length; i++) {
        const c = i % comps;
        if (data[i] < min[c]) min[c] = data[i];
        if (data[i] > max[c]) max[c] = data[i];
      }
      acc.min = min.map((x) => (Number.isFinite(x) ? x : 0));
      acc.max = max.map((x) => (Number.isFinite(x) ? x : 0));
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const meshes: Array<Record<string, unknown>> = [];
  const nodes: Array<Record<string, unknown>> = [];
  for (const [i, m] of s.meshes.entries()) {
    let pos = m.positions;
    let idx = m.indices;
    let nrm = m.normals;
    let uv = m.uvs;
    if (opts.placeholders) {
      // your own asset goes here: a box with the mesh's bounds
      const mn = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
      const mx = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
      for (let k = 0; k < pos.length; k++) {
        mn[k % 3] = Math.min(mn[k % 3], pos[k]);
        mx[k % 3] = Math.max(mx[k % 3], pos[k]);
      }
      const c = [0, 1, 2, 3, 4, 5, 6, 7].map((b) => [b & 1 ? mx[0] : mn[0], b & 2 ? mx[1] : mn[1], b & 4 ? mx[2] : mn[2]]);
      pos = Float32Array.from(c.flat());
      idx = Uint32Array.from([0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]);
      nrm = null;
      uv = null;
    }
    const attributes: Record<string, number> = { POSITION: add(pos, 'VEC3', 3, 34962, true) };
    if (nrm) attributes.NORMAL = add(nrm, 'VEC3', 3, 34962);
    if (uv) attributes.TEXCOORD_0 = add(uv, 'VEC2', 2, 34962);
    const prim: Record<string, unknown> = { attributes, mode: opts.placeholders ? 4 : m.mode === 6 ? 4 : m.mode, material: 0 };
    if (idx) prim.indices = add(idx, 'SCALAR', 1, 34963);
    meshes.push({ name: `draw-${m.frame}-${m.cmd}${m.match ? `-${m.match}` : ''}`, primitives: [prim] });
    const base = m.model ?? IDENT;
    const inst = m.instances?.slice(0, opts.maxInstances ?? 500) ?? [IDENT];
    for (const [j, im] of inst.entries())
      nodes.push({ name: `draw-${m.frame}-${m.cmd}${inst.length > 1 ? `-${j}` : ''}`, mesh: i, matrix: mul(base, im).map((x) => Math.round(x * 1e6) / 1e6) });
  }
  const cameras: Array<Record<string, unknown>> = [];
  if (s.camera) {
    const world = invert(s.camera.view) ?? IDENT;
    const p = s.camera.perspective;
    cameras.push(
      p
        ? { type: 'perspective', perspective: { yfov: p.yfov, aspectRatio: p.aspect, znear: Math.max(1e-4, p.znear), zfar: p.zfar } }
        : { type: 'orthographic', orthographic: { xmag: 1 / s.camera.projection[0], ymag: 1 / s.camera.projection[5], znear: 0.01, zfar: 1000 } },
    );
    nodes.push({ name: 'camera', camera: 0, matrix: world.map((x) => Math.round(x * 1e6) / 1e6) });
  }
  const json = {
    asset: { version: '2.0', generator: 'DEA (decode anything): scene recovered from a WebGL recording' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    cameras: cameras.length ? cameras : undefined,
    materials: [
      { name: 'recovered', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.8 }, doubleSided: true },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: size }],
  };
  let jb = Buffer.from(JSON.stringify(json));
  if (jb.length % 4) jb = Buffer.concat([jb, Buffer.alloc(4 - (jb.length % 4), 0x20)]);
  let bb = Buffer.concat(chunks, size);
  if (bb.length % 4) bb = Buffer.concat([bb, Buffer.alloc(4 - (bb.length % 4))]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jb.length + 8 + bb.length, 8);
  const ch = (len: number, type: number) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  return Buffer.concat([header, ch(jb.length, 0x4e4f534a), jb, ch(bb.length, 0x004e4942), bb]);
}

/** scene/scene.js: loads the recovered scene.glb with three.js and frames it with the recorded camera. */
export function sceneModule(): string {
  return `// The 3D scene DEA recovered from the site's GPU buffers: each mesh's geometry, its model matrix and the camera,
// as scene.glb (open it in Blender or any glTF viewer too). The look (the site's shaders, lighting, post-processing)
// is in the replay; this is the scene graph to build on: swap materials, add lights, animate the nodes.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function mountRecoveredScene(el = document.body, o = {}) {
  const w = o.width || el.clientWidth || innerWidth;
  const h = o.height || el.clientHeight || innerHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!o.once });
  renderer.setPixelRatio(o.pixelRatio || Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  el.appendChild(renderer.domElement);
  const gltf = await new GLTFLoader().loadAsync(o.url || '/scene/scene.glb');
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202028, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  if (o.material) gltf.scene.traverse((m) => { if (m.isMesh) m.material = o.material; });
  // the recorded camera: its world matrix is the inverse of the view matrix the site used
  let camera = gltf.cameras[0];
  if (camera && camera.isPerspectiveCamera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  } else if (!camera) {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    camera = new THREE.PerspectiveCamera(45, w / h, size / 100, size * 100);
    camera.position.copy(box.getCenter(new THREE.Vector3())).add(new THREE.Vector3(0, 0, size));
    camera.lookAt(box.getCenter(new THREE.Vector3()));
  }
  scene.updateMatrixWorld(true);
  const draw = () => renderer.render(scene, camera);
  if (o.once) draw();
  else renderer.setAnimationLoop(draw);
  return {
    scene,
    camera,
    renderer,
    gltf,
    dispose() {
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
`;
}

/** scene.md: what was recovered and how sure each part is. */
export function sceneMd(s: RecoveredScene, site: string): string {
  const L = [
    `# 3D scene recovered from ${site}`,
    '',
    `${s.meshes.length} mesh draw(s) read back from the GPU buffers of the recorded frame and written to \`public/scene/scene.glb\` with their model matrices and the camera. Load it with \`scene/scene.js\` or open it in Blender.`,
    '',
    '| draw | vertices | indices | model matrix from | instances | model file (by vertex count) |',
    '|---|---|---|---|---|---|',
    ...s.meshes.map(
      (m) =>
        `| ${m.frame}:${m.cmd} | ${m.vertexCount.toLocaleString('en-US')} | ${m.indices ? m.indices.length.toLocaleString('en-US') : '–'} | ${m.modelFrom} | ${m.instances?.length ?? 1} | ${m.match ? `≈ ${m.match}` : '–'} |`,
    ),
    '',
    s.camera
      ? `✔ Camera from ${s.camera.from}${s.camera.perspective ? `: perspective, vertical field of view ${((s.camera.perspective.yfov * 180) / Math.PI).toFixed(1)}°, aspect ${s.camera.perspective.aspect.toFixed(3)}, near ${s.camera.perspective.znear.toPrecision(3)}, far ${s.camera.perspective.zfar.toPrecision(3)}` : ' (orthographic)'}.`
      : '≈ No projection uniform was found on the mesh draws; the camera is framed on the scene bounds instead.',
    '',
    '✔ Geometry and matrices are read from the recording. ≈ A vertex shader can move vertices further (displacement, skinning, morphs, particles on textures): those moves are not baked into the glTF; the replay keeps them.',
    ...(s.skipped.length ? ['', '## Draws left out', '', ...s.skipped.slice(0, 20).map((x) => `- ${x}`)] : []),
    '',
  ];
  return L.join('\n');
}

export type { DrawInfo };
