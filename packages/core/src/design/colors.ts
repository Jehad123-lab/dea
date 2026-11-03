import { converter, differenceEuclidean, formatHex, parse } from 'culori';

const toOklch = converter('oklch');
const dist = differenceEuclidean('oklab');

export interface ColorGroup {
  hex: string;
  alpha: number;
  oklch: { l: number; c: number; h: number | null };
  name: string;
  share: number;
  weight: number;
  members: string[];
  kinds: Record<string, number>;
}

export interface WeightedColor {
  css: string;
  weight: number;
  kind: string;
}

/** Plain-words name for a colour: "near-black", "soft blue", "warm off-white". */
export function colorName(hex: string): string {
  const c = toOklch(parse(hex));
  if (!c) return 'unknown';
  const l = c.l ?? 0;
  const ch = c.c ?? 0;
  const h = c.h ?? 0;
  if (ch < 0.025) {
    if (l < 0.12) return 'black';
    if (l < 0.25) return 'near-black';
    if (l < 0.45) return 'dark grey';
    if (l < 0.7) return 'grey';
    if (l < 0.9) return 'light grey';
    if (l < 0.98) return 'off-white';
    return 'white';
  }
  const hues: Array<[number, string]> = [
    [20, 'pink'],
    [45, 'red'],
    [70, 'orange'],
    [100, 'yellow'],
    [130, 'lime'],
    [165, 'green'],
    [195, 'teal'],
    [225, 'cyan'],
    [265, 'blue'],
    [295, 'indigo'],
    [325, 'violet'],
    [355, 'magenta'],
    [361, 'pink'],
  ];
  const hue = hues.find(([max]) => h < max)?.[1] ?? 'pink';
  const tone = l < 0.3 ? 'deep ' : l < 0.5 ? 'dark ' : l > 0.88 ? 'pale ' : l > 0.75 ? 'light ' : '';
  const sat = ch < 0.06 ? 'muted ' : ch > 0.2 ? 'vivid ' : '';
  if (ch < 0.045 && l > 0.9) return `${hue}-tinted off-white`;
  if (ch < 0.045 && l < 0.25) return `${hue}-tinted near-black`;
  return `${sat}${tone}${hue}`.trim();
}

/** Group near-identical colours (OKLab distance) and rank them by visual weight. */
export function groupColors(samples: WeightedColor[], threshold = 0.035, max = 16): ColorGroup[] {
  const groups: Array<{
    lab: ReturnType<typeof parse>;
    hex: string;
    alpha: number;
    weight: number;
    members: Map<string, number>;
    kinds: Record<string, number>;
  }> = [];
  const total = samples.reduce((n, s) => n + s.weight, 0) || 1;
  const parsed = samples
    .map((s) => ({ s, c: parse(s.css) }))
    .filter((x) => x.c && (x.c.alpha ?? 1) > 0.04)
    .sort((a, b) => b.s.weight - a.s.weight);
  for (const { s, c } of parsed) {
    if (!c) continue;
    const hex = formatHex(c) ?? '#000000';
    let g = groups.find((x) => dist(x.lab!, c) < threshold);
    if (!g) {
      g = { lab: c, hex, alpha: Math.round((c.alpha ?? 1) * 100) / 100, weight: 0, members: new Map(), kinds: {} };
      groups.push(g);
    }
    g.weight += s.weight;
    g.members.set(hex, (g.members.get(hex) ?? 0) + s.weight);
    g.kinds[s.kind] = (g.kinds[s.kind] ?? 0) + s.weight;
  }
  return groups
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map((g) => {
      const o = toOklch(parse(g.hex))!;
      return {
        hex: g.hex,
        alpha: g.alpha,
        oklch: { l: round(o.l ?? 0, 3), c: round(o.c ?? 0, 3), h: o.h === undefined || Number.isNaN(o.h) ? null : round(o.h, 1) },
        name: colorName(g.hex),
        share: round(g.weight / total, 3),
        weight: Math.round(g.weight),
        members: [...g.members.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([h]) => h),
        kinds: Object.fromEntries(Object.entries(g.kinds).map(([k, v]) => [k, round(v / g.weight, 2)])),
      };
    });
}

export interface ColorRoles {
  background: ColorGroup | null;
  text: ColorGroup | null;
  accents: ColorGroup[];
  neutrals: ColorGroup[];
  scheme: 'dark' | 'light' | 'mixed' | 'unknown';
}

export function colorRoles(dom: ColorGroup[], byKind: (k: string) => ColorGroup[]): ColorRoles {
  const bg = byKind('background')[0] ?? null;
  const text = byKind('text')[0] ?? null;
  const accents = dom.filter((g) => g.oklch.c >= 0.07 && g.share >= 0.002).slice(0, 5);
  const neutrals = dom.filter((g) => g.oklch.c < 0.07).slice(0, 6);
  let scheme: ColorRoles['scheme'] = 'unknown';
  if (bg && text) scheme = bg.oklch.l < 0.35 && text.oklch.l > 0.6 ? 'dark' : bg.oklch.l > 0.75 && text.oklch.l < 0.5 ? 'light' : 'mixed';
  else if (bg) scheme = bg.oklch.l < 0.35 ? 'dark' : bg.oklch.l > 0.75 ? 'light' : 'mixed';
  return { background: bg, text, accents, neutrals, scheme };
}

/** WCAG 2 contrast ratio between two colours. */
export function contrast(a: string, b: string): number | null {
  const ca = parse(a);
  const cb = parse(b);
  if (!ca || !cb) return null;
  const lum = (c: ReturnType<typeof parse>) => {
    const rgb = converter('rgb')(c)!;
    const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
  };
  const [l1, l2] = [lum(ca), lum(cb)].sort((x, y) => y - x);
  return round((l1 + 0.05) / (l2 + 0.05), 2);
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
