import type { Page } from 'playwright';

export interface ColorSample {
  css: string;
  weight: number;
  kind: 'text' | 'background' | 'border' | 'svg';
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
        sample: prev && prev.s.sample.length >= own.length ? prev.s.sample : own.slice(0, 80),
        selector: prev && prev.s.sample.length >= own.length ? prev.s.selector : sel(el),
        fontId: null,
      };
      byKey.set(key, { el: prev && prev.s.sample.length >= own.length ? prev.el : el, s });
    }
    const text = [...byKey.values()].sort((a, b) => b.s.chars - a.s.chars);
    for (const e of Array.from(document.querySelectorAll('[data-dea-font]'))) e.removeAttribute('data-dea-font');
    text.slice(0, 40).forEach((t, i) => {
      t.el.setAttribute('data-dea-font', String(i));
      t.s.fontId = i;
    });
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
    };
  });
}
