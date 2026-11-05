// Read the whole page, not only the first screen: scroll a fresh load a stop at a time, wait for each stop to settle, read the
// elements in view and take a screenshot, then merge the stops (pagelayer.ts) into one document.

import type { Browser, Page } from 'playwright';
import { installObservers } from '../browser/open.ts';
import { alignToReference } from '../browser/phase.ts';
import { settleScene, thumbOfImage } from '../browser/settle.ts';
import { assertNotBotWall } from '../browser/wall.ts';
import { cacheKey, currentCache } from '../cache.ts';
import { budgetLeftMs, overBudget } from '../timings.ts';
import type { HeroLayout } from './generate.ts';
import { mergeStops, type PageLayer, type StopRead } from './pagelayer.ts';
import { LAYOUT_READ } from './preview.ts';

export interface FullPageOptions {
  section?: string | null;
  /** most stops read (default 48) */
  maxStops?: number;
  /** most scroll covered (px, default 40 000) */
  maxExtent?: number;
  /** longest total time for the read (ms, default 240 000) */
  timeMs?: number;
  /** wait for the first screen to settle (ms cap, default 30 000) */
  settleMs?: number;
  /** a screenshot of the window at each stop (JPEG), kept for the per-stop score */
  shots?: boolean;
  /** the original's reference first screen (a PNG data URL): the read starts once the fresh load shows it, not a loading screen */
  reference?: string | null;
  /** longest wait for the reference picture (ms, default 60 000) */
  alignMs?: number;
  onProgress?: (s: string) => void;
}

export interface FullPageResult {
  layer: PageLayer;
  /** JPEG screenshots of the window at each stop, in order (same length as layer.stops when requested) */
  shots: Buffer[];
  /** how the first screen settled before the read began */
  settled: { stable: boolean; ms: number; timeDriven: boolean };
}

type Read = Pick<HeroLayout, 'boxes' | 'shapes' | 'graphics' | 'background'> & { viewport?: { width: number; height: number } };

/**
 * Images that are in view and still loading, and a moment for lazy content: the stop waits for pictures in the window to finish
 * (up to 2.5 s) and for the DOM to stop growing, so a "lazy" section is read with its content.
 */
async function settleStop(page: Page, extraMs: number): Promise<void> {
  await page
    .evaluate(
      `new Promise((res) => {
        const t = setTimeout(res, 2500);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const imgs = [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && !i.complete; });
          if (!imgs.length) { clearTimeout(t); res(); return; }
          let n = imgs.length;
          const done = () => { if (--n <= 0) { clearTimeout(t); res(); } };
          imgs.forEach((i) => { i.addEventListener('load', done, { once: true }); i.addEventListener('error', done, { once: true }); });
        }));
      })`,
    )
    .catch(() => {});
  await page.waitForTimeout(extraMs);
}

const cacheKeyOf = (url: string, vp: { width: number; height: number }, o: FullPageOptions) => ({
  url,
  vp,
  section: o.section ?? null,
  v: 6,
  shots: Boolean(o.shots),
  ref: Boolean(o.reference),
  maxStops: o.maxStops ?? 120,
  maxExtent: o.maxExtent ?? 100_000,
});

/** Read the page at a series of scroll stops on a fresh load. Null when the page does not scroll or nothing could be read. */
export async function readFullPage(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  o: FullPageOptions = {},
): Promise<FullPageResult | null> {
  const say = (s: string) => o.onProgress?.(s);
  const cache = currentCache();
  const key = cacheKey('fullpage', JSON.stringify(cacheKeyOf(url, viewport, o)));
  if (cache) {
    const hit = await cache.get('fullpage', key).catch(() => null);
    if (hit) {
      try {
        const { readFile } = await import('node:fs/promises');
        const layer = JSON.parse(await readFile(`${hit}/layer.json`, 'utf8')) as PageLayer;
        say('reusing the whole-page read from the cache (--no-cache takes it again)');
        const shots: Buffer[] = [];
        const { existsSync } = await import('node:fs');
        if (o.shots) for (let i = 0; existsSync(`${hit}/shot-${i}.jpg`); i++) shots.push(await readFile(`${hit}/shot-${i}.jpg`));
        if (o.shots && shots.length !== layer.stops.length) throw new Error('the cached stops have no screenshots');
        return { layer, shots, settled: { stable: true, ms: 0, timeDriven: false } };
      } catch {
        /* a damaged entry: read again */
      }
    }
  }
  const started = Date.now();
  const ceilingMs = Math.min(900_000, Math.max(30_000, budgetLeftMs()));
  const timeMs = Math.min(o.timeMs ?? 240_000, ceilingMs);
  const context = await browser.newContext({ viewport });
  await cache?.attach(context);
  await installObservers(context, true);
  const page = await context.newPage();
  const limits: string[] = [];
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => null);
    await assertNotBotWall(page, resp);
    let settled: Awaited<ReturnType<typeof settleScene>>;
    if (o.reference) {
      // a stable picture is not always the site: a loading screen is stable too, so the read waits for the reference picture
      const refThumb = await thumbOfImage(page, o.reference);
      const al = await alignToReference(page, refThumb, { capMs: o.alignMs ?? 60_000 });
      settled = al.settle;
      say(`first screen: ${al.note}; reading the whole page`);
      if (al.aligned === false)
        limits.push('the fresh load never showed the reference first screen (a loading screen or another phase): stops may differ from the original by that');
    } else {
      settled = await settleScene(page, { capMs: o.settleMs ?? 30_000 });
      say(
        `first screen ${settled.stable ? 'stable' : settled.timeDriven ? 'still moving (time-driven)' : 'still changing'} after ${Math.round(settled.ms / 1000)} s; reading the whole page`,
      );
    }
    const H = viewport.height;
    const step = Math.round(H * 0.8);
    const read = async (): Promise<(Read & { s: number; docHeight: number }) | null> => {
      const r = (await page.evaluate(LAYOUT_READ(o.section ?? null, { page: true })).catch(() => null)) as Read | null;
      if (!r) return null;
      const info = (await page
        .evaluate('({ s: Math.round(window.scrollY), h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) })')
        .catch(() => ({ s: 0, h: H }))) as { s: number; h: number };
      return { ...r, s: info.s, docHeight: info.h };
    };
    // does the page scroll by itself? scroll by a screen and see where the window ended up
    await page.evaluate(`window.scrollTo(0, ${H})`).catch(() => {});
    await page.waitForTimeout(400);
    const probe = (await page.evaluate('Math.round(window.scrollY)').catch(() => 0)) as number;
    await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
    const mechanism: 'native' | 'wheel' = probe >= Math.min(H * 0.3, 200) ? 'native' : 'wheel';
    let ratio: number | null = null;
    // how far one px of wheel moves a page that scrolls natively (a smooth-scroll library eases and may scale it)
    let wheelRatio: number | null = null;
    if (mechanism === 'native') {
      await page.mouse.move(viewport.width / 2, H / 2).catch(() => {});
      await page.mouse.wheel(0, 400).catch(() => {});
      await page.waitForTimeout(2200);
      const moved = (await page.evaluate('Math.round(window.scrollY)').catch(() => 0)) as number;
      if (moved > 20) wheelRatio = moved / 400;
      await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
      await page.waitForTimeout(400);
    }
    const reads: StopRead[] = [];
    const shots: Buffer[] = [];
    const shoot = async () => {
      if (o.shots) shots.push(await page.screenshot({ type: 'jpeg', quality: 72 }).catch(() => Buffer.alloc(0)));
    };
    const maxStops = o.maxStops ?? 120;
    const maxExtent = o.maxExtent ?? 100_000;
    if (mechanism === 'native') {
      let y = 0;
      for (let i = 0; i < maxStops; i++) {
        await page.evaluate(`window.scrollTo(0, ${y})`).catch(() => {});
        await settleStop(page, i === 0 ? 300 : 650);
        const r = await read();
        if (!r) break;
        // the page's own answer: where it really is (a smooth-scroll library may not have arrived, a page may end sooner)
        const here = r.s;
        reads.push({ s: here, docHeight: r.docHeight, background: r.background, boxes: r.boxes, shapes: r.shapes, graphics: r.graphics });
        await shoot();
        const end = Math.max(0, r.docHeight - H);
        if (here >= end - 2 || y >= end || y >= maxExtent) {
          if (y >= maxExtent && end > maxExtent) limits.push(`the read stopped at ${maxExtent} px; the page goes on to ${r.docHeight} px`);
          break;
        }
        y = Math.min(y + step, end);
        if (i === maxStops - 1) limits.push(`the read stopped after ${maxStops} stops (${here} px of ${r.docHeight} px)`);
        // the time allowed follows the page: after a few stops the cost per stop is known, and a long page earns the time it needs
        // (up to the ceiling), so a page is read to its end or to a stated limit, not cut where a fixed clock happened to run out
        const perStop = (Date.now() - started) / (i + 1);
        const stopsLeft = Math.max(0, Math.ceil((Math.min(r.docHeight, maxExtent) - here) / step));
        const allowed = o.timeMs != null ? timeMs : Math.min(Math.max(timeMs, perStop * (i + 1 + stopsLeft) * 1.15), ceilingMs);
        if (Date.now() - started > allowed || overBudget()) {
          limits.push(`the read stopped at ${here} px of ${r.docHeight} px: the time allowed for it (${Math.round(allowed / 1000)} s) ran out`);
          break;
        }
      }
      await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
    } else {
      // a page that answers only the wheel (virtual scroll): the wheel moves it, and how far it moves it is measured below
      await page.mouse.move(viewport.width / 2, H / 2).catch(() => {});
      await page.mouse.wheel(0, -20_000).catch(() => {});
      await settleStop(page, 1500);
      const wheelStep = step;
      let total = 0;
      const raw: Array<{ w: number; r: Read & { docHeight: number } }> = [];
      for (let i = 0; i < Math.min(maxStops, 30); i++) {
        if (i > 0) {
          await page.mouse.wheel(0, wheelStep).catch(() => {});
          total += wheelStep;
          await settleStop(page, 1800);
        }
        const r = await read();
        if (!r) break;
        raw.push({ w: total, r });
        await shoot();
        if (raw.length >= 3) {
          // the end: three stops that read the same elements at the same places
          const sig = (x: Read) =>
            (x.boxes ?? [])
              .slice(0, 12)
              .map((b) => `${b.k}@${Math.round(b.y)}`)
              .join('|');
          const n = raw.length;
          if (
            sig((raw[n - 1] as { r: Read }).r) === sig((raw[n - 2] as { r: Read }).r) &&
            sig((raw[n - 2] as { r: Read }).r) === sig((raw[n - 3] as { r: Read }).r)
          ) {
            raw.splice(n - 2, 2);
            shots.splice(n - 2, 2);
            break;
          }
        }
        if (Date.now() - started > timeMs || overBudget()) {
          limits.push('the wheel read stopped: the time allowed for it ran out');
          break;
        }
      }
      // page px per wheel px: the median over elements read at two consecutive stops that moved up by the same amount
      const ratios: number[] = [];
      for (let i = 1; i < raw.length; i++) {
        const a = new Map((raw[i - 1] as (typeof raw)[number]).r.boxes.filter((b) => b.k).map((b) => [b.k as string, b]));
        const dw = (raw[i] as (typeof raw)[number]).w - (raw[i - 1] as (typeof raw)[number]).w;
        for (const b of (raw[i] as (typeof raw)[number]).r.boxes) {
          const p = b.k ? a.get(b.k) : undefined;
          if (p && dw > 0 && p.y - b.y > 5 && Math.abs(p.x - b.x) < 3) ratios.push((p.y - b.y) / dw);
        }
      }
      ratios.sort((a, b) => a - b);
      ratio = ratios.length >= 3 ? (ratios[Math.floor(ratios.length / 2)] as number) : null;
      if (ratio == null) {
        limits.push('the page answers the wheel but nothing could be matched between stops, so the distance per wheel step is unknown: no page layer');
        return null;
      }
      for (const x of raw)
        reads.push({
          s: Math.round(x.w * ratio),
          docHeight: Math.round(x.w * ratio + H),
          background: x.r.background,
          boxes: x.r.boxes,
          shapes: x.r.shapes,
          graphics: x.r.graphics,
        });
      limits.push(`virtual scroll: the kit scrolls natively; one wheel step moves the original ${Math.round(ratio * 100) / 100} px per px (measured)`);
      await page.mouse.wheel(0, -20_000).catch(() => {});
    }
    if (reads.length < 2) return null;
    const layer = mergeStops(reads, viewport, {
      mechanism: mechanism === 'native' ? 'native' : 'wheel',
      ratio,
      wheelRatio: mechanism === 'native' ? wheelRatio : ratio,
      limits,
    });
    say(
      `whole page read: ${layer.stops.length} stops over ${layer.extent} px of ${layer.documentHeight} px, ${layer.boxes.length} text blocks, ${layer.shapes.length} shapes, ${layer.graphics.length} graphics (${layer.counts.static} static, ${layer.counts.fixed} fixed, ${layer.counts.moving} moving)`,
    );
    if (cache) {
      const files: Record<string, string | Uint8Array> = { 'layer.json': JSON.stringify(layer) };
      shots.forEach((b, i) => {
        files[`shot-${i}.jpg`] = b;
      });
      await cache.put('fullpage', key, { url, made: new Date().toISOString() }, files).catch(() => {});
    }
    return { layer, shots, settled: { stable: settled.stable, ms: settled.ms, timeDriven: settled.timeDriven } };
  } finally {
    await context.close().catch(() => {});
  }
}

export interface StopScore {
  /** scroll position (px) of the stop */
  y: number;
  /** page similarity per kit view, 0..1 (null when it could not be taken) */
  scores: Record<string, number | null>;
}

export interface PageStopsResult {
  stops: StopScore[];
  /** mean per kit view */
  mean: Record<string, number | null>;
  /** the kit's screenshots per view (JPEG), in stop order */
  kitShots: Record<string, Buffer[]>;
  seconds: number;
}

/**
 * Score the kit at every scroll stop: open the preview, scroll to the stop's position, wait for it to settle and compare a
 * window screenshot with the original's at the same stop (the same 96 × 60 page score the first screen uses). `views` are the
 * kit views to score: '' is the page kit as shipped, '__replay' and '__rebuild' the canvas programs, each scored by itself.
 */
export async function scorePageStops(
  browser: Browser,
  base: string,
  views: string[],
  stops: Array<{ y: number }>,
  shots: Buffer[],
  viewport: { width: number; height: number },
  cmp: Page,
  params: Record<string, unknown>,
  compare: (page: Page, a: string, b: string) => Promise<{ similarity: number }>,
  maxStops = 16,
): Promise<PageStopsResult> {
  const t0 = Date.now();
  // every stop for a DOM page; an even sample of at most `maxStops` where the canvas has to be drawn at each
  const pick = (n: number) =>
    n <= maxStops ? [...Array(n).keys()] : [...new Set([...Array(maxStops).keys()].map((i) => Math.round((i * (n - 1)) / (maxStops - 1))))];
  const out: PageStopsResult = { stops: stops.map((s) => ({ y: s.y, scores: {} })), mean: {}, kitShots: {}, seconds: 0 };
  for (const view of views) {
    const page = await browser.newPage({ viewport });
    const idx = view ? pick(stops.length) : [...Array(stops.length).keys()];
    const kit: Buffer[] = [];
    try {
      const p = view ? { ...params, program: view, live: true } : { ...params };
      await page.goto(`${base}/preview/index.html#${encodeURIComponent(JSON.stringify(p))}`, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction('window.__deaReady === true', undefined, { timeout: 120_000 }).catch(() => {});
      for (const i of idx) {
        const y = stops[i]?.y ?? 0;
        await page.evaluate(`window.scrollTo(0, ${y})`).catch(() => {});
        await page.waitForTimeout(view ? 3500 : 500);
        const buf = await page.screenshot({ type: 'jpeg', quality: 72 }).catch(() => null);
        const orig = shots[i];
        if (!buf || !orig?.length) {
          (out.stops[i] as StopScore).scores[view || 'kit'] = null;
          kit[i] = Buffer.alloc(0);
          continue;
        }
        kit[i] = buf;
        const sc = await compare(cmp, `data:image/jpeg;base64,${orig.toString('base64')}`, `data:image/jpeg;base64,${buf.toString('base64')}`).catch(
          () => null,
        );
        (out.stops[i] as StopScore).scores[view || 'kit'] = sc ? Math.round(sc.similarity * 1000) / 1000 : null;
      }
    } finally {
      await page.close().catch(() => {});
    }
    const vals = idx.map((i) => (out.stops[i] as StopScore).scores[view || 'kit']).filter((v): v is number => typeof v === 'number');
    out.mean[view || 'kit'] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000 : null;
    out.kitShots[view || 'kit'] = kit;
  }
  out.seconds = Math.round((Date.now() - t0) / 1000);
  return out;
}

/** A contact sheet: a row per source (the original, then each kit view), a column per stop, as one JPEG under `maxBytes`. */
export async function stopsSheet(
  scratch: Page,
  rows: Array<{ label: string; frames: Buffer[] }>,
  labels: string[],
  columns: number[],
  maxBytes = 900_000,
): Promise<Buffer> {
  let quality = 0.8;
  const cols = columns.slice(0, 8);
  for (let tries = 0; tries < 7; tries++) {
    const url = (await scratch.evaluate(
      async ([rws, names, q]) => {
        const cw = 230;
        const pad = 5;
        const head = 20;
        const left = 70;
        const imgs = await Promise.all(
          rws.map((r) => Promise.all(r.frames.map(async (u) => (u ? createImageBitmap(await (await fetch(u)).blob()).catch(() => null) : null)))),
        );
        const first = imgs.flat().find(Boolean) as ImageBitmap | undefined;
        const ch = first ? Math.round((first.height / first.width) * cw) : 144;
        const c = document.createElement('canvas');
        c.width = left + names.length * (cw + pad);
        c.height = head + rws.length * (ch + pad);
        const x = c.getContext('2d') as CanvasRenderingContext2D;
        x.fillStyle = '#111';
        x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = '#eee';
        x.font = '12px sans-serif';
        for (const [i, n] of names.entries()) x.fillText(n, left + i * (cw + pad) + 3, 14);
        for (const [j, r] of rws.entries()) {
          x.fillText(r.label, 4, head + j * (ch + pad) + ch / 2);
          for (const [i, im] of imgs[j].entries()) if (im) x.drawImage(im, left + i * (cw + pad), head + j * (ch + pad), cw, ch);
        }
        return c.toDataURL('image/jpeg', q);
      },
      [
        rows.map((r) => ({
          label: r.label,
          frames: cols.map((i) => (r.frames[i]?.length ? `data:image/jpeg;base64,${r.frames[i]?.toString('base64')}` : '')),
        })),
        cols.map((i) => labels[i] ?? String(i)),
        quality,
      ] as const,
    )) as string;
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    if (buf.length <= maxBytes || quality < 0.3) return buf;
    quality -= 0.12;
  }
  throw new Error('unreachable');
}

/** extract.md section for the whole-page read. */
export function pageStopsMd(layer: PageLayer, r: PageStopsResult | null): string {
  const views = r ? Object.keys(r.mean) : [];
  const name = (v: string) => (v === 'kit' ? 'kit' : v.replace('__', ''));
  const pct = (x: number | null | undefined) => (x == null ? 'n/a' : `${Math.round(x * 1000) / 10}%`);
  const lines = [
    '## The whole page',
    '',
    `✔ Verified: DEA read the page on a fresh load at ${layer.stops.length} scroll stops (${layer.mechanism} scroll, ${layer.extent} px of ${layer.documentHeight} px) and the kit lays all of it out again in document coordinates: ${layer.boxes.length} text blocks, ${layer.shapes.length} shapes, ${layer.graphics.length} graphics (${layer.counts.static} static, ${layer.counts.fixed} fixed to the window, ${layer.counts.moving} moving against the page).`,
    '',
    r
      ? `Kit against the original's screenshot at each stop (page similarity, colour + light layout + edges at 96 × 60), mean: ${views.map((v) => `${name(v)} ${pct(r.mean[v])}`).join(', ')}. \`preview/page-stops.jpg\` shows original and kit at the stops.`
      : 'The kit was not scored per stop in this run.',
    '',
  ];
  if (r) {
    lines.push(`| scroll px | new on screen | ${views.map(name).join(' | ')} |`, `|---|---|${views.map(() => '---').join('|')}|`);
    layer.stops.forEach((s, i) => {
      lines.push(`| ${s.y} | ${Math.round(s.fresh * 100)}% | ${views.map((v) => pct(r.stops[i]?.scores[v === '' ? 'kit' : v])).join(' | ')} |`);
    });
    lines.push('');
  }
  if (layer.limits.length) lines.push('Limits:', ...layer.limits.map((l) => `- ${l}`), '');
  lines.push(
    "≈ Inferred / not covered: elements are absolute boxes at the width read (not the site's flex or grid), so a different window width scales the page and does not reflow it; clicks, hovers, menus and route changes are not read; a section the site draws with a canvas or a script is only as good as the first-screen recording.",
    '',
  );
  return lines.join('\n');
}
