import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Browser, Page } from 'playwright';
import { NAME_SHIM } from '../browser/init.ts';
import { installObservers, LOADER_VISIBLE } from '../browser/open.ts';
import { currentCache } from '../cache.ts';
import { pullRecording, REPLAY_CAPTURE_SCRIPT, type Recording, recordFrames, releaseFrames } from '../replay/capture.ts';
import { currentTimings, timed } from '../timings.ts';
import type { ShaderModule } from './generate.ts';
import type { Params } from './research.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Serve a folder on 127.0.0.1 (ES modules do not load from file:// pages). */
export async function serveDir(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0])).replace(/^(\.\.[/\\])+/, '');
      const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
      if (!file.startsWith(root)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

/** preview/index.html: the rebuild's first screen (tokens + heading + one shader program), driven by parameters in the URL hash. */
export function previewHtml(mods: ShaderModule[], threeVersion: string, hero: string | null = null): string {
  const v = threeVersion.replace(/^r/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>DEA rebuild preview</title>
<link rel="stylesheet" href="../tokens/tokens.css" />
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.${v}.0/build/three.module.js", "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.${v}.0/examples/jsm/" } }</script>
<style>html, body { margin: 0; height: 100%; overflow: hidden; } #scene { position: fixed; inset: 0; } .dea-hero { position: relative; z-index: 1; } h1 { position: relative; margin: 30vh 8vw 0; font-weight: 500; line-height: 1.05; }</style>
</head>
<body>
<div id="scene"></div>
${hero ?? '<h1 id="h"></h1>'}
<script type="module">
const P = JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'));
document.body.style.background = P.background || '';
document.body.style.color = P.text || '';
const h = document.getElementById('h');
if (h) {
  h.textContent = P.heading || '';
  if (P.font) h.style.fontFamily = P.font;
  if (P.size) h.style.fontSize = P.size + 'px';
}
const mods = {
${mods.map((m) => `  ${JSON.stringify(m.name)}: () => import('../${m.file}'),`).join('\n')}
};
window.__deaReady = false;
try {
  if (P.program === '__replay') {
    // the site's own recorded frames, replayed call for call (replay/replay.js)
    const { loadCapture, createReplay } = await import('../replay/replay.js');
    const d = await loadCapture('../public/replay/');
    const b = d.doc.canvas;
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;pointer-events:none;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.cssW + 'px;height:' + b.cssH + 'px';
    const el = document.getElementById('scene');
    el.style.opacity = String(P.opacity ?? 1);
    el.appendChild(c);
    const r = createReplay(c, d, { animate: false, preserveDrawingBuffer: true });
    r.renderFrames();
    window.__deaReplayErrors = r.errors;
  } else if (P.program === '__rebuild') {
    // the editable rebuild: the recorded render graph as three.js objects (rebuild/rebuild.js, public/rebuild/)
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');
    const { loadPipeline, createRebuild } = await import('../rebuild/rebuild.js');
    const d = await loadPipeline('../public/rebuild/');
    const b = d.pipeline.canvas;
    const c = document.createElement('canvas');
    c.style.cssText = 'position:fixed;pointer-events:none;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.cssW + 'px;height:' + b.cssH + 'px';
    const el = document.getElementById('scene');
    el.style.opacity = String(P.opacity ?? 1);
    el.appendChild(c);
    const r = createRebuild(c, d, { THREE, animate: false, preserveDrawingBuffer: true });
    r.renderFrames();
    window.__deaReplayErrors = r.errors;
  } else if (P.program === '__scene') {
    // the 3D scene recovered from the recording (scene/scene.glb): geometry, transforms, camera; a plain material
    const { mountRecoveredScene } = await import('../scene/scene.js');
    const el = document.getElementById('scene');
    await mountRecoveredScene(el, { url: '../public/scene/scene.glb', once: true });
  } else if (P.program === '__pipeline') {
    const THREE = await import('three');
    const { createPipeline } = await import('../pipeline.js');
    const el = document.getElementById('scene');
    el.style.opacity = String(P.opacity ?? 1);
    const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight);
    el.appendChild(renderer.domElement);
    const pipe = createPipeline(renderer);
    for (let i = 0; i < 4; i++) { pipe.render(2.0 + i / 60); await new Promise((r) => setTimeout(r, 50)); }
  } else if (P.program && mods[P.program]) {
    const THREE = await import('three');
    const { createMaterial, meta } = await mods[P.program]();
    const el = document.getElementById('scene');
    el.style.opacity = String(P.opacity ?? 1);
    const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = meta.fullscreen ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) : new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
    camera.position.z = meta.fullscreen ? 0 : 3;
    const material = createMaterial();
    scene.add(meta.points ? new THREE.Points(new THREE.PlaneGeometry(2, 2, 127, 127), material) : new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    for (const [k, u] of Object.entries(material.uniforms)) {
      if (/time/i.test(k) && typeof u.value === 'number') u.value = 2.0;
      if (/res(olution)?$/i.test(k) && u.value && u.value.isVector2) u.value.set(innerWidth, innerHeight);
    }
    renderer.render(scene, camera);
    await new Promise((r) => setTimeout(r, 300));
    renderer.render(scene, camera);
  }
  if (P.standin === 'particles') {
    // ≈ a technique stand-in (not the site's code): a soft cloud of points where the site draws its particle simulation
    const THREE = await import('three');
    const { createParticles } = await import('../standins/particles.js');
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none';
    document.body.insertBefore(el, document.body.firstChild.nextSibling);
    const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
    camera.position.z = 3;
    scene.add(createParticles(THREE, { spread: P.spread, x: P.standinX, y: P.standinY, color: P.standinColor || P.text }));
    renderer.render(scene, camera);
  }
} catch (e) { window.__deaError = String(e && e.message || e); }
window.__deaReady = true;
</script>
</body>
</html>
`;
}

export interface Similarity {
  /** the score DEA optimises: colour, light layout and edges together (0..1) */
  similarity: number;
  /** 1 − mean colour distance */
  colour: number;
  /** how the light and dark areas line up (correlation of brightness, 0..1) */
  layout: number;
  /** how the edges line up (correlation of edge strength, 0..1) */
  edges: number;
  meanA: string;
  meanB: string;
}

/**
 * Similarity of two images (data URLs) at 96×60. Colour distance alone calls two mostly-black pages 99% alike, so the
 * score also compares where light and edges are: 0.3 colour + 0.35 brightness layout + 0.35 edges.
 */
export async function compareImages(page: Page, a: string, b: string): Promise<Similarity> {
  await page.evaluate(NAME_SHIM);
  return page.evaluate(
    async ([x, y]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => rej(new Error('image did not load'));
          im.src = src;
        });
      const W = 96;
      const H = 60;
      const px = async (src: string) => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(await load(src), 0, 0, W, H);
        return ctx.getImageData(0, 0, W, H).data;
      };
      const [p, q] = [await px(x), await px(y)];
      const n = p.length / 4;
      let d = 0;
      const ma = [0, 0, 0];
      const mb = [0, 0, 0];
      const la = new Float64Array(n);
      const lb = new Float64Array(n);
      for (let i = 0, k = 0; i < p.length; i += 4, k++) {
        d += Math.sqrt((p[i] - q[i]) ** 2 + (p[i + 1] - q[i + 1]) ** 2 + (p[i + 2] - q[i + 2]) ** 2);
        for (let j = 0; j < 3; j++) {
          ma[j] += p[i + j];
          mb[j] += q[i + j];
        }
        la[k] = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
        lb[k] = 0.2126 * q[i] + 0.7152 * q[i + 1] + 0.0722 * q[i + 2];
      }
      const grad = (l: Float64Array) => {
        const g = new Float64Array(n);
        for (let yy = 1; yy < H - 1; yy++)
          for (let xx = 1; xx < W - 1; xx++) {
            const at = (dx: number, dy: number) => l[(yy + dy) * W + xx + dx];
            const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
            const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
            g[yy * W + xx] = Math.hypot(gx, gy);
          }
        return g;
      };
      const corr = (u: Float64Array, v: Float64Array) => {
        let su = 0;
        let sv = 0;
        for (let i = 0; i < n; i++) {
          su += u[i];
          sv += v[i];
        }
        const mu = su / n;
        const mv = sv / n;
        let num = 0;
        let du = 0;
        let dv = 0;
        for (let i = 0; i < n; i++) {
          num += (u[i] - mu) * (v[i] - mv);
          du += (u[i] - mu) ** 2;
          dv += (v[i] - mv) ** 2;
        }
        if (du < 1e-6 && dv < 1e-6) return 1; // both flat: alike
        if (du < 1e-6 || dv < 1e-6) return 0; // one flat, one not: nothing lines up
        return Math.max(0, num / Math.sqrt(du * dv));
      };
      const colour = 1 - d / n / Math.sqrt(3 * 255 * 255);
      const layout = corr(la, lb);
      const edges = corr(grad(la), grad(lb));
      const hex = (m: number[]) =>
        `#${m
          .map((v) =>
            Math.round(v / n)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`;
      return { similarity: 0.3 * colour + 0.35 * layout + 0.35 * edges, colour, layout, edges, meanA: hex(ma), meanB: hex(mb) };
    },
    [a, b] as const,
  );
}

/**
 * The original's first screen as a person sees it after the intro: screenshots over `ms`, keeping the one with the
 * most detail (a loading screen is mostly flat).
 */
/** A text block on the first screen, as the browser laid it out (viewport pixels and computed styles). */
export interface LayoutBox {
  tag: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  letterSpacing: string;
  lineHeight: string;
  color: string;
  textTransform: string;
  textAlign: string;
  opacity: number;
}

/** Read the visible text blocks of the first screen (or of one section), each with its box and computed type. */
export const LAYOUT_READ = (section: string | null) => `(() => {
  const root = ${section ? `document.querySelector(${JSON.stringify(section)})` : 'document.body'} || document.body;
  const out = [];
  const W = innerWidth, H = innerHeight;
  const LOADER = /(^|[\\s_-])(pre)?loader([\\s_-]|$)|preload/i;
  let skip = true;
  const walk = (el) => {
    if (out.length >= 40) return;
    if (skip && el !== root && (el.getAttribute('role') === 'progressbar' || LOADER.test(String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) + ' ' + el.id))) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\\s+/g, ' ').trim();
    if (own && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W) {
        let op = 1;
        for (let p = el; p && p !== document.documentElement; p = p.parentElement) op *= +getComputedStyle(p).opacity;
        if (op >= 0.05)
          out.push({ __el: el, tag: el.tagName.toLowerCase(), text: (el.innerText || own).trim().slice(0, 200), x: r.left, y: r.top, w: r.width, h: r.height,
            fontFamily: cs.fontFamily, fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing,
            lineHeight: cs.lineHeight, color: cs.color, textTransform: cs.textTransform, textAlign: cs.textAlign, opacity: Math.round(op * 100) / 100 });
        return;
      }
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
  if (!out.length) { skip = false; walk(root); }
  // the part of an element its overflow-clipping ancestors let through (0..1): a label slid out of its button is not seen
  const shown = (el, r) => {
    let x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0), x1 = Math.min(r.right, W), y1 = Math.min(r.bottom, H);
    // only the containing-block chain clips: a fixed element escapes every ancestor, an absolute one the static ancestors
    let mode = getComputedStyle(el).position;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const holds = cs.transform !== 'none' || cs.perspective !== 'none' || cs.filter !== 'none' || /paint|layout|strict|content/.test(cs.contain || '');
      if (mode === 'fixed' && !holds) continue;
      if (mode === 'absolute' && cs.position === 'static' && !holds) continue;
      mode = cs.position;
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { x0 = Math.max(x0, pr.left); x1 = Math.min(x1, pr.right); }
      if (cs.overflowY !== 'visible') { y0 = Math.max(y0, pr.top); y1 = Math.min(y1, pr.bottom); }
    }
    return (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / Math.max(1, r.width * r.height);
  };
  const opacityOf = (el) => { let op = 1; for (let p = el; p && p !== document.documentElement; p = p.parentElement) op *= +getComputedStyle(p).opacity; return Math.round(op * 100) / 100; };
  const hiddenUp = (el) => { for (let p = el; p && p !== document.documentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') return true; if (p !== root && LOADER.test(String(p.className && p.className.baseVal !== undefined ? p.className.baseVal : p.className) + ' ' + p.id)) return true; } return false; };
  const boxes = out.filter((b, i) => { const el = b.__el; delete b.__el; return !el || shown(el, el.getBoundingClientRect()) >= 0.5; });
  // the first screen's flat shapes (pills, buttons, badges): a background colour or gradient, a border, rounded corners
  const shapes = [];
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length && i < 4000 && shapes.length < 30; i++) {
    const el = all[i];
    if (el.closest('svg') || el.tagName === 'CANVAS') continue;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : null;
    const grad = /gradient\\(/.test(cs.backgroundImage) ? cs.backgroundImage : null;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const border = bw > 0 && cs.borderTopStyle !== 'none' && !/rgba\\(\\d+, \\d+, \\d+, 0\\)/.test(cs.borderTopColor) ? bw + 'px ' + cs.borderTopStyle + ' ' + cs.borderTopColor : null;
    if (!bg && !grad && !border) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width >= 3 && r.height >= 3 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W)) continue;
    // a big shape counts only as an overlay over the picture: a gradient or a see-through colour on a positioned layer
    // that does not hold the canvas (a vignette, a fade to black at the bottom)
    const big = r.width * r.height > W * H * 0.25;
    if (big && !((grad || (bg && /rgba\\(.*, 0?\\.\\d+\\)$/.test(bg))) && cs.position !== 'static' && !el.querySelector('canvas'))) continue;
    if (hiddenUp(el) || shown(el, r) < 0.5) continue;
    const op = opacityOf(el);
    if (op < 0.05) continue;
    shapes.push({ x: r.left, y: r.top, w: r.width, h: r.height, background: bg, gradient: grad, border, radius: cs.borderRadius, opacity: op });
  }
  // the first screen's graphics: inline SVG (a logo, an icon) with its computed paint inlined, and small images
  const graphics = [];
  const PAINT = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule'];
  for (const el of root.querySelectorAll('svg, img')) {
    if (graphics.length >= 12) break;
    if (el.tagName.toLowerCase() === 'svg' && el.parentElement && el.parentElement.closest('svg')) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width >= 8 && r.height >= 8 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W)) continue;
    if (r.width * r.height > W * H * 0.25) continue;
    if (hiddenUp(el) || shown(el, r) < 0.5) continue;
    const op = opacityOf(el);
    if (op < 0.05) continue;
    if (el.tagName.toLowerCase() === 'img') {
      if (!el.complete || !el.naturalWidth || !/^https?:/.test(el.currentSrc || el.src)) continue;
      graphics.push({ kind: 'img', x: r.left, y: r.top, w: r.width, h: r.height, src: el.currentSrc || el.src, fit: getComputedStyle(el).objectFit, opacity: op });
      continue;
    }
    const clone = el.cloneNode(true);
    const a = [el, ...el.querySelectorAll('*')], b = [clone, ...clone.querySelectorAll('*')];
    for (let k = 0; k < a.length && k < 400; k++) {
      const cs = getComputedStyle(a[k]);
      b[k].setAttribute('style', PAINT.map((p) => p + ':' + cs.getPropertyValue(p)).join(';'));
      b[k].removeAttribute('class');
    }
    clone.setAttribute('width', '100%');
    clone.setAttribute('height', '100%');
    clone.style.color = getComputedStyle(el).color;
    clone.style.display = 'block';
    const svg = clone.outerHTML;
    if (svg.length > 40000) continue;
    graphics.push({ kind: 'svg', x: r.left, y: r.top, w: r.width, h: r.height, svg, opacity: op });
  }
  let canvas = null;
  for (const c of root.querySelectorAll('canvas')) {
    const r = c.getBoundingClientRect();
    const vis = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    if (vis < W * H * 0.05 || getComputedStyle(c).visibility === 'hidden') continue;
    if (canvas && vis <= canvas.vis) continue;
    let radius = getComputedStyle(c).borderRadius;
    for (let p = c.parentElement, i = 0; p && i < 5 && (!radius || radius === '0px'); p = p.parentElement, i++) {
      const cs = getComputedStyle(p);
      if (cs.borderRadius && cs.borderRadius !== '0px' && cs.overflow !== 'visible') {
        radius = cs.borderRadius;
        const pr = p.getBoundingClientRect();
        canvas = { x: pr.left, y: pr.top, w: pr.width, h: pr.height, radius, vis };
      }
    }
    if (!canvas || canvas.vis !== vis) canvas = { x: r.left, y: r.top, w: r.width, h: r.height, radius: radius || '0px', vis };
  }
  if (canvas) delete canvas.vis;
  const bgOf = (el) => { const b = el && getComputedStyle(el).backgroundColor; return b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent' ? b : null; };
  const background = bgOf(document.body) || bgOf(document.documentElement);
  return { viewport: { width: W, height: H }, boxes, canvas, background, shapes, graphics };
})()`;

/** Open the page just to read the first screen's text layout (used when you bring your own reference screenshot). */
export async function readLayout(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  section: string | null = null,
  waitMs = 8000,
  gpuMask = false,
): Promise<{
  viewport: { width: number; height: number };
  boxes: LayoutBox[];
  canvas?: { x: number; y: number; w: number; h: number; radius: string } | null;
  background?: string | null;
} | null> {
  // without the GPU mask a site on a machine without a GPU often takes a fast, static path (and sometimes another layout);
  // with it, the site runs its WebGL path as on a real GPU, slowly. Extract reads both and keeps the one that matches.
  const context = await browser.newContext({ viewport });
  await currentCache()?.attach(context);
  if (gpuMask) await installObservers(context, true);
  const page = await context.newPage();
  type L = {
    viewport: { width: number; height: number };
    boxes: LayoutBox[];
    canvas?: { x: number; y: number; w: number; h: number; radius: string } | null;
    background?: string | null;
  };
  let best: L | null = null;
  const read = async () => {
    if (section) await page.evaluate(`document.querySelector(${JSON.stringify(section)})?.scrollIntoView({ block: 'start' })`).catch(() => {});
    const l = (await page.evaluate(LAYOUT_READ(section)).catch(() => null)) as L | null;
    if (l && (!best || l.boxes.length > best.boxes.length)) best = l;
  };
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(waitMs);
    await read();
    // wait out a loading screen (up to 3 minutes), keeping the reading with the most text
    for (let t = 0; t < 180_000 && (await page.evaluate(LOADER_VISIBLE).catch(() => false)); t += 2500) {
      await page.waitForTimeout(2500);
      await read();
    }
    await page.waitForTimeout(1500);
    await read();
    return best;
  } finally {
    await context.close();
  }
}

export { LOADER_VISIBLE } from '../browser/open.ts';

export async function referenceShot(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  ms = 20_000,
  section: string | null = null,
  record = false,
  /** stop watching once the page has settled (no loader, the most detailed frame not beaten for 10 s); `ms` is then a cap */
  smart = false,
  /** recorded frames (2 lets the replay alternate and read clocks; 1 is the quick mode) */
  frames = 2,
): Promise<{
  png: string;
  atMs: number;
  loader: boolean;
  /** the recorded WebGL frames (when `record`), taken right before the screenshot, which shows the last of them */
  recording?: Recording | null;
  recordingError?: string;
  layout: {
    viewport: { width: number; height: number };
    boxes: LayoutBox[];
    canvas?: { x: number; y: number; w: number; h: number; radius: string } | null;
    background?: string | null;
  } | null;
}> {
  // the same observers and GPU answer DEA's decoders use, so the site shows its real 3D on a GPU-less machine
  const context = await browser.newContext({ viewport });
  await currentCache()?.attach(context);
  await installObservers(context, true);
  if (record) await context.addInitScript({ content: REPLAY_CAPTURE_SCRIPT });
  const page = await context.newPage();
  try {
    await timed('page load', () => page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => {}));
    let best = { png: '', score: -1, atMs: 0, loader: false };
    let layout: unknown = null;
    const t0 = Date.now();
    // a loader still covering the page at the end buys more time (up to 2.5× or 3 minutes): software WebGL is slow
    const hardCap = Math.min(Math.max(ms * 2.5, ms), 180_000);
    let loader = false;
    const watchStart = currentTimings()?.now() ?? 0;
    let quiet = 0;
    while (Date.now() - t0 < ms || (loader && Date.now() - t0 < hardCap)) {
      if (smart && !loader && best.score > 0 && quiet >= 4 && Date.now() - t0 >= 8000) {
        currentTimings()?.note(`settled after ${Math.round((Date.now() - t0) / 1000)} s (cap ${Math.round(ms / 1000)} s)`);
        break;
      }
      await page.waitForTimeout(2500);
      if (section) await page.evaluate(`document.querySelector(${JSON.stringify(section)})?.scrollIntoView({ block: 'start' })`).catch(() => {});
      const buf = await page.screenshot({ type: 'png' }).catch(() => null);
      if (!buf) continue;
      const png = `data:image/png;base64,${buf.toString('base64')}`;
      await page.evaluate(NAME_SHIM);
      const score = (await page.evaluate(async (src) => {
        const im = new Image();
        await new Promise((r) => {
          im.onload = r;
          im.src = src;
        });
        const c = document.createElement('canvas');
        c.width = 96;
        c.height = 60;
        const x = c.getContext('2d') as CanvasRenderingContext2D;
        x.drawImage(im, 0, 0, 96, 60);
        const d = x.getImageData(0, 0, 96, 60).data;
        let s = 0;
        let s2 = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          s += l;
          s2 += l * l;
        }
        const m = s / (d.length / 4);
        return Math.sqrt(s2 / (d.length / 4) - m * m);
      }, png)) as number;
      loader = (await page.evaluate(LOADER_VISIBLE).catch(() => false)) as boolean;
      // frames behind a loader only count when nothing better comes
      const s2 = loader ? score * 0.25 : score;
      quiet = s2 > best.score * 1.02 || loader ? 0 : quiet + 1;
      if (s2 > best.score) {
        best = { png, score: s2, atMs: Date.now() - t0, loader };
        layout = await page.evaluate(LAYOUT_READ(section)).catch(() => layout);
      }
    }
    currentTimings()?.record('watch for the reference frame', watchStart, (currentTimings()?.now() ?? 0) - watchStart);
    if (record) {
      // record two frames, hold the page on the last one, and use that moment as the reference: the replay then has the
      // exact frame to match
      if (section) await page.evaluate(`document.querySelector(${JSON.stringify(section)})?.scrollIntoView({ block: 'start' })`).catch(() => {});
      const r = await timed('record WebGL frames', () => recordFrames(page, { frames }));
      if (r.ok) {
        await page.waitForTimeout(400);
        const buf = await page.screenshot({ type: 'png' }).catch(() => null);
        const nowLoader = (await page.evaluate(LOADER_VISIBLE).catch(() => false)) as boolean;
        const recording = await timed('read the recording out of the page', () => pullRecording(page).catch(() => null));
        await releaseFrames(page);
        if (buf && recording) {
          const l = await page.evaluate(LAYOUT_READ(section)).catch(() => layout);
          return {
            png: `data:image/png;base64,${buf.toString('base64')}`,
            atMs: Date.now() - t0,
            loader: nowLoader,
            layout: (l ?? layout) as never,
            recording,
          };
        }
        return {
          png: best.png,
          atMs: best.atMs,
          loader: best.loader,
          layout: layout as never,
          recording: null,
          recordingError: 'the recording could not be read out of the page',
        };
      }
      return { png: best.png, atMs: best.atMs, loader: best.loader, layout: layout as never, recording: null, recordingError: r.error };
    }
    return { png: best.png, atMs: best.atMs, loader: best.loader, layout: layout as never };
  } finally {
    await context.close();
  }
}

/** Two images side by side with labels (original left, rebuild right), as a PNG. */
export async function sideBySide(page: Page, a: string, b: string, labels: [string, string]): Promise<Buffer> {
  await page.evaluate(NAME_SHIM);
  const url = (await page.evaluate(
    async ([a, b, la, lb]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((r) => {
          const im = new Image();
          im.onload = () => r(im);
          im.src = src;
        });
      const [x, y] = [await load(a), await load(b)];
      const w = 960;
      const h = Math.round((x.height / x.width) * w);
      const c = document.createElement('canvas');
      c.width = w * 2 + 12;
      c.height = h + 40;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = '#111';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(x, 0, 40, w, h);
      g.drawImage(y, w + 12, 40, w, h);
      g.fillStyle = '#eee';
      g.font = '18px sans-serif';
      g.fillText(la, 10, 26);
      g.fillText(lb, w + 22, 26);
      return c.toDataURL('image/png');
    },
    [a, b, labels[0], labels[1]] as const,
  )) as string;
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

/** Render the preview with parameters and return a PNG data URL of the first screen. */
export async function renderPreview(
  browser: Browser,
  base: string,
  params: Params,
  viewport: { width: number; height: number },
): Promise<{ png: string; error?: string }> {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto(`${base}/preview/index.html#${encodeURIComponent(JSON.stringify(params))}`, { waitUntil: 'load', timeout: 30_000 });
    // a first compile of many programs on a software GPU can take a while; the wait ends as soon as the page is ready
    await page.waitForFunction('window.__deaReady === true', undefined, { timeout: 120_000 }).catch(() => {});
    const error = (await page.evaluate('window.__deaError || null')) as string | null;
    const png = `data:image/png;base64,${(await page.screenshot({ type: 'png' })).toString('base64')}`;
    return { png, error: error ?? undefined };
  } finally {
    await page.close();
  }
}

/** A neutral placeholder image of the given size (for --own-assets), made by the browser's canvas. */
export async function placeholderPng(page: Page, w: number, h: number, label: string): Promise<Buffer> {
  await page.evaluate(NAME_SHIM);
  const url = (await page.evaluate(
    ([w, h, label]) => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.min(4096, w));
      c.height = Math.max(1, Math.min(4096, h));
      const x = c.getContext('2d') as CanvasRenderingContext2D;
      const s = Math.max(8, Math.round(Math.min(c.width, c.height) / 8));
      for (let i = 0; i < c.width; i += s)
        for (let j = 0; j < c.height; j += s) {
          x.fillStyle = ((i + j) / s) % 2 ? '#8a8a8a' : '#6e6e6e';
          x.fillRect(i, j, s, s);
        }
      x.fillStyle = '#fff';
      x.font = `${Math.max(10, s / 2)}px sans-serif`;
      x.fillText(label, 6, Math.max(14, s / 1.5));
      return c.toDataURL('image/png');
    },
    [w, h, label] as const,
  )) as string;
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}
