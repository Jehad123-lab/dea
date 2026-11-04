import { describe, expect, it } from 'vitest';
import { INIT_SCRIPT } from '../src/browser/init.ts';
import { LOADER_VISIBLE, launchBrowser } from '../src/browser/open.ts';
import { LAYOUT_READ } from '../src/extract/preview.ts';
import { REPLAY_CAPTURE_SCRIPT } from '../src/replay/capture.ts';

// A script that is built inside a template literal loses a backslash the moment it is written as `\(` instead of
// `\\(`: the regular expression it builds is then invalid, the whole script throws when the browser parses it, and the
// caller (which swallows the error) carries on with no data. Every classic in-page script must at least parse (the player and runner are ES modules; the real-browser replay test runs them).
describe('in-page scripts', () => {
  const scripts: Array<[string, string]> = [
    ['LAYOUT_READ (whole page)', LAYOUT_READ(null)],
    ['LAYOUT_READ (a section)', LAYOUT_READ('#hero')],
    ['LOADER_VISIBLE', LOADER_VISIBLE],
    ['INIT_SCRIPT', INIT_SCRIPT],
    ['REPLAY_CAPTURE_SCRIPT', REPLAY_CAPTURE_SCRIPT],
  ];
  for (const [name, src] of scripts) {
    it(`${name} parses`, () => {
      expect(() => new Function(src)).not.toThrow();
    });
  }
});

describe.skipIf(!process.env.DEA_E2E)('layout read (real browser)', () => {
  it('finds a fade laid over the picture by a ::before, and the text above it', async () => {
    const { browser } = await launchBrowser('auto', true);
    try {
      const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
      await page.setContent(`<!doctype html><style>
        body{margin:0;background:#000}
        section{position:fixed;inset:0;isolation:isolate}
        section::before{content:"";position:absolute;z-index:-1;top:50%;left:0;right:0;bottom:0;background:linear-gradient(to top, rgba(3,5,10,.6), rgba(3,5,10,0))}
        h1{position:absolute;left:30px;top:40px;color:#eee;font:700 40px serif;margin:0}
      </style><canvas width="800" height="500" style="position:fixed;inset:0;z-index:0"></canvas><section><h1>Hello world</h1></section>`);
      const l = (await page.evaluate(LAYOUT_READ(null))) as { boxes: Array<{ text: string }>; shapes: Array<{ y: number; h: number; gradient: string }> };
      expect(l.boxes.map((b) => b.text)).toContain('Hello world');
      expect(l.shapes).toHaveLength(1);
      expect(l.shapes[0]?.y).toBeCloseTo(250, 0);
      expect(l.shapes[0]?.h).toBeCloseTo(250, 0);
      expect(l.shapes[0]?.gradient).toMatch(/^linear-gradient/);
    } finally {
      await browser.close();
    }
  });
});
