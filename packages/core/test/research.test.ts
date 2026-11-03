import { describe, expect, it } from 'vitest';
import { analyse, duckDuckGo, type Finding, providersFromEnv, researchLoop, type SearchProvider } from '../src/index.ts';

const hex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
/** a stand-in for the visual diff: how close the rebuild's background is to the original's */
const similarity = (bg: string, target: string) => {
  const a = hex(bg);
  const b = hex(target);
  return 1 - Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0)) / Math.sqrt(3 * 255 ** 2);
};

describe('research-and-retry', () => {
  it('a mocked provider improves a deliberately wrong rebuild, and the finding is cited', async () => {
    const asked: string[] = [];
    const provider: SearchProvider = {
      name: 'mock',
      async search(q) {
        asked.push(q);
        return [
          { title: 'Brand guide', url: 'https://example.test/brand', snippet: 'Links use #ff5500. The page background: #0e100f with off-white text.', source: 'mock' },
          { title: 'Unrelated', url: 'https://example.test/other', snippet: 'nothing useful here', source: 'mock' },
        ];
      },
    };
    const r = await researchLoop({
      params: { background: '#ffffff' },
      render: async (p) => similarity(String(p.background), '#0e100f'),
      queries: (_p, round) => [`gsap.com background colour (round ${round})`],
      knobs: [{ name: 'background', kind: 'color', near: /background|bg/i }],
      providers: [provider],
    });
    expect(r.start).toBeLessThan(0.2);
    expect(r.best).toBeGreaterThan(0.99);
    expect(r.params.background).toBe('#0e100f');
    expect(r.citations[0]).toMatchObject({ url: 'https://example.test/brand' });
    expect(r.rounds[0].tried.find((t) => t.value === '#ff5500')).toBeUndefined(); // not near "background"
    expect(asked.length).toBeGreaterThan(0);
  });

  it('stops honestly when nothing helps or no provider is set', async () => {
    const empty: SearchProvider = { name: 'empty', search: async () => [] };
    const r = await researchLoop({ params: { x: 1 }, render: async () => 0.5, queries: () => ['q'], knobs: [], providers: [empty] });
    expect(r.best).toBe(0.5);
    expect(r.stoppedBecause).toMatch(/no new values|rounds/);
    const none = await researchLoop({ params: { x: 1 }, render: async () => 0.5, queries: () => ['q'], knobs: [], providers: [] });
    expect(none.stoppedBecause).toMatch(/no search provider/);
    const broken: SearchProvider = {
      name: 'down',
      search: async () => {
        throw new Error('429');
      },
    };
    const b = await researchLoop({ params: { x: 1 }, render: async () => 0.5, queries: () => ['q'], knobs: [], providers: [broken], rounds: 1 });
    expect(b.rounds[0].errors[0]).toContain('429');
  });

  it('pulls numbers, fonts and eases out of findings', () => {
    const f: Finding = { title: 't', url: 'u', source: 's', snippet: 'uniforms: { uSpeed: { value: 0.35 } }, font-family: "Mori Gothic", ease: "power3.out"' };
    const hints = analyse([f], [
      { name: 'uSpeed', kind: 'number', min: 0, max: 10 },
      { name: 'font', kind: 'font' },
      { name: 'ease', kind: 'ease' },
    ]);
    expect(hints.map((h) => [h.knob, h.value])).toEqual([
      ['uSpeed', 0.35],
      ['font', 'Mori Gothic'],
      ['ease', 'power3.out'],
    ]);
  });

  it('parses DuckDuckGo HTML results and reads providers from the environment', async () => {
    const html =
      '<div><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgsap.com%2Fdocs&amp;rut=x">GSAP <b>docs</b></a><a class="result__snippet" href="#">Eases like power2.out</a></div>';
    const p = duckDuckGo((async () => new Response(html)) as unknown as typeof fetch);
    expect(await p.search('gsap')).toEqual([{ title: 'GSAP docs', url: 'https://gsap.com/docs', snippet: 'Eases like power2.out', source: 'duckduckgo' }]);
    expect(providersFromEnv({ DEA_SEARCH: 'none' })).toEqual([]);
    expect(providersFromEnv({}).map((x) => x.name)).toEqual(['duckduckgo']);
    expect(providersFromEnv({ DEA_SEARCH: 'searxng,github', DEA_SEARXNG_URL: 'http://localhost:8888', GITHUB_TOKEN: 't' }).map((x) => x.name)).toEqual(['searxng', 'github']);
  });
});
