import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { framerComponent, framerControls, framerName, framerRunner, writeFramerExport } from '../src/extract/framer.ts';
import type { PipelineDoc } from '../src/replay/rebuild.ts';

function pipeline(over: Partial<PipelineDoc> = {}): PipelineDoc {
  return {
    url: 'https://lusion.co/',
    at: '2026-11-23T00:00:00Z',
    data: 'data.bin',
    canvas: { w: 1280, h: 720, cssW: 1280, cssH: 720, x: 0, y: 0 } as any,
    attrs: {},
    extensions: [],
    resources: {} as any,
    materials: [
      {
        id: 0,
        program: 1,
        name: 'm0',
        vertex: 'shaders/m0.vert',
        fragment: 'shaders/m0.frag',
        state: {} as any,
        uniforms: { uTime: 3, uIntensity: 0.8, uColor: [1, 0.5, 0], uTex: { tex: 1, kind: '2d' }, uFlow: 2, uPos: [0.2, 3, 1] },
        builtins: [],
      },
      { id: 1, program: 2, name: 'm1', vertex: 'a', fragment: 'b', state: {} as any, uniforms: { uIntensity: -2, uMouse: [0, 0] }, builtins: [] },
    ],
    cameras: [],
    passes: [],
    frames: [],
    clocks: [{ program: 1, uniform: 'uFlow', base: 0, rate: 1 }],
    inputs: [],
    viewport: { w: 1280, h: 720 },
    toneMappingExposure: null,
    labels: {},
    ...over,
  } as PipelineDoc;
}

describe('framer export', () => {
  it('names components safely', () => {
    expect(framerName('https://www.lusion.co/')).toBe('LusionCo');
    expect(framerName('123 go')).toBe('Dea123Go');
    expect(framerName('')).toBe('DeaRebuild');
  });

  it('makes controls for plain numbers and colour-named vectors, skipping clocks, inputs, textures and positions', () => {
    const c = framerControls(pipeline());
    expect(c.map((x) => [x.prop, x.kind, x.uniform, x.material])).toEqual([
      ['intensity', 'number', 'uIntensity', 0],
      ['color', 'color', 'uColor', 0],
      ['intensity1', 'number', 'uIntensity', 1],
    ]);
    expect(c[2].min).toBeLessThan(0);
  });

  it('strips exports from the runner and loads three.js from esm.sh', () => {
    const r = framerRunner('165');
    expect(r).toContain('https://esm.sh/three@0.165.0');
    expect(r).not.toMatch(/^export /m);
    expect(r).not.toContain("from 'three'");
  });

  it('writes one default-exported component with property controls and low-end defaults', () => {
    const { code, name } = framerComponent(pipeline(), { url: 'https://x.vercel.app/rebuild/' });
    expect(name).toBe('LusionCo');
    expect(code).toContain('export default function LusionCo(props)');
    expect(code.match(/^export /gm)).toHaveLength(1);
    expect(code).toContain('@framerDisableUnlink');
    expect(code).toContain('@framerIntrinsicWidth 1280');
    expect(code).toContain('IntersectionObserver');
    expect(code).toContain('prefers-reduced-motion');
    expect(code).toContain('webglcontextlost');
    expect(code).toContain('maxDpr: 1.5');
    expect(code).toContain('color: "#ff8000"');
    expect(code).toContain('"https://x.vercel.app/rebuild/"');
  });
});

describe('writeFramerExport', () => {
  let kit: string;
  beforeEach(async () => {
    kit = await mkdtemp(join(tmpdir(), 'dea-framer-'));
    await mkdir(join(kit, 'public', 'rebuild', 'shaders'), { recursive: true });
    await writeFile(join(kit, 'public', 'rebuild', 'shaders', 'm0.frag'), 'void main(){}');
    await writeFile(join(kit, 'public', 'rebuild', 'data.bin'), 'bin');
  });
  afterEach(() => rm(kit, { recursive: true, force: true }));
  const exists = (p: string) =>
    stat(p).then(
      () => true,
      () => false,
    );

  it('refuses a kit with the site files unless allowed, and copies the capture it points to', async () => {
    await writeFile(join(kit, 'dea-kit.json'), JSON.stringify({ url: 'https://lusion.co/', ownAssets: false }));
    await writeFile(join(kit, 'public', 'rebuild', 'pipeline.json'), JSON.stringify(pipeline({ data: '../replay/capture.bin' })));
    await mkdir(join(kit, 'public', 'replay'), { recursive: true });
    await writeFile(join(kit, 'public', 'replay', 'capture.bin'), 'cap');
    await expect(writeFramerExport(kit)).rejects.toThrow(/--own-assets/);
    const r = await writeFramerExport(kit, { allowSiteFiles: true });
    expect(r.siteFiles).toBe(true);
    expect(await exists(join(r.site, 'replay', 'capture.bin'))).toBe(true);
    expect(await readFile(join(kit, 'framer', 'README.md'), 'utf8')).toMatch(/Warning/);
  });

  it('writes the component, the hosted files and CORS headers for an own-assets kit', async () => {
    await writeFile(join(kit, 'dea-kit.json'), JSON.stringify({ url: 'https://lusion.co/', ownAssets: true }));
    await writeFile(join(kit, 'public', 'rebuild', 'pipeline.json'), JSON.stringify(pipeline()));
    const r = await writeFramerExport(kit, { name: 'Hero Glow' });
    expect(r.name).toBe('HeroGlow');
    expect(r.siteFiles).toBe(false);
    expect(await exists(join(kit, 'framer', 'HeroGlow.tsx'))).toBe(true);
    expect(await exists(join(r.site, 'rebuild', 'data.bin'))).toBe(true);
    expect(await exists(join(r.site, 'rebuild', 'shaders', 'm0.frag'))).toBe(true);
    expect(JSON.parse(await readFile(join(r.site, 'vercel.json'), 'utf8')).headers[0].headers[0].value).toBe('*');
    expect(await exists(join(r.site, '_headers'))).toBe(true);
  });

  it('explains a kit without a rebuild', async () => {
    await writeFile(join(kit, 'dea-kit.json'), JSON.stringify({ url: 'https://a.b/', ownAssets: true }));
    await expect(writeFramerExport(kit)).rejects.toThrow(/no editable rebuild/);
  });
});

describe('framer export: why it is blank', () => {
  it('says what is wrong in the Framer editor only, never to a visitor', () => {
    const { code } = framerComponent(pipeline(), { name: 'Hero' });
    expect(code).toContain('Set Source to the URL of the hosted framer/site folder');
    expect(code).toContain('Access-Control-Allow-Origin');
    expect(code).toContain('context lost');
    // the message is drawn only when the component is on the Framer canvas (the editor)
    expect(code).toContain('RenderTarget.current() === RenderTarget.canvas');
    expect(code).toMatch(/why && inCanvas \?/);
  });
});
