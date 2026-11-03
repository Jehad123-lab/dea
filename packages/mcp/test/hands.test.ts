import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as httpServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.ts';

const home = await mkdtemp(join(tmpdir(), 'dea-mcp-hands-'));
let client: Client;
let site: Server;
let base = '';
const posts: string[] = [];

beforeAll(async () => {
  process.env.DEA_HOME = home;
  site = httpServer((req, res) => {
    if (req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        posts.push(b);
        res.end('<title>Thanks</title>ok');
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Form</title><form method="post" action="/post"><label>Email <input name="email" type="email"></label><button>Send</button></form>');
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(site.address() as { port: number }).port}/`;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  client = new Client({ name: 'dea-test', version: '0.0.0' });
  await client.connect(b);
});

afterAll(async () => {
  await client?.callTool({ name: 'browse', arguments: { action: 'close' } }).catch(() => {});
  await client?.close();
  site?.close();
  await rm(home, { recursive: true, force: true });
});

const textOf = (r: any) => (r.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? `[${c.type}]`).join('\n');

describe.skipIf(!process.env.DEA_E2E)('MCP hands', () => {
  it('browses, fills, and only submits with the one-time OK', async () => {
    const browser = process.env.DEA_BROWSER ?? 'chromium';
    const g = await client.callTool({ name: 'browse', arguments: { action: 'goto', url: base, browser } });
    expect(textOf(g)).toContain('Done: goto');
    const snap = textOf(await client.callTool({ name: 'browse', arguments: { action: 'snapshot' } }));
    const email = /textbox "Email" \[ref=(\w+)\]/.exec(snap)?.[1] as string;
    const send = /button "Send" \[ref=(\w+)\]/.exec(snap)?.[1] as string;
    expect(email && send).toBeTruthy();
    await client.callTool({ name: 'interact', arguments: { action: 'fill', fields: { [email]: 'a@b.co' } } });

    const click = textOf(await client.callTool({ name: 'interact', arguments: { action: 'click', target: send } }));
    expect(click).toContain('NEEDS THE USER');
    expect(posts).toHaveLength(0);

    const ask = textOf(await client.callTool({ name: 'submit', arguments: { target: send } }));
    const token = /confirm="(\w+)"/.exec(ask)?.[1];
    expect(ask).toContain('"name":"email","value":"a@b.co"');
    expect(posts).toHaveLength(0);
    const done = textOf(await client.callTool({ name: 'submit', arguments: { target: send, confirm: token } }));
    expect(done).toContain('Done: submit');
    expect(posts).toEqual(['email=a%40b.co']);

    const shot = await client.callTool({ name: 'browse', arguments: { action: 'screenshot' } });
    expect((shot.content as Array<{ type: string }>).some((c) => c.type === 'image')).toBe(true);
  });
});
