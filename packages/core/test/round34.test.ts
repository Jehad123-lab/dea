import { describe, expect, it } from 'vitest';
import { activeGlsl, detectTechniques } from '../src/extract/research.js';
import { NO_CONTEXT_MS, NO_DRAW_MS } from '../src/replay/capture.js';

const standard = [
  '#version 300 es',
  '#define STANDARD',
  '#define USE_MAP',
  '#ifdef USE_MAP',
  '  uniform sampler2D map;',
  '#endif',
  '#ifdef USE_DISPLACEMENTMAP',
  '  uniform sampler2D displacementMap;',
  '#endif',
  'void main() {}',
].join('\n');

describe('Round 34: techniques ignore GLSL behind an #ifdef that is off', () => {
  it('drops an undefined #ifdef branch and keeps a defined one', () => {
    const out = activeGlsl(standard);
    expect(out).toContain('uniform sampler2D map;');
    expect(out).not.toContain('displacementMap');
  });

  it('no heightmap for a three.js material without a displacement map (keyframes false positive)', () => {
    expect(detectTechniques(standard).map((t) => t.id)).not.toContain('heightmap');
  });

  it('still finds a heightmap when the displacement map is on', () => {
    const on = standard.replace('#define USE_MAP', '#define USE_MAP\n#define USE_DISPLACEMENTMAP');
    expect(detectTechniques(on).map((t) => t.id)).toContain('heightmap');
  });

  it('handles #ifndef, #else, #elif and #if defined()', () => {
    const src = [
      '#define A',
      '#ifndef A',
      'x1',
      '#else',
      'x2',
      '#endif',
      '#if defined(B) || defined(A)',
      'x3',
      '#endif',
      '#if defined(B)',
      'x4',
      '#elif defined(A)',
      'x5',
      '#else',
      'x6',
      '#endif',
    ].join('\n');
    const out = activeGlsl(src).split('\n');
    expect(out).toEqual(['#define A', 'x2', 'x3', 'x5']);
  });

  it('keeps both branches of an #if it cannot evaluate', () => {
    const out = activeGlsl(['#if NUM_LIGHTS > 0', 'a', '#else', 'b', '#endif'].join('\n'));
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('defines do not leak from one program into the next', () => {
    const out = activeGlsl(['#version 300 es', '#define USE_X', '#version 300 es', '#ifdef USE_X', 'leak', '#endif'].join('\n'));
    expect(out).not.toContain('leak');
  });

  it('nested branches inside an off branch stay off', () => {
    const out = activeGlsl(['#ifdef OFF', '#ifndef ALSO', 'hidden', '#endif', '#endif', 'shown'].join('\n'));
    expect(out).not.toContain('hidden');
    expect(out).toContain('shown');
  });
});

describe('Round 34: the recorder gives up early on a page with no WebGL context', () => {
  it('waits seconds, not the full 90 s', () => {
    expect(NO_CONTEXT_MS).toBeLessThanOrEqual(10_000);
  });

  it('gives up after 15 s when contexts exist but none has drawn', () => {
    expect(NO_DRAW_MS).toBeLessThan(90_000);
    expect(NO_DRAW_MS).toBeGreaterThan(NO_CONTEXT_MS);
  });
});
