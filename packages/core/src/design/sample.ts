import type { Page } from 'playwright';

export interface ColorSample {
  css: string;
  weight: number;
  kind: 'text' | 'background' | 'border' | 'svg' | 'visible';
}

export interface TextSample {
  tag: string;
  family: string;
  stack: string;
  size: number;
  weight: string;
  style: string;
  lineHeight: number | null;
  letterSpacing: number | null;
  transform: string;
  chars: number;
  /** how many elements carry this style; many elements with 1–2 characters each = text split for animation */
  elements: number;
  sample: string;
  selector: string;
  fontId: number | null;
}

export interface StyleSample {
  colors: ColorSample[];
  gradients: Array<{ css: string; area: number; selector: string }>;
  text: TextSample[];
  rootVars: Record<string, string>;
  radii: Record<string, number>;
  shadows: Record<string, number>;
  viewport: { width: number; height: number };
  elementsScanned: number;
  /** what paints the first screen, from a 16×10 grid of points: canvas, video, image or a DOM background */
  coverage: { canvas: number; video: number; image: number; dom: number };
}

/**
 * One pass over computed styles. Tags up to 40 representative text elements with
 * data-dea-font so the font module can ask Chrome which real font drew them.
 */
export async function sampleStyles(page: Page): Promise<StyleSample> {
  return page.evaluate(() => {
    const MAX = 5000;
    const vw = innerWidth;
    const vh = innerHeight;
    const colors: ColorSample[] = [];
    const gradients: StyleSample['gradients'] = [];
    const radii: Record<string, number> = {};
    const shadows: Record<string, number> = {};
    const byKey = new Map<string, { el: Element; s: TextSample }>();
    const sel = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const cls = Array.from(el.classList)
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join('');
      return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 80);
    };
    const els = Array.from(document.querySelectorAll('body, body *')).slice(0, MAX);
    let scanned = 0;
    for (const el of els) {
      if (el instanceof HTMLScriptElement || el instanceof HTMLStyleElement || el.tagName === 'NOSCRIPT' || el.tagName === 'TEMPLATE') continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      scanned++;
      const opacity = Number(cs.opacity);
      // area counted only once per screen, so a 10-screen-tall wrapper does not drown everything
      const area = Math.min(r.width, vw) * Math.min(r.height, vh * 1.5);
      if (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) && opacity > 0.05) {
        colors.push({ css: cs.backgroundColor, weight: area, kind: 'background' });
      }
      if (cs.backgroundImage?.includes('gradient')) gradients.push({ css: cs.backgroundImage.slice(0, 300), area, selector: sel(el) });
      const bw =
        Number.parseFloat(cs.borderTopWidth) +
        Number.parseFloat(cs.borderBottomWidth) +
        Number.parseFloat(cs.borderLeftWidth) +
        Number.parseFloat(cs.borderRightWidth);
      if (bw > 0 && cs.borderStyle !== 'none') colors.push({ css: cs.borderTopColor, weight: (r.width + r.height) * 2, kind: 'border' });
      if (el instanceof SVGElement && el.tagName !== 'svg') {
        if (cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url')) colors.push({ css: cs.fill, weight: Math.min(area, 20000), kind: 'svg' });
        if (cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url')) colors.push({ css: cs.stroke, weight: 200, kind: 'svg' });
      }
      if (cs.borderRadius && cs.borderRadius !== '0px') radii[cs.borderRadius] = (radii[cs.borderRadius] ?? 0) + 1;
      if (cs.boxShadow && cs.boxShadow !== 'none') shadows[cs.boxShadow.slice(0, 160)] = (shadows[cs.boxShadow.slice(0, 160)] ?? 0) + 1;
      // own text only (direct text nodes)
      let own = '';
      for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) own += n.textContent ?? '';
      own = own.replace(/\s+/g, ' ').trim();
      if (!own || opacity < 0.05) continue;
      const chars = own.length;
      colors.push({ css: cs.color, weight: chars * Number.parseFloat(cs.fontSize), kind: 'text' });
      const size = Math.round(Number.parseFloat(cs.fontSize) * 100) / 100;
      const lh = cs.lineHeight === 'normal' ? null : Math.round((Number.parseFloat(cs.lineHeight) / size) * 100) / 100;
      const ls = cs.letterSpacing === 'normal' ? 0 : Math.round((Number.parseFloat(cs.letterSpacing) / size) * 1000) / 1000;
      const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const key = `${family}|${cs.fontWeight}|${cs.fontStyle}|${size}`;
      const prev = byKey.get(key);
      // a letter of split text says little; show the word or line it belongs to
      const shown = own.length <= 2 && el.parentElement ? (el.parentElement.textContent ?? '').replace(/\s+/g, ' ').trim() || own : own;
      const keepPrev = !!prev && prev.s.sample.length >= shown.length;
      const s: TextSample = {
        tag: el.tagName.toLowerCase(),
        family,
        stack: cs.fontFamily.slice(0, 200),
        size,
        weight: cs.fontWeight,
        style: cs.fontStyle,
        lineHeight: lh,
        letterSpacing: ls,
        transform: cs.textTransform,
        chars: (prev?.s.chars ?? 0) + chars,
        elements: (prev?.s.elements ?? 0) + 1,
        sample: keepPrev && prev ? prev.s.sample : shown.slice(0, 80),
        selector: keepPrev && prev ? prev.s.selector : sel(el),
        fontId: null,
      };
      byKey.set(key, { el: keepPrev && prev ? prev.el : el, s });
    }
    const text = [...byKey.values()].sort((a, b) => b.s.chars - a.s.chars);
    for (const e of Array.from(document.querySelectorAll('[data-dea-font]'))) e.removeAttribute('data-dea-font');
    text.slice(0, 40).forEach((t, i) => {
      t.el.setAttribute('data-dea-font', String(i));
      t.s.fontId = i;
    });
    // What is actually on top at each point of the first screen. pointer-events is forced on for a moment
    // because elementsFromPoint skips elements with pointer-events: none (common on full-screen canvases).
    const cover = { canvas: 0, video: 0, image: 0, dom: 0 };
    const force = document.createElement('style');
    force.textContent = '*{pointer-events:auto!important}';
    document.head.appendChild(force);
    const cell = (vw * vh) / 160;
    try {
      for (let gx = 0; gx < 16; gx++) {
        for (let gy = 0; gy < 10; gy++) {
          const x = ((gx + 0.5) / 16) * vw;
          const y = ((gy + 0.5) / 10) * vh;
          let hit = false;
          for (const el of document.elementsFromPoint(x, y)) {
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue;
            const tag = el.tagName;
            if (tag === 'CANVAS') cover.canvas++;
            else if (tag === 'VIDEO') cover.video++;
            else if (tag === 'IMG' || tag === 'PICTURE' || /url\(/.test(cs.backgroundImage)) cover.image++;
            else if (cs.backgroundColor && !/rgba\(\d+, \d+, \d+, 0(\.0\d*)?\)|transparent/.test(cs.backgroundColor)) {
              cover.dom++;
              colors.push({ css: cs.backgroundColor, weight: cell, kind: 'visible' });
            } else continue;
            hit = true;
            break;
          }
          if (!hit) {
            cover.dom++;
            colors.push({ css: 'rgb(255, 255, 255)', weight: cell, kind: 'visible' }); // the browser's default canvas colour
          }
        }
      }
    } finally {
      force.remove();
    }
    const rootVars: Record<string, string> = {};
    const rcs = getComputedStyle(document.documentElement);
    for (let i = 0; i < rcs.length; i++) {
      const name = rcs[i];
      if (name.startsWith('--')) rootVars[name] = rcs.getPropertyValue(name).trim().slice(0, 200);
    }
    return {
      colors,
      gradients: gradients.sort((a, b) => b.area - a.area).slice(0, 12),
      text: text.map((t) => t.s),
      rootVars,
      radii,
      shadows,
      viewport: { width: vw, height: vh },
      elementsScanned: scanned,
      coverage: { canvas: cover.canvas / 160, video: cover.video / 160, image: cover.image / 160, dom: cover.dom / 160 },
    };
  });
}
