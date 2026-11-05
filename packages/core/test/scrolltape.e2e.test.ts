import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchBrowser } from '../src/browser/open.ts';
import { serveDir } from '../src/extract/preview.ts';
import { compareCanvas } from '../src/extract/score.ts';
import { pullRecording, REPLAY_CAPTURE_SCRIPT, recordFrames, recordScrollTape, releaseFrames } from '../src/replay/capture.ts';
import { buildGraph, compactCapture } from '../src/replay/graph.ts';
import { REPLAY_PLAYER } from '../src/replay/player.ts';
import { rebuildPipeline } from '../src/replay/rebuild.ts';
import { REBUILD_RUNNER } from '../src/replay/runner.ts';
import { buildPageMap, fitScrollTape, tapeMoved } from '../src/replay/scrolltape.ts';

// A virtual-scroll scene written for this test (nothing from any site): the page never scrolls, the wheel moves a target,
// an eased value follows it, and the CPU re-uploads 64 instance positions only when the value changed. The scene is a
// non-linear function of the scroll (a smoothstep between a scattered and a grid layout), so no straight-line fit of one
// uniform follows it; the instance buffer carries it.
const scene = (
  always: boolean,
) => `<!doctype html><html><body style="margin:0;background:#111"><main><section id="hero" style="min-height:100vh"><h1 style="color:#fff">Assemble</h1></section></main>
<canvas id="c" width="320" height="200" style="width:320px;height:200px;position:fixed;left:0;top:0"></canvas>
<script>
const gl = document.getElementById('c').getContext('webgl2');
const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
const p = gl.createProgram();
gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\\nin vec2 position; in vec2 offset; void main(){ gl_Position = vec4(position*0.07 + offset, 0., 1.); }'));
gl.attachShader(p, sh(gl.FRAGMENT_SHADER, '#version 300 es\\nprecision highp float; uniform float uTone; out vec4 o; void main(){ o = vec4(mix(vec3(1.,.3,.2), vec3(.2,.7,1.), uTone), 1.); }'));
gl.bindAttribLocation(p, 0, 'position'); gl.bindAttribLocation(p, 1, 'offset'); gl.linkProgram(p); gl.useProgram(p);
const N = 64;
const scat = [], grid = [];
for (let i = 0; i < N; i++) { scat.push(Math.sin(i * 12.9898) * 0.9, Math.sin(i * 78.233) * 0.9); grid.push(-0.7 + (i % 8) * 0.2, -0.7 + Math.floor(i / 8) * 0.2); }
const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(scat), gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
let target = 0, s = 0, last = -1;
addEventListener('wheel', (e) => { target = Math.max(0, Math.min(2000, target + e.deltaY)); }, { passive: true });
const tick = () => {
  s += 0.5 * (target - s); if (Math.abs(target - s) < 0.01) s = target;
  const t = Math.min(1, s / 2000), pr = t * t * (3 - 2 * t);
  if (${always ? 'true' : 'Math.abs(pr - last) > 1e-5'}) {
    const pos = new Float32Array(N * 2);
    for (let i = 0; i < N * 2; i++) pos[i] = scat[i] + (grid[i] - scat[i]) * pr;
    gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.uniform1f(gl.getUniformLocation(p, 'uTone'), pr);
    last = pr;
  }
  gl.viewport(0, 0, 320, 200); gl.clearColor(0.05, 0.05, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, N);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
</script></body></html>`;

describe.skipIf(!process.env.DEA_E2E)('scroll tape (real browser)', () => {
  it.each([false, true])(
    'records a virtual-scroll scene at scroll stops and plays the stop the live scroll picks (re-uploads every frame: %s)',
    async (always) => {
      const dir = await mkdtemp(join(tmpdir(), 'dea-scroll-'));
      const { browser } = await launchBrowser('chromium', true);
      const server = await serveDir(dir);
      try {
        await writeFile(join(dir, 'page.html'), scene(always));
        const ctx = await browser.newContext({ viewport: { width: 320, height: 200 } });
        await ctx.addInitScript({ content: REPLAY_CAPTURE_SCRIPT });
        const page = await ctx.newPage();
        await page.goto(`${server.url}/page.html`);
        await page.waitForTimeout(1200);
        const r = await recordFrames(page, { frames: 2, timeoutMs: 30_000 });
        expect(r.ok).toBe(true);
        const top = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
        const st = await recordScrollTape(page, { stops: 4, step: 500, settle: 8, timeoutMs: 120_000 });
        expect(st.ok).toBe(true);
        if (!st.ok) return;
        expect(st.rec.stops.map((s) => s.sc)).toEqual([500, 1000, 1500, 2000, 0]);
        expect(st.rec.mechanism).toBe('virtual');
        expect(st.rec.stops[0].dom?.inView.some((x) => x.heading === 'Assemble')).toBe(true);
        const rec = await pullRecording(page);
        await releaseFrames(page);
        const raw = rec as NonNullable<typeof rec>;
        const c = compactCapture(raw.doc, new Uint8Array(raw.bin.buffer, raw.bin.byteOffset, raw.bin.byteLength));
        const bin = new Uint8Array(c.bin.buffer, c.bin.byteOffset, c.bin.byteLength);
        const doc = c.doc;
        // the original at scroll 1000 and 2000, taken from the live page
        const shotAt = async (px: number) => {
          await page.mouse.wheel(0, px);
          await page.waitForTimeout(1500);
          return `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
        };
        const at1000 = await shotAt(1000);
        const at2000 = await shotAt(1000);
        const at500 = await shotAt(-1500);
        const at0 = await shotAt(-500);
        const at750 = await shotAt(750);
        // split the tape off the rest frames the way extract does
        const from = 2;
        doc.scroll = { from, mechanism: st.rec.mechanism, step: st.rec.step, settle: st.rec.settle, stops: st.rec.stops };
        doc.scrollFrames = doc.frames.slice(from);
        doc.frames = doc.frames.slice(0, from);
        const fit = fitScrollTape(doc, bin, { stops: st.rec.stops });
        expect(tapeMoved(fit)).toBe(true);
        if (!fit) return;
        expect(fit.stops[0].changed).toBe(0);
        expect(fit.stops[3].changed).toBeGreaterThan(0.5);
        expect(fit.uploadBuffers).toBe(1);
        fit.k = 0.5;
        doc.scroll.fit = fit;
        const map = buildPageMap(page.url(), fit, { mechanism: st.rec.mechanism, stops: st.rec.stops as never });
        expect(map.stops).toHaveLength(5);
        expect(map.sections.some((x) => x.heading === 'Assemble')).toBe(true);
        await writeFile(join(dir, 'capture.json'), JSON.stringify(doc));
        await writeFile(join(dir, 'capture.bin'), c.bin);
        await writeFile(join(dir, 'replay.js'), REPLAY_PLAYER);
        await writeFile(
          join(dir, 'replay.html'),
          '<!doctype html><html><body style="margin:0;background:#111"><canvas id="c" style="width:320px;height:200px;display:block"></canvas><script type="module">import { loadCapture, createReplay } from "./replay.js"; const d = await loadCapture("./"); const r = createReplay(document.getElementById("c"), d, { animate: false, preserveDrawingBuffer: true, listen: false, blend: !location.search.includes("noblend") }); window.__r = r; r.renderFrames(2); window.__errors = r.errors; window.__done = true;</script></body></html>',
        );
        const p2 = await ctx.newPage();
        await p2.goto(`${server.url}/replay.html`);
        await p2.waitForFunction(() => (window as unknown as { __done?: boolean }).__done, null, { timeout: 30_000 });
        const play = async (scroll: number) => {
          await p2.evaluate((x) => {
            const rp = (window as unknown as { __r: { setInput: (o: object) => void; renderFrames: (n: number) => void } }).__r;
            rp.setInput({ scroll: x });
            rp.renderFrames(40);
          }, scroll);
          return `data:image/png;base64,${(await p2.screenshot()).toString('base64')}`;
        };
        const box = { x: 0, y: 0, w: 320, h: 200 };
        const sz = { width: 320, height: 200 };
        // the top before any scroll: the rest frames
        const topPlayed = `data:image/png;base64,${(await p2.screenshot()).toString('base64')}`;
        expect((await compareCanvas(p2, top, topPlayed, box, [], sz))?.score).toBeGreaterThan(0.97);
        // the same scroll as the live page at 1000: the picture assembled halfway, which no first-frame replay can show
        const played1000 = await play(1000);
        const s1000 = await compareCanvas(p2, at1000, played1000, box, [], sz);
        expect(s1000?.score).toBeGreaterThan(0.97);
        // and the first screen replayed as it was is far from it (the scene really changes with the scroll)
        expect((await compareCanvas(p2, at1000, topPlayed, box, [], sz))?.score).toBeLessThan((s1000?.score ?? 1) - 0.02);
        // forward to the end, then backward to a stop in the middle, then home: every move lands on the live page's picture
        expect((await compareCanvas(p2, at2000, await play(2000), box, [], sz))?.score).toBeGreaterThan(0.97);
        expect((await compareCanvas(p2, at500, await play(500), box, [], sz))?.score).toBeGreaterThan(0.97);
        expect((await compareCanvas(p2, at0, await play(0), box, [], sz))?.score).toBeGreaterThan(0.97);
        // between two stops: a site that re-uploads every frame has frames that line up, so uniforms and uploads blend between the stops
        const played750 = await play(750);
        expect(fit.aligned).toBe(true);
        const s750 = (await compareCanvas(p2, at750, played750, box, [], sz))?.score ?? 0;
        // the same position without blending: the nearest stop alone
        const p4 = await ctx.newPage();
        await p4.goto(`${server.url}/replay.html?noblend=1`);
        await p4.waitForFunction(() => (window as unknown as { __done?: boolean }).__done, null, { timeout: 30_000 });
        await p4.evaluate((x) => {
          const rp = (window as unknown as { __r: { setInput: (o: object) => void; renderFrames: (n: number) => void } }).__r;
          rp.setInput({ scroll: x });
          rp.renderFrames(40);
        }, 750);
        const nearest = `data:image/png;base64,${(await p4.screenshot()).toString('base64')}`;
        const sNear = (await compareCanvas(p4, at750, nearest, box, [], sz))?.score ?? 0;
        if (always) {
          expect(s750).toBeGreaterThan(0.9);
          expect(s750).toBeGreaterThan(sNear + 0.005);
        } else expect(s750).toBeGreaterThan(0.85);
        // the editable rebuild plays the same tape: the same stops, from the pipeline description
        doc.graph = buildGraph(doc, bin);
        const rb = rebuildPipeline(doc, bin, { data: 'capture.bin' });
        expect(rb.pipeline.scroll?.n).toBe(doc.scrollFrames?.length);
        await mkdir(join(dir, 'shaders'), { recursive: true });
        await writeFile(join(dir, 'pipeline.json'), JSON.stringify(rb.pipeline));
        for (const [f, src] of Object.entries(rb.shaders)) await writeFile(join(dir, f), src);
        await writeFile(join(dir, 'rebuild.js'), REBUILD_RUNNER);
        await writeFile(
          join(dir, 'rebuild.html'),
          '<!doctype html><html><head><script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js" } }</script></head><body style="margin:0;background:#111"><canvas id="c" style="width:320px;height:200px;display:block"></canvas><script type="module">try { const { loadPipeline, createRebuild } = await import("./rebuild.js"); const d = await loadPipeline("./"); const r = createRebuild(document.getElementById("c"), d, { animate: false, preserveDrawingBuffer: true, listen: false, debug: true }); window.__rb = r; r.renderFrames(2); window.__errors = r.errors; } catch (e) { window.__errors = [String(e)]; } window.__done = true;</script></body></html>',
        );
        const p3 = await ctx.newPage();
        await p3.goto(`${server.url}/rebuild.html`);
        await p3.waitForFunction(() => (window as unknown as { __done?: boolean }).__done, null, { timeout: 60_000 });
        expect(await p3.evaluate(() => (window as unknown as { __errors: string[] }).__errors)).toEqual([]);
        const playRb = async (scroll: number) => {
          await p3.evaluate((x) => {
            const rp = (window as unknown as { __rb: { setInput: (o: object) => void; renderFrames: (n: number) => void } }).__rb;
            rp.setInput({ scroll: x });
            rp.renderFrames(40);
          }, scroll);
          return `data:image/png;base64,${(await p3.screenshot()).toString('base64')}`;
        };
        expect((await compareCanvas(p3, at1000, await playRb(1000), box, [], sz))?.score).toBeGreaterThan(0.95);
        expect((await compareCanvas(p3, at2000, await playRb(2000), box, [], sz))?.score).toBeGreaterThan(0.95);
        expect((await compareCanvas(p3, at500, await playRb(500), box, [], sz))?.score).toBeGreaterThan(0.95);
        expect(await p2.evaluate(() => (window as unknown as { __r: { errors: string[] } }).__r.errors)).toEqual([]);
        await ctx.close();
      } finally {
        await server.close();
        await browser.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
