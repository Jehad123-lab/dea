import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serveDir } from '../src/extract/preview.ts';
import { read, resetPoliteState } from '../src/web/index.ts';

// read, with a real headless browser: a page that is empty until its script runs (like most apps), a script that tries to reach
// another address on this machine (the render refuses it), and a page that needs no script (no browser is started for it).
describe.skipIf(!process.env.DEA_E2E)('read: rendering in a real browser', () => {
  it('returns what the scripts built, refuses the page’s requests to other private addresses, and leaves plain pages alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dea-render-'));
    const other = await mkdtemp(join(tmpdir(), 'dea-render-other-'));
    const home = await mkdtemp(join(tmpdir(), 'dea-render-home-'));
    const secretServer = await serveDir(other);
    const server = await serveDir(dir);
    resetPoliteState();
    try {
      await writeFile(join(other, 'secret.txt'), 'the secret behind the firewall');
      await writeFile(
        join(dir, 'app.html'),
        `<!doctype html><html><head><title>Shell app</title></head><body><div id="root"></div><script>
setTimeout(() => {
  document.getElementById('root').innerHTML = '<main><h1>Built by the script</h1><p>This paragraph only exists after the script ran, and it has enough words in it to count as readable text for the reader.</p><p id="peek">peeking…</p></main>';
  fetch(${JSON.stringify(`${secretServer.url}/secret.txt`)}).then((r) => r.text()).then((t) => { document.getElementById('peek').textContent = 'LEAKED ' + t; }).catch(() => { document.getElementById('peek').textContent = 'the request was refused'; });
}, 150);
</script></body></html>`,
      );
      await writeFile(
        join(dir, 'plain.html'),
        `<!doctype html><html><head><title>Plain</title></head><body><main><h1>Plain page</h1><p>${'Words that were there from the start. '.repeat(30)}</p></main></body></html>`,
      );

      const shell = await read(`${server.url}/app.html`, { home, allowPrivate: true, fresh: true });
      expect(shell.method).toBe('rendered');
      expect(shell.text).toContain('Built by the script');
      expect(shell.text).toContain('the request was refused');
      expect(shell.text).not.toContain('LEAKED');
      expect(shell.warnings?.join(' ')).toMatch(/refused/);

      const served = await read(`${server.url}/app.html`, { home, allowPrivate: true, fresh: true, render: 'never' });
      expect(served.method).toBe('static');
      expect(served.text).not.toContain('Built by the script');

      const plain = await read(`${server.url}/plain.html`, { home, allowPrivate: true, fresh: true });
      expect(plain.method).toBe('static'); // enough text already: no browser
    } finally {
      await server.close();
      await secretServer.close();
      await rm(dir, { recursive: true, force: true });
      await rm(other, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000);
});
