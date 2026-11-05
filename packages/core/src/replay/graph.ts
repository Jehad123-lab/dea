// The render graph of a recorded WebGL frame sequence (dea extract's replay): every draw with the program, target,
// inputs and state it ran with, grouped into passes; the clock uniforms to animate; and the meshes, model matrices and
// camera of the 3D draws, so the scene can be rebuilt as a glTF. Everything here is read from the recording (Verified);
// a pass's role (simulation, bloom, composite...) is DEA's reading of it (Inferred) and says why.

export type Arg = null | number | boolean | string | Arg[] | { $: string; [k: string]: unknown };
export type Cmd = [string, ...Arg[]];

export interface FrameState {
  en: Record<string, boolean>;
  p: Record<string, unknown>;
  program: number;
  arrayBuffer: number;
  vao: number;
  drawFb: number;
  readFb: number;
  rb: number;
  activeTexture: number;
  units: Array<{ u: number; '2d'?: number; cube?: number; '3d'?: number; array?: number; smp?: number }>;
  defaultVao?: VaoSnap;
  current?: number[][];
}

export interface VaoAttr {
  i: number;
  en: boolean;
  size: number;
  type: number;
  norm: boolean;
  stride: number;
  off: number;
  int?: boolean;
  div?: number;
  buf?: number;
}
export interface VaoSnap {
  attrs: VaoAttr[];
  el: number;
}

export interface CaptureDoc {
  version: 1 | 2;
  canvas: { w: number; h: number; cssW: number; cssH: number; x: number; y: number; style: Record<string, string> };
  dpr: number;
  attrs: Record<string, unknown>;
  extensions: string[];
  snap: {
    buffers: Array<{ id: number; kind: string; usage: number; o: number; l: number }>;
    textures: Array<{
      id: number;
      missing?: boolean;
      target: number;
      params: Record<string, number>;
      levels: Array<{ level: number; face: number; ifmt: number; w: number; h: number; d: number; skipped?: string; upload?: unknown; o?: number; l?: number }>;
      comp?: unknown[];
    }>;
    programs: Array<{
      id: number;
      shaders: Array<{ type: number; src: string }>;
      attribs: Array<{ name: string; type: number; size: number; loc: number }>;
      uniforms: Array<{ name: string; type: number; v: number | number[] }>;
    }>;
    renderbuffers: Array<{ id: number; internalformat?: number; w?: number; h?: number; samples?: number }>;
    samplers: unknown[];
    framebuffers: Array<{ id: number; atts: Array<{ a: number; type: number; tex?: number; rb?: number; level?: number }>; draw: number[]; read: number }>;
    vaos: Array<VaoSnap & { id: number }>;
  };
  frames: Array<{ state: FrameState | null; cmds: Cmd[]; ms: number; ts?: number; ptr?: [number, number] | null }>;
  /** the recording continued while the pointer moved along a known path: frames from `from` on are the tape ('move' frames with the pointer moving, then 'still' frames as it settles) */
  tape?: { from: number; move: number; still: number; anchors?: import('./tape.ts').TapeAnchor[]; fit?: unknown };
  /** the tape's frames (split off `frames` after the recording is compacted): rebuild and replay play them while the pointer moves */
  tapeFrames?: CaptureDoc['frames'];
  errors: string[];
  overflow: boolean;
  binBytes: number;
  url: string;
  at: string;
  contexts: number;
  animate?: AnimateEntry[];
  /** 'last': live, play the last recorded frame alone (set when the two recorded frames flip back and forth even with held uniforms) */
  hold?: 'last';
  /** uniforms that follow the pointer, scroll or window size (measured by the input probe, or read from names) */
  inputs?: import('./inputs.ts').InputMap[];
  /** the window size (CSS px) when the recording was made */
  viewport?: { w: number; h: number } | null;
  graph?: RenderGraph;
}

export interface AnimateEntry {
  frame: number;
  cmd: number;
  /** index into the command's arguments (after the function name) */
  arg: number;
  uniform: string;
  base: number;
  /** change per millisecond of wall time */
  rate: number;
}

export interface DrawInfo {
  frame: number;
  cmd: number;
  fn: string;
  mode: number;
  count: number;
  instances: number;
  program: number;
  fb: number;
  vao: number;
  inputs: Array<{ uniform: string; tex: number }>;
  blend: boolean;
  blendFunc: number[];
  depthTest: boolean;
  depthMask: boolean;
  viewport: number[];
  /** element type and byte offset for drawElements */
  index?: { type: number; offset: number; buf: number };
  first?: number;
  uniforms: Record<string, number[]>;
  attrs: VaoAttr[];
}

export interface TextureInfo {
  id: number;
  w: number;
  h: number;
  format: string;
  /** written by a pass (render target) */
  target: boolean;
  label: string;
}

export interface Pass {
  index: number;
  frame: number;
  target: { fb: number; label: string; w: number; h: number; format: string };
  programs: string[];
  draws: Array<{ frame: number; cmd: number }>;
  drawCount: number;
  primitives: string;
  inputs: string[];
  blend: string;
  depth: string;
  role: string;
  why: string;
}

export interface ProgramInfo {
  id: number;
  label: string;
  uniforms: string[];
  samplers: string[];
  draws: number;
}

export interface RenderGraph {
  programs: ProgramInfo[];
  passes: Pass[];
  textures: TextureInfo[];
  /** passes per frame and which frames repeat */
  frames: number;
}

const BUILTIN = new Set([
  'modelMatrix',
  'modelViewMatrix',
  'projectionMatrix',
  'viewMatrix',
  'normalMatrix',
  'cameraPosition',
  'isOrthographic',
  'toneMappingExposure',
  'logDepthBufFC',
]);
const SAMPLER = new Set([0x8b5e, 0x8b5f, 0x8b60, 0x8b62, 0x8dc1, 0x8dc4, 0x8dc5, 0x8dca, 0x8dcb, 0x8dcc, 0x8dcf, 0x8dd2, 0x8dd3, 0x8dd4, 0x8dd7]);
const SAMPLER_KIND: Record<number, string> = {
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
const MODES: Record<number, string> = { 0: 'points', 1: 'lines', 2: 'line loop', 3: 'line strip', 4: 'triangles', 5: 'triangle strip', 6: 'triangle fan' };
const IFMT: Record<number, string> = {
  6408: 'RGBA',
  6407: 'RGB',
  32856: 'RGBA8',
  32849: 'RGB8',
  33321: 'R8',
  33323: 'RG8',
  34842: 'RGBA16F',
  34836: 'RGBA32F',
  33325: 'R16F',
  33327: 'RG16F',
  33326: 'R32F',
  33328: 'RG32F',
  35898: 'R11F_G11F_B10F',
  35907: 'SRGB8_ALPHA8',
  34843: 'RGB16F',
  34837: 'RGB32F',
  33189: 'DEPTH16',
  33190: 'DEPTH24',
  36012: 'DEPTH32F',
  35056: 'DEPTH24_STENCIL8',
  6402: 'DEPTH',
};
const BLEND: Record<number, string> = {
  0: 'ZERO',
  1: 'ONE',
  768: 'SRC_COLOR',
  769: '1-SRC_COLOR',
  770: 'SRC_ALPHA',
  771: '1-SRC_ALPHA',
  772: 'DST_ALPHA',
  773: '1-DST_ALPHA',
  774: 'DST_COLOR',
  775: '1-DST_COLOR',
};

/** Numbers of a recorded argument (a typed array in the binary, an inline array, or a number). */
export function numbers(a: Arg, bin: Uint8Array): number[] {
  if (typeof a === 'number') return [a];
  if (typeof a === 'boolean') return [a ? 1 : 0];
  if (Array.isArray(a)) return a.flatMap((x) => numbers(x, bin));
  if (a && typeof a === 'object' && a.$ === 'bin') {
    const o = Number(a.o);
    const l = Number(a.l);
    const t = String(a.t);
    const dv = new DataView(bin.buffer, bin.byteOffset + o, l);
    const out: number[] = [];
    const size = /64/.test(t) ? 8 : /32/.test(t) ? 4 : /16/.test(t) ? 2 : 1;
    for (let i = 0; i + size <= l && out.length < 4096; i += size)
      out.push(
        t === 'Float32Array'
          ? dv.getFloat32(i, true)
          : t === 'Float64Array'
            ? dv.getFloat64(i, true)
            : t === 'Int32Array'
              ? dv.getInt32(i, true)
              : t === 'Uint32Array'
                ? dv.getUint32(i, true)
                : t === 'Int16Array'
                  ? dv.getInt16(i, true)
                  : t === 'Uint16Array'
                    ? dv.getUint16(i, true)
                    : t === 'Int8Array'
                      ? dv.getInt8(i)
                      : dv.getUint8(i),
      );
    return out;
  }
  return [];
}

const ref = (a: Arg, kind: string): number => (a && typeof a === 'object' && !Array.isArray(a) && a.$ === kind ? Number(a.id) : 0);
const locName = (a: Arg): { p: number; n: string } | null =>
  a && typeof a === 'object' && !Array.isArray(a) && a.$ === 'loc' ? { p: Number(a.p), n: String(a.n) } : null;

/** A short name for a program: three.js's SHADER_NAME when present, and its own uniforms. */
export function programLabel(p: CaptureDoc['snap']['programs'][number]): { label: string; uniforms: string[]; samplers: string[] } {
  const src = p.shaders.map((s) => s.src).join('\n');
  const named = /#define[ \t]+SHADER_NAME[ \t]+([^\s]+)/.exec(src)?.[1];
  const own = p.uniforms.map((u) => u.name.replace(/\[\d+\]$/, '')).filter((n, i, a) => !BUILTIN.has(n) && a.indexOf(n) === i);
  const samplers = p.uniforms.filter((u) => SAMPLER.has(u.type)).map((u) => u.name);
  const shown = own.slice(0, 4).join(', ');
  const label = `${named && !/^(ShaderMaterial|RawShaderMaterial)$/.test(named) ? named : named ? named : 'program'} #${p.id}${shown ? ` (${shown}${own.length > 4 ? ', …' : ''})` : ''}`;
  return { label, uniforms: own, samplers };
}

const CLOCK = /time|tick|elapsed|clock|^u?t$|^uT$|frame/i;

/**
 * Clock uniforms: a scalar uniform named like a clock whose value grows between the recorded frames advances with real
 * time in the replay (base + rate × ms). Other values replay as recorded, alternating frame by frame.
 */
export function animateEntries(doc: CaptureDoc): AnimateEntry[] {
  const out: AnimateEntry[] = [];
  if (doc.frames.length < 2) return out;
  const [a, b] = doc.frames;
  const ta = a.ts ?? 0;
  const tb = b.ts ?? ta + 16.7;
  const dt = tb - ta || 16.7;
  // match the n-th call of each uniform location in frame a to the n-th in frame b
  const key = (c: Cmd) => {
    const l = locName(c[1] as Arg);
    return l ? `${c[0]}|${l.p}|${l.n}` : null;
  };
  const seen = new Map<string, number>();
  const firstVals = new Map<string, Array<{ cmd: number; v: number }>>();
  a.cmds.forEach((c, i) => {
    const k = key(c);
    if (!k || !/^uniform1f$/.test(c[0]) || typeof c[2] !== 'number') return;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    firstVals.set(`${k}#${n}`, [{ cmd: i, v: c[2] }]);
  });
  seen.clear();
  b.cmds.forEach((c, i) => {
    const k = key(c);
    if (!k || !/^uniform1f$/.test(c[0]) || typeof c[2] !== 'number') return;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    const A = firstVals.get(`${k}#${n}`);
    if (!A) return;
    const name = (locName(c[1] as Arg) as { n: string }).n;
    const va = A[0].v;
    const vb = c[2];
    if (!CLOCK.test(name) || !(vb > va)) return;
    const rate = (vb - va) / dt;
    out.push({ frame: 0, cmd: A[0].cmd, arg: 1, uniform: name, base: va, rate });
    out.push({ frame: 1, cmd: i, arg: 1, uniform: name, base: vb - rate * dt, rate });
  });
  return out;
}

interface Sim {
  program: number;
  drawFb: number;
  readFb: number;
  active: number;
  units: Map<number, Record<string, number>>;
  vao: number;
  arrayBuffer: number;
  en: Record<string, boolean>;
  blendFunc: number[];
  depthMask: boolean;
  viewport: number[];
}

/** A write or read of textures, in command order (for deciding which textures' contents the frames need). */
export interface TexEvent {
  frame: number;
  cmd: number;
  reads: number[];
  /** textures written, and whether the whole image is overwritten */
  writes: Array<{ tex: number; full: boolean }>;
}

/** Walk the recorded commands with the recorded state and list every draw with what it ran with. */
export function listDraws(doc: CaptureDoc, bin: Uint8Array, events?: TexEvent[]): DrawInfo[] {
  const draws: DrawInfo[] = [];
  const fbAtt = new Map<number, Map<number, number>>();
  for (const f of doc.snap.framebuffers) fbAtt.set(f.id, new Map(f.atts.filter((a) => a.tex).map((a) => [a.a, a.tex as number])));
  const texSize = new Map<number, [number, number]>();
  for (const t of doc.snap.textures) {
    const L = t.levels?.find((l) => l.level === 0);
    if (L) texSize.set(t.id, [L.w, L.h]);
  }
  // uniform values per program, from the snapshots, then as the commands set them
  const uni = new Map<number, Map<string, number[]>>();
  const utype = new Map<number, Map<string, number>>();
  for (const p of doc.snap.programs) {
    uni.set(p.id, new Map(p.uniforms.map((u) => [u.name, Array.isArray(u.v) ? u.v : [u.v]])));
    utype.set(p.id, new Map(p.uniforms.map((u) => [u.name, u.type])));
  }
  const vaos = new Map<number, { attrs: Map<number, VaoAttr>; el: number }>();
  for (const v of doc.snap.vaos) vaos.set(v.id, { attrs: new Map(v.attrs.map((a) => [a.i, { ...a }])), el: v.el });
  doc.frames.forEach((f, fi) => {
    const st = f.state;
    if (!st) return;
    if (st.defaultVao) vaos.set(0, { attrs: new Map(st.defaultVao.attrs.map((a) => [a.i, { ...a }])), el: st.defaultVao.el });
    const p = st.p;
    const s: Sim = {
      program: st.program,
      drawFb: st.drawFb,
      readFb: st.readFb,
      active: (st.activeTexture ?? 0x84c0) - 0x84c0,
      units: new Map(st.units.map((u) => [u.u, { ...u } as unknown as Record<string, number>])),
      vao: st.vao,
      arrayBuffer: st.arrayBuffer,
      en: { ...st.en },
      blendFunc: [p[0x80c9], p[0x80c8], p[0x80cb], p[0x80ca]].map(Number),
      depthMask: Boolean(p[0x0b72]),
      viewport: (p[0x0ba2] as number[]) ?? [0, 0, doc.canvas.w, doc.canvas.h],
    };
    const vao = () => {
      let v = vaos.get(s.vao);
      if (!v) {
        v = { attrs: new Map(), el: 0 };
        vaos.set(s.vao, v);
      }
      return v;
    };
    f.cmds.forEach((c, ci) => {
      const [name, ...a] = c;
      switch (name) {
        case 'useProgram':
          s.program = ref(a[0], 'prog');
          break;
        case 'bindFramebuffer': {
          const fb = ref(a[1], 'fb');
          if (a[0] === 0x8d40 || a[0] === 0x8ca9) s.drawFb = fb;
          if (a[0] === 0x8d40 || a[0] === 0x8ca8) s.readFb = fb;
          break;
        }
        case 'activeTexture':
          s.active = Number(a[0]) - 0x84c0;
          break;
        case 'framebufferTexture2D':
        case 'framebufferTextureLayer': {
          const fb = a[0] === 0x8ca8 ? s.readFb : s.drawFb;
          if (!fbAtt.has(fb)) fbAtt.set(fb, new Map());
          (fbAtt.get(fb) as Map<number, number>).set(Number(a[1]), ref(a[name === 'framebufferTexture2D' ? 3 : 2], 'tex'));
          break;
        }
        case 'texImage2D':
        case 'texStorage2D': {
          const u = s.units.get(s.active) ?? {};
          const t = u[Number(a[0]) === 0x0de1 ? '2d' : 'cube'];
          if (t && name === 'texStorage2D') texSize.set(t, [Number(a[3]), Number(a[4])]);
          else if (t && a.length >= 8 && a[1] === 0) texSize.set(t, [Number(a[3]), Number(a[4])]);
          if (t && events) events.push({ frame: fi, cmd: ci, reads: [], writes: [{ tex: t, full: true }] });
          break;
        }
        case 'texSubImage2D':
        case 'copyTexSubImage2D':
        case 'generateMipmap': {
          const u = s.units.get(s.active) ?? {};
          const t = u[Number(a[0]) === 0x0de1 ? '2d' : 'cube'];
          if (t && events) events.push({ frame: fi, cmd: ci, reads: [t], writes: [{ tex: t, full: false }] });
          break;
        }
        case 'clear': {
          if (!events) break;
          const bits = Number(a[0]);
          const atts = fbAtt.get(s.drawFb) ?? new Map();
          const full = !s.en[String(0x0c11)];
          const writes: TexEvent['writes'] = [];
          for (const [at, tex] of atts) {
            const color = at >= 0x8ce0 && at <= 0x8cef;
            if ((color && bits & 0x4000) || (at === 0x8d00 && bits & 0x100) || (at === 0x821a && bits & 0x100 && bits & 0x400)) writes.push({ tex, full });
            else if (at === 0x821a && bits & 0x500) writes.push({ tex, full: false });
          }
          events.push({ frame: fi, cmd: ci, reads: writes.filter((w) => !w.full).map((w) => w.tex), writes });
          break;
        }
        case 'blitFramebuffer': {
          if (!events) break;
          const src = [...(fbAtt.get(s.readFb) ?? new Map()).values()];
          const dst = [...(fbAtt.get(s.drawFb) ?? new Map()).values()];
          events.push({ frame: fi, cmd: ci, reads: src, writes: dst.map((tex) => ({ tex, full: false })) });
          break;
        }
        case 'bindTexture': {
          const k = { 3553: '2d', 34067: 'cube', 32879: '3d', 35866: 'array' }[Number(a[0])] ?? '2d';
          const u = s.units.get(s.active) ?? {};
          u[k] = ref(a[1], 'tex');
          s.units.set(s.active, u);
          break;
        }
        case 'bindVertexArray':
        case 'ext:OES_vertex_array_object.bindVertexArrayOES':
          s.vao = ref(a[0], 'vao');
          break;
        case 'bindBuffer':
          if (a[0] === 0x8892) s.arrayBuffer = ref(a[1], 'buf');
          else if (a[0] === 0x8893) vao().el = ref(a[1], 'buf');
          break;
        case 'vertexAttribPointer':
          vao().attrs.set(Number(a[0]), {
            ...(vao().attrs.get(Number(a[0])) ?? { en: false }),
            i: Number(a[0]),
            size: Number(a[1]),
            type: Number(a[2]),
            norm: Boolean(a[3]),
            stride: Number(a[4]),
            off: Number(a[5]),
            int: false,
            buf: s.arrayBuffer,
          });
          break;
        case 'vertexAttribIPointer':
          vao().attrs.set(Number(a[0]), {
            ...(vao().attrs.get(Number(a[0])) ?? { en: false }),
            i: Number(a[0]),
            size: Number(a[1]),
            type: Number(a[2]),
            norm: false,
            stride: Number(a[3]),
            off: Number(a[4]),
            int: true,
            buf: s.arrayBuffer,
          });
          break;
        case 'enableVertexAttribArray':
        case 'disableVertexAttribArray': {
          const at = vao().attrs.get(Number(a[0])) ?? ({ i: Number(a[0]), size: 4, type: 0x1406, norm: false, stride: 0, off: 0 } as VaoAttr);
          at.en = name === 'enableVertexAttribArray';
          vao().attrs.set(Number(a[0]), at);
          break;
        }
        case 'vertexAttribDivisor':
        case 'ext:ANGLE_instanced_arrays.vertexAttribDivisorANGLE': {
          const at = vao().attrs.get(Number(a[0]));
          if (at) at.div = Number(a[1]);
          break;
        }
        case 'enable':
        case 'disable':
          s.en[String(a[0])] = name === 'enable';
          break;
        case 'blendFunc':
          s.blendFunc = [Number(a[0]), Number(a[1]), Number(a[0]), Number(a[1])];
          break;
        case 'blendFuncSeparate':
          s.blendFunc = a.slice(0, 4).map(Number);
          break;
        case 'depthMask':
          s.depthMask = Boolean(a[0]);
          break;
        case 'viewport':
          s.viewport = a.slice(0, 4).map(Number);
          break;
        default:
          if (/^uniform/.test(name)) {
            const l = locName(a[0]);
            if (!l) break;
            const vals = /^uniformMatrix/.test(name) ? numbers(a[2], bin) : a.slice(1).flatMap((x) => numbers(x, bin));
            if (!uni.has(l.p)) uni.set(l.p, new Map());
            (uni.get(l.p) as Map<string, number[]>).set(l.n, vals);
          } else if (/^draw|ext:ANGLE_instanced_arrays\.draw/.test(name) && !/drawBuffers/.test(name)) {
            const fn = name.replace(/^ext:ANGLE_instanced_arrays\./, '').replace(/ANGLE$/, '');
            const elements = /Elements/.test(fn);
            const range = fn === 'drawRangeElements';
            const mode = Number(a[0]);
            const count = Number(range ? a[3] : a[elements ? 1 : 2]);
            const instances = /Instanced/.test(fn) ? Number(a[elements ? 4 : 3]) : 1;
            const values = uni.get(s.program) ?? new Map();
            const types = utype.get(s.program) ?? new Map();
            const inputs: DrawInfo['inputs'] = [];
            for (const [n, t] of types) {
              if (!SAMPLER.has(t)) continue;
              const unit = (values.get(n) ?? [0])[0];
              const tex = s.units.get(unit)?.[SAMPLER_KIND[t] ?? '2d'] ?? 0;
              if (tex) inputs.push({ uniform: n, tex });
            }
            const v = vao();
            if (events) {
              const atts = fbAtt.get(s.drawFb) ?? new Map();
              const writes: TexEvent['writes'] = [];
              for (const [at, tex] of atts) {
                const color = at >= 0x8ce0 && at <= 0x8cef;
                if (!color && !(s.depthMask && s.en[String(0x0b71)])) continue;
                const sz = texSize.get(tex);
                const covers = !!sz && s.viewport[0] <= 0 && s.viewport[1] <= 0 && s.viewport[2] >= sz[0] && s.viewport[3] >= sz[1];
                const full = color && count <= 6 && mode >= 4 && instances <= 1 && covers && !s.en[String(0x0be2)] && !s.en[String(0x0c11)];
                writes.push({ tex, full });
              }
              events.push({ frame: fi, cmd: ci, reads: inputs.map((i) => i.tex), writes });
            }
            draws.push({
              frame: fi,
              cmd: ci,
              fn,
              mode,
              count,
              instances,
              program: s.program,
              fb: s.drawFb,
              vao: s.vao,
              inputs,
              blend: Boolean(s.en[String(0x0be2)]),
              blendFunc: s.blendFunc,
              depthTest: Boolean(s.en[String(0x0b71)]),
              depthMask: s.depthMask,
              viewport: s.viewport,
              ...(elements ? { index: { type: Number(range ? a[4] : a[2]), offset: Number(range ? a[5] : a[3]), buf: v.el } } : { first: Number(a[1]) }),
              uniforms: Object.fromEntries(values),
              attrs: [...v.attrs.values()].filter((x) => x.en).map((x) => ({ ...x })),
            });
          }
      }
    });
  });
  return draws;
}

/** Group the draws into passes (a pass = consecutive draws into the same target) and read each pass's role. */
export function buildGraph(doc: CaptureDoc, bin: Uint8Array): RenderGraph {
  const draws = listDraws(doc, bin);
  const progs = new Map(doc.snap.programs.map((p) => [p.id, { ...programLabel(p), id: p.id, src: p.shaders.map((s) => s.src).join('\n') }]));
  const progLabel = (id: number) => progs.get(id)?.label ?? (id ? `program #${id} (made during the recording)` : 'none');
  // render targets: framebuffer -> colour attachment texture
  const fbTex = new Map<number, number>();
  for (const f of doc.snap.framebuffers) {
    const c = f.atts.find((a) => a.a === 0x8ce0 && a.tex);
    if (c?.tex) fbTex.set(f.id, c.tex);
  }
  const texSnap = new Map(doc.snap.textures.map((t) => [t.id, t]));
  const written = new Set<number>([...fbTex.values()]);
  const texInfo = (id: number): TextureInfo => {
    const t = texSnap.get(id);
    const L = t?.levels.find((l) => l.level === 0) ?? t?.levels[0];
    const w = L?.w ?? 0;
    const h = L?.h ?? 0;
    const format = L ? (IFMT[L.ifmt] ?? `0x${L.ifmt.toString(16)}`) : t?.comp?.length ? 'compressed' : '?';
    return {
      id,
      w,
      h,
      format,
      target: written.has(id),
      label: `tex#${id} ${w}×${h} ${format}${written.has(id) ? ' (render target)' : t?.levels.some((l) => l.upload) ? ' (image)' : ''}`,
    };
  };
  const fbInfo = (fb: number) => {
    if (!fb) return { fb: 0, label: `screen ${doc.canvas.w}×${doc.canvas.h}`, w: doc.canvas.w, h: doc.canvas.h, format: 'canvas' };
    const t = fbTex.get(fb);
    if (!t) return { fb, label: `framebuffer #${fb}`, w: 0, h: 0, format: '?' };
    const ti = texInfo(t);
    return { fb, label: `render target ${ti.w}×${ti.h} ${ti.format} (tex#${t})`, w: ti.w, h: ti.h, format: ti.format };
  };
  const passes: Pass[] = [];
  let cur: (Pass & { _d: DrawInfo[] }) | null = null;
  for (const d of draws) {
    if (!cur || cur.frame !== d.frame || cur.target.fb !== d.fb) {
      cur = {
        index: passes.length,
        frame: d.frame,
        target: fbInfo(d.fb),
        programs: [],
        draws: [],
        drawCount: 0,
        primitives: '',
        inputs: [],
        blend: '',
        depth: '',
        role: '',
        why: '',
        _d: [],
      };
      passes.push(cur);
    }
    cur._d.push(d);
    cur.draws.push({ frame: d.frame, cmd: d.cmd });
  }
  const usedTex = new Set<number>();
  for (const P of passes as Array<Pass & { _d: DrawInfo[] }>) {
    const ds = P._d;
    P.drawCount = ds.length;
    P.programs = [...new Set(ds.map((d) => progLabel(d.program)))];
    const prim = new Map<string, number>();
    for (const d of ds) prim.set(MODES[d.mode] ?? String(d.mode), (prim.get(MODES[d.mode] ?? String(d.mode)) ?? 0) + d.count * d.instances);
    P.primitives = [...prim].map(([m, n]) => `${n.toLocaleString('en-US')} vertices as ${m}`).join(', ');
    const ins = new Map<number, string>();
    for (const d of ds)
      for (const i of d.inputs) {
        ins.set(i.tex, `${i.uniform} ← ${texInfo(i.tex).label}`);
        usedTex.add(i.tex);
      }
    P.inputs = [...ins.values()];
    const b = ds.find((d) => d.blend);
    P.blend = b ? `on (${b.blendFunc.map((x) => BLEND[x] ?? x).join(', ')})` : 'off';
    const dt = ds.find((d) => d.depthTest);
    P.depth = dt ? `test on, write ${dt.depthMask ? 'on' : 'off'}` : 'off';
    const src = ds.map((d) => progs.get(d.program)?.src ?? '').join('\n');
    const names = ds
      .flatMap((d) => [progs.get(d.program)?.label ?? '', ...(progs.get(d.program)?.uniforms ?? []), ...d.inputs.map((i) => i.uniform)])
      .join(' ');
    const fullscreen = ds.every((d) => d.count <= 6 && d.instances <= 1 && d.mode >= 4);
    const readsTargets = ds.some((d) => d.inputs.some((i) => written.has(i.tex)));
    const float = /F$|32F|16F/.test(P.target.format);
    const prevFull = passes[P.index - 1];
    if (P.target.fb && fullscreen && float && readsTargets && /pos|vel|sim|life/i.test(names)) {
      P.role = 'simulation step (GPGPU ping-pong)';
      P.why = 'a full-screen draw into a float render target that reads other render targets, with state-like uniform names';
    } else if (P.target.fb && fullscreen && readsTargets && /prev|trail|ripple|feedback|history/i.test(names)) {
      P.role = 'simulation step (feedback: reads its previous result)';
      P.why = 'a full-screen draw into a render target that reads an earlier result (prev/trail/feedback names)';
    } else if (ds.some((d) => d.mode === 0)) {
      P.role = 'points (particles)';
      P.why = `${ds.filter((d) => d.mode === 0).length} draw(s) of gl.POINTS`;
    } else if ((/smaa|edgesTex|blendTex|areaTex|searchTex/i.test(names) || /SMAA/.test(src)) && fullscreen) {
      P.role = 'SMAA anti-aliasing';
      P.why = 'SMAA textures or names in the program';
    } else if (/bloom|luminosity|luminance|blur|kawase|mip|threshold|downsampl|upsampl|convolution/i.test(names) && fullscreen) {
      P.role = prevFull && P.target.w && prevFull.target.w && P.target.w < prevFull.target.w ? 'bloom (downsample)' : 'bloom / blur';
      P.why = 'bloom or blur names in the program';
    } else if (fullscreen && P.target.fb && prevFull?.target.w && P.target.w && P.target.w * 2 <= prevFull.target.w + 1) {
      P.role = 'downsample';
      P.why = 'a full-screen draw into a target half the size of the previous one';
    } else if (fullscreen && !P.target.fb) {
      P.role = /blue|noise|dither/i.test(names) ? 'composite to screen (with blue-noise dither)' : 'composite to screen';
      P.why = 'a full-screen draw into the canvas';
    } else if (fullscreen) {
      P.role = 'full-screen pass';
      P.why = 'a full-screen draw into a render target';
    } else {
      P.role = ds.some((d) => d.instances > 1) ? 'meshes (instanced)' : 'meshes';
      P.why = `${ds.length} draw(s) of geometry with more than two triangles`;
    }
    delete (P as Partial<Pass & { _d: DrawInfo[] }>)._d;
  }
  const programs: ProgramInfo[] = [...progs.values()].map((p) => ({
    id: p.id,
    label: p.label,
    uniforms: p.uniforms,
    samplers: p.samplers,
    draws: draws.filter((d) => d.program === p.id).length,
  }));
  const textures = [...new Set([...usedTex, ...written])].map(texInfo);
  return { programs, passes, textures, frames: doc.frames.length };
}

/** render-graph.md: the passes in order, Verified facts and the Inferred role of each. */
export function renderGraphMd(g: RenderGraph, doc: CaptureDoc, site: string): string {
  const L = [
    `# Render graph of ${site}`,
    '',
    `Recorded live by DEA: ${g.frames} consecutive frames of the site's WebGL${doc.version} context (${doc.canvas.w}×${doc.canvas.h} drawing buffer), every call with its arguments, and every buffer, texture, program and render target as it was when the frames began. The replay (\`replay/replay.js\`) runs exactly these calls, so it draws what the site drew.`,
    '',
    '✔ Verified = read from the recording (target, programs, draws, inputs, blend, depth). ≈ Inferred = the role DEA reads from those facts, with why.',
    '',
  ];
  for (let f = 0; f < g.frames; f++) {
    const ps = g.passes.filter((p) => p.frame === f);
    L.push(`## Frame ${f + 1}: ${ps.length} passes, ${ps.reduce((n, p) => n + p.drawCount, 0)} draws`, '');
    for (const p of ps) {
      L.push(
        `### Pass ${p.index}: ${p.role} (≈)`,
        '',
        `- ✔ Target: ${p.target.label}`,
        `- ✔ Programs: ${p.programs.join('; ')}`,
        `- ✔ Draws: ${p.drawCount} (${p.primitives})`,
        `- ✔ Reads: ${p.inputs.length ? p.inputs.join('; ') : 'no textures'}`,
        `- ✔ Blend ${p.blend}; depth ${p.depth}`,
        `- ≈ Role: ${p.role}, because ${p.why}`,
        '',
      );
    }
  }
  L.push(
    '## Programs',
    '',
    '| program | own uniforms | samplers | draws |',
    '|---|---|---|---|',
    ...g.programs.filter((p) => p.draws).map((p) => `| ${p.label} | ${p.uniforms.join(', ') || '–'} | ${p.samplers.join(', ') || '–'} | ${p.draws} |`),
    '',
    'Change a value live: `replay.setUniform("<program label or id>", "<uniform>", value)`. Switch a pass off: `replay.setPassEnabled(<pass index>, false)`.',
    '',
  );
  if (doc.errors.length) L.push('## Recording notes', '', ...doc.errors.slice(0, 20).map((e) => `- ${e}`), '');
  return `${L.join('\n')}\n`;
}

/**
 * Textures whose contents the recorded frames never need: the first thing the frames do with them is overwrite the
 * whole image (a clear, or a full-screen opaque draw), or they are never touched. Their pixels can be left out of the
 * recording; the replay allocates them empty.
 */
export function unneededTextures(doc: CaptureDoc, bin: Uint8Array): Set<number> {
  const events: TexEvent[] = [];
  listDraws(doc, bin, events);
  const first = new Map<number, 'read' | 'full' | 'partial'>();
  for (const e of events) {
    for (const t of e.reads) if (!first.has(t)) first.set(t, 'read');
    for (const w of e.writes) if (!first.has(w.tex)) first.set(w.tex, w.full ? 'full' : 'partial');
  }
  // a texture bound as a sampler or written partially stays; one fully overwritten first, or never touched, goes
  const out = new Set<number>();
  for (const t of doc.snap.textures) {
    const f = first.get(t.id);
    if (f === 'full' || f === undefined) out.add(t.id);
  }
  return out;
}

/** float32 -> IEEE half (round to nearest). */
export function toHalf(f: number): number {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, f);
  const x = b.getUint32(0);
  const sign = (x >>> 16) & 0x8000;
  const e = (x >>> 23) & 0xff;
  let m = x & 0x7fffff;
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  const exp = e - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    m = (m | 0x800000) >> (1 - exp);
    return sign | ((m + 0x1000) >> 13);
  }
  const h = sign | (exp << 10) | (m >> 13);
  return m & 0x1000 ? h + 1 : h;
}

const HALF_OK = new Set([0x881a, 0x822d, 0x822f, 0x881b, 0x8c3a]);

/**
 * A smaller copy of the recording: textures the frames overwrite before reading keep only their size and format,
 * half-float textures are stored as halves, and the binary is rewritten with only the bytes still referenced.
 */
export function compactCapture(doc: CaptureDoc, bin: Uint8Array, opts: { drop?: Set<number> } = {}): { doc: CaptureDoc; bin: Buffer; dropped: number } {
  const drop = opts.drop ?? unneededTextures(doc, bin);
  const out = structuredClone(doc) as CaptureDoc;
  const chunks: Buffer[] = [];
  let size = 0;
  const put = (b: Uint8Array): number => {
    const pad = (8 - (size % 8)) % 8;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      size += pad;
    }
    const o = size;
    chunks.push(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
    size += b.byteLength;
    return o;
  };
  const slice = (o: number, l: number) => bin.subarray(o, o + l);
  let dropped = 0;
  for (const B of out.snap.buffers) B.o = put(slice(B.o, B.l));
  for (const T of out.snap.textures) {
    for (const L of T.levels ?? []) {
      const lv = L as typeof L & { upFmt?: number; upType?: number; alloc?: number[] };
      if (lv.o == null || lv.l == null) continue;
      if (drop.has(T.id)) {
        dropped += lv.l;
        lv.alloc = [lv.upFmt ?? 0x1908, HALF_OK.has(L.ifmt) ? 0x140b : (lv.upType ?? 0x1401)];
        delete lv.o;
        delete lv.l;
        continue;
      }
      const raw = slice(lv.o, lv.l);
      if (HALF_OK.has(L.ifmt) && lv.upType === 0x1406) {
        const f = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
        const h = new Uint16Array(f.length);
        for (let i = 0; i < f.length; i++) h[i] = toHalf(f[i]);
        lv.o = put(new Uint8Array(h.buffer));
        lv.l = h.byteLength;
        lv.upType = 0x140b;
      } else lv.o = put(raw);
    }
  }
  // every other binary reference (command arguments, compressed and image uploads) keeps its bytes
  const walk = (x: unknown): void => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    const o = x as Record<string, unknown>;
    if ((o.$ === 'bin' || o.$ === 'img') && typeof o.o === 'number') {
      o.o = put(slice(o.o, Number(o.l)));
      return;
    }
    for (const v of Object.values(o)) walk(v);
  };
  for (const T of out.snap.textures) {
    walk(T.comp);
    for (const L of T.levels ?? []) walk((L as { upload?: unknown }).upload);
  }
  for (const f of out.frames) walk(f.cmds);
  out.binBytes = size;
  return { doc: out, bin: Buffer.concat(chunks, size), dropped };
}

/**
 * --own-assets for the replay: every texture the site uploaded (images, data, compressed files) becomes a neutral
 * checker of the same size; render targets, which the frames draw themselves, stay. Geometry stays (it is the scene).
 */
export function placeholderTextures(doc: CaptureDoc, bin: Uint8Array): number {
  const written = new Set<number>();
  for (const f of doc.snap.framebuffers) for (const a of f.atts) if (a.tex) written.add(a.tex);
  let n = 0;
  const checker = (x: number, y: number) => ((x >> 3) + (y >> 3)) % 2;
  for (const T of doc.snap.textures) {
    if (written.has(T.id) || T.missing) continue;
    let touched = false;
    for (const L of T.levels ?? []) {
      const lv = L as typeof L & { upType?: number; ch?: number; upload?: unknown; alloc?: number[] };
      if (lv.o != null && lv.l != null) {
        const ch = lv.ch ?? 4;
        const t = lv.upType ?? 0x1401;
        const size = t === 0x1406 || t === 0x1404 || t === 0x1405 ? 4 : t === 0x140b ? 2 : 1;
        const dv = new DataView(bin.buffer, bin.byteOffset + lv.o, lv.l);
        for (let i = 0; i * size < lv.l; i++) {
          const px = Math.floor(i / ch);
          const c = i % ch;
          const v = c === 3 ? 1 : checker(px % L.w, Math.floor(px / L.w)) ? 0.62 : 0.5;
          if (t === 0x1406) dv.setFloat32(i * 4, v, true);
          else if (t === 0x140b) dv.setUint16(i * 2, toHalf(v), true);
          else if (size === 1) dv.setUint8(i, Math.round(v * 255));
        }
        touched = true;
      } else if (lv.upload) {
        // an image upload: paint the image bytes as the checker
        const walk = (x: unknown): void => {
          if (!x || typeof x !== 'object') return;
          if (Array.isArray(x)) return void x.forEach(walk);
          const o = x as Record<string, unknown>;
          if (o.$ === 'img') {
            const w = Number(o.w);
            const u8 = bin.subarray(Number(o.o), Number(o.o) + Number(o.l));
            for (let i = 0; i < u8.length; i += 4) {
              const p = i / 4;
              const v = checker(p % w, Math.floor(p / w)) ? 158 : 128;
              u8[i] = v;
              u8[i + 1] = v;
              u8[i + 2] = v;
              u8[i + 3] = 255;
            }
            return;
          }
          for (const v of Object.values(o)) walk(v);
        };
        walk(lv.upload);
        touched = true;
      }
    }
    if (T.comp?.length) {
      // compressed files: replaced by an empty RGBA8 level of the same size
      const c = T.comp.find((x) => /compressedTexImage2D/.test(String((x as { fn: string }).fn))) as { args: Arg[] } | undefined;
      if (c) {
        T.levels = [{ level: 0, face: 0, ifmt: 0x8058, w: Number(c.args[3]), h: Number(c.args[4]), d: 1, alloc: [0x1908, 0x1401] } as never];
        T.comp = [];
        touched = true;
      }
    }
    if (touched) n++;
  }
  return n;
}
