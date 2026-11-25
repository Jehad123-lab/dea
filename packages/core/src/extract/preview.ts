import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Browser, Page } from 'playwright';
import { NAME_SHIM } from '../browser/init.ts';
import { GL_ON_SCREEN, installObservers, LOADER_HIDE, LOADER_PROGRESS, LOADER_UNHIDE, LOADER_VISIBLE, LOADER_WHY } from '../browser/open.ts';
import { alignToReference, type PhaseInfo, phaseInfo } from '../browser/phase.ts';
import { thumbOfImage } from '../browser/settle.ts';
import { assertNotBotWall } from '../browser/wall.ts';
import { currentCache } from '../cache.ts';
import {
  grabCanvasFrame,
  pressListeners,
  pullRecording,
  REPLAY_CAPTURE_SCRIPT,
  type Recording,
  recordFrames,
  recordScrollTape,
  recordTape,
  releaseFrames,
} from '../replay/capture.ts';
import { type ProbeData, probeInputs } from '../replay/inputs.ts';
import { currentTimings, overBudget, timed } from '../timings.ts';
import { type ShaderModule, threeRevision } from './generate.ts';
import { runInteractionWithState, type StepState, setDragStep } from './interaction.ts';
import {
  betterFrame,
  type FrameStats,
  frameChanged,
  frameStats,
  isFlat,
  keepWatching,
  postLoaderGlWait,
  QUICK_LOADER_CAP_MS,
  shouldPeel,
  THUMB_H,
  THUMB_W,
} from './refwait.ts';
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
  const v = threeRevision(threeVersion);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>DEA rebuild preview</title>
<link rel="stylesheet" href="../tokens/tokens.css" />
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.${v}.0/build/three.module.js", "three/examples/jsm/": "https://cdn.jsdelivr.net/npm/three@0.${v}.0/examples/jsm/" } }</script>
<style>${hero?.includes('class="dea-page"') ? 'html, body { margin: 0; overflow-x: hidden; } body { position: relative; }' : 'html, body { margin: 0; height: 100%; overflow: hidden; }'} #scene { position: fixed; inset: 0; } .dea-hero { position: relative; z-index: 1; } h1 { position: relative; margin: 30vh 8vw 0; font-weight: 500; line-height: 1.05; }</style>
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
    const r = createReplay(c, d, { animate: !!P.live, steady: P.steady !== false, preserveDrawingBuffer: true });
    r.renderFrames();
    if (P.live) { r.start(); window.__deaKit = r; }
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
    const r = createRebuild(c, d, { THREE, animate: !!P.live, steady: P.steady !== false, preserveDrawingBuffer: true });
    r.renderFrames();
    if (P.live) { r.start(); window.__deaKit = r; }
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
export interface LayoutReadOptions {
  /** read for the whole page: larger caps, big background panels kept, and fixed or sticky elements flagged (`fx`: 1 fixed, 2 sticky) */
  page?: boolean;
}

export const LAYOUT_READ = (section: string | null, o: LayoutReadOptions = {}) => `(() => {
  const PAGE = ${o.page ? 'true' : 'false'};
  const CAP = PAGE ? { boxes: 500, shapes: 400, graphics: 120, scan: 30000 } : { boxes: 150, shapes: 100, graphics: 40, scan: 4000 };
  const root = ${section ? `document.querySelector(${JSON.stringify(section)})` : 'document.body'} || document.body;
  const out = [];
  const W = innerWidth, H = innerHeight;
  // the parent of a node, through a shadow root to its host
  const up = (n) => n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
  const rootOf = (el) => (window.__DEA__ && window.__DEA__.rootOf ? window.__DEA__.rootOf(el) : el.shadowRoot);
  // a key that names the same element at another scroll position: its path through the DOM
  const keyOf = (el, pe) => { const p = []; for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) i++; p.push(n.tagName.toLowerCase() + ':' + i); } return p.reverse().join('>') + (pe || ''); };
  // where an element paints: the z-index of each stacking context on the way down (position + z-index, fixed or sticky, opacity,
  // transforms, filters), then its own level (positioned above in-flow); equal paths paint in document order
  const zinfo = new Map();
  const zpath = (el) => {
    const chain = [];
    for (let n = el; n && n !== document.documentElement; n = up(n)) chain.push(n);
    const path = [];
    let inPos = false;
    for (const n of chain.reverse()) {
      let v = zinfo.get(n);
      if (!v) {
        const c = getComputedStyle(n);
        const pos = c.position !== 'static';
        const zi = c.zIndex !== 'auto' ? parseInt(c.zIndex, 10) : null;
        const ctx = (pos && zi !== null) || c.position === 'fixed' || c.position === 'sticky' || +c.opacity < 1 || c.transform !== 'none' || c.filter !== 'none' || c.isolation === 'isolate' || c.mixBlendMode !== 'normal';
        v = { pos, zi, ctx };
        zinfo.set(n, v);
      }
      const { pos, zi, ctx } = v;
      // content inside a positioned element without a z-index paints with that element (its layer), not below it
      if (n === el) path.push(zi !== null && pos ? zi : pos || inPos ? 0.5 : 0);
      else if (ctx) {
        path.push(zi !== null && pos ? zi : 0);
        inPos = false;
      } else if (pos) inPos = true;
    }
    return path;
  };
  // a fixed or sticky element (a header, a pinned panel) keeps its place in the window while the page scrolls
  const fixedOf = (el) => { let f = 0; for (let n = el; n && n !== document.documentElement; n = up(n)) { const p = getComputedStyle(n).position; if (p === 'fixed') return 1; if (p === 'sticky') f = 2; } return f; };
  const fxOf = (el) => { if (!PAGE) return {}; const f = fixedOf(el); return f ? { fx: f } : {}; };
  const docOrder = new Map();
  { let i = 0; for (const n of root.querySelectorAll('*')) docOrder.set(n, i++); }
  const LOADER = /(^|[\\s_-])(pre)?loader([\\s_-]|$)|preload/i;
  let skip = true;
  // text with runs that differ from the block (a bold word, a coloured or underlined link) as inline spans
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const runs = (el, depth) => {
    let h = '';
    const p = getComputedStyle(el);
    for (const n of el.childNodes) {
      if (n.nodeType === 3) h += esc(n.textContent.replace(/\\s+/g, ' '));
      else if (n.nodeType === 1 && depth < 4) {
        if (n.tagName === 'BR') { h += '<br>'; continue; }
        if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|CANVAS|IMG|VIDEO|PICTURE)$/i.test(n.tagName)) continue;
        const c = getComputedStyle(n);
        if (c.display === 'none' || c.visibility === 'hidden') continue;
        const d = [];
        if (c.fontWeight !== p.fontWeight) d.push('font-weight:' + c.fontWeight);
        if (c.color !== p.color) d.push('color:' + c.color);
        if (c.fontStyle !== p.fontStyle) d.push('font-style:' + c.fontStyle);
        if (c.textDecorationLine !== p.textDecorationLine) d.push('text-decoration:' + c.textDecorationLine);
        if (c.fontFamily !== p.fontFamily) d.push('font-family:' + c.fontFamily.replace(/"/g, "'"));
        const inner = runs(n, depth + 1);
        h += d.length ? '<span style="' + d.join(';') + '">' + inner + '</span>' : inner;
      }
    }
    return h;
  };
  const seen = new Set();
  const walk = (el) => {
    if (out.length >= CAP.boxes) return;
    if (skip && el !== root && (el.getAttribute('role') === 'progressbar' || LOADER.test(String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) + ' ' + el.id))) return;
    let cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return;
    // text kept only for screen readers (clipped to nothing) is not on the page
    if (/rect\\(\\s*[01](px)?[ ,]/.test(cs.clip) || /inset\\(\\s*(50|100)%/.test(cs.clipPath)) return;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\\s+/g, ' ').trim()
    || (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) ? String(el.value || '').trim() : '');
    if (own && !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) {
      // split text (one span per character or word) is one block: climb through inline parents to the word or line
      let top = el;
      for (let p = el.parentElement; p && p !== root && p !== document.body; p = p.parentElement) {
        const pd = getComputedStyle(p).display;
        if (!/^(inline|inline-block|inline-flex|contents)$/.test(pd) || (p.innerText || '').length > 120) break;
        top = p;
      }
      if (seen.has(top)) return;
      seen.add(top);
      el = top;
      cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W) {
        let op = 1;
        for (let p = el; p && p !== document.documentElement; p = up(p)) op *= +getComputedStyle(p).opacity;
        // rotated text (a vertical label): the box the kit needs is the unrotated one, turned about its centre
        let rot = 0, gx = r.left, gy = r.top, gw = r.width, gh = r.height;
        {
          let m = new DOMMatrix();
          for (let q = el; q && q.nodeType === 1; q = q.parentElement) { const t = getComputedStyle(q).transform; if (t && t !== 'none') m = new DOMMatrix(t).multiply(m); }
          const a = (Math.atan2(m.b, m.a) * 180) / Math.PI;
          if (Math.abs(a) > 1 && el.offsetWidth > 0 && el.offsetHeight > 0) { rot = Math.round(a * 10) / 10; gw = el.offsetWidth; gh = el.offsetHeight; gx = r.left + r.width / 2 - gw / 2; gy = r.top + r.height / 2 - gh / 2; }
        }
        if (op >= 0.05)
          out.push({ __el: el, ...fxOf(el), k: keyOf(el), zp: zpath(el), o: docOrder.get(el) ?? 0, tag: el.tagName.toLowerCase(), text: (el.innerText || own).trim().slice(0, 200), rich: el.children.length ? runs(el, 0).trim().slice(0, 1200) : '', deco: cs.textDecorationLine !== 'none' ? cs.textDecorationLine : '', fstyle: cs.fontStyle, x: gx, y: gy, w: gw, h: gh, ...(rot ? { rot } : {}), ...(cs.writingMode && cs.writingMode !== 'horizontal-tb' ? { wm: cs.writingMode } : {}),
            fontFamily: cs.fontFamily, fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing,
            lineHeight: cs.lineHeight, color: cs.color, textTransform: cs.textTransform, textAlign: cs.textAlign, opacity: Math.round(op * 100) / 100 });
        return;
      }
    }
    for (const c of el.children) walk(c);
    const sr = rootOf(el);
    if (sr) for (const c of sr.children) walk(c);
  };
  walk(root);
  if (!out.length) { skip = false; walk(root); }
  // the part of an element its overflow-clipping ancestors let through (0..1): a label slid out of its button is not seen
  const shown = (el, r) => {
    // a page read slices the page by the window, so the window's edge hides nothing: only an element's own clipping ancestors do
    let x0 = PAGE ? r.left : Math.max(r.left, 0), y0 = PAGE ? r.top : Math.max(r.top, 0), x1 = PAGE ? r.right : Math.min(r.right, W), y1 = PAGE ? r.bottom : Math.min(r.bottom, H);
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
  const opacityOf = (el) => { let op = 1; for (let p = el; p && p !== document.documentElement; p = up(p)) op *= +getComputedStyle(p).opacity; return Math.round(op * 100) / 100; };
  const hiddenUp = (el) => { for (let p = el; p && p !== document.documentElement; p = up(p)) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') return true; if (p !== root && LOADER.test(String(p.className && p.className.baseVal !== undefined ? p.className.baseVal : p.className) + ' ' + p.id)) return true; } return false; };
  const boxes = out.filter((b, i) => {
    const el = b.__el;
    delete b.__el;
    if (!el) return true;
    if (shown(el, el.getBoundingClientRect()) < 0.5) return false;
    // text a mask hides (a rolling label keeps a second copy of each letter behind its overflow clip) is not on the page: keep what shows
    try {
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let vis = '', all = '';
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const t = n.textContent.replace(/\\s+/g, ' ');
        all += t;
        if (!t.trim()) { vis += t; continue; }
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const rr = rg.getBoundingClientRect();
        if (rr.width > 0 && n.parentElement && shown(n.parentElement, rr) >= 0.5) vis += t;
      }
      if (vis.trim() && vis.trim() !== all.trim()) { b.text = vis.trim().slice(0, 200); b.rich = ''; }
    } catch {}
    return true;
  });
  // the first screen's flat shapes (pills, buttons, badges): a background colour or gradient, a border, rounded corners
  const shapes = [];
  const all = root.querySelectorAll('*');
  for (let i = 0; i < all.length && i < CAP.scan && shapes.length < CAP.shapes; i++) {
    const el = all[i];
    if (el.closest('svg') || el.tagName === 'CANVAS') continue;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : null;
    const hasUrl = /url\\(["']?https?:/.test(cs.backgroundImage);
    const grad = /gradient\\(/.test(cs.backgroundImage) || hasUrl ? cs.backgroundImage : null;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const border = bw > 0 && cs.borderTopStyle !== 'none' && !/rgba\\(\\d+, \\d+, \\d+, 0\\)/.test(cs.borderTopColor) ? bw + 'px ' + cs.borderTopStyle + ' ' + cs.borderTopColor : null;
    if (!bg && !grad && !border) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width >= 3 && r.height >= 3 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W)) continue;
    // a big shape counts only as an overlay over the picture: a gradient or a see-through colour on a positioned layer
    // that does not hold the canvas (a vignette, a fade to black at the bottom)
    const big = r.width * r.height > W * H * 0.25;
    // a page panel (a full-width section with its own colour) is a shape of the page; only a panel that holds the canvas stays out
    // (a small canvas, one read back as a picture, does not keep its panel out)
    if (PAGE && big) { const inside = (window.__DEA__ && window.__DEA__.deep ? window.__DEA__.deep('canvas') : [...el.querySelectorAll('canvas')]).filter((c) => el.contains(c) || (c.getRootNode && el.contains(c.getRootNode().host || null))); if (inside.some((c) => { const cr = c.getBoundingClientRect(); return cr.width * cr.height > W * H * 0.6; })) continue; }
    else if (big && hasUrl) { if (el.querySelector('canvas')) continue; }
    else if (big && !((grad || (bg && /rgba\\(.*, 0?\\.\\d+\\)$/.test(bg))) && cs.position !== 'static' && !el.querySelector('canvas'))) continue;
    if (hiddenUp(el) || shown(el, r) < 0.5) continue;
    const op = opacityOf(el);
    if (op < 0.05) continue;
    shapes.push({ k: keyOf(el), ...fxOf(el), zp: zpath(el), o: docOrder.get(el) ?? 0, x: r.left, y: r.top, w: r.width, h: r.height, background: bg, gradient: grad, border, radius: cs.borderRadius, filter: null, shadow: cs.boxShadow !== 'none' ? cs.boxShadow : null, ...(hasUrl ? { bgSize: cs.backgroundSize, bgPos: cs.backgroundPosition, bgRepeat: cs.backgroundRepeat, media: big } : {}), opacity: op });
  }
  // a gradient painted by a ::before or ::after: a fade laid over the picture (a dark band at the bottom of a section, a
  // blurred spot) is an overlay too, and the picture under it is the same canvas. Its box comes from its own offsets and size.
  for (let i = 0; i < all.length && i < CAP.scan && shapes.length < CAP.shapes + 10; i++) {
    const el = all[i];
    if (el.closest('svg') || el.tagName === 'CANVAS') continue;
    for (const pe of ['::before', '::after']) {
      const ps = getComputedStyle(el, pe);
      if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none' || ps.visibility === 'hidden' || ps.position === 'static') continue;
      if (!/gradient\\(/.test(ps.backgroundImage)) continue;
      const pr = el.getBoundingClientRect();
      const ext = (v, base) => (v === 'auto' ? null : v.endsWith('%') ? (parseFloat(v) / 100) * base : parseFloat(v));
      const L = ext(ps.left, pr.width);
      const R = ext(ps.right, pr.width);
      const T = ext(ps.top, pr.height);
      const B = ext(ps.bottom, pr.height);
      let w = ext(ps.width, pr.width);
      let h = ext(ps.height, pr.height);
      if (w == null) w = L != null && R != null ? pr.width - L - R : pr.width;
      if (h == null) h = T != null && B != null ? pr.height - T - B : pr.height;
      const x = pr.left + (L != null ? L : R != null ? pr.width - R - w : 0);
      const y = pr.top + (T != null ? T : B != null ? pr.height - B - h : 0);
      if (!(w >= 3 && h >= 3 && y + h > 0 && x + w > 0 && y < H && x < W)) continue;
      if (hiddenUp(el) || shown(el, { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }) < 0.5) continue;
      const op = Math.round(opacityOf(el) * (+ps.opacity) * 100) / 100;
      if (op < 0.05) continue;
      shapes.push({ k: keyOf(el, pe), ...fxOf(el), x, y, w, h, background: null, gradient: ps.backgroundImage, border: null, radius: ps.borderRadius, filter: ps.filter !== 'none' ? ps.filter : null, opacity: op });
    }
  }
  // the first screen's graphics: inline SVG (a logo, an icon) with its computed paint inlined, and small images
  const graphics = [];
  const PAINT = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule'];
  for (const el of root.querySelectorAll('svg, img, video')) {
    if (graphics.length >= CAP.graphics) break;
    if (el.tagName.toLowerCase() === 'svg' && el.parentElement && el.parentElement.closest('svg')) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width >= 8 && r.height >= 8 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W)) continue;
    const bigG = r.width * r.height > W * H * 0.25;
    if (bigG && el.tagName.toLowerCase() === 'svg') continue;
    if (hiddenUp(el) || shown(el, r) < 0.5) continue;
    const op = opacityOf(el);
    if (op < 0.05) continue;
    if (el.tagName.toLowerCase() === 'video') {
      // a background or hero video: the kit plays the same file (by URL, for study); a blob: stream falls back to its poster
      const vs = el.currentSrc || el.src;
      // a video that has not shown a frame yet (lazy, not started) is its poster picture on the page: the kit shows the same still
      const stillPoster = /^https?:/.test(el.poster || '') && (el.readyState < 2 || (el.paused && el.currentTime < 0.05));
      const kind = stillPoster ? 'img' : /^https?:/.test(vs) ? 'video' : /^https?:/.test(el.poster || '') ? 'img' : null;
      if (!kind) continue;
      graphics.push({ k: keyOf(el), ...fxOf(el), zp: zpath(el), o: docOrder.get(el) ?? 0, kind, x: r.left, y: r.top, w: r.width, h: r.height, src: kind === 'video' ? vs : el.poster, poster: el.poster || undefined, t: kind === 'video' && !el.paused ? Math.round(el.currentTime * 10) / 10 : undefined, fit: getComputedStyle(el).objectFit, media: bigG, opacity: op });
      continue;
    }
    if (el.tagName.toLowerCase() === 'img') {
      if (!el.complete || !el.naturalWidth || !/^https?:/.test(el.currentSrc || el.src)) continue;
      graphics.push({ k: keyOf(el), ...fxOf(el), zp: zpath(el), o: docOrder.get(el) ?? 0, kind: 'img', x: r.left, y: r.top, w: r.width, h: r.height, src: el.currentSrc || el.src, fit: getComputedStyle(el).objectFit, media: bigG, opacity: op });
      continue;
    }
    const clone = el.cloneNode(true);
    const a = [el, ...el.querySelectorAll('*')], b = [clone, ...clone.querySelectorAll('*')];
    for (let k = 0; k < a.length && k < 400; k++) {
      const cs = getComputedStyle(a[k]);
      b[k].setAttribute('style', PAINT.map((p) => p + ':' + cs.getPropertyValue(p)).join(';'));
      b[k].removeAttribute('class');
    }
    // an icon that points at a shared sprite (<use href="#id">) is nothing on its own: bring the referenced shapes along
    const NS = 'http://www.w3.org/2000/svg';
    let defs = null;
    for (const u of clone.querySelectorAll('use')) {
      const ref = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
      if (ref[0] !== '#' || ref.length < 2) continue;
      const id = ref.slice(1);
      if (Array.from(clone.querySelectorAll('[id]')).some((n) => n.id === id)) continue;
      const target = document.getElementById(id);
      if (!target) continue;
      defs ??= clone.insertBefore(document.createElementNS(NS, 'defs'), clone.firstChild);
      const copy = target.cloneNode(true);
      for (const n of [copy, ...copy.querySelectorAll('*')]) n.removeAttribute('class');
      defs.appendChild(copy);
    }
    clone.setAttribute('width', '100%');
    clone.setAttribute('height', '100%');
    clone.style.color = getComputedStyle(el).color;
    clone.style.display = 'block';
    const svg = clone.outerHTML;
    if (svg.length > 40000) continue;
    graphics.push({ k: keyOf(el), ...fxOf(el), zp: zpath(el), o: docOrder.get(el) ?? 0, kind: 'svg', x: r.left, y: r.top, w: r.width, h: r.height, svg, opacity: op });
  }
  let canvas = null;
  // a canvas that is not the page's scene (a chart, a map, a 2D drawing) and can be read back becomes a picture of what it shows,
  // so the section it sits in is not an empty hole in the kit; a canvas that reads back blank (WebGL without a kept buffer) stays out
  if (PAGE) {
    const snap = (window.__DEA__ && window.__DEA__.deep ? window.__DEA__.deep('canvas') : [...root.querySelectorAll('canvas')]);
    let bytes = 0;
    for (const c of snap) {
      if (graphics.length >= CAP.graphics || bytes > 900000) break;
      const r = c.getBoundingClientRect();
      if (!(r.width >= 24 && r.height >= 24 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W)) continue;
      if (r.width * r.height > W * H * 0.6) continue;
      if (hiddenUp(c) || opacityOf(c) < 0.05) continue;
      let url = '';
      try { url = c.toDataURL('image/webp', 0.7); } catch (e) { continue; }
      if (url.length < 900 || url.length > 260000) continue;
      bytes += url.length;
      graphics.push({ k: keyOf(c), ...fxOf(c), zp: zpath(c), o: docOrder.get(c) ?? 0, kind: 'img', x: r.left, y: r.top, w: r.width, h: r.height, src: url, fit: 'fill', canvasSnap: true, opacity: opacityOf(c) });
    }
  }
  // canvases in the document and in shadow roots, open or closed (the observers record every attachShadow)
  const inRoot = (c) => { for (let n = c; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) if (n === root) return true; return false; };
  const canvasList = window.__DEA__ && window.__DEA__.deep ? window.__DEA__.deep('canvas').filter(inRoot) : [...root.querySelectorAll('canvas')];
  for (const c of canvasList) {
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
  // a picture that fills the window under a WebGL canvas that fills it too is the canvas's fallback, not a second layer
  const canvasBig = canvas && canvas.vis > W * H * 0.5;
  if (canvasBig) {
    for (let i = graphics.length - 1; i >= 0; i--) if (graphics[i].media) graphics.splice(i, 1);
    for (let i = shapes.length - 1; i >= 0; i--) if (shapes[i].media) shapes.splice(i, 1);
  }
  if (canvas) delete canvas.vis;
  const bgOf = (el) => { const b = el && getComputedStyle(el).backgroundColor; return b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent' ? b : null; };
  // the page colour the first screen sits on: what shows at nine points of the window (the nearest opaque background up the
  // tree), the most common; else the body's
  const seenBg = new Map();
  for (const fx of [0.04, 0.5, 0.96]) for (const fy of [0.04, 0.5, 0.96]) {
    let c = null;
    for (let e = document.elementFromPoint(W * fx, H * fy); e && !c; e = e.parentElement) c = bgOf(e);
    if (c) seenBg.set(c, (seenBg.get(c) || 0) + 1);
  }
  const common = [...seenBg.entries()].sort((a, b) => b[1] - a[1])[0];
  const background = (common && common[1] >= 4 ? common[0] : null) || bgOf(document.body) || bgOf(document.documentElement);
  // a colour written in a newer space (oklch, oklab, lab, color()) reads back as it was written; the page colour is handed on as plain sRGB
  const plain = (c) => {
    if (!c || /^(rgb|#)/i.test(c)) return c;
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return d[3] === 255 ? 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')' : 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + Math.round((d[3] / 255) * 1000) / 1000 + ')';
    } catch { return c; }
  };
  return { viewport: { width: W, height: H }, boxes, canvas, background: plain(background), shapes, graphics };
})()`;

/** Where each first-screen element sits at a few scroll positions: a box that moves, scales or fades with scroll gets keyframes. */
export interface ScrollLayout {
  /** what moves the keyframes: the page's own scrolling, or the wheel on a page that scrolls by itself (virtual scrolling) */
  mode: 'scroll' | 'wheel';
  /** the text boxes read last (long after the intro), complete: used when the first read caught a heading half typed */
  boxesFinal?: unknown[];
  /** the scroll positions read (px); the first is 0 */
  positions: number[];
  /** per element key: box [x, y, w, h, opacity, fontSize] at each position, null where the element was not on screen */
  items: Record<string, Array<[number, number, number, number, number, number] | null>>;
  /** the text of each text box when the page was read last (long after the intro): the final text of a heading that was being typed */
  texts: Record<string, string>;
}

/**
 * Scroll the page to a few positions and read the first screen's layout at each, then keep the elements whose box
 * changes between them (a hero card that shrinks, a heading that fades or slides): the kit applies those keyframes by
 * scroll. Only a page that really scrolls is read this way. Elements are matched by their path through the DOM.
 */
export async function readScrollLayouts(page: Page, section: string | null): Promise<ScrollLayout | null> {
  const can = (await page.evaluate('document.documentElement.scrollHeight > innerHeight + 2').catch(() => false)) as boolean;
  const mode: 'scroll' | 'wheel' = can ? 'scroll' : 'wheel';
  const vh = (await page.evaluate('innerHeight').catch(() => 900)) as number;
  const vw = (await page.evaluate('innerWidth').catch(() => 1440)) as number;
  const positions = [0, Math.round(vh * 0.4), Math.round(vh * 0.9)];
  type R = {
    boxes: Array<{ k?: string; text?: string; x: number; y: number; w: number; h: number; opacity: number; fontSize: number }>;
    shapes?: Array<{ k?: string; x: number; y: number; w: number; h: number; opacity: number }>;
    graphics?: Array<{ k?: string; x: number; y: number; w: number; h: number; opacity: number }>;
    canvas?: { x: number; y: number; w: number; h: number } | null;
  };
  const settle = async (ms: number) => {
    // two drawn frames, then a moment for a scrubbed or smoothed animation to catch up
    await page
      .evaluate('new Promise((r) => { const t = setTimeout(r, 6000); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(); })); })')
      .catch(() => {});
    await page.waitForTimeout(ms);
  };
  const reads: R[] = [];
  let at = 0;
  try {
    if (mode === 'wheel') {
      // a page that scrolls by its own (virtual) scrolling answers the wheel: bring it back to the top first
      await page.mouse.move(vw / 2, vh / 2).catch(() => {});
      await page.mouse.wheel(0, -8000).catch(() => {});
      await settle(2500);
    }
    for (const y of positions) {
      if (mode === 'scroll') await page.evaluate(`window.scrollTo(0, ${y})`);
      else {
        if (y !== at) await page.mouse.wheel(0, y - at);
      }
      at = y;
      await settle(mode === 'wheel' ? 2500 : 900);
      reads.push((await page.evaluate(LAYOUT_READ(section))) as R);
    }
  } catch {
    return null;
  } finally {
    if (mode === 'scroll') await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
    else await page.mouse.wheel(0, -8000).catch(() => {});
  }
  const items: ScrollLayout['items'] = {};
  const add = (i: number, k: string | undefined, b: [number, number, number, number, number, number]) => {
    if (!k) return;
    if (!items[k]) items[k] = positions.map(() => null);
    items[k][i] = b;
  };
  reads.forEach((r, i) => {
    for (const b of r.boxes) add(i, b.k, [b.x, b.y, b.w, b.h, b.opacity, b.fontSize]);
    for (const b of r.shapes ?? []) add(i, b.k, [b.x, b.y, b.w, b.h, b.opacity, 0]);
    for (const b of r.graphics ?? []) add(i, b.k, [b.x, b.y, b.w, b.h, b.opacity, 0]);
    if (r.canvas) add(i, 'canvas', [r.canvas.x, r.canvas.y, r.canvas.w, r.canvas.h, 1, 0]);
  });
  // keep what is on screen at 0 and changes: position, size, opacity or type size by more than 2% of the window / 0.05
  const changed = Object.entries(items).filter(([, f]) => {
    const a = f[0];
    if (!a) return false;
    return f
      .slice(1)
      .some(
        (b) =>
          b &&
          (Math.abs(b[0] - a[0]) > 0.02 * vw ||
            Math.abs(b[1] - a[1]) > 0.02 * vh ||
            Math.abs(b[2] - a[2]) > 0.02 * vw ||
            Math.abs(b[3] - a[3]) > 0.02 * vh ||
            Math.abs(b[4] - a[4]) > 0.05 ||
            Math.abs(b[5] - a[5]) > 0.5),
      );
  });
  const texts: Record<string, string> = {};
  for (const b of reads[0]?.boxes ?? []) if (b.k && b.text) texts[b.k] = b.text;
  if (!changed.length && !Object.keys(texts).length) return null;
  return {
    mode,
    positions,
    texts,
    boxesFinal: reads[0]?.boxes ?? [],
    items: Object.fromEntries(
      changed.map(([k, f]) => [k, f.map((b) => (b ? (b.map((v) => Math.round(v * 100) / 100) as [number, number, number, number, number, number]) : null))]),
    ),
  };
}

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
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => null);
    await page.waitForTimeout(waitMs);
    await assertNotBotWall(page, resp);
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

/** luminance stats of a PNG data URL on a 96×60 thumbnail, read in the page */
async function thumbStats(page: Page, png: string): Promise<FrameStats> {
  await page.evaluate(NAME_SHIM);
  const lum = (await page.evaluate(
    async ([src, w, h]) => {
      const im = new Image();
      await new Promise((r) => {
        im.onload = r;
        im.src = src;
      });
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d') as CanvasRenderingContext2D;
      x.drawImage(im, 0, 0, w, h);
      const d = x.getImageData(0, 0, w, h).data;
      const out: number[] = [];
      for (let i = 0; i < d.length; i += 4) out.push(Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]));
      return out;
    },
    [png, THUMB_W, THUMB_H] as const,
  )) as number[];
  return frameStats(lum);
}

/** Round 32: the page's environment as DEA set it and as the page reacted, for the report */
export interface RefEnv {
  gpuMasked: boolean;
  coresMasked: boolean;
  renderer: string | null;
  /** WebGL contexts the page lost: ms since the page started, canvas size */
  contextLost: Array<{ t: number; w?: number; h?: number }>;
  /** the html element's class when it names a fallback mode (static, fallback, no-webgl, lite, reduced) */
  fallbackClass: string | null;
}

export const ENV_READ = `(() => {
  const D = window.__DEA__ || {};
  const cls = String(document.documentElement.className || '');
  return {
    gpuMasked: !!D.gpuMasked,
    coresMasked: !!D.coresMasked,
    renderer: D.renderer || null,
    contextLost: Array.isArray(D.contextLost) ? D.contextLost.slice(0, 20) : [],
    fallbackClass: /(^|\\s)(static|fallback|no-?webgl|no-?3d|lite|reduced|poster)(\\s|$)/i.test(cls) ? cls.slice(0, 120) : null,
  };
})()`;

/** Round 33: a renderer name short enough for one line, cut at a word and never mid-id ("(Subzero) (0" was the old cut) */
export function shortRenderer(r: string, max = 110): string {
  if (r.length <= max) return r;
  const cut = r.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,(]+$/, '')}…`;
}

/** One line for the report about the page's environment (null when there is nothing to say). */
export function envLine(e: RefEnv | null | undefined): string | null {
  if (!e) return null;
  const parts: string[] = [];
  if (e.gpuMasked) parts.push(`DEA answered a desktop GPU name for the software renderer${e.renderer ? ` (${shortRenderer(e.renderer)})` : ''}`);
  if (e.coresMasked) parts.push('DEA answered 8 CPU cores and 8 GB (navigator.hardwareConcurrency, deviceMemory)');
  if (e.contextLost.length)
    parts.push(
      `the page lost ${e.contextLost.length} WebGL context(s) (first at ${Math.round(e.contextLost[0].t / 1000)} s${e.contextLost[0].w ? `, ${e.contextLost[0].w}x${e.contextLost[0].h} canvas` : ''})`,
    );
  if (e.fallbackClass) parts.push(`the page switched to a fallback mode (html class "${e.fallbackClass}")`);
  return parts.length ? parts.join('; ') : null;
}

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
  /** after the recording: run the scripted pointer and scroll (frames for the interaction check) and the input probe */
  interact = false,
  /** what the scroll tape may add to the recording, in MB */
  tapeMb?: number,
): Promise<{
  /** a frame after each step of the interaction script, on the live site */
  interaction?: Buffer[];
  /** how first-screen elements move with scroll (keyframes at a few scroll positions), when the page scrolls */
  layoutScroll?: ScrollLayout | null;
  /** how the fresh load the interaction ran on was brought to the phase of the reference picture */
  phase?: PhaseInfo | null;
  /** what the page changed during each step of the interaction script (uniforms, CPU uploads, draw sizes) */
  interactionState?: Array<StepState | null>;
  /** every float uniform per frame beside the pointer, scroll and window size, while the probe moved them */
  probe?: ProbeData | null;
  png: string;
  atMs: number;
  loader: boolean;
  /** the kept frame is near-uniform: likely still a loading screen (no counter) or an undrawn canvas */
  flat?: boolean;
  /** the recorded WebGL frames (when `record`), taken right before the screenshot, which shows the last of them */
  recording?: Recording | null;
  recordingError?: string;
  /** Round 32: what DEA told the page and what the page did: GPU name / CPU masks, lost WebGL contexts, a static-mode class */
  env?: RefEnv;
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
    const resp = await timed('page load', () => page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => null));
    await assertNotBotWall(page, resp);
    let best = { png: '', score: -1, atMs: 0, loader: false, flat: true };
    let layout: unknown = null;
    const t0 = Date.now();
    // a loader still covering the page at the end buys more time (up to 2.5× or 3 minutes): software WebGL is slow
    const hardCap = Math.min(Math.max(ms * 2.5, ms), 180_000);
    let loader = false;
    const watchStart = currentTimings()?.now() ?? 0;
    let quiet = 0;
    // ...and keeps buying it for as long as the loader's counter keeps rising, up to 7 minutes (full mode only)
    // when the loader's own counter last went up (the only progress that buys time past the hard cap)
    let pctAt = Date.now();
    let lastPct: number | null = null;
    let lastScore = -1;
    // past the hard cap only a rising loader counter buys more time: an animated loader keeps changing the picture forever on a
    // slow CPU (lusion.co on a 2-vCPU box sat here for 13+ minutes); quick mode (1 frame) never goes past its hard cap
    // Round 28: quick mode now also follows a rising counter, up to 3 minutes (only the counter buys this, not a changing picture)
    const longCap = frames < 2 ? Math.max(hardCap, QUICK_LOADER_CAP_MS) : 420_000;
    // a flat best frame (igloo.inc's grey loader has no counter) buys a bounded extra wait while the picture still changes
    let lastStats: FrameStats | null = null;
    let changedAt = Date.now();
    let flatNoted = false;
    // Round 29: the watch clock starts at the first frame the watch actually got, not at page load: on software WebGL the first
    // screenshots of jehaduddin.vercel.app took ~49 s, which ate the whole 2.5x hard cap before the counter could buy time
    let wt0 = 0;
    const welapsed = () => (wt0 ? Date.now() - wt0 : 0);
    let peelAt = -Infinity;
    let peels = 0;
    let lastWhy = '';
    let whyNotes = 0;
    let loaderSeen = false;
    let glMissing = false;
    let sawCanvasUnderLoader = false;
    const watching = () =>
      Date.now() - t0 < longCap + 120_000 &&
      keepWatching({
        elapsed: welapsed(),
        ms,
        hardCap,
        longCap,
        loader,
        pctAge: Date.now() - pctAt,
        bestFlat: best.score >= 0 && best.flat,
        changedAge: Date.now() - changedAt,
        quick: frames < 2,
      });
    while (watching()) {
      if (!flatNoted && best.flat && best.score >= 0 && welapsed() >= Math.max(ms, loader ? hardCap : ms)) {
        flatNoted = true;
        currentTimings()?.note('the best frame so far is near-uniform (a loading screen?): watching longer while it changes');
      }
      if (smart && !loader && !best.flat && best.score > 0 && quiet >= 4 && Date.now() - t0 >= 8000) {
        currentTimings()?.note(`settled after ${Math.round((Date.now() - t0) / 1000)} s (cap ${Math.round(ms / 1000)} s)`);
        break;
      }
      await page.waitForTimeout(2500);
      if (section) await page.evaluate(`document.querySelector(${JSON.stringify(section)})?.scrollIntoView({ block: 'start' })`).catch(() => {});
      const buf = await page.screenshot({ type: 'png' }).catch(() => null);
      if (!buf) continue;
      if (!wt0) {
        wt0 = Date.now();
        pctAt = wt0;
        changedAt = wt0;
        if (wt0 - t0 > 10_000)
          currentTimings()?.note(`the first watch frame came ${Math.round((wt0 - t0) / 1000)} s after page load: the watch clock starts there`);
      }
      const png = `data:image/png;base64,${buf.toString('base64')}`;
      const st = await thumbStats(page, png);
      const score = st.sd;
      const flat = isFlat(st);
      if (frameChanged(lastStats, st)) changedAt = Date.now();
      lastStats = st;
      loader = (await page.evaluate(LOADER_VISIBLE).catch(() => false)) as boolean;
      if (loader) {
        loaderSeen = true;
        if (!sawCanvasUnderLoader) sawCanvasUnderLoader = ((await page.evaluate(GL_ON_SCREEN).catch(() => -1)) as number) >= 0;
      }
      // Round 29: why the loader check said that, logged when it changes (every poll with DEA_DEBUG_LOADER=1)
      const why = (await page.evaluate(LOADER_WHY).catch(() => 'loader check failed')) as string;
      const whyLine = `${loader ? 'loader' : 'no loader'} at ${Math.round((Date.now() - t0) / 1000)} s: ${why}`.slice(0, 400);
      if (process.env.DEA_DEBUG_LOADER) console.error(whyLine);
      if (why !== lastWhy && whyNotes++ < 30) currentTimings()?.note(whyLine);
      lastWhy = why;
      if (loader) {
        const pct = (await page.evaluate(LOADER_PROGRESS).catch(() => null)) as number | null;
        const rising = pct !== null && (lastPct === null || pct > lastPct);
        if (rising) pctAt = Date.now();
        if (pct !== null) lastPct = pct;
        lastScore = score;
      } else if (lastScore >= 0) {
        // Round 32: on any loader-to-no-loader change, with or without a counter reading (PR #24's run had none)
        currentTimings()?.note(
          `the loading screen finished after ${Math.round((Date.now() - t0) / 1000)} s${lastPct !== null ? ` (it showed ${lastPct}% last)` : ''}`,
        );
        // Round 30: once (it repeated on every poll after the loader cleared: 44 identical lines)
        lastScore = -1;
      }
      // frames behind a loader only count when nothing better comes
      const s2 = loader ? score * 0.25 : score;
      quiet = s2 > best.score * 1.02 || loader ? 0 : quiet + 1;
      if (betterFrame({ score: s2, flat }, best)) {
        best = { png, score: s2, atMs: Date.now() - t0, loader, flat };
        layout = await page.evaluate(LAYOUT_READ(section)).catch((e) => {
          if (process.env.DEA_DEBUG_LAYOUT) console.error('layout read failed (watch):', String(e).slice(0, 300));
          return layout;
        });
      }
      // Round 29: a flat frame that sits still (or outlasts the hard cap) is looked through: hide the loader layers, whether or not
      // LOADER_VISIBLE matched, and keep the page behind them if it has detail; else put the loader back and watch on
      if (shouldPeel({ bestFlat: best.flat, flat, changedAge: Date.now() - changedAt, elapsed: welapsed(), hardCap, sincePeel: Date.now() - peelAt, peels })) {
        peelAt = Date.now();
        peels++;
        const hidden = (await page.evaluate(LOADER_HIDE).catch(() => 0)) as number;
        if (hidden > 0) {
          await page.waitForTimeout(1500);
          const pb = await page.screenshot({ type: 'png' }).catch(() => null);
          const ppng = pb ? `data:image/png;base64,${pb.toString('base64')}` : '';
          const pst = ppng ? await thumbStats(page, ppng) : null;
          if (pst && !isFlat(pst)) {
            currentTimings()?.note(
              `a flat loading screen at ${Math.round((Date.now() - t0) / 1000)} s: DEA hid ${hidden} loader layer(s) and took the reference through them`,
            );
            best = { png: ppng, score: pst.sd, atMs: Date.now() - t0, loader: false, flat: false };
            loader = false;
            layout = await page.evaluate(LAYOUT_READ(section)).catch(() => layout);
            break;
          }
          await page.evaluate(LOADER_UNHIDE).catch(() => 0);
          currentTimings()?.note(
            `hiding ${hidden} loader layer(s) at ${Math.round((Date.now() - t0) / 1000)} s showed a flat page too: loader put back, watching on`,
          );
        }
      }
    }
    currentTimings()?.record('watch for the reference frame', watchStart, (currentTimings()?.now() ?? 0) - watchStart);
    // Round 28: the watch ended with the loader still up and no detailed frame: hide the loader's layers and look through them
    // (jehaduddin.vercel.app's counter stalls at 64 on software WebGL while the site behind it is already laid out)
    if (best.flat && best.png) {
      const hidden = (await page.evaluate(LOADER_HIDE).catch(() => 0)) as number;
      if (hidden > 0) {
        await page.waitForTimeout(1500);
        const buf = await page.screenshot({ type: 'png' }).catch(() => null);
        if (buf) {
          const png = `data:image/png;base64,${buf.toString('base64')}`;
          const st = await thumbStats(page, png);
          if (!isFlat(st)) {
            currentTimings()?.note(
              `the loader was still up after ${Math.round((Date.now() - t0) / 1000)} s: DEA hid ${hidden} loader layer(s) and took the reference through them`,
            );
            best = { png, score: st.sd, atMs: Date.now() - t0, loader: false, flat: false };
            loader = false;
            layout = await page.evaluate(LAYOUT_READ(section)).catch(() => layout);
          } else currentTimings()?.note(`the loader was still up; hiding ${hidden} loader layer(s) showed a flat page too`);
        }
      }
    }
    // Round 30: a loader just finished but the WebGL scene has not mounted yet (the hero is still a poster image): wait for a
    // drawing canvas, then take the reference again, so the recording has a scene to record
    {
      const glRead = async () => (await page.evaluate(GL_ON_SCREEN).catch(() => -1)) as number;
      const r0 = await glRead();
      await page.waitForTimeout(1000);
      const r1 = await glRead();
      const waitMs = postLoaderGlWait({ loaderSeen: loaderSeen || peels > 0, bestFlat: best.flat, glOnScreen: r0 >= 0 && r1 > r0, quick: frames < 2 });
      if (waitMs > 0) {
        const g0 = Date.now();
        let prev = r1;
        let drawing = false;
        let nudged = false;
        // Round 35: a visible canvas whose frame counter is still at the first read counts once the counter moves past ANY
        // earlier visible read (igloo.inc on a slow box: frames over 2.5 s apart, and a -1 poll in between reset the chain)
        let seen = r1 >= 0 ? r1 : r0;
        let lastVisible = -1;
        while (Date.now() - g0 < waitMs) {
          await page.waitForTimeout(2500);
          const r = await glRead();
          if (r >= 0) lastVisible = r;
          if (r >= 0 && seen >= 0 && r > seen) {
            drawing = true;
            break;
          }
          if (r >= 0 && seen < 0) seen = r;
          prev = r;
          // a scene that mounts on the first pointer or scroll (lazy R3F, an IntersectionObserver): nudge once after 10 s, then
          // put the page back at the top
          if (!nudged && Date.now() - g0 >= 10_000) {
            nudged = true;
            await page.mouse.move(viewport.width / 2, viewport.height / 2).catch(() => {});
            await page.mouse.wheel(0, 40).catch(() => {});
            await page.waitForTimeout(600);
            await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
          }
        }
        if (drawing) {
          await page.waitForTimeout(2500);
          const gb = await page.screenshot({ type: 'png' }).catch(() => null);
          const gpng = gb ? `data:image/png;base64,${gb.toString('base64')}` : '';
          const gst = gpng ? await thumbStats(page, gpng) : null;
          if (gst && !isFlat(gst)) {
            best = { png: gpng, score: gst.sd, atMs: Date.now() - t0, loader: false, flat: false };
            layout = await page.evaluate(LAYOUT_READ(section)).catch(() => layout);
          }
          currentTimings()?.note(
            `the WebGL scene started drawing ${Math.round((Date.now() - g0) / 1000)} s after the watch ended (after the loading screen): reference taken again`,
          );
        } else if (lastVisible >= 0 || prev >= 0) {
          // Round 35: a big WebGL canvas is on screen but its frames did not advance while DEA watched. Do not drop it:
          // the recorder decides (it gives up in 15 s when no context ever drew, Round 34), so a slow scene is still recorded
          currentTimings()?.note(
            `a WebGL canvas is on screen after the loading screen but its frame count did not move in ${Math.round(waitMs / 1000)} s: recording anyway (the recorder stops in 15 s if nothing ever drew)`,
          );
        } else {
          glMissing = true;
          currentTimings()?.note(
            `no WebGL canvas drew within ${Math.round(waitMs / 1000)} s after the loading screen finished (pointer and scroll nudged too): the first screen after the loader has no WebGL`,
          );
          // Round 31: a WebGL canvas that was up during the loader and is gone now belonged to the loading screen
          if (sawCanvasUnderLoader)
            currentTimings()?.note('a WebGL canvas was on screen while the loader was up and is gone now: it belonged to the loading screen');
        }
      }
    }
    // Round 32: what DEA told the page and how it reacted, once, for the timings and the report
    const env = ((await page.evaluate(ENV_READ).catch(() => null)) as RefEnv | null) ?? undefined;
    {
      const line = envLine(env);
      if (line) currentTimings()?.note(`page environment: ${line}`);
    }
    // every screenshot in the watch failed (or the watch never ran): one more try, so the reference is never an empty image
    // (Round 27: --no-replay wrote a 0-byte original.png and the diff died on "image did not load")
    if (!best.png) {
      const buf = await page.screenshot({ type: 'png' }).catch(() => null);
      if (!buf) throw new Error('could not take a screenshot of the page for the reference');
      best = { png: `data:image/png;base64,${buf.toString('base64')}`, score: 0, atMs: Date.now() - t0, loader, flat: true };
      layout = await page.evaluate(LAYOUT_READ(section)).catch(() => layout);
    }
    // Round 31: the wait after the loader found no drawing WebGL canvas: recording would wait 90 s for frames that cannot come
    if (record && glMissing) {
      currentTimings()?.note('not recording: no WebGL canvas is drawing on the first screen after the loader');
      return {
        png: best.png,
        atMs: best.atMs,
        loader: best.loader,
        flat: best.flat,
        layout: layout as never,
        env,
        recording: null,
        recordingError: 'no WebGL canvas drew on the first screen after the loading screen (DEA waited and nudged the pointer and scroll)',
      };
    }
    if (record) {
      // record two frames, hold the page on the last one, and use that moment as the reference: the replay then has the
      // exact frame to match
      if (section) await page.evaluate(`document.querySelector(${JSON.stringify(section)})?.scrollIntoView({ block: 'start' })`).catch(() => {});
      const r = await timed('record WebGL frames', () => recordFrames(page, { frames }));
      if (r.ok) {
        // the canvas at the recorded frame, before the tape records more: the score compares the replay with this
        const canvasPng = await timed('copy the canvas at the recorded frame', () => grabCanvasFrame(page).catch(() => null));
        await page.waitForTimeout(400);
        const buf = await page.screenshot({ type: 'png' }).catch(() => null);
        const nowLoader = (await page.evaluate(LOADER_VISIBLE).catch(() => false)) as boolean;
        // the first screen's layout is read now, while the page is still held on the recorded moment (the tape runs it on)
        const l = await page.evaluate(LAYOUT_READ(section)).catch((e) => {
          if (process.env.DEA_DEBUG_LAYOUT) console.error('layout read failed:', String(e).slice(0, 300));
          return layout;
        });
        // the tape: more frames of the same recording while the pointer moves and settles (what the site draws and uploads then)
        const tape = interact ? await timed('record the pointer tape', () => recordTape(page).catch((e) => ({ ok: false as const, error: String(e) }))) : null;
        // a page that listens for a press may draw only while the button is held (paint, fluid, drag-to-orbit): a second tape with
        // the button down, kept only when the hover tape found nothing that follows the pointer
        const presses = interact && tape?.ok ? await pressListeners(page) : 0;
        const dragTape =
          presses > 0 && tape?.ok
            ? await timed('record the pointer tape with the button held', () =>
                recordTape(page, { drag: true }).catch((e) => ({ ok: false as const, error: String(e) })),
              )
            : null;
        // the scroll tape: the recording continued while the page is scrolled, a stop at a time (what a scroll-driven scene did)
        const scrollTape =
          interact && !overBudget()
            ? await timed('record the scroll tape', () =>
                recordScrollTape(page, {
                  shouldStop: overBudget,
                  maxBytes: (tapeMb ?? 64) * 1e6,
                  onStop: process.env.DEA_DEBUG_TAPE
                    ? (st, i, ms) => console.error(`tape stop ${i}: scroll ${st.sc}, wheel ${st.wh}, frames ${st.f0}-${st.f1}, ${Math.round(ms / 1000)} s`)
                    : undefined,
                }).catch((e) => ({ ok: false as const, error: String(e) })),
              )
            : null;
        setDragStep(presses > 0);
        const recording = await timed('read the recording out of the page', () => pullRecording(page).catch(() => null));
        if (recording && tape?.ok) recording.doc.tape = { from: frames, move: tape.move, still: tape.still };
        if (recording && tape?.ok && dragTape?.ok)
          recording.doc.tapeDrag = { from: frames + tape.move + tape.still, move: dragTape.move, still: dragTape.still };
        if (recording && scrollTape?.ok) {
          const from = frames + (tape?.ok ? tape.move + tape.still : 0) + (dragTape?.ok ? dragTape.move + dragTape.still : 0);
          recording.doc.scroll = {
            from,
            mechanism: scrollTape.rec.mechanism,
            step: scrollTape.rec.step,
            settle: scrollTape.rec.settle,
            stops: scrollTape.rec.stops,
            docHeight: scrollTape.rec.docHeight,
            reach: scrollTape.rec.reach,
            ended: scrollTape.rec.ended,
          };
        }
        await releaseFrames(page);
        if (buf && recording) {
          const atMs = Date.now() - t0;
          let interaction: Buffer[] | undefined;
          let interactionState: Array<StepState | null> | undefined;
          let layoutScroll: ScrollLayout | null | undefined;
          let probe: ProbeData | null | undefined;
          let phase: PhaseInfo | null = null;
          if (interact) {
            // the scroll tape moved the page (a story that plays forward does not always come back to the top), so the scripted
            // interaction runs on a fresh load of the site, held as long as the reference was: its "rest" is then the first screen
            let ipage = page;
            if (scrollTape?.ok && !overBudget()) {
              const fresh = await timed('reload the site for the scripted interaction', async () => {
                const p = await context.newPage();
                await p.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => null);
                // not "wait as long as the reference took": wait until the scene is stable and shows the picture the reference showed
                // (the same phase of an intro or a loop), up to 1.5 × the reference's time
                const ref = await thumbOfImage(p, `data:image/png;base64,${buf.toString('base64')}`);
                const al = await alignToReference(p, ref, { capMs: Math.min(Math.max(atMs * 1.5, 20_000), 150_000) });
                phase = phaseInfo(al);
                return p;
              }).catch(() => null);
              if (fresh) {
                await page.close().catch(() => {});
                ipage = fresh;
              }
            }
            const ran = await timed('scripted pointer and scroll on the site', () => runInteractionWithState(ipage).catch(() => undefined));
            interaction = ran?.frames;
            interactionState = ran?.states;
            await ipage.evaluate('window.scrollTo(0, 0)').catch(() => {});
            probe = await timed('input probe (pointer, scroll, resize)', () => probeInputs(ipage).catch(() => null));
            layoutScroll = await timed('first-screen boxes at a few scroll positions', () => readScrollLayouts(ipage, section).catch(() => null));
          }
          // the screenshot at the recorded moment is the reference (the replay has that exact frame to match), unless it is a
          // flat loader while the watch had kept a detailed frame (Round 27): then the watched frame is the better reference
          const nowFlat = await thumbStats(page, `data:image/png;base64,${buf.toString('base64')}`).then(isFlat, () => best.flat);
          const useBest = nowFlat && !best.flat && Boolean(best.png);
          if (useBest) currentTimings()?.note('the screenshot after recording is flat (a loader came back?): the watched frame is the reference');
          return {
            png: useBest ? best.png : `data:image/png;base64,${buf.toString('base64')}`,
            atMs: useBest ? best.atMs : atMs,
            loader: useBest ? best.loader : nowLoader,
            flat: useBest ? false : nowFlat,
            layout: (l ?? layout) as never,
            env,
            recording: canvasPng ? { ...recording, canvasPng } : recording,
            interaction,
            interactionState,
            layoutScroll,
            probe,
            phase,
          };
        }
        return {
          png: best.png,
          atMs: best.atMs,
          loader: best.loader,
          flat: best.flat,
          layout: layout as never,
          env,
          recording: null,
          recordingError: 'the recording could not be read out of the page',
        };
      }
      return { png: best.png, atMs: best.atMs, loader: best.loader, flat: best.flat, layout: layout as never, env, recording: null, recordingError: r.error };
    }
    return { png: best.png, atMs: best.atMs, loader: best.loader, flat: best.flat, layout: layout as never, env };
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

/**
 * A screenshot of a page that is drawing heavy WebGL on a software GPU can fail once with "Unable to capture screenshot" while
 * the compositor is busy. Retry after a pause, then take the frame from the page's own surface instead of the compositor's.
 */
export async function safeScreenshot(page: Page): Promise<Buffer> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await page.screenshot({ type: 'png', timeout: 60_000 });
    } catch (e) {
      last = e;
      await page.waitForTimeout(1500 * (i + 1)).catch(() => {});
    }
  }
  try {
    const cdp = await page.context().newCDPSession(page);
    const r = (await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false } as never)) as { data: string };
    await cdp.detach().catch(() => {});
    return Buffer.from(r.data, 'base64');
  } catch {
    throw last;
  }
}

/** Render the preview with parameters and return a PNG data URL of the first screen. */
export async function renderPreview(
  browser: Browser,
  base: string,
  params: Params,
  viewport: { width: number; height: number },
): Promise<{ png: string; error?: string }> {
  // through the content cache: three.js and the other pinned CDN files the preview imports are kept, so scoring works
  // offline once they were fetched (before, a run without internet scored a rebuild that was never drawn)
  const context = await browser.newContext({ viewport });
  await currentCache()?.attach(context);
  const page = await context.newPage();
  try {
    await page.goto(`${base}/preview/index.html#${encodeURIComponent(JSON.stringify(params))}`, { waitUntil: 'load', timeout: 30_000 });
    // a first compile of many programs on a software GPU can take a while; the wait ends as soon as the page is ready
    await page.waitForFunction('window.__deaReady === true', undefined, { timeout: 120_000 }).catch(() => {});
    const error = (await page.evaluate('window.__deaError || null')) as string | null;
    const png = `data:image/png;base64,${(await safeScreenshot(page)).toString('base64')}`;
    return { png, error: error ?? undefined };
  } finally {
    await context.close();
  }
}

/** Open the kit's replay or rebuild running live (pointer, scroll and clocks drive it) and run the interaction script. */
export async function kitInteraction(
  browser: Browser,
  base: string,
  program: '__replay' | '__rebuild',
  viewport: { width: number; height: number },
  extra: Params = {},
): Promise<{ frames: Buffer[]; states: Array<StepState | null>; error?: string }> {
  const context = await browser.newContext({ viewport });
  await currentCache()?.attach(context);
  const page = await context.newPage();
  try {
    // the recorder only watches here: it reads which uniforms and uploads change during each step
    await page.addInitScript(REPLAY_CAPTURE_SCRIPT);
    await page.goto(`${base}/preview/index.html#${encodeURIComponent(JSON.stringify({ ...extra, program, live: true }))}`, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await page.waitForFunction('window.__deaReady === true', undefined, { timeout: 120_000 }).catch(() => {});
    const error = (await page.evaluate('window.__deaError || null')) as string | null;
    const { frames, states } = await runInteractionWithState(page);
    return { frames, states, error: error ?? undefined };
  } finally {
    await context.close();
  }
}

export interface Steadiness {
  frames: number;
  /** mean change between consecutive frames (0..255 on a small grey image) */
  step: number;
  /** mean change between frames two apart */
  skip: number;
  /** step / skip: about 0.5 for smooth motion, about 1 for a still picture with noise, well above 1 when the picture flips
   *  back and forth between two states (shaking) */
  flip: number;
  shaking: boolean;
}

/**
 * Is the live kit steady? Opens the replay or rebuild running live, then renders `frames` consecutive frames by hand
 * and compares them: a picture that flips between two states every frame changes a lot from one frame to the next and
 * little across two.
 */
export async function kitSteadiness(
  browser: Browser,
  base: string,
  program: '__replay' | '__rebuild',
  viewport: { width: number; height: number },
  opts: { frames?: number; steady?: boolean } = {},
): Promise<Steadiness | null> {
  const page = await browser.newPage({ viewport });
  // the code below runs in the page: a bundler's keep-names helper (__name) must exist there, or every call throws
  await page.addInitScript(() => {
    (globalThis as unknown as { __name?: (f: unknown) => unknown }).__name ??= (f: unknown) => f;
  });
  try {
    await page.goto(`${base}/preview/index.html#${encodeURIComponent(JSON.stringify({ program, live: true, steady: opts.steady !== false }))}`, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await page.waitForFunction('window.__deaReady === true && !!window.__deaKit', undefined, { timeout: 120_000 }).catch(() => {});
    return (await page.evaluate(async (n) => {
      const kit = (window as unknown as { __deaKit?: { stop: () => void; renderFrames: (k: number) => void } }).__deaKit;
      const src = document.querySelector('#scene canvas') as HTMLCanvasElement | null;
      if (!kit || !src) return null;
      kit.stop();
      const W = 160;
      const H = Math.max(1, Math.round((src.height / src.width) * W));
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      const grab = () => {
        x.drawImage(src, 0, 0, W, H);
        const d = x.getImageData(0, 0, W, H).data;
        const g = new Float32Array(W * H);
        for (let i = 0; i < g.length; i++) g[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
        return g;
      };
      const F: Float32Array[] = [];
      for (let i = 0; i < n; i++) {
        kit.renderFrames(1);
        await new Promise((r) => setTimeout(r, 16));
        F.push(grab());
      }
      const md = (a: Float32Array, b: Float32Array) => {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
        return s / a.length;
      };
      const mean = (v: number[]) => v.reduce((s, y) => s + y, 0) / Math.max(1, v.length);
      const step = mean(F.slice(1).map((f, i) => md(F[i], f)));
      const skip = mean(F.slice(2).map((f, i) => md(F[i], f)));
      const flip = step / Math.max(skip, 0.05);
      return {
        frames: n,
        step: Math.round(step * 100) / 100,
        skip: Math.round(skip * 100) / 100,
        flip: Math.round(flip * 100) / 100,
        shaking: step > 1 && flip > 1.5,
      };
    }, opts.frames ?? 8)) as Steadiness | null;
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
