import { readFile, rm, writeFile } from 'node:fs/promises';
import { type Har, stripHar } from '../evidence/secrets.ts';

export type AssetKind = 'document' | 'script' | 'style' | 'font' | 'image' | 'media' | '3d-model' | 'texture' | 'wasm' | 'data' | 'other';

export interface NetEntry {
  i: number;
  url: string;
  method: string;
  status: number;
  mime: string;
  kind: AssetKind;
  bytes: number;
  host: string;
  httpVersion: string;
  ms: number;
}

export interface NetworkSummary {
  requests: number;
  bytes: number;
  failed: number;
  byKind: Record<string, { count: number; bytes: number }>;
  hosts: Array<{ host: string; count: number; bytes: number; firstParty: boolean }>;
  largest: NetEntry[];
  fonts: NetEntry[];
  models: NetEntry[];
  errors: NetEntry[];
  documentHeaders: Record<string, string>;
  redactions: number;
}

export function classify(url: string, mime: string): AssetKind {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  const m = mime.toLowerCase();
  if (/\.(glb|gltf|drc|fbx|obj|usdz|ply|splat|ksplat|spz)$/.test(path) || /model\//.test(m)) return '3d-model';
  if (/\.(ktx2|basis|hdr|exr|dds)$/.test(path)) return 'texture';
  if (/\.wasm$/.test(path) || m.includes('wasm')) return 'wasm';
  if (m.includes('font') || /\.(woff2?|ttf|otf|eot)$/.test(path)) return 'font';
  if (m.includes('html')) return 'document';
  if (m.includes('javascript') || m.includes('ecmascript') || /\.(m?js)$/.test(path)) return 'script';
  if (m.includes('css') || path.endsWith('.css')) return 'style';
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(path)) return 'image';
  if (m.startsWith('video/') || m.startsWith('audio/') || /\.(mp4|webm|mov|m3u8|mp3|ogg|wav)$/.test(path)) return 'media';
  if (m.includes('json') || m.includes('xml') || m.includes('text/plain')) return 'data';
  return 'other';
}

function registrable(host: string): string {
  const parts = host.split('.');
  return parts.slice(-2).join('.');
}

/** Read Playwright's raw HAR, strip secrets, write the clean copy, delete the raw one, summarise. */
export async function finishHar(rawPath: string, cleanPath: string, pageUrl: string): Promise<{ summary: NetworkSummary; entries: NetEntry[] }> {
  const raw = JSON.parse(await readFile(rawPath, 'utf8')) as Har;
  const { har, redactions } = stripHar(raw);
  await writeFile(cleanPath, JSON.stringify(har, null, 1));
  await rm(rawPath, { force: true });
  return summarize(har, pageUrl, redactions);
}

export function summarize(har: Har, pageUrl: string, redactions = 0): { summary: NetworkSummary; entries: NetEntry[] } {
  let site = '';
  try {
    site = registrable(new URL(pageUrl).hostname);
  } catch {
    /* ignore */
  }
  const all = har.log?.entries ?? [];
  const entries: NetEntry[] = all
    .map((e, i) => {
      const res = e.response as any;
      const req = e.request as any;
      const mime = String(res.content?.mimeType ?? '');
      const bytes = Math.max(Number(res._transferSize ?? 0), Number(res.bodySize ?? 0), Number(res.content?.size ?? 0), 0);
      let host = '';
      try {
        host = new URL(req.url).hostname;
      } catch {
        /* data: urls */
      }
      return {
        i,
        url: String(req.url),
        method: String(req.method ?? 'GET'),
        status: Number(res.status ?? 0),
        mime,
        kind: classify(String(req.url), mime),
        bytes,
        host,
        httpVersion: String(res.httpVersion ?? ''),
        ms: Math.round(Number((e as any).time ?? 0)),
      };
    })
    .filter((e) => /^https?:/i.test(e.url)); // blob: and data: are not network transfers
  const byKind: NetworkSummary['byKind'] = {};
  const hostMap = new Map<string, { count: number; bytes: number }>();
  for (const e of entries) {
    byKind[e.kind] ??= { count: 0, bytes: 0 };
    byKind[e.kind].count++;
    byKind[e.kind].bytes += e.bytes;
    if (!e.host) continue;
    const h = hostMap.get(e.host) ?? { count: 0, bytes: 0 };
    h.count++;
    h.bytes += e.bytes;
    hostMap.set(e.host, h);
  }
  const doc = (har.log?.entries ?? []).find((e) => String((e.response as any).content?.mimeType ?? '').includes('html'));
  const documentHeaders: Record<string, string> = {};
  for (const h of doc?.response.headers ?? []) {
    const k = h.name.toLowerCase();
    if (
      /^(server|x-powered-by|x-vercel-id|x-vercel-cache|x-nf-request-id|cf-ray|cf-cache-status|x-served-by|via|x-cache|x-github-request-id|x-amz-cf-id|x-nextjs-cache|x-nextjs-prerender|x-framer-.*|x-wf-.*|content-security-policy|cache-control|age|alt-svc|strict-transport-security|x-generator|fly-request-id|x-render-origin-server|platform|x-netlify.*)$/.test(
        k,
      )
    ) {
      documentHeaders[k] = h.value.slice(0, 300);
    }
  }
  return {
    entries,
    summary: {
      requests: entries.length,
      bytes: entries.reduce((n, e) => n + e.bytes, 0),
      failed: entries.filter((e) => e.status >= 400 || e.status === 0).length,
      byKind,
      hosts: [...hostMap.entries()]
        .map(([host, v]) => ({ host, ...v, firstParty: !!site && registrable(host) === site }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 25),
      largest: [...entries].sort((a, b) => b.bytes - a.bytes).slice(0, 12),
      fonts: entries.filter((e) => e.kind === 'font'),
      models: entries.filter((e) => e.kind === '3d-model' || e.kind === 'texture'),
      errors: entries.filter((e) => e.status >= 400).slice(0, 20),
      documentHeaders,
      redactions,
    },
  };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
