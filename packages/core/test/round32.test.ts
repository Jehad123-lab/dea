import { describe, expect, it } from 'vitest';
import { INIT_SCRIPT } from '../src/browser/init.ts';
import { ENV_READ, envLine } from '../src/extract/preview.ts';

describe('Round 32: the page environment in the report', () => {
  it('says nothing when there is nothing to say', () => {
    expect(envLine(null)).toBeNull();
    expect(envLine({ gpuMasked: false, coresMasked: false, renderer: null, contextLost: [], fallbackClass: null })).toBeNull();
  });
  it('names the masks, a lost context and a fallback class', () => {
    const l = envLine({
      gpuMasked: true,
      coresMasked: true,
      renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))',
      contextLost: [{ t: 118_400, w: 1440, h: 900 }],
      fallbackClass: 'vscroll static',
    });
    expect(l).toContain('desktop GPU name');
    expect(l).toContain('8 CPU cores');
    expect(l).toContain('lost 1 WebGL context(s) (first at 118 s, 1440x900 canvas)');
    expect(l).toContain('html class "vscroll static"');
  });
  it('the page scripts parse and record context loss', () => {
    expect(() => new Function(`return ${ENV_READ}`)).not.toThrow();
    expect(() => new Function(INIT_SCRIPT)).not.toThrow();
    expect(INIT_SCRIPT).toContain('webglcontextlost');
  });
  it('the fallback-class regex is escaped for the page', () => {
    expect(ENV_READ).toContain('(^|\\s)(static|');
  });
});
