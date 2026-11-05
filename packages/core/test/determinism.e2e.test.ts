import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extract } from '../src/extract/index.ts';
import { serveDir } from '../src/extract/preview.ts';
import { canonicalJson, ledgerAnswer, queryLedger, readLedger } from '../src/index.ts';

// Same inputs, same outputs: the same local page extracted twice must give the same structured answer (scores rounded, page map,
// evidence ledger); only `meta` (run id, times, machine, file hashes) may differ. A static page: a still WebGL triangle and some text.
const PAGE = `<!doctype html><html><head><style>body{margin:0;font:22px Arial;background:#fff}section{height:600px;padding:60px}#c{display:block;width:400px;height:300px}</style></head><body>
<section><h1>Static fixture</h1><canvas id="c" width="400" height="300"></canvas></section>
<section style="background:#eef"><h2>Second section</h2><p>Some words that never change.</p></section>
<script>
const gl = document.getElementById('c').getContext('webgl', { preserveDrawingBuffer: true });
const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
const p = gl.createProgram();
gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'));
gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float; void main(){ gl_FragColor = vec4(0.9, 0.3, 0.1, 1.0); }'));
gl.linkProgram(p); gl.useProgram(p);
const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.8, -0.8, 0.8, -0.8, 0.0, 0.8]), gl.STATIC_DRAW);
const l = gl.getAttribLocation(p, 'a'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
gl.clearColor(0.1, 0.1, 0.2, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
</script></body></html>`;

describe.skipIf(!process.env.DEA_E2E)('determinism of the engine (real browser)', () => {
  it('the same page extracted twice gives the same structured answer, except meta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dea-det-e2e-'));
    const home = await mkdtemp(join(tmpdir(), 'dea-det-home-'));
    process.env.DEA_HOME = home;
    const server = await serveDir(dir);
    try {
      await writeFile(join(dir, 'page.html'), PAGE);
      const url = `${server.url}/page.html`;
      const answers: Array<{ result: Record<string, unknown>; meta: Record<string, unknown> }> = [];
      for (let i = 0; i < 2; i++) {
        const r = await extract(url, { quick: true, noCache: true, noResearch: true, providers: [], noDiff: false, referenceMs: 8000 });
        const ledger = (await readLedger(join(r.dir, 'extract'))) ?? (await readLedger(r.dir));
        expect(ledger).not.toBeNull();
        if (!ledger) return;
        expect(ledger.findings.length).toBeGreaterThan(3);
        answers.push(ledgerAnswer(queryLedger(ledger, { detail: 'full' })));
      }
      // the structured answer, scores rounded to 3 decimals, is the same text
      expect(canonicalJson(answers[1].result)).toBe(canonicalJson(answers[0].result));
      // and what differs is what is said to differ
      expect(answers[1].meta).not.toEqual(answers[0].meta);
      expect(Object.keys(answers[0].meta).some((k) => k.startsWith('runId'))).toBe(true);
    } finally {
      await server.close();
      delete process.env.DEA_HOME;
      await rm(dir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  }, 600_000);
});
