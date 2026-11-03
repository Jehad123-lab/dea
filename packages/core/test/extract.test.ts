import { describe, expect, it } from 'vitest';
import {
  filterTree,
  type GsapNode,
  type ProgramSource,
  pickPrograms,
  pipelineModule,
  projectFiles,
  type ShaderModule,
  shaderModule,
  tokenFiles,
} from '../src/index.ts';

const vert =
  '#version 300 es\n#define SHADER_TYPE ShaderMaterial\nprecision highp float;\nin vec3 position;\nin vec2 uv;\nout vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position, 1.0); }';
const frag =
  '#version 300 es\n#define SHADER_TYPE ShaderMaterial\nprecision highp float;\nuniform float uTime;\nuniform vec2 uResolution;\nuniform vec3 uColor;\nuniform sampler2D uNoise;\nuniform sampler2D tPrev;\nin vec2 vUv;\nout vec4 outColor;\nvoid main(){ vec4 n = texture(uNoise, vUv + uTime * 0.1); outColor = vec4(uColor * n.r, 1.0) + texture(tPrev, vUv) * 0.0; }';
const prog: ProgramSource = {
  id: 'p1',
  name: 'ShaderMaterial with uTime, uNoise',
  shaders: [vert, frag],
  samplers: [
    {
      sampler: 'uNoise',
      texture: 't3',
      file: 'assets/network/001-noise.png',
      renderTarget: false,
      width: 64,
      height: 64,
      wrap: 'REPEAT / REPEAT',
      filter: 'NEAREST / NEAREST',
    },
    { sampler: 'tPrev', texture: 't4', file: null, renderTarget: true, width: 256, height: 256, wrap: '', filter: '' },
  ],
};

describe('extract: files you can use', () => {
  it('writes tokens as CSS variables, a Tailwind preset and W3C tokens', () => {
    const t = tokenFiles(
      {
        color: { background: { $type: 'color', $value: '#0e100f' }, text: { $type: 'color', $value: '#fffce1' } },
        fontFamily: { primary: { $type: 'fontFamily', $value: 'Mori Gothic' } },
        fontSize: { '64': { $type: 'dimension', $value: '64px' } },
        cubicBezier: { 'expo-out': { $type: 'cubicBezier', $value: [0.16, 1, 0.3, 1] } },
      },
      { eases: ['power3.out'] },
    );
    expect(t.css).toContain('--color-background: #0e100f;');
    expect(t.css).toContain('--font-primary: "Mori Gothic", system-ui, sans-serif;');
    expect(t.css).toContain('--ease-expo-out: cubic-bezier(0.16, 1, 0.3, 1);');
    expect(t.tailwind).toContain('"background": "var(--color-background)"');
    const j = JSON.parse(t.json);
    expect(j.color.text).toEqual({ $type: 'color', $value: '#fffce1' });
    expect(j.gsapEase['power3-out'].$value).toBe('power3.out');
  });

  it('turns a shader program into a RawShaderMaterial module with textures by path', () => {
    const m = shaderModule(prog, { last: { uTime: 12.5 }, textureDir: '/textures', ownAssets: false, textureName: () => 'noise.png' });
    expect(m.name).toBe('TimeNoiseShader');
    expect(m.fullscreen).toBe(true);
    expect(m.code).toContain('new THREE.RawShaderMaterial');
    expect(m.code).toContain("uNoise: { file: '/textures/noise.png', wrap: 'RepeatWrapping', minFilter: 'NearestFilter', magFilter: 'NearestFilter' }");
    expect(m.code).toContain('uTime: { value: 12.5 }, // float: last value seen on the site');
    expect(m.code).toContain('uResolution: { value: new THREE.Vector2(innerWidth, innerHeight) }');
    expect(m.code).toContain('render target');
    expect(m.code).not.toContain('modelViewMatrix: {');
    const own = shaderModule(prog, { last: {}, textureDir: '/textures', ownAssets: true, textureName: () => 'noise.png' });
    expect(own.textures.find((t) => t.sampler === 'uNoise')?.placeholder).toBe(true);
  });

  it('picks the site programs with a clock first and skips library materials', () => {
    const lib: ProgramSource = {
      id: 'p2',
      name: 'MeshStandardMaterial',
      shaders: ['#define SHADER_NAME MeshStandardMaterial\nvoid main(){gl_Position=vec4(0.);}', '#define STANDARD\nvoid main(){}'],
      samplers: [],
    };
    expect(pickPrograms([lib, prog]).map((p) => p.id)).toEqual(['p1']);
  });

  it('writes a project per target', () => {
    const m = shaderModule(prog, { last: {}, textureDir: '/textures', ownAssets: false, textureName: () => 'noise.png' });
    const o = { mods: [m], title: 'Site', site: 'https://x.test', threeVersion: '170', hasMotion: true, heading: 'Hello' };
    expect(Object.keys(projectFiles('react', o)).sort()).toEqual([
      'index.html',
      'package.json',
      'src/App.jsx',
      'src/Scene.jsx',
      'src/main.jsx',
      'vite.config.js',
    ]);
    expect(projectFiles('react', o)['src/Scene.jsx']).toContain('orthographic');
    expect(Object.keys(projectFiles('vanilla', o)).sort()).toEqual(['index.html', 'main.js', 'package.json', 'scene.js']);
    expect(JSON.parse(projectFiles('vanilla', o)['package.json']).dependencies.three).toBe('^0.170.0');
    const framer = projectFiles('framer', o)['DeaScene.tsx'];
    expect(framer).toContain('addPropertyControls');
    expect(framer).toContain('https://esm.sh/three@0.170.0');
  });

  it('rebuilds the render pipeline of one frame: targets, order, wiring, scene hooks', () => {
    const m = shaderModule(prog, { last: {}, textureDir: '/textures', ownAssets: false, textureName: () => 'noise.png' });
    const js = pipelineModule(
      [
        { index: 1, target: 't4', programs: ['p1'], programNames: ['UTimeUNoise'], draws: 1, inputs: ['t3', 't4'] },
        { index: 2, target: 'screen', programs: ['p9', 'p1'], programNames: ['MeshPhysicalMaterial', 'UTimeUNoise'], draws: 14, inputs: ['t4'] },
      ],
      [{ id: 't4', width: 256, height: 256, internalFormat: 'RGBA16F', type: 'HALF_FLOAT', renderTarget: true }],
      new Map<string, ShaderModule>([['p1', m]]),
      [prog],
      'https://x.test',
    );
    expect(js).toContain('t4: new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, depthBuffer: false })');
    expect(js).toContain(`{ target: 't4', run: () => fullscreen(materials.p1, {"tPrev":"t4"}) }, // pass 1`);
    expect(js).toContain('{ target: null, run: () => hooks.scene?.(renderer, { pass: 2, reads: ["t4"] }) }');
    expect(js).toContain("import { createMaterial as TimeNoiseShaderMaterial } from './shaders/TimeNoiseShader.js';");
  });

  it('keeps only the motion of one section', () => {
    const tree: GsapNode[] = [
      {
        type: 'timeline',
        start: 0,
        duration: 2,
        children: [
          { type: 'tween', start: 0, duration: 1, targets: ['div.hero__title'] },
          { type: 'tween', start: 1, duration: 1, targets: ['footer.site'] },
        ],
      },
      { type: 'tween', start: 0, duration: 1, targets: ['nav.top'] },
    ];
    const f = filterTree(tree, 'section .hero__title');
    expect(f).toHaveLength(1);
    expect(f[0].children?.map((c) => c.targets?.[0])).toEqual(['div.hero__title']);
  });
});
