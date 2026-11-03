import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyDriver,
  detectTechniques,
  driversCode,
  driverText,
  extractGaps,
  type Finding,
  fitLine,
  type HeroLayout,
  heroHtml,
  heroJsx,
  heroStyles,
  type KitManifest,
  libraryAdd,
  libraryList,
  libraryRemove,
  librarySearch,
  libraryUse,
  observedFrom,
  observedLiteral,
  type ProgramSource,
  particlesStandin,
  projectFiles,
  researchLoop,
  researchTechniques,
  type SearchProvider,
  sceneCss,
  shaderModule,
  shaderName,
  type TraceDoc,
  traceGaps,
} from '../src/index.ts';

const env = (n: number, f: (i: number) => [number, number, number, number, number]) =>
  Array.from({ length: n }, (_, i) => [i * 150, ...f(i)] as [number, number, number, number, number, number]);

describe('live trace: what drives a uniform', () => {
  it('fits a line', () => {
    const f = fitLine([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(f.a).toBeCloseTo(2);
    expect(f.b).toBeCloseTo(1);
    expect(f.r).toBeCloseTo(1);
  });

  it('tells a clock, the scroll, the pointer, the viewport, a constant and its own animation apart', () => {
    const still = env(40, () => [0, 300, 200, 1440, 900]);
    const series = (g: (i: number) => number) => Array.from({ length: 30 }, (_, i) => [i * 150, g(i)] as [number, number]);
    const u = (s: Array<[number, number]>, last = [s[s.length - 1][1]]) => ({
      series: s,
      last,
      min: Math.min(...s.map((x) => x[1])),
      max: Math.max(...s.map((x) => x[1])),
    });
    const clock = classifyDriver(u(series((i) => 2 + i * 0.15)), still);
    expect(clock.kind).toBe('clock');
    expect(clock.kind === 'clock' && clock.perSecond).toBeCloseTo(1, 2);
    expect(driverText(clock)).toContain('(seconds)');

    const scrolling = env(40, (i) => [i * 40, -1, -1, 1440, 900]);
    expect(classifyDriver(u(series((i) => (i * 6 * 40) / 1000)), scrolling).kind).toBe('scroll'); // a tie: the input wins
    const downUp = env(40, (i) => [(i < 20 ? i : 40 - i) * 120, -1, -1, 1440, 900]);
    expect(classifyDriver(u(series((i) => ((i < 20 ? i : 40 - i) * 120) / 2000)), downUp)).toMatchObject({ kind: 'scroll', scale: 0.0005 });

    const pointing = env(40, (i) => [0, 100 + i * 20, 400, 1440, 900]);
    const p = classifyDriver(u(series((i) => Math.sin(i) * 0 + (100 + i * 20) / 1440)), pointing);
    // monotonic and linear in time too: a clock fits first only when it is time-linear; make it non-monotonic
    expect(['pointer', 'clock']).toContain(p.kind);
    const wobble = env(40, (i) => [0, 300 + 200 * Math.sin(i), 400, 1440, 900]);
    const pw = classifyDriver(u(series((i) => (300 + 200 * Math.sin(i)) / 1440)), wobble);
    expect(pw).toMatchObject({ kind: 'pointer', axis: 'x' });

    expect(classifyDriver(u(series(() => 1440)), still)).toEqual({ kind: 'viewport', of: 'width' });
    expect(
      classifyDriver(
        u(
          series(() => 0),
          [1440, 900],
        ),
        still,
      ),
    ).toEqual({ kind: 'viewport', of: 'size' });
    expect(classifyDriver(u(series(() => 0.5)), still)).toEqual({ kind: 'constant' });
    expect(classifyDriver(u(series((i) => Math.sin(i / 3))), still).kind).toBe('animated');
  });

  it('writes gaps for unexplained uniforms and leaves three.js built-ins out', () => {
    const doc: TraceDoc = {
      url: 'https://x.test',
      durationMs: 1000,
      programs: [{ id: 'p1', name: 'fx', compiledBy: null }],
      uniforms: [
        {
          program: 'fx',
          name: 'modelViewMatrix',
          fn: 'uniformMatrix4fv',
          calls: 3,
          first: [1],
          last: [1],
          min: -1,
          max: 1,
          series: [],
          driver: { kind: 'animated', min: -1, max: 1 },
          setBy: null,
          stack: [],
        },
        {
          program: 'fx',
          name: 'uWarp',
          fn: 'uniform1f',
          calls: 9,
          first: [0],
          last: [1],
          min: 0,
          max: 1,
          series: [],
          driver: { kind: 'animated', min: 0, max: 1 },
          setBy: 'app.js:3:1 (tick)',
          stack: [],
        },
      ],
      uploads: [],
      breakpoints: [],
      env: [],
    };
    const g = traceGaps(doc, 'https://x.test');
    expect(g[0].topic).toBe('What drives uWarp');
    expect(g[0].next[0].command).toBe('dea trace https://x.test --break uniform:uWarp');
    const obs = observedFrom(doc);
    expect(obs['fx|uWarp'].value).toEqual([1]);
    expect(obs.uWarp.setBy).toBe('app.js:3:1 (tick)');
  });
});

const vert = 'precision highp float;\nattribute vec3 position;\nvoid main(){ gl_Position = vec4(position, 1.0); }';
const frag =
  'precision highp float;\nuniform float uTime;\nuniform float uStir;\nuniform vec3 uTint;\nuniform vec2 uRes;\nvoid main(){ gl_FragColor = vec4(uTint * uStir + uTime * 0.0 + uRes.x * 0.0, 1.0); }';
const prog: ProgramSource = { id: 'p1', name: 'ShaderMaterial with uTime, uStir, uTint', shaders: [vert, frag], samplers: [] };

describe('extract: values and drivers from the live trace', () => {
  it('names modules after the material or its uniforms', () => {
    expect(shaderName('ShaderMaterial with uCore, uST, uAx, uHgt')).toBe('CoreStAxShader');
    expect(shaderName('EffectMaterial')).toBe('EffectMaterial');
    expect(shaderName('fmw-fabric')).toBe('FmwFabric');
  });

  it('writes literals in the uniform type', () => {
    expect(observedLiteral('float', [0.12345])).toBe('0.1235');
    expect(observedLiteral('vec3', [1, 0.5, 0])).toBe('new THREE.Vector3(1, 0.5, 0)');
    expect(observedLiteral('vec3', [1])).toBeNull();
    expect(observedLiteral('mat3', Array(9).fill(0))).toContain('Matrix3().fromArray');
  });

  it('uses observed values and drivers, and applies them every frame through update()', () => {
    const m = shaderModule(prog, {
      last: {},
      textureDir: '/textures',
      ownAssets: false,
      textureName: (f) => f,
      observed: {
        'ShaderMaterial with uTime, uStir, uTint|uStir': {
          value: [0.2],
          driver: { kind: 'pointer', axis: 'x', scale: 0.001, offset: 0.1, r: 0.95 },
          setBy: 'GLRoot.js:912:3134 (_)',
        },
        uTint: { value: [0.9, 0.8, 0.7], driver: { kind: 'constant' } },
      },
    });
    expect(m.code).toContain('uStir: { value: 0.2 }, // float: ✔ last value seen on the site (live trace), set by GLRoot.js:912:3134 (_)');
    expect(m.code).toContain('uTint: { value: new THREE.Vector3(0.9, 0.8, 0.7) }');
    expect(m.code).toContain('uStir: {"kind":"pointer","axis":"x","scale":0.001,"offset":0.1,"r":0.95}, // ≈ inferred from the live trace');
    expect(m.code).toContain('uTime: {"kind":"clock","perSecond":1,"r2":0}, // ≈ guessed from the name');
    expect(m.code).toContain('export function update(material, state)');
    // the generated update() really moves the uniforms
    const src = driversCode(m.uniforms).replace(/export /g, '');
    const run = new Function(`${src}; return { drivers, update };`)() as { update: (m: unknown, s: unknown) => void };
    const mat = {
      uniforms: {
        uTime: { value: 0 },
        uStir: { value: 0 },
        uRes: {
          value: {
            isVector2: true,
            set(w: number, h: number) {
              this.w = w;
              this.h = h;
            },
            w: 0,
            h: 0,
          },
        },
      },
    };
    run.update(mat, { time: 2, scrollY: 0, pointer: { x: 500, y: 0 }, width: 800, height: 600 });
    expect(mat.uniforms.uTime.value).toBe(2);
    expect(mat.uniforms.uStir.value).toBeCloseTo(0.6);
  });

  it('React scene imports shader modules from the project root, and every target calls update()', () => {
    const m = shaderModule(prog, { last: {}, textureDir: '/textures', ownAssets: false, textureName: (f) => f });
    const o = { mods: [m], title: 'Site', site: 'https://x.test', threeVersion: '170', hasMotion: false, heading: 'Hi' };
    const react = projectFiles('react', o)['src/Scene.jsx'];
    expect(react).toContain(`import { createMaterial, update } from '../shaders/${m.name}.js';`);
    expect(react).toContain('update(material, {');
    expect(projectFiles('vanilla', o)['scene.js']).toContain(`from './shaders/${m.name}.js'`);
    const framer = projectFiles('framer', o)['DeaScene.tsx'];
    expect(framer).toContain('function update(material, state)');
    expect(framer).not.toContain('export const drivers');
  });

  it('writes the gap section: build failure, low score behind a loader, guessed uniforms, no GSAP', () => {
    const m = shaderModule(prog, { last: {}, textureDir: '/textures', ownAssets: false, textureName: (f) => f });
    const gaps = extractGaps({
      url: 'https://x.test',
      mods: [m],
      diff: {
        start: 0.2,
        afterAnalysis: 0.3,
        final: 0.3,
        params: {},
        research: null,
        parts: { similarity: 0.3, colour: 0.9, layout: 0.1, edges: 0.05, meanA: '#000', meanB: '#000' } as never,
      },
      build: { ok: false, ms: 10, log: 'error: Could not resolve "./x.js"', step: 'build' },
      hasMotion: false,
      trace: null,
      passes: 12,
      referenceLoader: true,
    });
    expect(gaps.map((g) => g.topic)).toEqual([
      'The generated project did not build (build)',
      'The first screen of the rebuild is 30% similar',
      '2 uniform starting value(s) are guesses',
      'No live GSAP timelines were captured',
    ]);
    expect(gaps[1].missing).toContain('loader');
    expect(gaps[1].next[0].command).toBe('dea extract https://x.test --reference hero.png');
  });
});

describe('research: techniques behind a pipeline', () => {
  it('recognises techniques from program names and GLSL', () => {
    const ids = detectTechniques(
      'ShaderMaterial with tPos, uDt\nuniform sampler2D tPos; uniform sampler2D tVel;\nDownsamplingMaterial\nUpsamplingMaterial\nSMAAWeightsMaterial\n/tex/bluenoise64.png\ngl_PointSize = 2.0;',
    ).map((t) => t.id);
    expect(ids).toEqual(['gpgpu', 'mipmap-bloom', 'smaa', 'blue-noise', 'points']);
  });

  it('looks each one up and ranks tutorial and forum sources first (mocked search)', async () => {
    const calls: string[] = [];
    const fake: SearchProvider = {
      name: 'fake',
      async search(q) {
        calls.push(q);
        const r: Finding[] = [
          { title: 'random blog', url: `https://spam.example/${calls.length}`, snippet: '', source: 'fake' },
          { title: 'Codrops tutorial', url: `https://tympanus.net/codrops/${calls.length}`, snippet: '', source: 'fake' },
        ];
        return r;
      },
    };
    const failing: SearchProvider = {
      name: 'down',
      async search() {
        throw new Error('offline');
      },
    };
    const [t] = await researchTechniques(detectTechniques('uniform sampler2D tPos; uniform sampler2D tVel;'), [fake, failing], { perTechnique: 2 });
    expect(calls.length).toBe(2);
    expect(t.sources[0].url).toContain('tympanus.net/codrops');
    expect(t.sources).toHaveLength(2);
  });
});

describe('library: decode once, reuse everywhere', () => {
  let root: string;
  let kit: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dea-lib-'));
    process.env.DEA_LIBRARY = join(root, 'library');
    kit = join(root, 'run', 'extract');
    await mkdir(join(kit, 'shaders'), { recursive: true });
    await mkdir(join(kit, 'node_modules', 'three'), { recursive: true });
    await writeFile(join(kit, 'shaders', 'a.js'), 'export {}');
    await writeFile(join(kit, 'node_modules', 'three', 'index.js'), '');
    const m: KitManifest = {
      url: 'https://jehaduddin.vercel.app/',
      extractedAt: '2026-11-03T00:00:00Z',
      target: 'react',
      score: 0.42,
      shaders: [{ name: 'TPosDtRoShader', uniforms: ['tPos', 'uStir'], drivers: { uStir: 'pointer' } }],
      eases: ['power3.out'],
      colors: ['#e9e7e1'],
      fonts: ['Timeless Sans Grotesk'],
      techniques: ['GPGPU particle simulation'],
      provenance: 'test',
    };
    await writeFile(join(kit, 'dea-kit.json'), JSON.stringify(m));
  });
  afterAll(async () => {
    delete process.env.DEA_LIBRARY;
    await rm(root, { recursive: true, force: true });
  });

  it('adds, lists, searches, uses and removes kits', async () => {
    const e = await libraryAdd(join(root, 'run'), { tags: ['Hero', 'portfolio'] });
    expect(e.name).toBe('jehaduddin.vercel.app');
    expect(e.tags).toEqual(['hero', 'portfolio']);
    expect((await libraryList()).map((x) => x.name)).toEqual(['jehaduddin.vercel.app']);
    const hits = await librarySearch('gpgpu power3');
    expect(hits).toHaveLength(1);
    expect(hits[0].matched).toEqual(['technique: GPGPU particle simulation', 'ease: power3.out']);
    expect(await librarySearch('gpgpu lottie')).toHaveLength(0);
    const dest = join(root, 'new-site');
    const used = await libraryUse('jehaduddin.vercel.app', dest);
    expect(used.files).toBe(2); // dea-kit.json + shaders/a.js; node_modules is not copied
    expect(JSON.parse(await readFile(join(dest, 'dea-kit.json'), 'utf8')).url).toBe('https://jehaduddin.vercel.app/');
    await expect(libraryUse('jehaduddin.vercel.app', dest)).rejects.toThrow(/not empty/);
    expect(await libraryRemove('jehaduddin.vercel.app')).toBe(true);
    expect(await libraryList()).toEqual([]);
  });
});

describe('extract: the first screen as the site laid it out', () => {
  const layout: HeroLayout = {
    viewport: { width: 1440, height: 900 },
    boxes: [
      {
        tag: 'h1',
        text: 'Jehad Uddin',
        x: 72,
        y: 630,
        w: 600,
        h: 120,
        fontFamily: '"Timeless Sans Grotesk", sans-serif',
        fontSize: 144,
        fontWeight: '500',
        letterSpacing: '-2.88px',
        lineHeight: '144px',
        color: 'rgb(233, 231, 225)',
        textTransform: 'none',
        textAlign: 'start',
        opacity: 1,
      },
      {
        tag: 'a',
        text: 'Work <3',
        x: 1300,
        y: 40,
        w: 60,
        h: 20,
        fontFamily: 'sans-serif',
        fontSize: 14,
        fontWeight: '400',
        letterSpacing: 'normal',
        lineHeight: 'normal',
        color: 'rgb(255, 255, 255)',
        textTransform: 'uppercase',
        textAlign: 'start',
        opacity: 0.6,
      },
    ],
  };

  it('places each text block in viewport units with the computed type', () => {
    const [h1, link] = heroStyles(layout);
    expect(h1.tag).toBe('h1');
    expect(h1.style).toMatchObject({ position: 'absolute', left: '5vw', top: '70vh', fontSize: 'max(10px, 10vw)', lineHeight: '1', textAlign: 'left' });
    expect(link.tag).toBe('span');
    expect(link.style.opacity).toBe('0.6');
  });

  it('writes Hero.jsx and escaped HTML, and the React project uses it', () => {
    expect(heroJsx(layout)).toContain('"text": "Jehad Uddin"');
    expect(heroHtml(layout)).toContain('>Work &lt;3</span>');
    const m = shaderModule(prog, { last: {}, textureDir: '/textures', ownAssets: false, textureName: (f) => f });
    const files = projectFiles('react', { mods: [m], title: 'Site', site: 'https://x.test', threeVersion: '170', hasMotion: false, heading: 'Hi', layout });
    expect(Object.keys(files)).toContain('src/Hero.jsx');
    expect(files['src/App.jsx']).toContain('<Hero />');
    const vanilla = projectFiles('vanilla', { mods: [m], title: 'Site', site: 'https://x.test', threeVersion: '170', hasMotion: false, heading: 'Hi', layout });
    expect(vanilla['index.html']).toContain('class="dea-hero"');
  });
});

describe('extract: technique stand-ins', () => {
  it('writes a particle stand-in that runs, and wires it into the React and vanilla scenes', () => {
    const code = particlesStandin();
    expect(code).toContain("not the site's code");
    const made: Record<string, unknown> = {};
    const fakeThree = {
      BufferGeometry: class {
        attrs: Record<string, unknown> = {};
        setAttribute(k: string, v: unknown) {
          this.attrs[k] = v;
        }
      },
      BufferAttribute: class {
        constructor(
          public array: Float32Array,
          public size: number,
        ) {}
      },
      Color: class {
        constructor(public c: string) {}
      },
      PointsMaterial: class {
        constructor(public o: unknown) {
          made.material = o;
        }
      },
      Points: class {
        position = { set: (x: number, y: number, z: number) => Object.assign(made, { at: [x, y, z] }) };
        constructor(
          public geo: { attrs: Record<string, { array: Float32Array }> },
          public mat: unknown,
        ) {}
      },
      AdditiveBlending: 2,
    };
    const create = new Function(`${code.replace('export function', 'function')}; return createParticles;`)() as (
      t: unknown,
      o: unknown,
    ) => {
      geo: { attrs: Record<string, { array: Float32Array }> };
    };
    const pts = create(fakeThree, { count: 100, x: 0.35, y: -0.2, color: '#e9e7e1' });
    expect(pts.geo.attrs.position.array).toHaveLength(300);
    expect(made.at).toEqual([0.35, -0.2, 0]);
    const m = shaderModule(prog, { last: {}, textureDir: '/textures', ownAssets: false, textureName: (f) => f });
    const standin = { kind: 'particles' as const, spread: 1.2, x: 0.35, y: 0, color: '#e9e7e1' };
    const react = projectFiles('react', { mods: [m], title: 'S', site: 'https://x.test', threeVersion: '170', hasMotion: false, heading: 'H', standin });
    expect(react['standins/particles.js']).toBe(code);
    expect(react['src/Scene.jsx']).toContain('<Particles />');
    const vanilla = projectFiles('vanilla', { mods: [m], title: 'S', site: 'https://x.test', threeVersion: '170', hasMotion: false, heading: 'H', standin });
    expect(vanilla['scene.js']).toContain('scene.add(createParticles(THREE, {"spread":1.2,"x":0.35,"y":0,"color":"#e9e7e1"}))');
  });
});

describe('research loop: only evidence about this site counts', () => {
  it('ignores values from generic pages and keeps a value that improves the diff', async () => {
    const provider: SearchProvider = {
      name: 'fake',
      async search() {
        return [
          { title: 'CSS colors tutorial', url: 'https://w3.example/css', snippet: 'background: #ff0000 is red', source: 'fake' },
          { title: 'x.test design notes', url: 'https://blog.example/x-test', snippet: 'x.test uses a background of #0e100f', source: 'fake' },
        ];
      },
    };
    const tried: string[] = [];
    const r = await researchLoop({
      params: { background: '#ffffff' },
      render: async (p) => {
        tried.push(String(p.background));
        return p.background === '#0e100f' ? 0.95 : 0.4;
      },
      queries: () => ['x.test background'],
      knobs: [{ name: 'background', kind: 'color', near: /background/i }],
      providers: [provider],
      rounds: 3,
      relevant: (f) => `${f.url} ${f.title} ${f.snippet}`.includes('x.test'),
    });
    expect(tried).not.toContain('#ff0000');
    expect(r.params.background).toBe('#0e100f');
    expect(r.best).toBe(0.95);
    expect(r.citations[0].url).toBe('https://blog.example/x-test');
  });
});

describe('extract: canvas placement and page background', () => {
  it('puts the canvas where the site had it, with its rounded corners, and paints the page background', () => {
    const l = {
      viewport: { width: 1000, height: 500 },
      boxes: [],
      canvas: { x: 100, y: 50, w: 800, h: 400, radius: '24px' },
      background: 'rgb(240, 241, 250)',
    };
    const css = sceneCss(l);
    expect(css).toContain('html, body { background: rgb(240, 241, 250); }');
    expect(css).toContain('left: 10vw !important; top: 10vh !important; width: 80vw !important; height: 80vh !important; border-radius: 24px');
    expect(heroHtml(l)).toContain('<style>');
    expect(sceneCss({ ...l, canvas: { x: 0, y: 0, w: 1000, h: 500, radius: '0px' }, background: null })).toBe('');
    expect(heroJsx(l)).toContain('.dea-scene');
  });
});
