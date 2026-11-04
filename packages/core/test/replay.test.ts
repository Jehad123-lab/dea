import { describe, expect, it } from 'vitest';
import { REPLAY_CAPTURE_SCRIPT } from '../src/replay/capture.ts';
import {
  animateEntries,
  buildGraph,
  type CaptureDoc,
  type Cmd,
  compactCapture,
  type FrameState,
  placeholderTextures,
  renderGraphMd,
  toHalf,
  unneededTextures,
} from '../src/replay/graph.ts';
import { REPLAY_PLAYER } from '../src/replay/player.ts';
import { normalMatrixOf, rebuildMd, rebuildPipeline } from '../src/replay/rebuild.ts';
import { REBUILD_RUNNER } from '../src/replay/runner.ts';
import { invert, mul, perspectiveOf, recoverScene, sceneGlb, sceneMd } from '../src/replay/scene.ts';

// a tiny recording, written the way the in-page recorder writes one: a simulation pass ping-ponging two float targets,
// a mesh drawn with model/view/projection uniforms into the canvas, and a clock uniform
const bin: number[] = [];
const put = (bytes: Uint8Array) => {
  while (bin.length % 8) bin.push(0);
  const o = bin.length;
  bin.push(...bytes);
  return o;
};
const f32 = (a: number[]) => new Uint8Array(new Float32Array(a).buffer);
const u16 = (a: number[]) => new Uint8Array(new Uint16Array(a).buffer);
const persp = (fov: number, aspect: number, n: number, f: number) => {
  const t = 1 / Math.tan(fov / 2);
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
};
const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1]; // camera at z = 5
const model = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 0, 0, 1]; // scale 2, x + 1
const proj = persp(Math.PI / 4, 16 / 9, 0.1, 100);
// a quad: 4 vertices, 2 triangles, but drawn as 12 indices (twice) so it counts as a mesh, not a full-screen pass
const posO = put(f32([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]));
const idxO = put(u16([0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3]));
const simA = put(f32(new Array(4 * 4).fill(0.5)));
const simB = put(f32(new Array(4 * 4).fill(0.25)));
const screenRt = put(f32(new Array(4 * 4).fill(1)));
const loc = (p: number, n: string) => ({ $: 'loc', p, n });
const state = (over: Partial<FrameState> = {}): FrameState => ({
  en: { [0x0be2]: false, [0x0b71]: false, [0x0c11]: false },
  p: { [0x0ba2]: [0, 0, 64, 36], [0x0b72]: true, [0x80c9]: 1, [0x80c8]: 0, [0x80cb]: 1, [0x80ca]: 0 },
  program: 0,
  arrayBuffer: 0,
  vao: 0,
  drawFb: 0,
  readFb: 0,
  rb: 0,
  activeTexture: 0x84c0,
  units: [],
  defaultVao: { attrs: [], el: 0 },
  ...over,
});
const frame = (read: number, write: number, t: number): Cmd[] => [
  ['bindFramebuffer', 0x8d40, { $: 'fb', id: write }],
  ['viewport', 0, 0, 2, 2],
  ['useProgram', { $: 'prog', id: 1 }],
  ['activeTexture', 0x84c0],
  ['bindTexture', 0x0de1, { $: 'tex', id: read }],
  ['uniform1f', loc(1, 'uTime'), t],
  ['bindVertexArray', { $: 'vao', id: 7 }],
  ['drawArrays', 4, 0, 3],
  ['bindFramebuffer', 0x8d40, null],
  ['viewport', 0, 0, 64, 36],
  ['clear', 0x4100],
  ['useProgram', { $: 'prog', id: 2 }],
  ['uniformMatrix4fv', loc(2, 'modelMatrix'), false, { $: 'bin', o: put(f32(model)), l: 64, t: 'Float32Array' }],
  ['bindVertexArray', { $: 'vao', id: 8 }],
  ['drawElements', 4, 12, 0x1403, 0],
];
const doc: CaptureDoc = {
  version: 2,
  canvas: { w: 64, h: 36, cssW: 64, cssH: 36, x: 0, y: 0, style: {} },
  dpr: 1,
  attrs: {},
  extensions: [],
  snap: {
    buffers: [
      { id: 20, kind: 'array', usage: 0x88e4, o: posO, l: 48 },
      { id: 21, kind: 'element', usage: 0x88e4, o: idxO, l: 24 },
    ],
    textures: [
      {
        id: 10,
        target: 0x0de1,
        params: {},
        levels: [{ level: 0, face: 0, ifmt: 0x8814, w: 2, h: 2, d: 1, o: simA, l: 64, upFmt: 0x1908, upType: 0x1406, ch: 4 } as never],
      },
      {
        id: 11,
        target: 0x0de1,
        params: {},
        levels: [{ level: 0, face: 0, ifmt: 0x8814, w: 2, h: 2, d: 1, o: simB, l: 64, upFmt: 0x1908, upType: 0x1406, ch: 4 } as never],
      },
      {
        id: 12,
        target: 0x0de1,
        params: {},
        levels: [{ level: 0, face: 0, ifmt: 0x881a, w: 2, h: 2, d: 1, o: screenRt, l: 64, upFmt: 0x1908, upType: 0x1406, ch: 4 } as never],
      },
    ],
    programs: [
      {
        id: 1,
        shaders: [{ type: 0x8b30, src: '#define SHADER_NAME SimMaterial\nuniform sampler2D tPos; uniform float uTime;' }],
        attribs: [{ name: 'position', type: 0x8b51, size: 1, loc: 0 }],
        uniforms: [
          { name: 'tPos', type: 0x8b5e, v: 0 },
          { name: 'uTime', type: 0x1406, v: 0 },
        ],
      },
      {
        id: 2,
        shaders: [{ type: 0x8b31, src: 'uniform mat4 modelMatrix, viewMatrix, projectionMatrix;' }],
        attribs: [{ name: 'position', type: 0x8b51, size: 1, loc: 0 }],
        uniforms: [
          { name: 'modelMatrix', type: 0x8b5c, v: model },
          { name: 'viewMatrix', type: 0x8b5c, v: view },
          { name: 'projectionMatrix', type: 0x8b5c, v: proj },
        ],
      },
    ],
    renderbuffers: [],
    samplers: [],
    framebuffers: [
      { id: 30, atts: [{ a: 0x8ce0, type: 0x1702, tex: 10, level: 0 }], draw: [0x8ce0], read: 0x8ce0 },
      { id: 31, atts: [{ a: 0x8ce0, type: 0x1702, tex: 11, level: 0 }], draw: [0x8ce0], read: 0x8ce0 },
    ],
    vaos: [
      { id: 7, attrs: [{ i: 0, en: true, size: 2, type: 0x1406, norm: false, stride: 0, off: 0, buf: 20 }], el: 0 },
      { id: 8, attrs: [{ i: 0, en: true, size: 3, type: 0x1406, norm: false, stride: 0, off: 0, buf: 20 }], el: 21 },
    ],
  },
  frames: [
    { state: state(), cmds: frame(10, 31, 1.0), ms: 16, ts: 1000 },
    { state: state(), cmds: frame(11, 30, 1.5), ms: 16, ts: 1500 },
  ],
  errors: [],
  overflow: false,
  binBytes: 0,
  url: 'https://example.com',
  at: '2026-11-04T00:00:00Z',
  contexts: 1,
};
const BIN = Uint8Array.from(bin);

describe('replay: render graph', () => {
  it('groups draws into passes and reads their roles', () => {
    const g = buildGraph(doc, BIN);
    expect(g.passes).toHaveLength(4);
    expect(g.passes[0].target.label).toMatch(/render target 2×2 RGBA32F \(tex#11\)/);
    expect(g.passes[0].role).toBe('simulation step (GPGPU ping-pong)');
    expect(g.passes[0].inputs.join()).toMatch(/tPos ← tex#10/);
    expect(g.passes[1].role).toBe('meshes');
    expect(g.passes[1].target.label).toMatch(/^screen 64×36/);
    expect(g.programs.find((p) => p.id === 1)?.label).toMatch(/^SimMaterial #1 \(tPos, uTime\)/);
    expect(renderGraphMd(g, doc, 'https://example.com')).toMatch(/### Pass 0: simulation step/);
  });

  it('advances clock uniforms with real time and leaves the rest as recorded', () => {
    const a = animateEntries(doc);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ frame: 0, cmd: 5, arg: 1, uniform: 'uTime', base: 1 });
    expect(a[0].rate).toBeCloseTo(0.001, 9); // 0.5 per 500 ms
    expect(a[1].base).toBeCloseTo(1, 9); // both frames sit on one line through time
  });

  it('leaves out textures the frames overwrite before they read them', () => {
    // tex 11 is written by the first pass before anything reads it; tex 10 is read first; tex 12 is never touched
    expect([...unneededTextures(doc, BIN)].sort()).toEqual([11, 12]);
    const c = compactCapture(doc, BIN);
    const lv = (id: number) => c.doc.snap.textures.find((t) => t.id === id)?.levels[0] as unknown as Record<string, unknown>;
    expect(lv(11).o).toBeUndefined();
    expect(lv(11).alloc).toEqual([0x1908, 0x1406]);
    expect(lv(12).alloc).toEqual([0x1908, 0x140b]); // half-float target, allocated as halves
    expect(lv(10).l).toBe(64);
    // the bytes that stay are the same bytes, at their new offsets
    const o = Number(lv(10).o);
    expect(new Float32Array(c.bin.buffer.slice(c.bin.byteOffset + o, c.bin.byteOffset + o + 64))[0]).toBe(0.5);
    const m = c.doc.frames[0].cmds[12][3] as unknown as { o: number };
    expect(new Float32Array(c.bin.buffer.slice(c.bin.byteOffset + m.o, c.bin.byteOffset + m.o + 64))[12]).toBe(1);
    expect(c.bin.length).toBeLessThan(BIN.length);
  });

  it('converts to half floats exactly where halves are exact', () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(0.5)).toBe(0x3800);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(0)).toBe(0);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(1e9)).toBe(0x7c00);
  });

  it('--own-assets turns uploaded textures into checkers and keeps render targets', () => {
    const d = structuredClone(doc);
    const b = BIN.slice();
    d.snap.textures.push({
      id: 13,
      target: 0x0de1,
      params: {},
      levels: [{ level: 0, face: 0, ifmt: 0x8058, w: 2, h: 1, d: 1, o: put(new Uint8Array(8).fill(9)), l: 8, upType: 0x1401, ch: 4 } as never],
    });
    const bb = Uint8Array.from(bin);
    expect(placeholderTextures(d, bb)).toBe(2); // tex 12 (never a target) and tex 13
    const lv = d.snap.textures[3].levels[0] as unknown as { o: number };
    expect(bb[lv.o]).not.toBe(9);
    expect(b[0]).toBe(BIN[0]);
  });
});

describe('replay: scene recovery', () => {
  it('matrix helpers and the camera', () => {
    const i = invert(model) as number[];
    expect(mul(model, i).map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const p = perspectiveOf(proj);
    expect(p?.yfov).toBeCloseTo(Math.PI / 4, 6);
    expect(p?.aspect).toBeCloseTo(16 / 9, 6);
    expect(p?.znear).toBeCloseTo(0.1, 6);
    expect(p?.zfar).toBeCloseTo(100, 3);
    expect(perspectiveOf([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1])).toBeNull();
  });

  it('reads mesh geometry back from the buffers and writes a valid glTF binary', () => {
    const s = recoverScene(doc, BIN, { models: [{ name: 'quad.glb › Quad', vertices: 4 }] });
    expect(s.meshes).toHaveLength(1);
    const m = s.meshes[0];
    expect(m.vertexCount).toBe(4);
    expect(Array.from(m.positions.slice(3, 6))).toEqual([1, -1, 0]);
    expect(m.indices?.length).toBe(12);
    expect(m.model).toEqual(model);
    expect(m.match).toBe('quad.glb › Quad');
    expect(s.camera?.view).toEqual(view);
    const glb = sceneGlb(s);
    expect(glb.readUInt32LE(0)).toBe(0x46546c67);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    const jl = glb.readUInt32LE(12);
    const j = JSON.parse(glb.subarray(20, 20 + jl).toString());
    expect(j.asset.version).toBe('2.0');
    expect(j.nodes[0].matrix).toEqual(model);
    expect(j.nodes[1].camera).toBe(0);
    expect(j.nodes[1].matrix[14]).toBeCloseTo(5, 6); // the camera sits at z = 5
    expect(j.accessors[0].min).toEqual([-1, -1, 0]);
    expect(j.cameras[0].perspective.yfov).toBeCloseTo(Math.PI / 4, 6);
    // placeholders: a box with the same bounds instead of the site's mesh
    const pg = sceneGlb(s, { placeholders: true });
    const pj = JSON.parse(pg.subarray(20, 20 + pg.readUInt32LE(12)).toString());
    expect(pj.accessors[0].count).toBe(8);
    expect(pj.accessors[0].max).toEqual([1, 1, 0]);
    expect(sceneMd(s, 'https://example.com')).toMatch(/quad\.glb › Quad/);
  });
});

describe('replay: in-page code', () => {
  it('the recorder and the player are valid JavaScript with no template holes', () => {
    expect(() => new Function(REPLAY_CAPTURE_SCRIPT)).not.toThrow();
    expect(() => new Function(REPLAY_PLAYER.replace(/^export /gm, ''))).not.toThrow();
    expect(REPLAY_CAPTURE_SCRIPT).not.toMatch(/\$\{/);
    expect(REPLAY_PLAYER).toMatch(/export function createReplay/);
    expect(REPLAY_PLAYER).toMatch(/export async function mountReplay/);
  });

  it('the editable-rebuild runner is valid JavaScript with no template holes', () => {
    const body = REBUILD_RUNNER.replace(/^import .*$/m, 'const THREE_NS = {};').replace(/^export /gm, '');
    expect(() => new Function(body)).not.toThrow();
    expect(REBUILD_RUNNER).not.toMatch(/\$\{/);
    expect(REBUILD_RUNNER).toMatch(/export function createRebuild/);
    expect(REBUILD_RUNNER).toMatch(/export async function mountRebuild/);
    expect(REBUILD_RUNNER).toMatch(/RawShaderMaterial/);
  });
});

describe('replay: editable rebuild', () => {
  const d = structuredClone(doc);
  d.animate = animateEntries(d);
  d.graph = buildGraph(d, BIN);
  const { pipeline, shaders, stats } = rebuildPipeline(d, BIN, { data: '../replay/capture.bin' });
  const draws = pipeline.frames.flatMap((f) => f.steps.filter((s) => s.op === 'draw'));

  it('turns every draw into a three.js draw step with its material, geometry and target', () => {
    expect(stats.draws).toBe(4);
    expect(draws[0]).toMatchObject({ op: 'draw', frame: 0, mode: 4, first: 0, count: 3, target: 31, index: null });
    expect(draws[0].attrs[0]).toMatchObject({ name: 'position', buf: 20, size: 2, type: 0x1406 });
    expect(draws[1]).toMatchObject({ mode: 4, count: 12, target: 0, index: { buf: 21, type: 0x1403, offset: 0 } });
    expect(pipeline.materials).toHaveLength(2);
    expect(pipeline.materials[0]).toMatchObject({ program: 1, fragment: 'shaders/SimMaterial-1.frag' });
    expect(shaders['shaders/SimMaterial-1.frag']).toMatch(/uniform sampler2D tPos/);
    expect(pipeline.data).toBe('../replay/capture.bin');
    expect(pipeline.glVersion).toBe(2);
  });

  it('samplers point at the texture bound to their unit, and per-draw changes are deltas', () => {
    expect(pipeline.materials[0].uniforms.tPos).toEqual({ tex: 10, kind: '2d' });
    expect(draws[0].uniforms).toEqual({});
    expect(draws[2].uniforms.tPos).toEqual({ tex: 11, kind: '2d' });
    expect(draws[2].uniforms.uTime).toBe(1.5);
  });

  it('cameras and model matrices become three.js matrices that reproduce the uploads', () => {
    expect(pipeline.cameras).toHaveLength(1);
    expect(pipeline.cameras[0].view).toEqual(view);
    expect(pipeline.cameras[0].projection).toEqual(proj);
    expect(draws[1].camera).toBe(0);
    expect(draws[1].model).toEqual(model);
    expect(draws[0].camera).toBeNull();
    expect(stats.matricesExact).toBe(2);
    expect(pipeline.materials[1].builtins.sort()).toEqual(['modelMatrix', 'projectionMatrix', 'viewMatrix']);
    expect(normalMatrixOf([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1])?.slice(0, 3)).toEqual([0.5, 0, 0]);
  });

  it('keeps clears, clocks and passes; labels what is recorded', () => {
    const clears = pipeline.frames[0].steps.filter((s) => s.op === 'clear');
    expect(clears).toHaveLength(1);
    expect(clears[0]).toMatchObject({ target: 0, bits: 0x4100 });
    expect(pipeline.clocks).toEqual([{ program: 1, uniform: 'uTime', base: 1, rate: expect.any(Number) }]);
    expect(pipeline.passes.map((p) => p.role)).toContain('simulation step (GPGPU ping-pong)');
    expect(pipeline.labels.geometry).toMatch(/^recorded/);
    expect(stats.recordedBuffers).toBe(2);
    const md = rebuildMd(pipeline, stats, { canvas: 0.8, page: 0.9 }, false);
    expect(md).toMatch(/Editable rebuild score: canvas 80.0%, page 90.0%/);
    expect(md).toMatch(/recorded: 2 vertex\/index buffers/);
  });

  it('--own-assets: large meshes become boxes and their bytes are zeroed', () => {
    const big = structuredClone(d);
    const n = 6000; // 6000 vertices × 12 bytes = 72 KB, past the 64 KB line
    const b = new Uint8Array(BIN.length + n * 12 + 8);
    b.set(BIN);
    const o = Math.ceil(BIN.length / 8) * 8;
    new Float32Array(b.buffer, o, n * 3).set(Array.from({ length: n * 3 }, (_, i) => (i % 3 === 1 ? 2 : i % 7)));
    big.snap.buffers.push({ id: 22, kind: 'array', usage: 0x88e4, o, l: n * 12 });
    (big.snap.vaos[1].attrs[0] as { buf: number }).buf = 22;
    const r = rebuildPipeline(big, b, { data: 'data.bin', ownAssets: true });
    const mesh = r.pipeline.frames[0].steps.find((s) => s.op === 'draw' && s.target === 0) as { placeholder?: { min: number[]; max: number[] } };
    expect(mesh.placeholder).toEqual({ min: [0, 2, 0], max: [6, 2, 6] });
    expect(r.stats.placeholders).toBe(2);
    expect(b.subarray(o, o + n * 12).every((x) => x === 0)).toBe(true);
  });
});
