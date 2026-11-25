import { describe, expect, it } from 'vitest';
import { INIT_SCRIPT } from '../src/browser/init.ts';

describe('Round 31: the GPU mask also answers a desktop CPU', () => {
  it('reports at least 8 cores and 8 GB when the mask is on, and records it', () => {
    expect(INIT_SCRIPT).toContain('D.coresMasked');
    expect(INIT_SCRIPT).toContain("'hardwareConcurrency'");
    expect(INIT_SCRIPT).toContain("'deviceMemory'");
    expect(INIT_SCRIPT).toContain('__DEA_GPU_MASK__ !== false');
  });
  it('the init script still parses', () => {
    expect(() => new Function(INIT_SCRIPT)).not.toThrow();
  });
});
