import { describe, expect, it } from 'vitest';
import { rebuildErrorText, recordReference } from '../src/extract/index.ts';

describe('dea record', () => {
  it('refuses --no-cache: the recording lives in the cache for the next extract', async () => {
    await expect(recordReference('http://127.0.0.1:9/', { noCache: true })).rejects.toThrow(/cannot run with --no-cache/);
  });
  it('refuses --reference: your own screenshot belongs to dea extract', async () => {
    await expect(recordReference('http://127.0.0.1:9/', { reference: 'shot.png' })).rejects.toThrow(/belongs to dea extract/);
  });
});

describe('rebuild error text', () => {
  it('says a CDN failure is a missing three.js, not a bad rebuild', () => {
    const t = rebuildErrorText('Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');
    expect(t).toMatch(/three\.js could not be loaded from the CDN/);
    expect(t).toMatch(/Run again with internet/);
  });
  it('keeps any other error as it is (short)', () => {
    expect(rebuildErrorText('x'.repeat(500))).toHaveLength(200);
  });
});
