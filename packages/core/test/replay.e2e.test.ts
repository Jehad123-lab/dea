import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchBrowser } from '../src/browser/open.ts';
import { serveDir } from '../src/extract/preview.ts';
import { compareCanvas } from '../src/extract/score.ts';
import { pullRecording, REPLAY_CAPTURE_SCRIPT, recordFrames, releaseFrames } from '../src/replay/capture.ts';
import { buildGraph, compactCapture } from '../src/replay/graph.ts';
import { REPLAY_PLAYER } from '../src/replay/player.ts';
import { rebuildPipeline } from '../src/replay/rebuild.ts';
import { REBUILD_RUNNER } from '../src/replay/runner.ts';

// A small WebGL2 page with the shapes real sites use: a float render target updated from its own previous value
// (ping-pong), an instanced draw that reads it, and a full-screen composite to the canvas.
const PAGE = `<!doctype html><html><body style="margin:0;background:#111"><canvas id="c" width="320" height="200" style="width:320px;height:200px"></canvas>
<script>
const gl = document.getElementById('c').getContext('webgl2');
gl.getExtension('EXT_color_buffer_float');
const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); return p; };
const quad = '#version 300 es\\nin vec2 position; out vec2 vUv; void main(){ vUv = position*0.5+0.5; gl_Position = vec4(position,0.,1.); }';
const sim = prog(quad, '#version 300 es\\nprecision highp float; uniform sampler2D tPos; uniform float uTime; in vec2 vUv; out vec4 o; void main(){ vec4 p = texture(tPos, vUv); o = vec4(fract(p.xy + vec2(0.013, 0.007) + 0.001*sin(uTime)), p.zw); }');
const pts = prog('#version 300 es\\nin vec2 position; uniform sampler2D tPos; void main(){ ivec2 c = ivec2(gl_InstanceID % 16, gl_InstanceID / 16); vec4 p = texelFetch(tPos, c, 0); gl_Position = vec4(p.xy*2.-1. + position*0.03, 0., 1.); }',
  '#version 300 es\\nprecision highp float; out vec4 o; void main(){ o = vec4(1.0, 0.6, 0.2, 1.0); }');
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindAttribLocation(sim, 0, 'position');
const tex = [0, 1].map((k) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); const d = new Float32Array(16*16*4); for (let i = 0; i < 256; i++) { d[i*4] = (i % 16) / 16 + k*0.01; d[i*4+1] = Math.floor(i / 16) / 16; d[i*4+3] = 1; }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 16, 16, 0, gl.RGBA, gl.FLOAT, d); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; });
const fbs = tex.map((t) => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; });
let i = 0;
const tick = (ts) => {
  const a = i % 2, b = 1 - a;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs[b]); gl.viewport(0, 0, 16, 16); gl.useProgram(sim);
  gl.bindTexture(gl.TEXTURE_2D, tex[a]); gl.uniform1f(gl.getUniformLocation(sim, 'uTime'), ts / 1000); gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, 320, 200); gl.clearColor(0.05, 0.05, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(pts); gl.bindTexture(gl.TEXTURE_2D, tex[b]); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 256);
  i++; requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
</script></body></html>`;

describe.skipIf(!process.env.DEA_E2E)('replay (real browser)', () => {
  it('records WebGL frames and replays them to the same picture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dea-replay-'));
    const { browser } = await launchBrowser('chromium', true);
    const server = await serveDir(dir);
    try {
      await writeFile(join(dir, 'page.html'), PAGE);
      const ctx = await browser.newContext({ viewport: { width: 320, height: 200 } });
      await ctx.addInitScript({ content: REPLAY_CAPTURE_SCRIPT });
      const page = await ctx.newPage();
      await page.goto(`${server.url}/page.html`);
      await page.waitForTimeout(1500);
      const r = await recordFrames(page, { frames: 2, timeoutMs: 30_000 });
      expect(r.ok).toBe(true);
      const shot = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
      const rec = await pullRecording(page);
      await releaseFrames(page);
      expect(rec?.doc.frames).toHaveLength(2);
      const raw = rec as NonNullable<typeof rec>;
      const c = compactCapture(raw.doc, new Uint8Array(raw.bin.buffer, raw.bin.byteOffset, raw.bin.byteLength));
      const g = buildGraph(c.doc, new Uint8Array(c.bin.buffer, c.bin.byteOffset, c.bin.byteLength));
      expect(g.passes.map((p) => p.role)).toContain('simulation step (GPGPU ping-pong)');
      await writeFile(join(dir, 'capture.json'), JSON.stringify(c.doc));
      await writeFile(join(dir, 'capture.bin'), c.bin);
      await writeFile(join(dir, 'replay.js'), REPLAY_PLAYER);
      await writeFile(
        join(dir, 'replay.html'),
        '<!doctype html><html><body style="margin:0;background:#111"><canvas id="c" style="width:320px;height:200px;display:block"></canvas><script type="module">import { loadCapture, createReplay } from "./replay.js"; const d = await loadCapture("./"); const r = createReplay(document.getElementById("c"), d, { animate: false, preserveDrawingBuffer: true }); r.renderFrames(); window.__errors = r.errors; window.__done = true;</script></body></html>',
      );
      const p2 = await ctx.newPage();
      await p2.goto(`${server.url}/replay.html`);
      await p2.waitForFunction(() => (window as unknown as { __done?: boolean }).__done, null, { timeout: 30_000 });
      expect(await p2.evaluate(() => (window as unknown as { __errors: string[] }).__errors)).toEqual([]);
      const replayed = `data:image/png;base64,${(await p2.screenshot()).toString('base64')}`;
      const s = await compareCanvas(p2, shot, replayed, { x: 0, y: 0, w: 320, h: 200 }, [], { width: 320, height: 200 });
      expect(s?.score).toBeGreaterThan(0.97);
      // (b) the same graph as three.js objects: materials, geometry, render targets, in the recorded order
      const bin = new Uint8Array(c.bin.buffer, c.bin.byteOffset, c.bin.byteLength);
      c.doc.graph = g;
      const rb = rebuildPipeline(c.doc, bin, { data: 'capture.bin' });
      expect(rb.stats.draws).toBe(4);
      await mkdir(join(dir, 'shaders'), { recursive: true });
      await writeFile(join(dir, 'pipeline.json'), JSON.stringify(rb.pipeline));
      for (const [f, src] of Object.entries(rb.shaders)) await writeFile(join(dir, f), src);
      await writeFile(join(dir, 'rebuild.js'), REBUILD_RUNNER);
      await writeFile(
        join(dir, 'rebuild.html'),
        '<!doctype html><html><head><script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" } }</script></head><body style="margin:0;background:#111"><canvas id="c" style="width:320px;height:200px;display:block"></canvas><script type="module">try { const { loadPipeline, createRebuild } = await import("./rebuild.js"); const d = await loadPipeline("./"); const r = createRebuild(document.getElementById("c"), d, { animate: false, preserveDrawingBuffer: true, debug: true }); r.renderFrames(); window.__errors = r.errors; } catch (e) { window.__errors = [String(e)]; } window.__done = true;</script></body></html>',
      );
      const p3 = await ctx.newPage();
      await p3.goto(`${server.url}/rebuild.html`);
      await p3.waitForFunction(() => (window as unknown as { __done?: boolean }).__done, null, { timeout: 60_000 });
      expect(await p3.evaluate(() => (window as unknown as { __errors: string[] }).__errors)).toEqual([]);
      const rebuilt = `data:image/png;base64,${(await p3.screenshot()).toString('base64')}`;
      const s3 = await compareCanvas(p3, shot, rebuilt, { x: 0, y: 0, w: 320, h: 200 }, [], { width: 320, height: 200 });
      expect(s3?.score).toBeGreaterThan(0.95);
      await ctx.close();
    } finally {
      await server.close();
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
