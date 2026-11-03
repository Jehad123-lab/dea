/**
 * Read design facts straight out of stylesheet text: @font-face, custom properties,
 * transitions, easing curves, keyframes, breakpoints and fluid type.
 * Regex-based on purpose (no CSS parser dependency); good enough for evidence, not for rewriting CSS.
 */
import type { SheetText } from './cdp.ts';

export interface FontFaceRule {
  family: string;
  weight: string;
  style: string;
  display: string;
  urls: string[];
  sheet: string;
}

export interface CssFacts {
  fontFaces: FontFaceRule[];
  customProps: Record<string, string>;
  transitions: Array<{ value: string; count: number }>;
  durations: Array<{ ms: number; count: number }>;
  easings: Array<{ value: string; count: number }>;
  keyframes: string[];
  breakpoints: Array<{ px: number; count: number }>;
  fluidType: Array<{ value: string; selector: string }>;
  sheets: number;
  bytes: number;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function inc(map: Map<string, number>, k: string, n = 1) {
  map.set(k, (map.get(k) ?? 0) + n);
}

export function toMs(v: string): number | null {
  const m = v.trim().match(/^(-?[\d.]+)(ms|s)$/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === 's' ? 1000 : 1));
}

export function readCss(sheets: SheetText[]): CssFacts {
  const fontFaces: FontFaceRule[] = [];
  const customProps: Record<string, string> = {};
  const transitions = new Map<string, number>();
  const durations = new Map<string, number>();
  const easings = new Map<string, number>();
  const keyframes = new Set<string>();
  const breakpoints = new Map<string, number>();
  const fluidType: CssFacts['fluidType'] = [];
  let bytes = 0;

  for (const sh of sheets) {
    const css = strip(sh.text);
    bytes += sh.text.length;
    for (const m of css.matchAll(/@font-face\s*{([^}]*)}/gi)) {
      const body = m[1];
      const get = (p: string) => body.match(new RegExp(`${p}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim() ?? '';
      const urls = [...body.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((u) => {
        try {
          return new URL(u[1], sh.url.startsWith('http') ? sh.url : undefined).toString();
        } catch {
          return u[1];
        }
      });
      fontFaces.push({
        family: get('font-family').replace(/["']/g, ''),
        weight: get('font-weight') || '400',
        style: get('font-style') || 'normal',
        display: get('font-display'),
        urls,
        sheet: sh.url,
      });
    }
    for (const m of css.matchAll(/(^|[},;\s])(:root|html|body|\[data-theme[^\]]*\]|\.dark|\.light)[^{]*{([^}]*)}/g)) {
      for (const d of m[3].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) if (!(d[1] in customProps)) customProps[d[1]] = d[2].trim().slice(0, 200);
    }
    for (const m of css.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/gi)) {
      const v = m[1].trim();
      if (v === 'none' || v.startsWith('var(')) continue;
      inc(transitions, v.slice(0, 160));
    }
    for (const m of css.matchAll(/(?:transition|animation)(?:-duration)?\s*:\s*([^;}]+)/gi)) {
      for (const t of m[1].matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) {
        const ms = toMs(`${t[1]}${t[2]}`);
        if (ms !== null && ms > 0 && ms < 20000) inc(durations, String(ms));
      }
    }
    for (const m of css.matchAll(
      /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)|steps\([^)]*\)|\b(ease-in-out|ease-in|ease-out|linear)\b(?=[^;{}]*[;}])/gi,
    )) {
      const v = m[1] !== undefined ? `cubic-bezier(${[m[1], m[2], m[3], m[4]].map(Number).join(', ')})` : m[0].toLowerCase();
      inc(easings, v);
    }
    for (const m of css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/gi)) keyframes.add(m[1]);
    for (const m of css.matchAll(/@media[^{]*\((?:min|max)-width\s*:\s*([\d.]+)(px|em|rem)\)/gi)) {
      const px = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
      inc(breakpoints, String(Math.round(px)));
    }
    for (const m of css.matchAll(/([^{}]+){[^}]*?font-size\s*:\s*([^;}]*(?:clamp\(|vw|vmin|vmax|cqi)[^;}]*)/gi)) {
      if (fluidType.length < 30) fluidType.push({ selector: m[1].trim().split('\n').pop()?.trim().slice(0, 80) ?? '', value: m[2].trim().slice(0, 120) });
    }
  }
  const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    fontFaces,
    customProps,
    transitions: top(transitions, 15).map(([value, count]) => ({ value, count })),
    durations: top(durations, 15).map(([ms, count]) => ({ ms: Number(ms), count })),
    easings: top(easings, 15).map(([value, count]) => ({ value, count })),
    keyframes: [...keyframes].slice(0, 60),
    breakpoints: top(breakpoints, 12)
      .map(([px, count]) => ({ px: Number(px), count }))
      .sort((a, b) => a.px - b.px),
    fluidType,
    sheets: sheets.length,
    bytes,
  };
}

/** Well-known easing curves, so "cubic-bezier(0.16, 1, 0.3, 1)" reads as "expo out". */
const NAMED: Array<[string, [number, number, number, number]]> = [
  ['ease', [0.25, 0.1, 0.25, 1]],
  ['ease-in', [0.42, 0, 1, 1]],
  ['ease-out', [0, 0, 0.58, 1]],
  ['ease-in-out', [0.42, 0, 0.58, 1]],
  ['sine out', [0.61, 1, 0.88, 1]],
  ['sine in-out', [0.37, 0, 0.63, 1]],
  ['quad out', [0.5, 1, 0.89, 1]],
  ['cubic out', [0.33, 1, 0.68, 1]],
  ['cubic in-out', [0.65, 0, 0.35, 1]],
  ['quart out', [0.25, 1, 0.5, 1]],
  ['quart in-out', [0.76, 0, 0.24, 1]],
  ['quint out', [0.22, 1, 0.36, 1]],
  ['quint in-out', [0.83, 0, 0.17, 1]],
  ['expo out', [0.16, 1, 0.3, 1]],
  ['expo out (alt)', [0.19, 1, 0.22, 1]],
  ['expo in-out', [0.87, 0, 0.13, 1]],
  ['circ out', [0, 0.55, 0.45, 1]],
  ['circ in-out', [0.85, 0, 0.15, 1]],
  ['back out', [0.34, 1.56, 0.64, 1]],
  ['cubic in', [0.32, 0, 0.67, 0]],
  ['quart in', [0.5, 0, 0.75, 0]],
  ['expo in', [0.7, 0, 0.84, 0]],
  ['Material standard', [0.4, 0, 0.2, 1]],
  ['Material decelerate', [0, 0, 0.2, 1]],
  ['Material accelerate', [0.4, 0, 1, 1]],
];

export function easingName(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'].includes(v)) return v;
  const m = v.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!m) return null;
  const p = [m[1], m[2], m[3], m[4]].map(Number);
  let best: [string, number] | null = null;
  for (const [name, q] of NAMED) {
    const d = Math.max(...q.map((x, i) => Math.abs(x - p[i])));
    if (d <= 0.03 && (!best || d < best[1])) best = [name, d];
  }
  if (best) return best[0];
  const [x1, y1, x2, y2] = p;
  if (y1 > 1 || y2 > 1 || y1 < 0 || y2 < 0) return 'custom, overshoots (springy)';
  if (x1 <= 0.4 && y1 >= 0.6 && y2 >= 0.9) return 'custom ease-out (fast start, long soft landing)';
  if (x1 >= 0.3 && y1 <= 0.3 && x2 <= 0.7 && y2 >= 0.9) return 'custom ease-in-out';
  if (y2 <= 0.6 && x2 >= 0.5) return 'custom ease-in (slow start)';
  return 'custom curve';
}
