import { describe, expect, it } from 'vitest';
import { detectStack, type StackSignals } from '../src/see/stack.ts';

const base = (over: Partial<StackSignals> = {}): StackSignals => ({
  probes: {},
  meta: {},
  scripts: [],
  requestUrls: [],
  htmlClass: '',
  htmlAttrs: {},
  documentHeaders: {},
  ...over,
});
const find = (s: StackSignals, id: string) => detectStack(s).find((h) => h.id === id);

describe('stack detector', () => {
  it('reads three.js and GSAP from their own globals as Verified', () => {
    const s = base({ probes: { three: '170', gsapVersions: ['3.15.0'] } });
    expect(find(s, 'three')).toMatchObject({ version: 'r170', label: 'Verified', versionLabel: 'Verified' });
    expect(find(s, 'gsap')).toMatchObject({ version: '3.15.0', label: 'Verified' });
  });

  it('labels script-name matches as Inferred', () => {
    const s = base({ scripts: ['https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js'] });
    expect(find(s, 'gsap')).toMatchObject({ version: '3.12.5', label: 'Inferred' });
  });

  it('finds Lenis from its html class and version global', () => {
    expect(find(base({ htmlClass: 'lenis lenis-smooth' }), 'lenis')?.label).toBe('Verified');
    expect(find(base({ probes: { lenisVersion: '1.3.4' } }), 'lenis')?.version).toBe('1.3.4');
  });

  it('finds React through the devtools hook, Next through window.next', () => {
    const s = base({ reactRenderers: [{ version: '19.1.0', packageName: 'react-dom' }], probes: { next: '15.3.0', nextAppRouter: true } });
    expect(find(s, 'react')).toMatchObject({ version: '19.1.0', label: 'Verified' });
    expect(find(s, 'next')).toMatchObject({ version: '15.3.0', label: 'Verified' });
  });

  it('finds Vue 3 from the app instance', () => {
    expect(find(base({ probes: { vue3App: '3.5.13' } }), 'vue')).toMatchObject({ version: '3.5.13', label: 'Verified' });
  });

  it('finds Webflow and Framer from generator tags and DOM markers', () => {
    expect(find(base({ meta: { generator: 'Webflow' }, probes: { webflowSite: '64ab' } }), 'webflow')?.label).toBe('Verified');
    expect(find(base({ meta: { generator: 'Framer 1b2c3d4' } }), 'framer')).toMatchObject({ label: 'Verified', version: '1b2c3d4' });
    expect(find(base({ requestUrls: ['https://framerusercontent.com/sites/x/script.mjs'] }), 'framer')?.label).toBe('Inferred');
  });

  it('reads hosting from response headers', () => {
    expect(find(base({ documentHeaders: { server: 'Vercel', 'x-vercel-id': 'bom1::abc' } }), 'vercel')?.label).toBe('Verified');
    expect(find(base({ documentHeaders: { server: 'cloudflare' } }), 'cloudflare')?.label).toBe('Verified');
  });

  it('says honestly when shaders run but no engine is known', () => {
    const hit = find(base({ shaderCount: 4, contexts: 1 }), 'webgl-unknown');
    expect(hit?.label).toBe('Inferred');
    expect(find(base({ shaderCount: 0, contexts: 1 }), 'webgl-unknown')).toBeUndefined();
  });

  it('reports nothing for a bare page', () => {
    expect(detectStack(base())).toEqual([]);
  });
});
