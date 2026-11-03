import { describe, expect, it } from 'vitest';
import { activeSource, parseShader, summarizeShaders } from '../src/design/shaders.ts';

const prefix = (type: string, name: string) =>
  `#version 300 es\n#define SHADER_TYPE ${type}\n#define SHADER_NAME ${name}\n#ifdef USE_INSTANCING\nattribute mat4 instanceMatrix;\n#endif\nuniform mat4 modelMatrix;\n`;

describe('shader reading', () => {
  it('drops inactive #ifdef blocks so three.js prefixes do not look like features', () => {
    const src = `${prefix('ShaderMaterial', 'Hole')}void main(){}`;
    expect(activeSource(src)).not.toContain('instanceMatrix');
    expect(activeSource(`#define USE_INSTANCING\n${src}`)).toContain('instanceMatrix');
  });

  it('tells the site’s own GLSL from three.js internals, addons and libraries', () => {
    const own = parseShader(
      {
        api: 'webgl2',
        type: 'fragment',
        source: `${prefix('ShaderMaterial', 'BlackHole')}uniform float uTime;\nuniform vec2 uMouse;\nfloat fbm(vec2 p){return 0.;}\nvoid main(){ float n = snoise(vec3(1.)); }`,
        t: 0,
      },
      0,
    );
    expect(own).toMatchObject({ origin: 'custom', custom: true, threeName: 'BlackHole' });
    expect(own.uniforms).toEqual(['uTime', 'uMouse']);
    expect(own.techniques).toEqual(expect.arrayContaining(['noise (simplex/perlin)', 'fractal noise (fbm)']));
    expect(parseShader({ api: 'webgl2', type: 'fragment', source: `${prefix('ShaderMaterial', 'PMREMGGXConvolution')}void main(){}`, t: 0 }, 1).origin).toBe(
      'three-internal',
    );
    expect(parseShader({ api: 'webgl2', type: 'fragment', source: `${prefix('ShaderMaterial', 'SkyShader')}void main(){}`, t: 0 }, 2).origin).toBe(
      'three-addon',
    );
    expect(parseShader({ api: 'webgl2', type: 'fragment', source: `${prefix('ShaderMaterial', 'EffectMaterial')}void main(){}`, t: 0 }, 3).origin).toBe(
      'postprocessing-lib',
    );
    expect(parseShader({ api: 'webgl2', type: 'fragment', source: `${prefix('MeshStandardMaterial', 'body')}void main(){}`, t: 0 }, 4).origin).toBe(
      'three-builtin-material',
    );
    expect(parseShader({ api: 'webgl', type: 'fragment', source: 'precision mediump float; void main(){}', t: 0 }, 5).origin).toBe('unknown');
  });

  it('summarises interactivity from custom uniform names', () => {
    const sum = summarizeShaders([
      {
        api: 'webgl2',
        type: 'fragment',
        source: `${prefix('ShaderMaterial', 'Hero')}uniform float uTime;\nuniform vec2 uMouse;\nuniform float uScroll;\nvoid main(){}`,
        t: 0,
      },
      {
        api: 'webgl2',
        type: 'fragment',
        source: `${prefix('ShaderMaterial', 'Hero')}uniform float uTime;\nuniform vec2 uMouse;\nuniform float uScroll;\nvoid main(){}`,
        t: 1,
      },
    ]);
    expect(sum.programs).toHaveLength(1);
    expect(sum.shaderCount).toBe(2);
    expect(sum.interactivity).toEqual(['react to the mouse', 'react to scroll', 'animate over time']);
  });
});
