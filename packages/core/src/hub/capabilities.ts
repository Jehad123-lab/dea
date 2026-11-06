import { readdir, stat } from 'node:fs/promises';
import { launchBrowser, releaseBrowser } from '../browser/open.ts';
import { webCacheHome } from '../web/cache.ts';
import { pdfText } from '../web/pdf.ts';
import { search, sourceList } from '../web/search.ts';
import { listApprovals } from './approvals.ts';
import { CONNECTORS } from './builtin/index.ts';
import { hubHome } from './store.ts';

export interface Capability {
  id: string;
  title: string;
  /** works = proven just now; limited = works with a stated limit; no = does not work here, and why; unknown = not tested (needs --live) */
  status: 'works' | 'limited' | 'no' | 'unknown';
  note: string;
}

/** A tiny PDF with one line of text, to prove the PDF reader runs here (built in memory, nothing fetched). */
const TINY_PDF = (() => {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 41 >>\nstream\nBT /F1 12 Tf 10 50 Td (dea pdf check) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
})();

/**
 * What works on this machine right now. Offline by default (the browser and the PDF reader are really started; the network is not
 * touched). With live=true each free search source is asked one small question, so a blocked source shows up here and not in the
 * middle of your work.
 */
export async function capabilities(
  o: { live?: boolean; env?: Record<string, string | undefined>; fetch?: typeof fetch; home?: string } = {},
): Promise<Capability[]> {
  const env = o.env ?? process.env;
  const out: Capability[] = [];
  const run = async (id: string, title: string, fn: () => Promise<Omit<Capability, 'id' | 'title'>>) => {
    try {
      out.push({ id, title, ...(await fn()) });
    } catch (e) {
      out.push({ id, title, status: 'no', note: (e as Error).message.split('\n')[0].slice(0, 200) });
    }
  };
  await run('render', 'read: run a page’s scripts in DEA’s own headless browser', async () => {
    const { browser, channel } = await launchBrowser('auto', true);
    const v = browser.version();
    await releaseBrowser(browser);
    return { status: 'works', note: `${channel} ${v} starts` };
  });
  await run('pdf', 'read: PDF text layers', async () => {
    const p = await pdfText(TINY_PDF);
    return p.text.includes('dea pdf check')
      ? { status: 'works', note: 'reads text PDFs; scanned PDFs (pictures of pages) have no text and DEA has no OCR' }
      : { status: 'no', note: 'the PDF reader ran but returned no text' };
  });
  await run('feeds', 'read: RSS, Atom and sitemaps', async () => ({ status: 'works', note: 'built in, no setup' }));
  const sources = sourceList(env);
  if (!o.live) {
    out.push({
      id: 'search',
      title: 'search: free sources',
      status: 'unknown',
      note: `${sources.map((s) => s.name).join(', ')} — run  dea hub doctor --live  to ask each one now`,
    });
  } else {
    for (const s of sources.filter((x) => !x.fallbackFor || x.name === 'duckduckgo-lite')) {
      await run(`search:${s.name}`, `search source ${s.name}`, async () => {
        const r = await search('webgl', { sources: [s.name], fresh: true, home: o.home, fetch: o.fetch, timeoutMs: 20_000, limit: 3 });
        const rep = r.sources.find((x) => x.source === s.name) ?? r.sources[0];
        if (rep?.status === 'ok' && r.results.length) return { status: 'works', note: `${rep.count} results in ${rep.ms} ms` };
        if (rep?.status === 'blocked' || rep?.status === 'rate_limited') return { status: 'no', note: `${rep.status.replace('_', ' ')}: ${rep.note ?? ''}` };
        return { status: 'no', note: `${rep?.status ?? 'no answer'}: ${rep?.note ?? 'no results'}` };
      });
    }
  }
  for (const c of Object.values(CONNECTORS)) {
    if (!c.defaultTokenEnv) continue;
    const set = Boolean(env[c.defaultTokenEnv]);
    out.push({
      id: `token:${c.id}`,
      title: `${c.id} connector token ($${c.defaultTokenEnv})`,
      status: set ? 'works' : c.needsToken ? 'no' : 'limited',
      note: set
        ? 'set in this shell (value not shown); dea hub selftest --live proves it'
        : c.needsToken
          ? 'not set in this shell: set it only if you use this connector (the value is never shown or stored)'
          : 'not set: public projects only',
    });
  }
  const cacheDir = webCacheHome(o.home);
  let n = 0;
  let bytes = 0;
  for (const f of await readdir(cacheDir).catch(() => [] as string[])) {
    n++;
    bytes += (await stat(`${cacheDir}/${f}`).catch(() => ({ size: 0 }))).size;
  }
  out.push({ id: 'cache', title: 'web cache', status: 'works', note: `${n} answers, ${(bytes / 1024).toFixed(0)} KB in ${cacheDir}` });
  const pending = (await listApprovals(hubHome())).filter((a) => a.status === 'pending' && Date.parse(a.expires) > Date.now()).length;
  out.push({ id: 'approvals', title: 'changes waiting for your OK', status: 'works', note: pending ? `${pending} waiting: dea hub approvals` : 'none' });
  return out;
}
