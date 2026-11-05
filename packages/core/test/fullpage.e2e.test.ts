import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installObservers, launchBrowser } from '../src/browser/open.ts';
import { settleScene } from '../src/browser/settle.ts';
import { readFullPage } from '../src/extract/fullpage.ts';
import { heroHtml } from '../src/extract/generate.ts';
import { pageIsWorthKeeping } from '../src/extract/pagelayer.ts';
import { LAYOUT_READ, serveDir } from '../src/extract/preview.ts';
import { STOP_DOM } from '../src/replay/capture.ts';

// A page written for this test: a fixed header, four tall sections with text and a colour panel each, a section that only exists
// once the page has been scrolled to it (content that loads on scroll), and a canvas inside a CLOSED shadow root.
const PAGE = `<!doctype html><html><head><style>
body{margin:0;font:20px Arial}
header{position:fixed;top:0;left:0;width:100%;height:40px;background:#222;color:#fff;z-index:5}
section{height:520px;width:100%;box-sizing:border-box;padding:80px 40px}
#a{background:#fff}#b{background:#eaeaff}#c{background:#ffeaea}#d{background:#eaffea}
#late{height:0;overflow:hidden}
</style></head><body>
<header>Nav bar</header>
<section id="a"><h1>Alpha heading</h1></section>
<section id="b"><h2>Beta heading</h2><div id="host" style="width:300px;height:120px"></div></section>
<section id="c"><h2>Gamma heading</h2><canvas id="chart" width="300" height="100" style="width:300px;height:100px"></canvas></section>
<section id="d"><h2>Delta heading</h2></section>
<div id="late"></div>
<script>
const r = document.getElementById('host').attachShadow({ mode: 'closed' });
const c = document.createElement('canvas'); c.width = 300; c.height = 120; c.style.cssText = 'width:300px;height:120px;display:block';
r.appendChild(c); window.__closedCanvas = c;
const x = document.getElementById('chart').getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 300, 100); x.fillStyle = '#fff'; x.font = '30px Arial'; x.fillText('chart', 20, 60);
// lazy: when the page has been scrolled past 900 px, a last section is added
addEventListener('scroll', () => {
  if (scrollY > 900 && !document.getElementById('lazy')) {
    const s = document.createElement('section'); s.id = 'lazy'; s.style.background = '#fffbe0'; s.innerHTML = '<h2>Lazy heading</h2>';
    document.body.insertBefore(s, document.getElementById('late'));
  }
}, { passive: true });
</script></body></html>`;

describe.skipIf(!process.env.DEA_E2E)('the whole page (real browser)', () => {
  it('reads every section including content that loads on scroll, flags the fixed header, and the kit scrolls to the same places', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dea-full-'));
    const { browser } = await launchBrowser('chromium', true);
    const server = await serveDir(dir);
    try {
      await writeFile(join(dir, 'page.html'), PAGE);
      const url = `${server.url}/page.html`;
      const vp = { width: 800, height: 500 };
      const r = await readFullPage(browser, url, vp, { shots: true, settleMs: 4000 });
      expect(r).not.toBeNull();
      if (!r) return;
      const { layer } = r;
      expect(layer.mechanism).toBe('native');
      expect(layer.stops.length).toBeGreaterThanOrEqual(5);
      const texts = layer.boxes.map((b) => b.text);
      expect(texts).toEqual(expect.arrayContaining(['Alpha heading', 'Beta heading', 'Gamma heading', 'Delta heading', 'Lazy heading']));
      // the lazy section was only created by scrolling: it sits below the fourth section
      const lazy = layer.boxes.find((b) => b.text === 'Lazy heading');
      expect(lazy?.y).toBeGreaterThan(2000);
      expect(layer.documentHeight).toBeGreaterThanOrEqual(2600);
      // the header does not move with the page
      const nav = layer.boxes.find((b) => b.text === 'Nav bar');
      expect(nav?.win).toBeDefined();
      // a 2D canvas the page draws into becomes a picture of what it shows; the closed-shadow WebGL-less canvas drew nothing and stays out
      const snaps = layer.graphics.filter((g) => (g as { canvasSnap?: boolean }).canvasSnap);
      expect(snaps.length).toBe(1);
      expect(snaps[0]?.src?.startsWith('data:image/')).toBe(true);
      expect(r.shots.length).toBe(layer.stops.length);
      expect(pageIsWorthKeeping(layer)).toBe(true);
      // the kit: the same page laid out again, scrolled to the lazy section
      const hero = {
        viewport: vp,
        boxes: layer.boxes.filter((b) => b.y < 500),
        canvas: null,
        background: 'rgb(255, 255, 255)',
        shapes: [],
        graphics: [],
        page: layer,
      };
      await writeFile(
        join(dir, 'kit.html'),
        `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body>${heroHtml(hero)}</body></html>`,
      );
      const page = await browser.newPage({ viewport: vp });
      await page.goto(`${server.url}/kit.html`);
      const h = (await page.evaluate('document.documentElement.scrollHeight')) as number;
      expect(Math.abs(h - layer.documentHeight)).toBeLessThan(layer.documentHeight * 0.05);
      const where = (await page.evaluate(
        `(() => { const e = [...document.querySelectorAll('.dea-page *')].find((n) => n.textContent === 'Lazy heading'); const r = e.getBoundingClientRect(); return r.top + scrollY; })()`,
      )) as number;
      expect(Math.abs(where - (lazy?.y ?? 0))).toBeLessThan(15);
      // the fixed header stays in the window at the end of the page
      await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
      await page.waitForTimeout(200);
      const navTop = (await page.evaluate(
        `(() => { const e = [...document.querySelectorAll('.dea-page *')].find((n) => n.textContent === 'Nav bar'); return e ? e.getBoundingClientRect().top : null; })()`,
      )) as number | null;
      expect(navTop).not.toBeNull();
      expect(Math.abs(navTop as number)).toBeLessThan(20);
      await page.close();
    } finally {
      await server.close();
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 150_000);

  it('finds a canvas inside a closed shadow root, which no query can reach', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dea-closed-'));
    const { browser } = await launchBrowser('chromium', true);
    const server = await serveDir(dir);
    try {
      await writeFile(join(dir, 'page.html'), PAGE);
      const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
      await installObservers(context, true);
      const page = await context.newPage();
      await page.goto(`${server.url}/page.html`);
      // one canvas is in the page itself (the 2D chart); the one in the closed shadow root is found by no query
      expect(await page.evaluate("document.querySelectorAll('canvas').length")).toBe(1);
      expect(await page.evaluate('window.__DEA__.deep("canvas").length')).toBe(2);
      await page.evaluate('window.scrollTo(0, 400)');
      await page.waitForTimeout(150);
      const dom = (await page.evaluate(STOP_DOM)) as { canvases: Array<{ share: number }> };
      expect(dom.canvases.length).toBeGreaterThanOrEqual(1);
      const l = (await page.evaluate(LAYOUT_READ(null, { page: true }))) as { canvas: { w: number } | null };
      // the first-screen read finds it too (it lies at scroll 400, where 300 × 120 is more than 5% of the window)
      expect(l.canvas?.w).toBe(300);
      await page.evaluate('window.scrollTo(0, 0)');
      const s = await settleScene(page, { capMs: 8000, minMs: 300, everyMs: 300 });
      expect(s.stable).toBe(true);
      await context.close();
    } finally {
      await server.close();
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
