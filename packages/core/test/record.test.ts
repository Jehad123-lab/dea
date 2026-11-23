import { describe, expect, it } from 'vitest';
import { recordReference } from '../src/extract/index.ts';

describe('dea record', () => {
  it('refuses --no-cache: the recording lives in the cache for the next extract', async () => {
    await expect(recordReference('http://127.0.0.1:9/', { noCache: true })).rejects.toThrow(/cannot run with --no-cache/);
  });
  it('refuses --reference: your own screenshot belongs to dea extract', async () => {
    await expect(recordReference('http://127.0.0.1:9/', { reference: 'shot.png' })).rejects.toThrow(/belongs to dea extract/);
  });
});
