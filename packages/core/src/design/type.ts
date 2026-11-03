import type { TextSample } from './sample.ts';

export interface TypeStyle {
  role: string;
  family: string;
  size: number;
  weight: string;
  style: string;
  lineHeight: number | null;
  letterSpacing: number | null;
  transform: string;
  chars: number;
  sample: string;
  selector: string;
}

export interface TypeScale {
  sizes: number[];
  base: number | null;
  ratio: number | null;
  ratioName: string | null;
  consistent: boolean;
}

const SCALES: Array<[number, string]> = [
  [1.067, 'minor second'],
  [1.125, 'major second'],
  [1.2, 'minor third'],
  [1.25, 'major third'],
  [1.333, 'perfect fourth'],
  [Math.SQRT2, 'augmented fourth'],
  [1.5, 'perfect fifth'],
  [1.618, 'golden ratio'],
];

/** Find the modular scale (if any) behind a set of font sizes. */
export function typeScale(samples: TextSample[]): TypeScale {
  const meaningful = samples.filter((s) => s.chars >= 3);
  const totalChars = meaningful.reduce((n, s) => n + s.chars, 0) || 1;
  // sizes used for at least a little text
  const sizes = [...new Set(meaningful.filter((s) => s.chars / totalChars > 0.002 || s.size >= 24).map((s) => Math.round(s.size)))].sort((a, b) => a - b);
  const bodyBySize = new Map<number, number>();
  for (const s of meaningful) bodyBySize.set(Math.round(s.size), (bodyBySize.get(Math.round(s.size)) ?? 0) + s.chars);
  const base = [...bodyBySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const ratios: number[] = [];
  for (let i = 1; i < sizes.length; i++) {
    const r = sizes[i] / sizes[i - 1];
    if (r > 1.04) ratios.push(r);
  }
  if (ratios.length < 2) return { sizes, base, ratio: null, ratioName: null, consistent: false };
  const logs = ratios.map(Math.log);
  const mean = Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length);
  const spread = Math.sqrt(logs.reduce((a, b) => a + (b - Math.log(mean)) ** 2, 0) / logs.length);
  const near = SCALES.reduce((best, s) => (Math.abs(s[0] - mean) < Math.abs(best[0] - mean) ? s : best));
  return {
    sizes,
    base,
    ratio: Math.round(mean * 1000) / 1000,
    ratioName: Math.abs(near[0] - mean) < 0.04 ? near[1] : null,
    consistent: spread < 0.08,
  };
}

/** Name text styles by role: display, heading, body, small, label. */
export function typeStyles(samples: TextSample[]): TypeStyle[] {
  const meaningful = samples.filter((s) => s.chars >= 2);
  if (!meaningful.length) return [];
  const body = [...meaningful].sort((a, b) => b.chars - a.chars)[0];
  return meaningful.slice(0, 24).map((s) => {
    let role = 'text';
    if (s === body) role = 'body';
    else if (/^h1$/.test(s.tag) || s.size >= Math.max(40, body.size * 2.5)) role = 'display';
    else if (/^h[2-3]$/.test(s.tag) || s.size >= body.size * 1.4) role = 'heading';
    else if (s.transform === 'uppercase' || (s.letterSpacing ?? 0) >= 0.05) role = 'label';
    else if (s.size < body.size * 0.9) role = 'small';
    else if (s.tag === 'a' || s.tag === 'button') role = 'link / button';
    return {
      role,
      family: s.family,
      size: s.size,
      weight: s.weight,
      style: s.style,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      transform: s.transform,
      chars: s.chars,
      sample: s.sample,
      selector: s.selector,
    };
  });
}
