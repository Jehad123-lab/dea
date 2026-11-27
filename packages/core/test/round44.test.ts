import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sceneModule } from '../src/replay/scene.ts';

describe('Round 44: kits load their files from Vite base (deployable under a sub-path)', () => {
  it('the recovered scene module reads scene.glb under BASE_URL', () => {
    // the kit's own template expression, assembled so it is not read as one here
    expect(sceneModule()).toContain(`$${'{'}import.meta.env?.BASE_URL ?? '/'}scene/scene.glb`);
    expect(sceneModule()).not.toContain("'/scene/scene.glb'");
  });
  it('the generated Scene components mount the rebuild and the replay under BASE_URL', () => {
    const src = readFileSync(new URL('../src/extract/generate.ts', import.meta.url), 'utf8');
    expect(src).not.toContain("{ base: '/rebuild/' }");
    expect(src).not.toContain("{ base: '/replay/' }");
    expect(src.match(/BASE_URL \?\? '\/'}rebuild\//g)?.length).toBe(3);
  });
});
