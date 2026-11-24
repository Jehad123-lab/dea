import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordReference } from '../src/extract/index.ts';

// dea record in a real browser: the first call takes the reference and keeps it in the cache; the second call with the
// same options finds it there and does not load the page again. A local server counts page loads; no live site.
const PAGE = `<!doctype html><title>Record me</title>
  <style>body{margin:0;background:#101418;color:#e8eef2;font:600 48px Inter,system-ui,sans-serif}</style>
  <main style="padding:80px">Record me<canvas id="c" width="400" height="200" style="display:block;margin-top:24px"></canvas></main>
  <script>const g = document.getElementById('c').getContext('2d'); g.fillStyle = '#3a7bd5'; g.fillRect(0, 0, 400, 200);</script>`;

let server: Server;
let base = '';
let loads = 0;
const cacheDir = await mkdtemp(join(tmpdir(), 'dea-record-'));

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/') loads++;
    res.writeHead(req.url === '/' ? 200 : 404, { 'content-type': 'text/html' });
    res.end(req.url === '/' ? PAGE : 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(cacheDir, { recursive: true, force: true });
});

describe.skipIf(!process.env.DEA_E2E)('dea record (real browser)', () => {
  const opts = () => ({ cacheDir, quick: true, noReplay: true, referenceMs: 500 });
  it('records once, then the same call is served from the cache without loading the page', async () => {
    const first = await recordReference(base, opts());
    expect(first.reused).toBe(false);
    expect(first.recorded).toBe(false); // --no-replay: only the screenshot
    expect(first.recordingError).toContain('--no-replay');
    expect(first.cacheDir).toBe(cacheDir);
    expect((await readdir(cacheDir)).length).toBeGreaterThan(0);
    const after = loads;
    expect(after).toBeGreaterThan(0);

    const second = await recordReference(base, opts());
    expect(second.reused).toBe(true);
    expect(loads).toBe(after);
  }, 60_000);
});
