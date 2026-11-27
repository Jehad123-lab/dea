import { describe, expect, it } from 'vitest';
import { analyzeArchitecture, classifyPassRole, fluidClamp, groupLayoutSections, projectFiles, renderArchitectureMd } from '../src/index.ts';

describe('architecture analysis', () => {
  it('classifies ordered post-processing roles and detects DOM sync + virtual scroll', () => {
    expect(classifyPassRole(['BloomPass'], 'rt0', 1)).toBe('bloom');
    expect(classifyPassRole(['FinalGrade'], 'rt1', 1)).toBe('grade');
    expect(classifyPassRole(['UfxQuad'], 'rt2', 1)).toBe('dom-sync');
    expect(classifyPassRole(['ScreenPaint'], 'rt3', 1)).toBe('distortion');
    expect(classifyPassRole(['SMAA'], 'rt4', 1)).toBe('antialias');
    expect(classifyPassRole(['FSRUpscale'], 'screen', 1)).toBe('upscale');

    const report = analyzeArchitecture({
      site: 'https://example.com',
      stack: ['three.js 0.158.0'],
      passes: [
        { index: 0, target: 'rt0', programs: ['p0'], programNames: ['BloomPass'], draws: 1, inputs: [] },
        { index: 1, target: 'rt1', programs: ['p1'], programNames: ['UfxQuad'], draws: 1, inputs: ['rt0'] },
        { index: 2, target: 'screen', programs: ['p2'], programNames: ['SMAA'], draws: 1, inputs: ['rt1'] },
      ],
      mods: [
        {
          name: 'ScreenPaintShader',
          file: 'shaders/ScreenPaintShader.js',
          fullscreen: true,
          points: false,
          uniforms: [{ name: 'uMouse', type: 'vec2', value: '[0, 0]', driver: { kind: 'pointer', axis: 'x', scale: 1, offset: 0, r: 1 } }],
          textures: [{ sampler: 'tUfx', file: null, placeholder: true }],
          code: '',
          vertex: '',
          fragment: '',
        },
      ],
      pageLayer: {
        viewport: { width: 1440, height: 900 },
        documentHeight: 3600,
        extent: 2700,
        mechanism: 'wheel',
        ratio: 1,
        wheelRatio: 0.75,
        stops: [],
        boxes: [],
        shapes: [],
        graphics: [],
        backgrounds: [[0, '#000000']],
        counts: { static: 4, fixed: 1, moving: 3 },
        limits: [],
      },
    });

    expect(report.domSyncDetected).toBe(true);
    expect(report.postChain.map((p) => p.role)).toEqual(['bloom', 'dom-sync', 'antialias']);
    expect(report.techniques.map((t) => t.id)).toContain('post-chain');
    expect(report.techniques.map((t) => t.id)).toContain('dom-webgl-sync');
    expect(report.techniques.map((t) => t.id)).toContain('virtual-scroll');
    expect(report.techniques.map((t) => t.id)).toContain('screen-distortion');

    const md = renderArchitectureMd(report);
    expect(md).toContain('## Ordered Render & Post-Processing Chain');
    expect(md).toContain('## Shaders by Owner / Pass');
    expect(md).toContain('ScreenPaintShader');
  });
});

describe('scalable Next.js output', () => {
  it('generates fluid clamp(), responsive sections, Lenis SmoothScroll, and motion/react MotionSection', () => {
    expect(fluidClamp(64, 1440)).toMatch(/^clamp\(42px, 4\.44vw, 74px\)$/);

    const layout = {
      viewport: { width: 1440, height: 900 },
      background: '#ffffff',
      canvas: null,
      scroll: null,
      boxes: [
        {
          k: 'nav',
          tag: 'a',
          text: 'Studio',
          x: 40,
          y: 24,
          w: 120,
          h: 28,
          fontFamily: 'Inter',
          fontSize: 16,
          fontWeight: '500',
          lineHeight: '24px',
          color: '#111111',
          textAlign: 'left',
          textTransform: 'none',
          letterSpacing: 'normal',
          opacity: 1,
          zp: [10],
          o: 0,
          win: [0, 3000] as [number, number],
        },
        {
          k: 'hero-title',
          tag: 'h1',
          text: 'Build Better Motion',
          x: 80,
          y: 220,
          w: 720,
          h: 96,
          fontFamily: 'Inter',
          fontSize: 64,
          fontWeight: '600',
          lineHeight: '1.1',
          color: '#111111',
          textAlign: 'left',
          textTransform: 'none',
          letterSpacing: '-0.02em',
          opacity: 1,
          zp: [1],
          o: 1,
          kf: [
            [0, 80, 220, 720, 96, 1],
            [600, 80, 140, 720, 96, 0.2],
          ] as [number, number, number, number, number, number][],
        },
      ],
      shapes: [],
      graphics: [],
    };

    const grouped = groupLayoutSections(layout);
    expect(grouped.sections.map((s) => s.role)).toEqual(['header', 'section']);

    const files = projectFiles('next', {
      mods: [],
      title: 'Test Site',
      site: 'https://example.com',
      threeVersion: '0.170.0',
      hasMotion: true,
      heading: 'Build Better Motion',
      layout,
    });

    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        'package.json',
        'next.config.mjs',
        'app/globals.css',
        'app/layout.tsx',
        'app/page.tsx',
        'components/SmoothScroll.tsx',
        'components/MotionSection.tsx',
        'components/PageContent.tsx',
        'components/Scene.tsx',
      ]),
    );
    expect(files['package.json']).toContain('"next"');
    expect(files['package.json']).toContain('"motion"');
    expect(files['package.json']).toContain('"lenis"');
    expect(files['components/MotionSection.tsx']).toContain("from 'motion/react'");
    expect(files['components/SmoothScroll.tsx']).toContain("from 'lenis'");
    expect(files['components/PageContent.tsx']).toContain('clamp(');
  });
});
