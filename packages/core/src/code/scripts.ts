import { createHash } from 'node:crypto';
import type { CDPSession } from 'playwright';
import { SourceMapConsumer } from 'source-map-js';

export interface ScriptRecord {
  scriptId: string;
  url: string;
  inline: boolean;
  isModule: boolean;
  bytes: number;
  hash: string;
  sourceMapUrl: string | null;
  source: string;
  /** libraries recognised inside this file (three.js, GSAP, React, ...) */
  libs: string[];
  /** app = the site's own code; vendor = a known library; mixed = app code bundled with libraries */
  role: 'app' | 'vendor' | 'mixed' | 'inline' | 'runtime';
}

/** Start listening for every script the page parses. Call before navigation. */
export async function watchScripts(cdp: CDPSession): Promise<Map<string, Omit<ScriptRecord, 'source' | 'libs' | 'role'>>> {
  const seen = new Map<string, Omit<ScriptRecord, 'source' | 'libs' | 'role'>>();
  cdp.on('Debugger.scriptParsed', (e) => {
    if (!e.url || e.url.startsWith('chrome-extension:') || e.url.startsWith('pptr:') || e.url.startsWith('__playwright')) return;
    seen.set(e.scriptId, {
      scriptId: e.scriptId,
      url: e.url,
      inline: false,
      isModule: Boolean(e.isModule),
      bytes: e.length ?? 0,
      hash: e.hash,
      sourceMapUrl: e.sourceMapURL || null,
    });
  });
  await cdp.send('Debugger.enable', { maxScriptsCacheSize: 200_000_000 });
  return seen;
}

const LIBS: Array<[string, RegExp]> = [
  ['three.js', /REVISION\s*=\s*["']\d{3}|THREE\.WebGLRenderer|__THREE__/],
  ['GSAP', /GreenSock|gsapVersions|_gsap\b/],
  ['ScrollTrigger', /ScrollTrigger|pinSpacing/],
  ['Lenis', /lenis|Lenis/],
  ['React', /react\.production|__REACT_DEVTOOLS_GLOBAL_HOOK__|react-dom/],
  ['React Three Fiber', /useFrame|__r3f|R3F/],
  ['Vue', /__VUE__|createApp\(/],
  ['Framer Motion', /framer-motion|MotionValue/],
  ['Swiper', /new Swiper\(|swiper-wrapper/],
  ['Barba', /barba\.init|@barba\/core/],
  ['Sanity client', /apicdn\.sanity\.io|@sanity\/client/],
  ['postprocessing', /EffectComposer|BloomEffect|UnrealBloomPass/],
  ['jQuery', /jQuery\.fn\b|\.jquery\s*=\s*["']\d|jquery:\s*["']\d/],
];

/** Fetch every parsed script's source through CDP and label what is inside. */
/** Scripts served by well-known third parties (tags, captchas, widgets): never the site's own code. */
const THIRD_PARTY: Array<[string, RegExp]> = [
  ['Google Tag', /googletagmanager\.com|google-analytics\.com|gtag\/js/],
  ['Cloudflare Turnstile', /challenges\.cloudflare\.com/],
  ['Cloudflare challenge', /\/cdn-cgi\/challenge-platform\//],
  ['reCAPTCHA', /google\.com\/recaptcha|gstatic\.com\/recaptcha/],
  ['hCaptcha', /hcaptcha\.com/],
  ['Vercel Analytics', /\/_vercel\/(insights|speed-insights)\//],
  ['Sentry', /browser\.sentry-cdn\.com|js\.sentry-cdn\.com/],
  ['Meta Pixel', /connect\.facebook\.net/],
  ['Hotjar', /static\.hotjar\.com/],
  ['Microsoft Clarity', /clarity\.ms/],
  ['HubSpot', /js\.hs-scripts\.com|js\.hsforms\.net/],
  ['Intercom', /widget\.intercom\.io/],
  ['Stripe.js', /js\.stripe\.com/],
  ['YouTube embed', /youtube\.com\/(iframe_api|s\/player)/],
];

export async function readScripts(
  cdp: CDPSession,
  seen: Map<string, Omit<ScriptRecord, 'source' | 'libs' | 'role'>>,
  pageUrl: string,
  maxBytes = 12_000_000,
): Promise<ScriptRecord[]> {
  const out: ScriptRecord[] = [];
  let total = 0;
  for (const s of seen.values()) {
    if (total > 60_000_000) break;
    let source = '';
    try {
      source = (await cdp.send('Debugger.getScriptSource', { scriptId: s.scriptId })).scriptSource ?? '';
    } catch {
      continue;
    }
    if (source.length > maxBytes) source = source.slice(0, maxBytes);
    total += source.length;
    const libs = LIBS.filter(([, re]) => re.test(source.slice(0, 2_000_000))).map(([n]) => n);
    const inline = s.url.split('#')[0] === pageUrl.split('#')[0] || s.inline;
    const appSignals = /(document\.querySelector|addEventListener|innerHTML|classList|getElementById|useEffect|useState|createElement)/.test(source);
    const base = (s.url.split('?')[0].split('/').pop() ?? '').toLowerCase();
    const vendorName =
      /(^|[-_.~])(three|react|react-dom|r3f|drei|post|postprocessing|vendors?|framework|polyfills?|lodash|gsap|motion|lenis|jquery|swiper|chunk-vendors|commons)([-_.~]|$)/.test(
        base,
      );
    const third = THIRD_PARTY.find(([, re]) => re.test(s.url));
    if (third && !libs.includes(third[0])) libs.push(third[0]);
    // eval'd modules (webpack dev builds) carry their own inline source map: its file list says library or app
    const own = inlineMapSources(source);
    const fromPackages = own?.length ? own.every((p) => isLibraryPath(p)) : false;
    if (fromPackages && own)
      for (const p of own) {
        const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p)?.[1];
        if (pkg && !libs.includes(pkg) && libs.length < 8) libs.push(pkg);
      }
    const role: ScriptRecord['role'] = fromPackages
      ? 'vendor'
      : inline
        ? 'inline'
        : third
          ? 'vendor'
          : vendorName && (libs.length || /polyfill|vendor|framework|commons/.test(base))
            ? 'vendor'
            : /webpack-runtime|webpack\/runtime|__webpack_require__\.p\s*=/.test(source) && source.length < 30_000
              ? 'runtime'
              : libs.length && !appSignals
                ? 'vendor'
                : libs.length && source.length > 300_000
                  ? 'mixed'
                  : libs.length >= 2 && /three\.js|React/.test(libs.join()) && !/(classList|querySelector)/.test(source)
                    ? 'vendor'
                    : 'app';
    out.push({ ...s, inline, bytes: source.length, hash: s.hash || createHash('sha1').update(source).digest('hex'), source, libs, role });
  }
  return out;
}

export interface BundlerHit {
  name: string;
  label: 'Verified' | 'Inferred';
  evidence: string[];
}

/** Which build tool made these files. Each guess carries the markers that support it. */
export function detectBundler(scripts: ScriptRecord[]): BundlerHit[] {
  const hits: BundlerHit[] = [];
  const add = (name: string, label: BundlerHit['label'], ev: string) => {
    const h = hits.find((x) => x.name === name);
    if (h) {
      if (h.evidence.length < 4) h.evidence.push(ev);
      if (label === 'Verified') h.label = 'Verified';
    } else hits.push({ name, label, evidence: [ev] });
  };
  for (const s of scripts) {
    const src = s.source.slice(0, 3_000_000);
    const file = s.url.split('/').pop() ?? s.url;
    if (/\/_next\/static\//.test(s.url)) add('Next.js (webpack or Turbopack)', 'Verified', `script path ${s.url.replace(/^https?:\/\/[^/]+/, '')}`);
    if (/TURBOPACK|__turbopack_/.test(src)) add('Turbopack', 'Verified', `"TURBOPACK" runtime marker in ${file}`);
    if (/__webpack_require__|webpackChunk|webpackJsonp/.test(src))
      add('webpack', 'Verified', `webpack runtime marker (__webpack_require__ / webpackChunk) in ${file}`);
    if (/__vite__mapDeps|__vitePreload|import\.meta\.env|vite\/modulepreload-polyfill/.test(src))
      add('Vite', 'Verified', `Vite runtime helper (__vite__mapDeps / __vitePreload) in ${file}`);
    if (/\/assets\/[\w.-]+-[A-Za-z0-9_-]{8}\.js$/.test(s.url)) add('Vite', 'Inferred', `file name pattern /assets/name-HASH8.js (${file})`);
    if (/-legacy-[A-Za-z0-9_-]{8}\.js$/.test(s.url) || /System\.register/.test(src))
      add('@vitejs/plugin-legacy (SystemJS)', 'Inferred', `legacy build file ${file}`);
    if (/parcelRequire|\$parcel\$/.test(src)) add('Parcel', 'Verified', `parcelRequire in ${file}`);
    if (/\/\/ (?:src|node_modules)\/.+\.(?:js|ts|tsx|jsx)\n/.test(src.slice(0, 200_000)) && /__esm|__toESM|__commonJS/.test(src))
      add('esbuild', 'Inferred', `esbuild helpers (__toESM / __commonJS) in ${file}`);
    else if (/__toESM|__commonJS\(/.test(src)) add('esbuild (or a tool built on it)', 'Inferred', `esbuild helpers in ${file}`);
    if (/Object\.defineProperty\(exports,\s*["']__esModule["']/.test(src) && !/__webpack_require__/.test(src))
      add('Rollup / CommonJS output', 'Inferred', `__esModule interop in ${file}`);
    if (/\/_nuxt\//.test(s.url)) add('Nuxt', 'Verified', `script path ${s.url.replace(/^https?:\/\/[^/]+/, '')}`);
    if (/\/_astro\//.test(s.url)) add('Astro', 'Verified', `script path ${s.url.replace(/^https?:\/\/[^/]+/, '')}`);
    if (/webflow\.[\w]+\.js|Webflow\.push/.test(s.url + src.slice(0, 50_000))) add('Webflow', 'Verified', `Webflow runtime ${file}`);
    if (/framerusercontent\.com|__framer/.test(s.url)) add('Framer', 'Verified', `Framer runtime ${file}`);
  }
  return hits;
}

/** Where the source map is, if the site published one. */
/** The original file names in a script's inline (data: URI) source map, or null when it has none. */
export function inlineMapSources(source: string): string[] | null {
  const i = source.lastIndexOf('sourceMappingURL=data:');
  if (i < 0 || source.length - i > 8_000_000) return null;
  const ref = /^sourceMappingURL=(data:[^\s'"]+)/.exec(source.slice(i))?.[1];
  if (!ref) return null;
  const comma = ref.indexOf(',');
  try {
    const meta = ref.slice(5, comma);
    const body = ref.slice(comma + 1);
    const raw = JSON.parse(meta.includes('base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body)) as { sources?: unknown };
    return Array.isArray(raw.sources) ? raw.sources.map(String) : null;
  } catch {
    return null;
  }
}

export function sourceMapRef(s: ScriptRecord): string | null {
  const di = s.source.lastIndexOf('sourceMappingURL=data:');
  const fromData = di >= 0 ? /^sourceMappingURL=(data:[^\s'"]+)/.exec(s.source.slice(di)) : null;
  if (fromData?.[1]) return fromData[1];
  const fromTail = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m.exec(s.source.slice(-4000));
  const ref = s.sourceMapUrl || fromTail?.[1] || null;
  if (!ref) return null;
  if (ref.startsWith('data:')) return ref;
  try {
    return new URL(ref, s.url).toString();
  } catch {
    return null;
  }
}

export interface LoadedMap {
  script: string;
  mapUrl: string;
  /** how DEA found it: the file said so, or DEA tried <file>.map */
  found: 'declared' | 'probed';
  sources: string[];
  withContent: number;
  consumer: SourceMapConsumer;
  contents: Map<string, string>;
}

/** Fetch and parse a script's source map. `probe` also tries <url>.map when the file names none (one GET, no retries). */
export async function loadSourceMap(
  s: ScriptRecord,
  opts: { probe?: boolean; timeoutMs?: number } = {},
): Promise<LoadedMap | { error: string; tried: string } | null> {
  let url = sourceMapRef(s);
  let found: LoadedMap['found'] = 'declared';
  if (!url && opts.probe !== false && !s.inline && /\.m?js(\?|$)/.test(s.url)) {
    url = `${s.url.split('?')[0]}.map`;
    found = 'probed';
  }
  if (!url) return null;
  let text: string;
  try {
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',');
      const meta = url.slice(5, comma);
      const body = url.slice(comma + 1);
      text = meta.includes('base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), headers: { 'user-agent': 'Mozilla/5.0 dea' } });
      if (!res.ok) return found === 'probed' ? null : { error: `HTTP ${res.status}`, tried: url };
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len > 60_000_000) return { error: `map is ${len} bytes, too big`, tried: url };
      text = await res.text();
    }
  } catch (e) {
    return found === 'probed' ? null : { error: (e as Error).message, tried: url };
  }
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return found === 'probed' ? null : { error: 'not JSON', tried: url };
  }
  if (!raw || (!raw.mappings && !raw.sections)) return found === 'probed' ? null : { error: 'not a source map', tried: url };
  let consumer: SourceMapConsumer;
  try {
    consumer = new SourceMapConsumer(raw);
  } catch (e) {
    return { error: `could not read the map: ${(e as Error).message}`, tried: url };
  }
  const contents = new Map<string, string>();
  const sources: string[] = (consumer as any).sources ?? raw.sources ?? [];
  for (const src of sources) {
    const c = consumer.sourceContentFor(src, true);
    if (c) contents.set(src, c);
  }
  return { script: s.url, mapUrl: url.startsWith('data:') ? 'inline data: URL' : url, found, sources, withContent: contents.size, consumer, contents };
}

/** A safe relative path for an original source ("webpack://app/./src/Hero.tsx" → "app/src/Hero.tsx"). */
export function safeSourcePath(src: string): string {
  const p = src
    .replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, '')
    .replace(/\?.*$/, '')
    .split(/[\\/]+/)
    .filter((x) => x && x !== '.' && x !== '..')
    .map((x) => x.replace(/[^\w.@+-]/g, '_').slice(0, 80))
    .join('/');
  return p || 'unnamed';
}

export function isLibraryPath(src: string): boolean {
  return /node_modules|\/\.pnpm\/|webpack\/(runtime|bootstrap)|vite\/|\(webpack\)|commonjsHelpers/.test(src) || src.includes('\u0000');
}
