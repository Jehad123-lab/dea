import { describe, expect, it } from 'vitest';
import { UNRECORDED_CANVAS_NOTE } from '../src/extract/index.ts';

describe('Round 35: an unrecorded run says what its canvas score is', () => {
  it('names the score as the shader-module draft, not (a) or (b)', () => {
    expect(UNRECORDED_CANVAS_NOTE).toMatch(/not \(a\) or \(b\)/);
    expect(UNRECORDED_CANVAS_NOTE).toMatch(/nothing was recorded/);
  });
});
