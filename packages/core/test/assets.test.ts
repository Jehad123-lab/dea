import { describe, expect, it } from 'vitest';
import { classifyAsset, gltfSummary, ktx2Summary, lottieSummary, parseGlb, programName, riveSummary, samplerRole, samplerUse } from '../src/index.ts';

function glb(json: object, bin?: Uint8Array): Uint8Array {
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (js.length % 4)) % 4;
  js = Uint8Array.from([...js, ...new Array(pad).fill(0x20)]);
  const binLen = bin ? bin.length + ((4 - (bin.length % 4)) % 4) : 0;
  const total = 12 + 8 + js.length + (bin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(js, 20);
  if (bin) {
    dv.setUint32(20 + js.length, binLen, true);
    dv.setUint32(24 + js.length, 0x004e4942, true);
    out.set(bin, 28 + js.length);
  }
  return out;
}

describe('asset files', () => {
  it('classifies by extension, mime and magic bytes', () => {
    expect(classifyAsset('https://x/a.glb', 'application/octet-stream')).toBe('glb');
    expect(classifyAsset('https://x/env', '', new TextEncoder().encode('#?RADIANCE\n'))).toBe('hdr');
    expect(classifyAsset('https://x/t.ktx2', '')).toBe('ktx2');
    expect(classifyAsset('https://x/f.woff2', 'font/woff2')).toBe('font');
    expect(classifyAsset('https://x/p', 'image/webp')).toBe('image');
    expect(classifyAsset('https://x/app.js', 'text/javascript')).toBeNull();
  });
  it('reads a glb: meshes, materials with texture slots, animations, embedded image sizes', () => {
    // a 1x1 PNG header as the embedded image
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0]);
    const g = parseGlb(
      glb(
        {
          asset: { version: '2.0', generator: 'test' },
          accessors: [{ count: 24 }, { count: 10, max: [2.5] }],
          bufferViews: [{ byteOffset: 0, byteLength: png.length }],
          images: [{ name: 'suit', mimeType: 'image/png', bufferView: 0 }],
          textures: [{ source: 0 }],
          materials: [{ name: 'fabric', pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 0 } }],
          meshes: [{ name: 'body', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
          nodes: [{ name: 'root' }],
          animations: [{ name: 'Idle', channels: [{ target: { node: 0, path: 'rotation' }, sampler: 0 }], samplers: [{ input: 1 }] }],
          extensionsUsed: ['KHR_draco_mesh_compression'],
        },
        png,
      ),
    );
    if ('error' in g) throw new Error(g.error);
    expect(g.meshes[0]).toMatchObject({ name: 'body', vertices: 24, material: ['fabric'] });
    expect(g.materials[0].slots).toEqual({ baseColor: 'suit', normal: 'suit' });
    expect(g.animations[0]).toMatchObject({ name: 'Idle', seconds: 2.5, targets: ['root.rotation'] });
    expect(g.images[0]).toMatchObject({ width: 512, height: 256 });
    expect(g.extensions).toContain('KHR_draco_mesh_compression');
    expect(gltfSummary({}).meshes).toEqual([]);
    expect(parseGlb(new Uint8Array(30))).toHaveProperty('error');
  });
  it('reads Lottie, KTX2 and Rive headers', () => {
    expect(lottieSummary({ v: '5.7.4', fr: 30, ip: 0, op: 90, w: 400, h: 400, layers: [{ nm: 'dot', ty: 4 }] })).toMatchObject({
      seconds: 3,
      layers: ['dot (shape)'],
    });
    expect(lottieSummary({ hello: 1 })).toBeNull();
    const k = new Uint8Array(80);
    const dv = new DataView(k.buffer);
    k.set([0xab, 0x4b, 0x54, 0x58]);
    dv.setUint32(20, 1024, true);
    dv.setUint32(24, 512, true);
    dv.setUint32(40, 11, true);
    dv.setUint32(44, 1, true);
    expect(ktx2Summary(k)).toMatchObject({ width: 1024, height: 512, levels: 11, supercompression: 'Basis Universal (ETC1S)' });
    expect(riveSummary(Uint8Array.from([0x52, 0x49, 0x56, 0x45, 7, 0, 1]))).toEqual({ version: '7.0' });
  });
});

describe('what a texture drives', () => {
  it('reads roles from sampler names and source names', () => {
    expect(samplerRole('tPos')).toContain('GPU simulation');
    expect(samplerRole('uFlowMap')).toContain('flow field');
    expect(samplerRole('e0TBlue')).toContain('blue noise');
    expect(samplerRole('t0', 'bluenoise64.png')).toContain('blue noise');
    expect(samplerRole('areaTexture')).toContain('SMAA');
    expect(samplerRole('boneTexture')).toContain('bone');
  });
  it('reads how the shader uses what it samples', () => {
    const fs =
      'uniform sampler2D uNoise; uniform sampler2D uImage; varying vec2 vUv;\nvoid main(){ vec4 n = texture2D(uNoise, vUv * 3.0 + uTime); vec2 uv = vUv + n.rg * 0.05; vec4 c = texture2D(uImage, uv); gl_FragColor = c; }';
    expect(samplerUse('uNoise', [fs])).toContain('offsets UVs (distortion)');
    expect(samplerUse('uImage', [fs])).toContain('feeds the output colour');
    const vs = 'uniform sampler2D tPos; void main(){ vec3 p = texture2D(tPos, uv).xyz; gl_Position = vec4(p, 1.0); }';
    expect(samplerUse('tPos', [vs])).toContain('moves vertices (sampled in the vertex shader)');
  });
  it('names programs from three.js defines or their uniforms', () => {
    expect(programName(['#define SHADER_NAME heroHaze\nvoid main(){}'], 'p1')).toBe('heroHaze');
    expect(programName(['#define SHADER_TYPE ShaderMaterial\n#define SHADER_NAME \nuniform float uTime; uniform sampler2D tPos;'], 'p1')).toBe(
      'ShaderMaterial with uTime, tPos',
    );
  });
});
