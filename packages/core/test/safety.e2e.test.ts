import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HandsSession } from '../src/hands/session.ts';
import { parsePolicy } from '../src/safety/policy.ts';

// Round 11's safety rules, proved in a real browser: a plain action that tries to change something is stopped before
// anything leaves the browser, and asks first. The server counts every request that would change data.
const PAGES: Record<string, string> = {
  '/': `<!doctype html><title>App</title>
    <div id="like" role="button" tabindex="0" onclick="fetch('/api/like', { method: 'POST', body: 'post=1' }).then(() => (document.title = 'liked'))">Like</div>
    <button type="button" id="read" onclick="fetch('/api/count').then(() => (document.title = 'read'))">Count</button>
    <a href="/logout">Log out</a>
    <form action="/search" method="post"><label>Query <input name="q"></label></form>`,
  '/logout': '<!doctype html><title>Logged out</title>',
};

let server: Server;
let base = '';
const writes: string[] = [];
const reads: string[] = [];
const root = await mkdtemp(join(tmpdir(), 'dea-safety-'));

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method !== 'GET' || url === '/logout') writes.push(`${req.method} ${url}`);
    else reads.push(url);
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end('{"ok":true}');
    }
    res.writeHead(PAGES[url] ? 200 : 404, { 'content-type': 'text/html' });
    res.end(PAGES[url] ?? 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server?.close();
  await rm(root, { recursive: true, force: true });
});

const browser = (process.env.DEA_BROWSER as 'chromium' | 'msedge' | 'chrome' | undefined) ?? 'chromium';
const policy = () => parsePolicy({ allowedDomains: ['127.0.0.1'] });

describe.skipIf(!process.env.DEA_E2E)('safety rules in a real browser (Round 11)', () => {
  it('a click whose script sends a POST is stopped, asks, and sends only after the OK', async () => {
    const s = await HandsSession.start({ browser, runsRoot: root, policy: policy(), shots: false }, `${base}/`);
    try {
      writes.length = 0;
      const ask = await s.click('#like');
      expect(ask.decision).toBe('ask');
      expect(ask.ok).toBe(false);
      expect(ask.reason).toMatch(/tried to send data \(POST 127\.0\.0\.1:\d+\/api\/like\)/);
      expect(ask.confirm).toMatch(/^[0-9a-f]{8}$/);
      expect(writes).toEqual([]);

      const yes = await s.click('#like', { confirm: ask.confirm });
      expect(yes.decision).toBe('allow');
      expect(yes.ok).toBe(true);
      expect(writes).toEqual(['POST /api/like']);
    } finally {
      await s.close();
    }
  });

  it('a click that only reads (GET) is not stopped', async () => {
    const s = await HandsSession.start({ browser, runsRoot: root, policy: policy(), shots: false }, `${base}/`);
    try {
      writes.length = 0;
      const r = await s.click('#read');
      expect(r.decision).toBe('allow');
      expect(r.ok).toBe(true);
      expect(reads).toContain('/api/count');
      expect(writes).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it('opening a logout link asks first, typed or clicked', async () => {
    const s = await HandsSession.start({ browser, runsRoot: root, policy: policy(), shots: false }, `${base}/`);
    try {
      writes.length = 0;
      const typed = await s.goto(`${base}/logout`);
      expect(typed.decision).toBe('ask');
      const clicked = await s.click('a[href="/logout"]');
      expect(clicked.decision).toBe('ask');
      expect(writes).toEqual([]);
      const yes = await s.goto(`${base}/logout`, { confirm: typed.confirm });
      expect(yes.decision).toBe('allow');
      expect(writes).toEqual(['GET /logout']);
    } finally {
      await s.close();
    }
  });

  it('pressing Enter in a form field asks, because it submits the form', async () => {
    const s = await HandsSession.start({ browser, runsRoot: root, policy: policy(), shots: false }, `${base}/`);
    try {
      writes.length = 0;
      const typed = await s.type('input[name="q"]', 'shoes');
      expect(typed.decision).toBe('allow');
      const enter = await s.type('input[name="q"]', 'shoes', { enter: true, clear: true });
      expect(enter.decision).toBe('ask');
      const press = await s.press('Enter', { target: 'input[name="q"]' });
      expect(press.decision).toBe('ask');
      expect(writes).toEqual([]);
    } finally {
      await s.close();
    }
  });
});
