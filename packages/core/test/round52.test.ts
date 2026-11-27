import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAYOUT_READ } from '../src/extract/preview.ts';

const src = readFileSync(new URL('../src/extract/index.ts', import.meta.url), 'utf8');

describe('Round 52: Stats.js at any depth, --own-assets-cost-only', () => {
  it('the layout read looks for a canvas-only fixed box anywhere, not only under body', () => {
    const js = LAYOUT_READ(null);
    expect(js).toContain("document.querySelectorAll('div')");
    expect(js).not.toContain("querySelectorAll('body > div')");
    expect(() => new Function(js)).not.toThrow();
  });

  it('cost-only mode needs a cached recording and skips the slow stages', () => {
    expect(src).toContain('--own-assets-cost-only needs the recording of an earlier run');
    expect(src).toContain('opts.ownAssets && (opts.ownAssetsCost || costOnly)');
    for (const gate of [
      'layoutCandidates.length && !costOnly',
      'quick || costOnly ? [] : candidates',
      'rounds: quick || costOnly ? 0',
      '!quick && !costOnly && replay',
      "!quick && !costOnly && !budgetSkip('build check')",
    ])
      expect(src).toContain(gate);
  });
});
