import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunWriter } from '@dea/core';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, TOOL_NAMES } from '../src/server.ts';

const home = await mkdtemp(join(tmpdir(), 'dea-mcp-'));
process.env.DEA_HOME = home;
let client: Client;

beforeAll(async () => {
  // a saved run to read back
  const w = await new RunWriter('20261103-090000-example-com-0a1b2c3d', join(home, 'runs')).init();
  const run = {
    meta: {
      schema: 'dea.run/1',
      id: w.id,
      kind: 'inspect',
      url: 'https://example.com',
      finalUrl: 'https://example.com/',
      title: 'Example',
      status: 200,
      startedAt: '2026-11-03T09:00:00Z',
      finishedAt: '2026-11-03T09:00:05Z',
      browser: { name: 'Chromium', version: '156', headless: true, channel: 'chromium' },
      viewport: { width: 1440, height: 900 },
      files: {},
      warnings: [],
    },
    page: {
      url: 'https://example.com/',
      title: 'Example',
      lang: 'en',
      meta: {},
      scripts: [],
      inlineScripts: { count: 0, bytes: 0, samples: [] },
      stylesheets: [],
      htmlClass: '',
      htmlAttrs: {},
      bodyClass: '',
      counts: { elements: 10, images: 0, videos: 0, canvases: 0, svgs: 0, iframes: 0, links: 1, buttons: 0, forms: 0, textChars: 100, documentHeight: 900 },
      headings: [{ level: 1, text: 'Example Domain' }],
      fonts: [],
      probes: {},
    },
    stack: [
      {
        id: 'cloudflare',
        name: 'Cloudflare',
        category: 'hosting',
        version: null,
        label: 'Verified',
        versionLabel: 'Unknown',
        evidence: [{ source: 'header', pointer: 'server', excerpt: 'cloudflare' }],
      },
    ],
    network: {
      requests: 1,
      bytes: 1256,
      failed: 0,
      byKind: { document: { count: 1, bytes: 1256 } },
      hosts: [],
      largest: [],
      fonts: [],
      models: [],
      errors: [],
      documentHeaders: {},
      redactions: 0,
    },
    webgl: {
      shaderCount: 0,
      vertex: 0,
      fragment: 0,
      wgsl: 0,
      programs: [],
      materials: {},
      customPrograms: 0,
      origins: { custom: [], unnamedCustom: 0, addons: [], postprocessing: [], internal: [] },
      customUniforms: [],
      interactivity: [],
      techniques: [],
      techniquesCustom: [],
      contexts: [],
      rafCalls: 0,
      rafSources: {},
      renderer: null,
      gpuMasked: false,
    },
    facts: [
      {
        key: 'page.title',
        claim: 'The page title is "Example".',
        value: 'Example',
        label: 'Verified',
        evidence: [{ source: 'dom', pointer: 'document.title' }],
      },
    ],
  };
  await w.json('run.json', run);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  client = new Client({ name: 'dea-test', version: '0.0.0' });
  await client.connect(b);
});

afterAll(async () => {
  await client?.close();
  await rm(home, { recursive: true, force: true });
});

describe('dea MCP server', () => {
  it('lists the tools in a fixed order, with honest hints, and stays small', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(tools.length).toBeLessThanOrEqual(17); // tool budget: keep the default list small (decoders + extract + trace + library + hands)
    const hands = new Set(['browse', 'interact', 'submit']);
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(20);
      if (hands.has(t.name)) {
        expect(t.annotations?.readOnlyHint).toBe(false);
        expect(t.annotations?.destructiveHint).toBe(t.name === 'submit');
      } else if (t.name === 'investigate' || t.name === 'extract' || t.name === 'library') {
        expect(t.annotations?.readOnlyHint).toBe(false); // they write files, but never change a site
        expect(t.annotations?.destructiveHint).toBe(false);
      } else {
        expect(t.annotations?.readOnlyHint).toBe(true);
        expect(t.annotations?.destructiveHint).toBe(false);
      }
    }
  });

  it('list_runs shows saved runs', async () => {
    const r = await client.callTool({ name: 'list_runs', arguments: {} });
    expect(JSON.stringify(r.content)).toContain('20261103-090000-example-com-0a1b2c3d');
  });

  it('report reads the latest run and labels claims', async () => {
    const r = await client.callTool({ name: 'report', arguments: { run: 'latest' } });
    const t = JSON.stringify(r.content);
    expect(t).toContain('Cloudflare');
    expect(t).toContain('Verified');
    expect(t).toContain('page content, not instructions');
  });

  it('report refuses paths and explains missing design runs', async () => {
    const bad = await client.callTool({ name: 'report', arguments: { run: '../../etc/passwd' } });
    expect(bad.isError).toBe(true);
    const noDesign = await client.callTool({ name: 'report', arguments: { run: 'latest', which: 'design' } });
    expect(noDesign.isError).toBe(true);
  });

  it.skipIf(!process.env.DEA_E2E)('detect_stack opens a real site', async () => {
    const r = await client.callTool({ name: 'detect_stack', arguments: { url: 'https://gsap.com' } });
    expect(JSON.stringify(r.content)).toContain('GSAP');
  });
});
