import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLedger, canonicalJson, type LedgerInput, ledgerAnswer, queryLedger, RunWriter } from '@dea/core';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.ts';

// Same inputs, same outputs, whichever AI drives it: two different clients, in different orders, with the arguments spelled
// differently, read the same result text from every structured tool. No network: the web is a recorded fetch, the clock is fixed.

const fx = async (n: string) => readFile(join(import.meta.dirname, '../../core/test/fixtures/web', n), 'utf8');
const home = await mkdtemp(join(tmpdir(), 'dea-det-'));
const webHome = await mkdtemp(join(tmpdir(), 'dea-det-web-'));
process.env.DEA_HOME = home;

const PAGE =
  '<html><head><title>Fixture page</title><meta name="description" content="a recorded page"></head><body><h1>Hello</h1><p>Same words every time.</p><a href="https://example.test/a">link a</a></body></html>';
const ledgerInput = (runId: string): LedgerInput => ({
  url: 'https://fixture.test/',
  runId,
  quick: false,
  ownAssets: false,
  machine: runId === 'run-a' ? 'software GL, 4 cores' : 'GPU, 16 cores',
  gaps: [],
  replay: {
    frames: 2,
    passes: 4,
    draws: 30,
    programs: 6,
    bytes: 3_000_000,
    canvas: 0.99312345,
    page: 0.98,
    shipped: true,
    errors: [],
    rebuild: { canvas: 0.97, page: 0.97, vsReplay: 0.99, errors: [] },
  },
});

async function makeClient(name: string, web: Record<string, { body: string; type?: string }>, now: number) {
  const f = (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.entries(web).find(([k]) => url.includes(k));
    return hit
      ? new Response(hit[1].body, { status: 200, headers: { 'content-type': hit[1].type ?? 'application/json' } })
      : new Response('not found', { status: 404 });
  }) as typeof fetch;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer({ web: { fetch: f, sleep: async () => {}, now: () => now, home: webHome } }).connect(a);
  const client = new Client({ name, version: name === 'client-one' ? '1.0.0' : '9.9.9' });
  await client.connect(b);
  return client;
}

/** What two clients compare: the deterministic text block and the structured result. */
const core = (r: any) => ({
  text: r.content[0].text as string,
  result: r.structuredContent.result,
  tool: r.structuredContent.tool,
  schema: r.structuredContent.schema,
});

let one: Client;
let two: Client;

beforeAll(async () => {
  const w = await new RunWriter('20261103-090000-fixture-test-0a1b2c3d', join(home, 'runs')).init();
  await w.json('run.json', {
    meta: {
      schema: 'dea.run/1',
      id: w.id,
      kind: 'extract',
      url: 'https://fixture.test',
      finalUrl: 'https://fixture.test/',
      title: 'Fixture',
      status: 200,
      startedAt: '2026-11-03T09:00:00Z',
      finishedAt: '2026-11-03T09:00:05Z',
      files: {},
      warnings: [],
    },
    stack: [],
    facts: [],
  });
  await w.json('evidence.json', await buildLedger(ledgerInput('run-a')));
  const web = {
    'html.duckduckgo.com/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
    'html.duckduckgo.com/html': { body: await fx('duckduckgo.html.txt'), type: 'text/html' },
    'wikipedia.org': { body: await fx('wikipedia.json') },
    'fixture.test/robots.txt': { body: 'User-agent: *\nAllow: /', type: 'text/plain' },
    'fixture.test/page': { body: PAGE, type: 'text/html' },
  };
  one = await makeClient('client-one', web, Date.parse('2026-11-05T10:00:00Z'));
  two = await makeClient('client-two', web, Date.parse('2026-11-05T17:45:00Z')); // another clock reading, another client
});

afterAll(async () => {
  await one?.close();
  await two?.close();
  await rm(home, { recursive: true, force: true });
  await rm(webHome, { recursive: true, force: true });
});

describe('same inputs, same outputs, whichever AI drives it', () => {
  it('search: two clients, other argument order and spelling, other time, identical result text', async () => {
    const a = await one.callTool({ name: 'search', arguments: { query: 'mount everest', sources: ['duckduckgo', 'wikipedia'], limit: 5 } });
    // client two: sources reversed and capitalised, extra spaces in the query, limit left to the default, fresh asked for
    const b = await two.callTool({ name: 'search', arguments: { fresh: true, query: '  mount everest ', sources: ['Wikipedia', 'DuckDuckGo'], limit: 8 } });
    expect(a.isError).toBeFalsy();
    const ca = core(a);
    const cb = core(b);
    expect(ca.result.results.length).toBeGreaterThan(2);
    expect(cb.result.results.slice(0, ca.result.results.length)).toEqual(ca.result.results.slice(0, cb.result.results.length));
    // the same arguments, same text: client two with the very arguments client one used
    const c = await two.callTool({ name: 'search', arguments: { limit: 5, query: 'mount everest', sources: ['wikipedia', 'duckduckgo'] } });
    expect(core(c).text).toBe(ca.text);
    expect(core(c)).toEqual(ca);
    // the volatile part is said to be volatile: times and cache state live in meta, not in the result
    expect(ca.text).not.toMatch(/fetched_at|verified|2026-11-05/);
    expect((a.structuredContent as any).meta.fetched_at).toBe('2026-11-05T10:00:00.000Z');
    expect((c.structuredContent as any).meta.label).toBe('cached'); // client two's cache state differs, its result does not
  });

  it('read: identical result, volatile fields apart', async () => {
    const a = await one.callTool({ name: 'read', arguments: { url: 'https://fixture.test/page', links: true } });
    const b = await two.callTool({ name: 'read', arguments: { links: true, url: 'https://fixture.test/page' } });
    expect(a.isError).toBeFalsy();
    expect(core(a).result.text).toContain('Same words every time.');
    expect(core(b).text).toBe(core(a).text);
    expect((a.structuredContent as any).meta.verified).toBe(true);
    expect((b.structuredContent as any).meta.fetched_at).not.toBe((a.structuredContent as any).meta.fetched_at); // the other clock reading is meta, not result
  });

  it('report and list_runs: identical in any call order', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['report', { run: 'latest', which: 'evidence' }],
      ['report', { run: 'latest', which: 'evidence', detail: 'full' }],
      ['report', { run: 'latest', which: 'json' }],
      ['list_runs', { limit: 20 }],
    ];
    const forward = [];
    for (const [name, args] of calls) forward.push(core(await one.callTool({ name, arguments: args })));
    const backward = [];
    for (const [name, args] of [...calls].reverse()) backward.unshift(core(await two.callTool({ name, arguments: args })));
    expect(backward.map((x) => x.text)).toEqual(forward.map((x) => x.text));
    for (const x of forward) expect(x.schema).toBe('dea.result/1');
    expect(JSON.stringify(forward[1].result)).toContain('0.993'); // scores come back rounded to 3 decimals
    expect(JSON.stringify(forward[1].result)).not.toContain('0.99312345');
  });

  it('every structured answer has its keys in a fixed order and the same text as its structured result', async () => {
    const r = await one.callTool({ name: 'report', arguments: { run: 'latest', which: 'evidence', detail: 'full' } });
    const text = (r.content as any)[0].text as string;
    expect(JSON.parse(text)).toEqual({ ...(r.structuredContent as any), meta: undefined });
    expect(text).toBe(canonicalJson(JSON.parse(text)));
  });

  it('the ledger is a function of the measurements: other run id, time and machine, same result', async () => {
    const a = await buildLedger(ledgerInput('run-a'));
    await new Promise((r) => setTimeout(r, 5));
    const b = await buildLedger(ledgerInput('run-b'));
    expect(a.madeAt).not.toBe(b.madeAt);
    const qa = ledgerAnswer(queryLedger(a, { detail: 'full' }));
    const qb = ledgerAnswer(queryLedger(b, { detail: 'full' }));
    expect(canonicalJson(qa.result)).toBe(canonicalJson(qb.result));
    expect(qa.meta).not.toEqual(qb.meta);
    expect(JSON.stringify(qa.result)).not.toMatch(/run-a|software GL/);
  });
});
