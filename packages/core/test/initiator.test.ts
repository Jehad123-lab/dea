import { describe, expect, it } from 'vitest';
import { apiGaps, describeInitiator, endpointNeedles, flattenInitiator, renderGaps } from '../src/index.ts';

// a webpack dev build like hn.algolia.com: the request is sent by library modules, the app module is an async parent
const cdpInit = {
  type: 'script',
  stack: {
    callFrames: [
      { functionName: 'send', url: 'webpack-internal:///5467', lineNumber: 9, columnNumber: 30 },
      { functionName: 't', url: 'webpack-internal:///290', lineNumber: 0, columnNumber: 100 },
    ],
    parent: {
      description: 'Promise.then',
      callFrames: [{ functionName: 'SearchProvider._this.search', url: 'webpack-internal:///8537', lineNumber: 176, columnNumber: 4 }],
    },
  },
};
const roles: Record<string, string> = { 'webpack-internal:///5467': 'vendor', 'webpack-internal:///290': 'vendor', 'webpack-internal:///8537': 'app' };
const appSite = (stack: string[]) => {
  const own = stack.find((l) => roles[/\((.+):\d+:\d+\)$/.exec(l)?.[1] ?? ''] === 'app');
  return own ? { where: `SearchProvider.tsx:177 (${/^at (\S+)/.exec(own)?.[1]})` } : null;
};
const base = { url: 'https://x-dsn.algolia.net/1/indexes/Item_dev/query', appSite, roleOf: (u: string) => roles[u], scripts: [] };

describe('who called this API: the fallback chain', () => {
  it('1. the hook’s stack wins when it reaches the site’s code', () => {
    const r = describeInitiator({ ...base, hookStack: ['at x (webpack-internal:///8537:10:2)'] });
    expect(r).toMatchObject({ label: 'Verified', how: expect.stringMatching(/fetch\/XHR/) });
  });

  it('2. then Chrome’s initiator stack, following async parents back to the app', () => {
    const cdp = flattenInitiator(cdpInit);
    expect(cdp.frames.map((f) => f.url)).toEqual(['webpack-internal:///5467', 'webpack-internal:///290', 'webpack-internal:///8537']);
    const r = describeInitiator({ ...base, hookStack: ['at send (webpack-internal:///5467:10:31)'], cdp });
    expect(r).toEqual({ where: 'SearchProvider.tsx:177 (SearchProvider._this.search)', label: 'Verified', how: expect.stringMatching(/async/) });
  });

  it('3. only library frames: says the library sent it and that the app caller is not visible', () => {
    const cdp = flattenInitiator({ type: 'script', stack: { callFrames: cdpInit.stack.callFrames } });
    const r = describeInitiator({ ...base, cdp, libsOf: () => ['@algolia/requester-browser-xhr'] });
    expect(r?.label).toBe('Verified');
    expect(r?.where).toBe('webpack module 5467:10:31 (send)');
    expect(r?.how).toMatch(/only library code.*@algolia.*not in the stack/);
  });

  it('4. no stack at all: the endpoint written in a script is an Inferred caller, app code before libraries', () => {
    const scripts = [
      { url: 'https://site.dev/vendor.js', role: 'vendor', source: 'x="/1/indexes/"' },
      { url: 'https://site.dev/main.js', role: 'app', source: 'a\nconst u = "https://x-dsn.algolia.net/1/indexes/" + idx + "/query"' },
    ];
    const r = describeInitiator({ ...base, scripts });
    expect(r).toMatchObject({ where: 'main.js:2:37', label: 'Inferred' });
    expect(r?.how).toMatch(/"\/1\/indexes"|x-dsn/);
  });

  it('5. nothing anywhere: null, and the report turns it into a gap with a reconstruction and next probes', () => {
    expect(describeInitiator({ ...base, scripts: [{ url: 'https://site.dev/main.js', role: 'app', source: 'nothing here' }] })).toBeNull();
    const gaps = apiGaps(
      [
        {
          host: 'https://x-dsn.algolia.net',
          method: 'POST',
          path: '/1/indexes/{index}/query',
          statuses: [200],
          auth: ['header x-algolia-api-key'],
          telemetry: false,
          responseKeys: ['hits', 'nbHits'],
          initiators: [],
          example: 'https://x-dsn.algolia.net/1/indexes/Item_dev/query',
        },
      ],
      'https://hn.algolia.com',
      { unpacked: false },
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].next[0]).toMatchObject({ command: 'dea code https://hn.algolia.com', probe: 'code' });
    const md = renderGaps(gaps);
    expect(md).toContain('## Gap → path to result');
    expect(md).toContain('**Best reconstruction now (Inferred):**');
    expect(md).toContain("method: 'POST'");
    expect(md).toContain("'x-algolia-api-key': process.env.API_KEY");
    expect(md).not.toMatch(/Unknown\s*$/);
  });

  it('turns an endpoint into literal strings worth searching for', () => {
    expect(endpointNeedles('https://api.site.dev/v2/products/123/reviews?x=1')).toEqual(['/v2/products', 'api.site.dev', 'site.dev']);
  });
});
