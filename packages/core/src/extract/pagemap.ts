// A page map for a page with no WebGL to record (a DOM page): the same stops and the same reading of the DOM, without frames.

import type { Browser } from 'playwright';
import { installObservers } from '../browser/open.ts';
import { STOP_DOM } from '../replay/capture.ts';
import { buildPageMap, type PageMapDoc, type ScrollTapeFit } from '../replay/scrolltape.ts';

interface Dom {
  scrollY: number;
  docHeight: number;
  viewport: [number, number];
  inView: Array<{ sel: string; heading: string; share: number }>;
  canvases: Array<{ sel: string; share: number }>;
}

/** Scroll a fresh load of the page by the wheel, a stop at a time, and read the sections and canvases in view. Null when the page does not scroll. */
export async function domPageMap(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  opts: { stops?: number; waitMs?: number } = {},
): Promise<PageMapDoc | null> {
  const context = await browser.newContext({ viewport });
  // the observers record every attachShadow, so a canvas inside a closed shadow root is still found
  await installObservers(context, true).catch(() => {});
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 }).catch(() => null);
    await page.waitForTimeout(opts.waitMs ?? 3000);
    const step = Math.round(viewport.height * 0.9); // a screen at a time: a DOM page has no scene to catch between screens
    const read = async () => (await page.evaluate(STOP_DOM).catch(() => null)) as Dom | null;
    const stops: Array<{ sc: number; f0: number; f1: number; dom: Dom }> = [];
    const top = await read();
    if (!top) return null;
    stops.push({ sc: 0, f0: 0, f1: 0, dom: top });
    for (let i = 1; i <= (opts.stops ?? 14); i++) {
      await page.mouse.wheel(0, step);
      await page.waitForTimeout(700);
      const dom = await read();
      if (!dom) break;
      if (dom.scrollY <= stops[stops.length - 1].sc + 1) break; // the end of the document
      stops.push({ sc: Math.round(dom.scrollY), f0: i, f1: i, dom });
    }
    const moved = stops.some((s) => s.sc >= Math.max(40, viewport.height * 0.2));
    if (!moved || stops.length < 3) return null;
    // stops are keyed by the page's own scroll; a page that stopped moving (the end of the document) repeats its last stop
    const seen = new Set<number>();
    const kept = stops.filter((s) => (seen.has(s.sc) ? false : (seen.add(s.sc), true)));
    const fit = {
      stops: kept.map((s) => ({ sc: s.sc, wh: s.sc, f0: s.f0, f1: s.f1, changed: 0, programs: [], draws: 0 })),
      aligned: true,
      uploadBuffers: 0,
      uploadFull: 0,
      k: 0.25,
      bytes: 0,
      ratio: 1,
    } as unknown as ScrollTapeFit;
    return buildPageMap(url, fit, { mechanism: 'native', stops: kept });
  } finally {
    await context.close().catch(() => {});
  }
}
