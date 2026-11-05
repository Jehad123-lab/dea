import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchBrowser } from '../src/browser/open.ts';
import { domPageMap } from '../src/extract/pagemap.ts';
import { serveDir } from '../src/extract/preview.ts';

// A DOM page written for this test (four tall sections, one with a canvas inside a CLOSED shadow root (shadowRoot answers null, querySelectorAll cannot see it)): the page map of a page with
// no WebGL to record still says which section is in view at which scroll position.
const PAGE = `<!doctype html><html><head><style>body{margin:0}section{height:520px;width:100%}</style></head><body>
<section id="a"><h1>Alpha</h1></section><section id="b"><h2>Beta</h2><div id="host"></div></section>
<section id="c"><h2>Gamma</h2></section><section id="d"><h2>Delta</h2></section>
<script>const r=document.getElementById('host').attachShadow({mode:'closed'});r.innerHTML='<canvas width=800 height=300 style="width:100%;height:300px"></canvas>';</script>
</body></html>`;

describe.skipIf(!process.env.DEA_E2E)('page map without WebGL (real browser)', () => {
  it('lists the sections in view at each stop, finds a canvas in a shadow root, and says nothing for a page that does not scroll', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dea-map-'));
    const { browser } = await launchBrowser('chromium', true);
    const server = await serveDir(dir);
    try {
      await writeFile(join(dir, 'page.html'), PAGE);
      await writeFile(join(dir, 'short.html'), '<!doctype html><body style="margin:0"><section style="height:100px">only</section></body>');
      const m = await domPageMap(browser, `${server.url}/page.html`, { width: 400, height: 300 }, { waitMs: 300 });
      expect(m).not.toBeNull();
      if (!m) return;
      expect(m.mechanism).toBe('native');
      expect(m.stops.length).toBeGreaterThanOrEqual(5);
      expect(m.extent).toBeGreaterThan(1000);
      expect(m.stops[0].sections[0]?.heading).toBe('Alpha');
      const heads = m.sections.map((s) => s.heading);
      expect(heads).toEqual(expect.arrayContaining(['Alpha', 'Beta', 'Gamma', 'Delta']));
      expect(m.canvases.length).toBeGreaterThan(0);
      expect(await domPageMap(browser, `${server.url}/short.html`, { width: 400, height: 300 }, { waitMs: 100 })).toBeNull();
    } finally {
      await server.close();
      await browser.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);
});
