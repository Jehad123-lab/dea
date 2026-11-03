import { describe, expect, it } from 'vitest';
import {
  buildOpenApi,
  CodeIndex,
  checkScripts,
  cmpVersion,
  detectBundler,
  explainPrograms,
  inferSchema,
  isApiCall,
  isAssetUrl,
  isTelemetry,
  linkData,
  mergeSchema,
  parseStack,
  type ScriptRecord,
  safeSourcePath,
  templatePath,
  uniformMeaning,
} from '../src/index.ts';

const script = (url: string, source: string, extra: Partial<ScriptRecord> = {}): ScriptRecord => ({
  scriptId: url,
  url,
  inline: false,
  isModule: true,
  bytes: source.length,
  hash: 'x',
  sourceMapUrl: null,
  source,
  libs: [],
  role: 'app',
  ...extra,
});

describe('API decoder', () => {
  it('turns ids in paths into named parameters', () => {
    expect(templatePath('/api/users/12345/posts/9f8e7d6c-1111-2222-3333-444455556666')).toEqual({
      template: '/api/users/{userId}/posts/{postId}',
      params: ['userId', 'postId'],
    });
    expect(templatePath('/v1/data/query/production').template).toBe('/v1/data/query/production');
  });

  it('infers and merges JSON shapes', () => {
    const a = inferSchema({ id: 1, name: 'a', tags: ['x'] });
    expect(a.properties.id.type).toBe('integer');
    expect(a.properties.tags.items.type).toBe('string');
    const m = mergeSchema(inferSchema({ id: 1 }), inferSchema({ id: 2, extra: true }));
    expect(Object.keys(m.properties)).toEqual(expect.arrayContaining(['id', 'extra']));
  });

  it('keeps assets and analytics out of the API', () => {
    expect(isApiCall({ method: 'GET', url: 'https://x.dev/api/items', responseMime: 'application/json', resourceType: 'fetch' })).toBe(true);
    expect(isApiCall({ method: 'GET', url: 'https://x.dev/logo.png', responseMime: 'image/png', resourceType: 'image' })).toBe(false);
    // files code fetches itself are listed as assets, not endpoints
    expect(isAssetUrl('https://x.dev/models/a.glb', 'model/gltf-binary')).toBe(true);
    expect(isAssetUrl('https://x.dev/api/items', 'application/json')).toBe(false);
    expect(isTelemetry('https://www.google-analytics.com/g/collect?v=2')).toBe(true);
  });

  it('writes an OpenAPI 3.1 spec with auth kinds and no secret values', () => {
    const secret = 'sk_live_51HxABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const call = (id: number) => ({
      method: 'GET',
      url: `https://api.example.com/v2/products/${id}?lang=en&api_key=${secret}`,
      status: 200,
      requestMime: '',
      requestBody: null,
      responseMime: 'application/json',
      responseBody: JSON.stringify({ id, title: 'Chair', price: 12.5, token: secret }),
      requestHeaderNames: ['authorization'],
      auth: ['Bearer'],
      harIndex: id,
      initiator: 'https://example.com/assets/app.js:1:200',
    });
    const r = buildOpenApi([call(101), call(202)], { title: 'Example', site: 'https://example.com' });
    const doc = r.openapi as any;
    expect(doc.openapi).toBe('3.1.0');
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(['/v2/products/{productId}']);
    expect(JSON.stringify(doc)).not.toContain(secret);
    expect(JSON.stringify(doc.components?.securitySchemes ?? {})).toMatch(/bearer/i);
    expect(r.endpoints[0].calls).toBe(2);
    expect(r.endpoints[0].initiators[0]).toContain('app.js');
  });

  it('ties response values to the sections that show them', () => {
    const calls = [
      {
        method: 'GET',
        url: 'https://cms.example.com/data?q=projects',
        status: 200,
        requestMime: '',
        requestBody: null,
        responseMime: 'application/json',
        responseBody: JSON.stringify({ result: [{ name: 'Black Hole' }, { name: 'Water Simulation' }, { name: 'Signal Core' }] }),
        requestHeaderNames: [],
        auth: [],
        harIndex: 0,
        initiator: null,
      },
    ];
    const sections = [
      { index: 0, text: 'Hello there, welcome' },
      { index: 1, text: 'Open Black Hole. Open Water Simulation. Open Signal Core.' },
    ] as any;
    const links = linkData(calls, sections);
    expect(links).toHaveLength(1);
    expect(links[0].section).toBe(1);
    expect(links[0].label).toBe('Verified');
  });
});

describe('vulnerable libraries', () => {
  it('compares versions the way retire.js does', () => {
    expect(cmpVersion('3.4.1', '3.5.0')).toBeLessThan(0);
    expect(cmpVersion('1.12.0', '1.9.9')).toBeGreaterThan(0);
    expect(cmpVersion('3.0.0', '3.0.0-beta.2')).toBeGreaterThan(0);
    expect(cmpVersion('2.0', '2.0.0')).toBe(0);
  });

  it('finds a library version and the issues that apply to it', () => {
    const repo = {
      jquery: {
        extractors: { uri: ['/(§§version§§)/jquery(\\.min)?\\.js'], filecontent: ['jQuery v(§§version§§)'] },
        vulnerabilities: [
          { below: '3.5.0', atOrAbove: '1.2.0', severity: 'medium', identifiers: { CVE: ['CVE-2020-11022'], summary: 'XSS in htmlPrefilter' } },
          { below: '1.9.0', severity: 'medium', identifiers: { CVE: ['CVE-2012-6708'] } },
        ],
      },
    };
    const hits = checkScripts(repo, [{ url: 'https://cdn.example.com/3.4.1/jquery.min.js', source: '/*! jQuery v3.4.1 */' }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].version).toBe('3.4.1');
    expect(hits[0].vulnerabilities.map((v) => v.ids[0])).toEqual(['CVE-2020-11022']);
    expect(checkScripts(repo, [{ url: 'https://x/3.7.1/jquery.js', source: '' }])[0].vulnerabilities).toHaveLength(0);
  });
});

describe('shader uniforms', () => {
  it('explains common uniform names', () => {
    expect(uniformMeaning('uTime')).toMatch(/clock/);
    expect(uniformMeaning('uMouse')).toMatch(/cursor/);
    expect(uniformMeaning('iResolution')).toMatch(/size/);
  });

  it('reads how the shader uses each uniform and joins live values', () => {
    const frag = `precision highp float;
uniform float uTime; uniform vec3 uColor; uniform sampler2D tMap; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){ vec4 t = texture2D(tMap, vUv); float w = sin(vUv.x * 10. + uTime); gl_FragColor = vec4(mix(t.rgb, uColor, w), 1.); }`;
    const programs = explainPrograms(
      [{ api: 'webgl2', type: 'fragment', source: frag, t: 1 }],
      [
        {
          name: 'wave',
          type: 'ShaderMaterial',
          meshes: ['heroPlane'],
          transparent: false,
          customProgram: true,
          uniforms: [
            { name: 'uTime', kind: 'number', value: '1.25', changed: true },
            { name: 'uColor', kind: 'Color', value: '#ff3300', changed: false },
            { name: 'tMap', kind: 'Texture', value: 'texture 512×512', changed: false },
          ],
        } as any,
      ],
    );
    expect(programs).toHaveLength(1);
    const p = programs[0];
    expect(p.functions).toContain('hash');
    const byName = Object.fromEntries(p.uniforms.map((u) => [u.name, u]));
    expect(byName.uTime.meaning).toMatch(/sine/);
    expect(byName.tMap.meaning).toMatch(/texture/);
    expect(byName.uTime.live).toEqual({ value: '1.25', changed: true });
    expect(p.material?.meshes).toEqual(['heroPlane']);
  });
});

describe('code index', () => {
  const bundle =
    'import{g as gsap}from"./motion.js";function Hero(){const e=document.querySelector(".hero-title");gsap.to(e,{y:0,opacity:1,duration:1.2,ease:"expo.out",stagger:.08});const t=gsap.timeline({delay:.4});t.to(".a",{x:10,duration:.5,ease:"power2.inOut"}).to(".b",{x:20,duration:.7,ease:"none"})}function Other(){return 1}Hero();';
  const idx = new CodeIndex([script('https://x.dev/assets/main-AbCd1234.js', bundle)], []);

  it('shows the smallest function around a position in a one-line bundle', () => {
    const ex = idx.at('https://x.dev/assets/main-AbCd1234.js', 1, bundle.indexOf('gsap.to') + 1);
    expect(ex?.code).toContain('function Hero()');
    expect(ex?.code).not.toContain('function Other');
  });

  it('finds code that names a class', () => {
    expect(idx.find('hero-title')[0]?.code).toContain('hero-title');
  });

  it('reads GSAP calls out of the code, each at its own column', () => {
    const tw = idx.staticTweens().filter((t) => t.method !== 'timeline');
    expect(tw.map((t) => [t.props.duration, t.props.ease])).toEqual([
      ['1.2', '"expo.out"'],
      ['0.5', '"power2.inOut"'],
      ['0.7', '"none"'],
    ]);
    expect(new Set(tw.map((t) => t.col)).size).toBe(3);
  });
});

describe('scripts', () => {
  it('detects Vite and webpack builds', () => {
    expect(detectBundler([script('https://x.dev/assets/index-AbCd1234.js', 'const __vite__mapDeps=1')]).map((b) => b.name)).toContain('Vite');
    expect(detectBundler([script('https://x.dev/_next/static/chunks/1.js', 'self.webpackChunk_N_E=self.webpackChunk_N_E||[]')]).map((b) => b.name)).toEqual(
      expect.arrayContaining([expect.stringMatching(/webpack|Next/)]),
    );
  });

  it('never lets a source map write outside its folder', () => {
    for (const bad of ['../../etc/passwd', 'webpack:///../../../x.js', '/abs/path.js', 'C:\\\\win\\\\x.js']) {
      const p = safeSourcePath(bad);
      expect(p.startsWith('/')).toBe(false);
      expect(p.split('/')).not.toContain('..');
    }
  });

  it('parses V8 stacks', () => {
    const f = parseStack(['Error', '    at Hero (https://x.dev/assets/main.js:1:420)', '    at https://x.dev/assets/main.js:1:9']);
    expect(f[0]).toMatchObject({ fn: 'Hero', url: 'https://x.dev/assets/main.js', line: 1, col: 420 });
  });
});
