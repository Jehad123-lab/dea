import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

export interface Unpacked {
  /** readable, deobfuscated code (string arrays decoded, minified syntax expanded) */
  code: string;
  /** modules when the file was a webpack or browserify bundle */
  modules: Array<{ id: string; path: string; code: string }>;
  bundle: string | null;
  ms: number;
}

const require = createRequire(import.meta.url);

/**
 * Deobfuscate and unminify one bundle with webcrack (MIT) in a worker thread, so a huge or hostile file can be
 * stopped after `timeoutMs` instead of freezing DEA. Returns null when it times out or webcrack cannot parse it.
 */
export async function unpack(code: string, opts: { timeoutMs?: number; deobfuscate?: boolean } = {}): Promise<Unpacked | { error: string }> {
  let entry: string;
  try {
    entry = pathToFileURL(require.resolve('webcrack')).href;
  } catch {
    return { error: 'webcrack is not installed' };
  }
  const t0 = Date.now();
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.entry).then(async ({ webcrack }) => {
      try {
        const r = await webcrack(workerData.code, { deobfuscate: workerData.deobfuscate, unminify: true, unpack: true, jsx: true, mangle: false });
        const modules = [];
        if (r.bundle) for (const [id, m] of r.bundle.modules) { if (modules.length < 400) modules.push({ id: String(id), path: String(m.path || id), code: m.code }); }
        parentPort.postMessage({ code: r.code, modules, bundle: r.bundle ? r.bundle.type : null });
      } catch (e) { parentPort.postMessage({ error: String(e && e.message || e) }); }
    });`,
    { eval: true, workerData: { entry, code, deobfuscate: opts.deobfuscate !== false }, resourceLimits: { maxOldGenerationSizeMb: 1536 } },
  );
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ error: `took longer than ${Math.round((opts.timeoutMs ?? 60_000) / 1000)} s` });
    }, opts.timeoutMs ?? 60_000);
    worker.once('message', (m: any) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(m.error ? { error: m.error } : { ...m, ms: Date.now() - t0 });
    });
    worker.once('error', (e: Error) => {
      clearTimeout(timer);
      resolve({ error: e.message });
    });
  });
}
