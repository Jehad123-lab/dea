import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HandsSession } from '../src/hands/session.ts';
import { parsePolicy } from '../src/safety/policy.ts';

// A tiny local site: an order form, a login form, and a link that leaves the allowed domain.
const PAGES: Record<string, string> = {
  '/': `<!doctype html><title>Shop</title><h1>Order</h1>
    <form action="/post" method="post">
      <label>Name <input name="name"></label>
      <label>Size <select name="size"><option>s</option><option>m</option></select></label>
      <label><input type="checkbox" name="gift"> Gift</label>
      <button>Place order</button>
    </form>
    <a href="/login">Login</a> <a href="http://other.invalid/">Elsewhere</a>`,
  '/login': `<!doctype html><title>Login</title><form action="/session" method="post">
    <label>User <input name="user"></label><label>Password <input type="password" name="password"></label>
    <button>Sign in</button></form>`,
};

let server: Server;
let base = '';
const posts: string[] = [];
const root = await mkdtemp(join(tmpdir(), 'dea-hands-'));

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        posts.push(`${req.url} ${b}`);
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<title>Thanks</title><p>Got it</p>');
      });
      return;
    }
    res.writeHead(PAGES[req.url ?? ''] ? 200 : 404, { 'content-type': 'text/html' });
    res.end(PAGES[req.url ?? ''] ?? 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server?.close();
  await rm(root, { recursive: true, force: true });
});

const browser = (process.env.DEA_BROWSER as 'chromium' | 'msedge' | 'chrome' | undefined) ?? 'chromium';

describe.skipIf(!process.env.DEA_E2E)('hands in a real browser', () => {
  it('fills a form without submitting, asks before submitting, and logs everything', async () => {
    const s = await HandsSession.start({ browser, runsRoot: root, policy: parsePolicy({ allowedDomains: ['127.0.0.1'] }) }, `${base}/`);
    try {
      const snap = await s.snapshot();
      const tree = (snap.data as { snapshot: string }).snapshot;
      const ref = (label: RegExp) => {
        const m = tree
          .split('\n')
          .find((l) => label.test(l))
          ?.match(/\[ref=(\w+)\]/);
        if (!m) throw new Error(`no ref for ${label} in\n${tree}`);
        return m[1];
      };
      const name = ref(/textbox "Name"/);
      const order = ref(/button "Place order"/);
      const filled = await s.fill({ [name]: 'Ada', [ref(/combobox "Size"/)]: 'm', [ref(/checkbox "Gift"/)]: true });
      expect(filled.ok).toBe(true);
      expect(posts).toHaveLength(0);

      const ask = await s.click(order);
      expect(ask.decision).toBe('ask');
      expect(ask.confirm).toMatch(/^[0-9a-f]{8}$/);
      expect(JSON.stringify(ask.preview)).toContain('"name","value":"Ada"');
      expect(posts).toHaveLength(0);

      const wrong = await s.click(order, { confirm: 'deadbeef' });
      expect(wrong.decision).toBe('ask');
      expect(posts).toHaveLength(0);

      const yes = await s.click(order, { confirm: ask.confirm });
      expect(yes.decision).toBe('allow');
      expect(yes.ok).toBe(true);
      expect(posts).toEqual(['/post name=Ada&size=m&gift=on']);

      const away = await s.goto('http://other.invalid/');
      expect(away.decision).toBe('deny');

      await s.goto(`${base}/login`);
      const t2 = ((await s.snapshot()).data as { snapshot: string }).snapshot;
      const pw = t2
        .split('\n')
        .find((l) => /textbox "Password"/.test(l))
        ?.match(/\[ref=(\w+)\]/)?.[1] as string;
      const signIn = t2
        .split('\n')
        .find((l) => /button "Sign in"/.test(l))
        ?.match(/\[ref=(\w+)\]/)?.[1] as string;
      expect((await s.type(pw, 'hunter2')).decision).toBe('deny');
      expect((await s.click(signIn, { confirmed: true })).decision).toBe('deny');
      expect(posts).toHaveLength(1);
    } catch (e) {
      await s.close();
      throw e;
    }
    {
      const r = await s.close();
      const log = (await readFile(join(r.dir, 'actions.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(log.map((l) => `${l.action}:${l.decision}`)).toEqual([
        'goto:allow',
        'snapshot:allow',
        'fill:allow',
        'submit:ask',
        'submit:ask',
        'submit:allow',
        'goto:deny',
        'goto:allow',
        'snapshot:allow',
        'type:deny',
        'submit:deny',
      ]);
      expect(JSON.stringify(log)).not.toContain('hunter2');
      expect(await readFile(join(r.dir, 'report.md'), 'utf8')).toContain('every one after an explicit OK');
    }
  });

  it('restricted mode looks and scrolls but never touches', async () => {
    const s = await HandsSession.start({ browser, runsRoot: root, policy: parsePolicy({ mode: 'restricted' }), shots: false }, `${base}/`);
    try {
      expect((await s.scroll({ by: 300 })).decision).toBe('allow');
      expect((await s.snapshot()).ok).toBe(true);
      expect((await s.click('text=Login')).decision).toBe('deny');
      expect((await s.type('input[name=name]', 'x')).decision).toBe('deny');
    } finally {
      await s.close();
    }
  });
});
