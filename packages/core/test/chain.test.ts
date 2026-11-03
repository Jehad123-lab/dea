import { SourceMapGenerator } from 'source-map-js';
import { describe, expect, it } from 'vitest';
import { originOf, passesOf, samplingLine } from '../src/assets/chain.ts';

describe('network → source → runtime', () => {
  it('maps the initiator stack through a source map and skips library frames', async () => {
    const gen = new SourceMapGenerator({ file: 'main-abc.js' });
    gen.addMapping({ generated: { line: 1, column: 40 }, original: { line: 6, column: 2 }, source: 'src/gl/blueNoise.js', name: 'load' });
    gen.setSourceContent('src/gl/blueNoise.js', "a\nb\nc\nd\ne\nexport const blueNoise = new THREE.TextureLoader().load('/tex/bluenoise64.png');\n");
    const files: Record<string, string> = {
      'https://x.test/assets/three-AAA.js': 'three()',
      'https://x.test/assets/main-abc.js': `${' '.repeat(40)}x()\n//# sourceMappingURL=main-abc.js.map`,
      'https://x.test/assets/main-abc.js.map': gen.toString(),
    };
    const o = await originOf(
      [
        { functionName: 'load', url: 'https://x.test/assets/three-AAA.js', lineNumber: 0, columnNumber: 3 },
        { functionName: 'init', url: 'https://x.test/assets/main-abc.js', lineNumber: 0, columnNumber: 40 },
      ],
      async (u) => files[u] ?? null,
      new Map(),
    );
    expect(o?.where).toBe('src/gl/blueNoise.js:6 (load)');
    expect(o?.via).toBe('three-AAA.js:1:4 (load)');
    expect(o?.excerpt).toContain("load('/tex/bluenoise64.png')");
    expect(o?.how).toContain('source map');
  });

  it('falls back to the bundle position with a code excerpt when no map is published', async () => {
    const js = `var a=1;function Ct(){return new Ae().load("/tex/noise.png")}`;
    const o = await originOf(
      [{ functionName: 'Ct', url: 'https://x.test/main-1.js', lineNumber: 0, columnNumber: 30 }],
      async (u) => (u.endsWith('.js') ? js : null),
      new Map(),
    );
    expect(o?.where).toBe('main-1.js:1:31 (Ct)');
    expect(o?.excerpt).toContain('/tex/noise.png');
  });

  it('finds the shader line that samples a sampler, and groups draws into passes', () => {
    const fs = 'precision highp float;\nuniform sampler2D tBlue;\nvoid main(){\n  vec4 n = texture2D(tBlue, gl_FragCoord.xy / 64.);\n  gl_FragColor = n;\n}';
    expect(samplingLine([fs], 'tBlue')).toEqual({ stage: 'fragment', line: 4, code: 'vec4 n = texture2D(tBlue, gl_FragCoord.xy / 64.);' });
    expect(samplingLine([fs], 'tNope')).toBeNull();
    const p = passesOf([
      { program: 'p1', target: 't1', inputs: ['t0'] },
      { program: 'p2', target: 'screen', inputs: ['t1'] },
      { program: 'p3', target: 'screen', inputs: ['t2'] },
    ]);
    expect(p).toEqual([
      { index: 1, target: 't1', programs: ['p1'], draws: 1, inputs: ['t0'] },
      { index: 2, target: 'screen', programs: ['p2', 'p3'], draws: 2, inputs: ['t1', 't2'] },
    ]);
  });
});
