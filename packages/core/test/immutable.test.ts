import { describe, expect, it } from 'vitest';
import { isImmutableUrl } from '../src/cache.ts';

describe('isImmutableUrl: CDN files that can never change, kept past the cache age limit', () => {
  it('an exact package version on jsDelivr, esm.sh or unpkg', () => {
    expect(isImmutableUrl('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js')).toBe(true);
    expect(isImmutableUrl('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js')).toBe(true);
    expect(isImmutableUrl('https://esm.sh/three@0.170.0')).toBe(true);
    expect(isImmutableUrl('https://esm.sh/react@19.0.0/jsx-runtime')).toBe(true);
    expect(isImmutableUrl('https://unpkg.com/@react-three/fiber@9.1.2/dist/index.js')).toBe(true);
  });
  it('not a range, a tag, another host or plain http', () => {
    expect(isImmutableUrl('https://esm.sh/react@19')).toBe(false);
    expect(isImmutableUrl('https://cdn.jsdelivr.net/npm/three@latest/build/three.module.js')).toBe(false);
    expect(isImmutableUrl('https://cdn.jsdelivr.net/npm/three@^0.170.0/build/three.module.js')).toBe(false);
    expect(isImmutableUrl('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/build/three.module.js')).toBe(false);
    expect(isImmutableUrl('https://example.com/three@0.170.0/three.module.js')).toBe(false);
    expect(isImmutableUrl('http://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js')).toBe(false);
    expect(isImmutableUrl('not a url')).toBe(false);
  });
});
