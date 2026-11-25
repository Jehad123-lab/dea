import { describe, expect, it } from 'vitest';
import { INIT_SCRIPT } from '../src/browser/init.ts';
import { GL_ON_SCREEN, installObservers, launchBrowser } from '../src/browser/open.ts';

// igloo.inc mounts its three.js canvas inside a CLOSED shadow root: no query finds it, so the post-loader WebGL check
// answered "no canvas" for 60 s and the recording was skipped on 3 of 4 runs (Round 36)
const PAGE = `<!doctype html><html><body style="margin:0"><div id="host"></div><script>
  const root = document.getElementById('host').attachShadow({ mode: 'closed' });
  const c = document.createElement('canvas');
  c.width = 800; c.height = 500; c.style.cssText = 'display:block;width:100vw;height:100vh';
  root.appendChild(c);
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const tick = () => { gl.clearColor(Math.random(), 0.2, 0.4, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(tick); };
  tick();
</script></body></html>`;

describe('Round 36: a WebGL canvas in a closed shadow root', () => {
  it('the page script keeps the canvas that made each context', () => {
    expect(INIT_SCRIPT).toContain('D.canvasRefs.push(new WeakRef(this))');
    expect(INIT_SCRIPT).toContain('D.allCanvases = ()');
    expect(GL_ON_SCREEN).toContain('D.allCanvases');
  });
});

describe.skipIf(!process.env.DEA_E2E)('Round 36: closed shadow root canvas (real browser)', () => {
  it('GL_ON_SCREEN sees it and its frame count moves', async () => {
    const { browser } = await launchBrowser('chromium', true);
    try {
      const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
      await installObservers(context);
      const page = await context.newPage();
      await page.setContent(PAGE);
      await page.waitForTimeout(800);
      expect(await page.evaluate('document.querySelectorAll("canvas").length')).toBe(0);
      const a = (await page.evaluate(GL_ON_SCREEN)) as number;
      await page.waitForTimeout(1200);
      const b = (await page.evaluate(GL_ON_SCREEN)) as number;
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThan(a);
      expect(await page.evaluate('window.__DEA__.allCanvases().length')).toBe(1);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
