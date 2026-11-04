import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { Page } from 'playwright';
import { NAME_SHIM } from '../browser/init.ts';
import { type BrowserChoice, launchBrowser, releaseBrowser } from '../browser/open.ts';
import { compareImages, type Similarity } from './preview.ts';

/**
 * The canvas-only perceptual score: how alike the WebGL picture is, with the page's text masked out.
 *
 * The page score (colour, light layout, edges over the whole screen) rewards matching text, layout and colour; a flat
 * stand-in behind the right text can score high while the 3D looks nothing like the site. This score looks only at the
 * canvas region and hides every text box, so it moves only when the picture itself gets closer:
 *  - SSIM (structural similarity) on luminance at three scales (fine detail, mid shapes, overall light distribution),
 *  - correlation of edge strength (Sobel) at the mid scale,
 *  - similarity of the luminance histograms (the tonal range: glow, haze, contrast).
 * score = 0.6 × mean SSIM + 0.2 × edges + 0.2 × histogram, each 0..1.
 */
export interface CanvasScore {
  score: number;
  /** mean SSIM over the three scales */
  ssim: number;
  ssimFine: number;
  ssimMid: number;
  ssimCoarse: number;
  edges: number;
  histogram: number;
  /** share of the canvas hidden because text sits on it */
  masked: number;
  /** the region compared, in page pixels */
  region: { x: number; y: number; w: number; h: number };
  /** pixels compared at the fine scale */
  size: { w: number; h: number };
}

export interface Luma {
  w: number;
  h: number;
  /** luminance 0..255, row-major */
  l: Float64Array;
  /** 1 = hidden (text on top), 0 = compared */
  mask: Uint8Array;
}

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

/** Mean SSIM over square windows (size `win`, step `stride`) that are at least half visible. */
export function ssim(a: Luma, b: Luma, win = 8, stride = 4): number {
  const { w, h } = a;
  const m = a.mask;
  let sum = 0;
  let n = 0;
  const ws = Math.min(win, w, h);
  for (let y0 = 0; y0 + ws <= h; y0 += stride)
    for (let x0 = 0; x0 + ws <= w; x0 += stride) {
      let k = 0;
      let sa = 0;
      let sb = 0;
      for (let y = y0; y < y0 + ws; y++)
        for (let x = x0; x < x0 + ws; x++) {
          const i = y * w + x;
          if (m[i]) continue;
          sa += a.l[i];
          sb += b.l[i];
          k++;
        }
      if (k < (ws * ws) / 2) continue;
      const ma = sa / k;
      const mb = sb / k;
      let va = 0;
      let vb = 0;
      let cv = 0;
      for (let y = y0; y < y0 + ws; y++)
        for (let x = x0; x < x0 + ws; x++) {
          const i = y * w + x;
          if (m[i]) continue;
          const da = a.l[i] - ma;
          const db = b.l[i] - mb;
          va += da * da;
          vb += db * db;
          cv += da * db;
        }
      va /= k;
      vb /= k;
      cv /= k;
      sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  return n ? Math.max(0, sum / n) : 0;
}

/** Half the size: each pixel is the mean of the visible pixels of a 2×2 block; a block is hidden only when all of it is. */
export function half(x: Luma): Luma {
  const w = Math.max(1, Math.floor(x.w / 2));
  const h = Math.max(1, Math.floor(x.h / 2));
  const l = new Float64Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let xx = 0; xx < w; xx++) {
      let s = 0;
      let k = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const i = Math.min(x.h - 1, y * 2 + dy) * x.w + Math.min(x.w - 1, xx * 2 + dx);
          if (x.mask[i]) continue;
          s += x.l[i];
          k++;
        }
      l[y * w + xx] = k ? s / k : 0;
      mask[y * w + xx] = k ? 0 : 1;
    }
  return { w, h, l, mask };
}

/** The mask grown by one pixel: an edge is only measured where its whole 3×3 neighbourhood is visible. */
function grow(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 1 : 0;
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && m[yy * w + xx]) hit = 1;
        }
      o[y * w + x] = hit;
    }
  return o;
}

function sobel(x: Luma): Float64Array {
  const { w, h, l } = x;
  const g = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let xx = 1; xx < w - 1; xx++) {
      const at = (dx: number, dy: number) => l[(y + dy) * w + xx + dx];
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      g[y * w + xx] = Math.hypot(gx, gy);
    }
  return g;
}

/** Pearson correlation over visible pixels, 0..1 (two flat images are alike, one flat and one not are not). */
export function correlation(u: Float64Array, v: Float64Array, mask: Uint8Array): number {
  let n = 0;
  let su = 0;
  let sv = 0;
  for (let i = 0; i < u.length; i++)
    if (!mask[i]) {
      su += u[i];
      sv += v[i];
      n++;
    }
  if (!n) return 0;
  const mu = su / n;
  const mv = sv / n;
  let num = 0;
  let du = 0;
  let dv = 0;
  for (let i = 0; i < u.length; i++) {
    if (mask[i]) continue;
    num += (u[i] - mu) * (v[i] - mv);
    du += (u[i] - mu) ** 2;
    dv += (v[i] - mv) ** 2;
  }
  if (du < 1e-6 && dv < 1e-6) return 1;
  if (du < 1e-6 || dv < 1e-6) return 0;
  return Math.max(0, num / Math.sqrt(du * dv));
}

/** 1 − half the L1 distance between the two luminance histograms (32 bins) of the visible pixels. */
export function histogram(a: Luma, b: Luma, bins = 32): number {
  const ha = new Float64Array(bins);
  const hb = new Float64Array(bins);
  let n = 0;
  for (let i = 0; i < a.l.length; i++) {
    if (a.mask[i]) continue;
    ha[Math.min(bins - 1, Math.floor((a.l[i] / 256) * bins))]++;
    hb[Math.min(bins - 1, Math.floor((b.l[i] / 256) * bins))]++;
    n++;
  }
  if (!n) return 0;
  let d = 0;
  for (let i = 0; i < bins; i++) d += Math.abs(ha[i] - hb[i]) / n;
  return 1 - d / 2;
}

/** The canvas score of two same-sized luminance images sharing a mask (a's mask is used). */
export function canvasScore(a: Luma, b: Luma, region: CanvasScore['region'] = { x: 0, y: 0, w: a.w, h: a.h }): CanvasScore {
  const bm: Luma = { ...b, mask: a.mask };
  const a1 = half(a);
  const b1 = half(bm);
  const a2 = half(a1);
  const b2 = half({ ...b1, mask: a1.mask });
  const ssimFine = ssim(a, bm);
  const ssimMid = ssim(a1, { ...b1, mask: a1.mask });
  const ssimCoarse = ssim(a2, { ...b2, mask: a2.mask });
  const s = (ssimFine + ssimMid + ssimCoarse) / 3;
  const edges = correlation(sobel(a1), sobel(b1), grow(a1.mask, a1.w, a1.h));
  const hist = histogram(a, bm);
  let hidden = 0;
  for (const v of a.mask) hidden += v;
  return {
    score: 0.6 * s + 0.2 * edges + 0.2 * hist,
    ssim: s,
    ssimFine,
    ssimMid,
    ssimCoarse,
    edges,
    histogram: hist,
    masked: hidden / a.mask.length,
    region,
    size: { w: a.w, h: a.h },
  };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A region of a screenshot as luminance at `width` pixels wide, with the given boxes (page pixels) hidden. */
export async function regionLuma(page: Page, png: string, region: Box, hide: Box[], viewportWidth: number, width = 320): Promise<Luma> {
  await page.evaluate(NAME_SHIM);
  const r = (await page.evaluate(
    async ([src, region, hide, vw, W]) => {
      const im = new Image();
      await new Promise((res, rej) => {
        im.onload = res;
        im.onerror = () => rej(new Error('image did not load'));
        im.src = src;
      });
      const k = im.width / vw; // screenshot pixels per page pixel
      const H = Math.max(8, Math.round((W * region.h) / Math.max(1, region.w)));
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(im, region.x * k, region.y * k, region.w * k, region.h * k, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      const l: number[] = new Array(W * H);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) l[j] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const mask: number[] = new Array(W * H).fill(0);
      const sx = W / region.w;
      const sy = H / region.h;
      for (const b of hide) {
        const pad = 6;
        const x0 = Math.max(0, Math.floor((b.x - pad - region.x) * sx));
        const y0 = Math.max(0, Math.floor((b.y - pad - region.y) * sy));
        const x1 = Math.min(W, Math.ceil((b.x + b.w + pad - region.x) * sx));
        const y1 = Math.min(H, Math.ceil((b.y + b.h + pad - region.y) * sy));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 1;
      }
      return { w: W, h: H, l, mask };
    },
    [png, region, hide, viewportWidth, width] as const,
  )) as { w: number; h: number; l: number[]; mask: number[] };
  return { w: r.w, h: r.h, l: Float64Array.from(r.l), mask: Uint8Array.from(r.mask) };
}

/**
 * The canvas-only score of a rebuild against the original: the canvas region of both screenshots, text boxes hidden.
 * With no canvas on the page there is nothing to score (null).
 */
export async function compareCanvas(
  page: Page,
  original: string,
  rebuild: string,
  canvas: Box | null | undefined,
  text: Box[],
  viewport: { width: number; height: number },
): Promise<CanvasScore | null> {
  if (!canvas || canvas.w < 16 || canvas.h < 16) return null;
  const region = {
    x: Math.max(0, canvas.x),
    y: Math.max(0, canvas.y),
    w: Math.min(viewport.width, canvas.x + canvas.w) - Math.max(0, canvas.x),
    h: Math.min(viewport.height, canvas.y + canvas.h) - Math.max(0, canvas.y),
  };
  if (region.w < 16 || region.h < 16) return null;
  const a = await regionLuma(page, original, region, text, viewport.width);
  const b = await regionLuma(page, rebuild, region, [], viewport.width);
  return canvasScore(a, b, region);
}

const p = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** One line: "canvas 41.2% (SSIM 38.0%, edges 30.1%, tones 72.4%)". */
export function canvasLine(s: CanvasScore | null | undefined): string {
  if (!s) return 'canvas: no canvas on the first screen';
  return `canvas ${p(s.score)} (SSIM ${p(s.ssim)}, edges ${p(s.edges)}, tones ${p(s.histogram)}${s.masked > 0.01 ? `, ${p(s.masked)} hidden under text` : ''})`;
}

/** A data URL for an image file on disk. */
async function dataUrl(path: string): Promise<string> {
  const mime = /\.jpe?g$/i.test(extname(path)) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${(await readFile(path)).toString('base64')}`;
}

export interface ScoreFilesResult {
  page: Similarity;
  canvas: CanvasScore | null;
}

/**
 * Both scores for two screenshots on disk (`dea score`): the page score and, when a layout (layout.json from an extract,
 * or any {viewport, canvas, boxes}) names the canvas, the canvas-only score with the text boxes hidden.
 */
export async function scoreFiles(
  original: string,
  rebuild: string,
  opts: { layout?: { viewport?: { width: number; height: number }; canvas?: Box | null; boxes?: Box[] } | null; browser?: BrowserChoice } = {},
): Promise<ScoreFilesResult> {
  const { browser } = await launchBrowser(opts.browser ?? 'auto', true);
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    const a = await dataUrl(original);
    const b = await dataUrl(rebuild);
    const sim = await compareImages(page, a, b);
    const vp =
      opts.layout?.viewport ??
      (await page.evaluate(async (src) => {
        const im = new Image();
        im.src = src;
        await im.decode();
        return { width: im.width, height: im.height };
      }, a));
    const canvasBox = opts.layout ? (opts.layout.canvas ?? { x: 0, y: 0, w: vp.width, h: vp.height }) : { x: 0, y: 0, w: vp.width, h: vp.height };
    const canvas = await compareCanvas(page, a, b, canvasBox, opts.layout?.boxes ?? [], vp);
    return { page: sim, canvas };
  } finally {
    await releaseBrowser(browser);
  }
}
