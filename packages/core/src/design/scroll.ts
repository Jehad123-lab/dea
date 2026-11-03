import type { Page } from 'playwright';
import type { RunWriter } from '../evidence/run.ts';

export interface FramePixels {
  file: string;
  buckets: Array<[number, number, number, number]>;
  diff: number | null;
  brightness: number;
}

export interface ScrollStep {
  i: number;
  scrollY: number;
  visualChange: number | null;
  file: string;
}

export interface ScrollResult {
  mode:
    | 'native'
    | 'smooth (JavaScript)'
    | 'custom (wheel drives the scene, page does not scroll)'
    | 'does not scroll'
    | 'unknown (not sampled: this machine rendered too slowly)';
  settleMs: number | null;
  intermediateFrames: number;
  documentHeight: number;
  viewportHeight: number;
  screens: number;
  steps: ScrollStep[];
  fixed: string[];
  hero: { moves: boolean; change: number | null; files: string[] };
  frames: FramePixels[];
  truncated: boolean;
  /** screenshots that could not be taken (very slow rendering) */
  misses: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, writer: RunWriter, name: string, misses: string[]): Promise<{ file: string; b64: string } | null> {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 60, animations: 'allow', timeout: 30_000 });
    const file = `frames/${name}.jpg`;
    await writer.bytes(file, buf);
    return { file, b64: buf.toString('base64') };
  } catch (e) {
    // a page that renders very slowly (heavy WebGL on a machine without a GPU) may never produce a frame in time
    misses.push(`${name}: ${(e as Error).message.split('\n')[0]}`);
    return null;
  }
}

/** Decode frames in a scratch tab: colour buckets for the screen palette, and how much changed between frames. */
async function analyse(page: Page, frames: Array<{ file: string; b64: string }>): Promise<FramePixels[]> {
  const scratch = await page.context().newPage();
  try {
    await scratch.setContent('<canvas id=c></canvas>');
    return await scratch.evaluate(async (list) => {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      let prev: Uint8ClampedArray | null = null;
      const out: FramePixels[] = [];
      for (const f of list) {
        const blob = await (await fetch(`data:image/jpeg;base64,${f.b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const W = 120;
        const H = Math.max(1, Math.round((bmp.height / bmp.width) * W));
        c.width = W;
        c.height = H;
        ctx.drawImage(bmp, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const buckets = new Map<number, [number, number, number, number]>();
        let lum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
          const b = buckets.get(k) ?? [0, 0, 0, 0];
          b[0] += d[i];
          b[1] += d[i + 1];
          b[2] += d[i + 2];
          b[3]++;
          buckets.set(k, b);
          lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        }
        let diff: number | null = null;
        if (prev && prev.length === d.length) {
          let s = 0;
          for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]);
          diff = Math.round((s / (d.length * 0.75)) * 100) / 100;
        }
        prev = d;
        out.push({
          file: f.file,
          buckets: [...buckets.values()]
            .sort((a, b) => b[3] - a[3])
            .slice(0, 32)
            .map((b) => [Math.round(b[0] / b[3]), Math.round(b[1] / b[3]), Math.round(b[2] / b[3]), b[3]] as [number, number, number, number]),
          diff,
          brightness: Math.round(lum / (d.length / 4)),
        });
      }
      return out;
    }, frames);
  } finally {
    await scratch.close().catch(() => {});
  }
}

/** Watch the hero for a moment, then scroll down step by step with the mouse wheel (so smooth-scroll libraries react). */
export async function sampleScroll(page: Page, writer: RunWriter, opts: { steps?: number; heroMs?: number; budgetMs?: number } = {}): Promise<ScrollResult> {
  const started = Date.now();
  let truncated = false;
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  await page.mouse.move(vp.width / 2, vp.height / 2);
  const misses: string[] = [];
  const hero: Array<{ file: string; b64: string }> = [];
  for (let i = 0; i < 3; i++) {
    const s = await shot(page, writer, `hero-${i}`, misses);
    if (!s) break;
    hero.push(s);
    if (i < 2) await sleep((opts.heroMs ?? 1200) / 2);
  }
  const canShoot = hero.length > 0;
  // one wheel tick, watch scrollY every frame to see how the page answers it
  const [timeline] = await Promise.all([
    page.evaluate(
      () =>
        new Promise<Array<[number, number]>>((done) => {
          const t0 = performance.now();
          const rows: Array<[number, number]> = [];
          const tick = () => {
            rows.push([Math.round(performance.now() - t0), Math.round(scrollY)]);
            if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
            else done(rows);
          };
          requestAnimationFrame(tick);
          setTimeout(() => done(rows), 4000);
        }),
    ),
    (async () => {
      await sleep(60);
      await page.mouse.wheel(0, Math.round(vp.height * 0.6));
    })(),
  ]);
  const ys = timeline.map((r) => r[1]);
  const startY = ys[0] ?? 0;
  const endY = ys[ys.length - 1] ?? 0;
  const firstMove = timeline.find((r) => r[1] !== startY);
  const settle = [...timeline].reverse().find((r) => Math.abs(r[1] - endY) > 1);
  const intermediate = new Set(ys.filter((y) => y !== startY && y !== endY)).size;
  const settleMs = firstMove && settle ? Math.max(0, settle[0] - firstMove[0]) : firstMove ? 0 : null;

  const steps: ScrollStep[] = [];
  const scrollShots: Array<{ file: string; b64: string }> = [];
  const first = canShoot ? await shot(page, writer, 'scroll-00', misses) : null;
  if (first) scrollShots.push(first);
  steps.push({ i: 0, scrollY: await page.evaluate(() => Math.round(scrollY)), visualChange: null, file: first?.file ?? '' });
  const n = opts.steps ?? 7;
  for (let i = 1; i <= n; i++) {
    if (Date.now() - started > (opts.budgetMs ?? 90_000)) {
      truncated = true;
      break;
    }
    await page.mouse.wheel(0, Math.round(vp.height * 0.85));
    await sleep(900);
    const s = canShoot && first ? await shot(page, writer, `scroll-${String(i).padStart(2, '0')}`, misses) : null;
    if (s) scrollShots.push(s);
    steps.push({ i, scrollY: await page.evaluate(() => Math.round(scrollY)), visualChange: null, file: s?.file ?? '' });
  }
  const info = await page.evaluate(() => {
    const sel = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${Array.from(el.classList)
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join('')}`.slice(0, 80);
    const fixed = Array.from(document.querySelectorAll('body *'))
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 10 && cs.display !== 'none' && cs.visibility !== 'hidden';
      })
      .slice(0, 12)
      .map((el) => `${sel(el)} (${getComputedStyle(el).position})`);
    return { fixed, docH: document.documentElement.scrollHeight, vh: innerHeight };
  });
  const heroPx = hero.length ? await analyse(page, hero) : [];
  const scrollPx = scrollShots.length ? await analyse(page, scrollShots) : [];
  for (const p of scrollPx) {
    const step = steps.find((x) => x.file === p.file);
    if (step) step.visualChange = p.diff;
  }
  const heroChange = heroPx.slice(1).reduce((m, p) => Math.max(m, p.diff ?? 0), 0);
  const moved = steps.some((s) => s.scrollY > 0);
  const visual = scrollPx.slice(1).some((p) => (p.diff ?? 0) > 3);
  let mode: ScrollResult['mode'];
  if (steps.length < 2) mode = 'unknown (not sampled: this machine rendered too slowly)';
  else if (!moved && visual) mode = 'custom (wheel drives the scene, page does not scroll)';
  else if (!moved) mode = 'does not scroll';
  else if (settleMs !== null && settleMs > 160 && intermediate >= 4) mode = 'smooth (JavaScript)';
  else mode = 'native';
  return {
    mode,
    settleMs,
    intermediateFrames: intermediate,
    documentHeight: info.docH,
    viewportHeight: info.vh,
    screens: Math.round((info.docH / info.vh) * 10) / 10,
    steps,
    fixed: info.fixed,
    hero: { moves: heroChange > 1.5, change: heroChange, files: hero.map((h) => h.file) },
    frames: [...heroPx, ...scrollPx],
    truncated,
    misses,
  };
}
