import { describe, expect, it } from 'vitest';
import { shortRenderer } from '../src/extract/preview.ts';

describe('Round 33: renderer names in the report', () => {
  it('keeps a short name whole', () => {
    expect(shortRenderer('ANGLE (NVIDIA GeForce RTX 3060)')).toBe('ANGLE (NVIDIA GeForce RTX 3060)');
  });
  it('cuts a long name at a word, never mid-id', () => {
    const r = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) with a much longer tail here';
    const s = shortRenderer(r, 80);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(81);
    expect(s).not.toMatch(/\(0…$/);
    expect(shortRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toContain('0x0000C0DE');
  });
});
