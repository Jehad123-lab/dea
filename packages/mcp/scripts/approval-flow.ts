// A real MCP client talking to `dea hub serve` over stdio, walking through supervised-mode approvals.
// Run:  pnpm demo:approval      (no network, no token: it uses a temp folder and a temp DEA home, and cleans up)
//
// Part A: a client that CAN show questions (MCP elicitation): the question goes through it.
// Part B: a client that CANNOT: the change waits as an approval; the "person" approves it in their terminal
//         (here the script plays the person by calling the same function `dea hub approve` calls); the client asks again.
// It exits with code 1 if anything differs from what the documentation says.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { updateHub } from '@dea/core';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { approveFlow } from '../../cli/src/hub.ts';

const root = resolve(import.meta.dirname, '../../..');
const text = (r: unknown) => ((r as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? '').join('\n');
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const home = await mkdtemp(join(tmpdir(), 'dea-approval-home-'));
const work = await mkdtemp(join(tmpdir(), 'dea-approval-work-'));
await mkdir(work, { recursive: true });
try {
  await updateHub((c) => {
    c.mcpServers.files = { builtin: 'filesystem', scope: { root: work } };
    c.clients.demo = { enabled: true, apps: { files: { level: 'full' } } };
  }, home);

  const connect = async (elicit: null | boolean) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', resolve(root, 'packages/cli/src/index.ts'), 'hub', 'serve', '--client', 'demo'],
      env: { ...process.env, DEA_HUB_HOME: home, DEA_MODE: 'supervised' } as Record<string, string>,
      cwd: root,
      stderr: 'pipe',
    });
    const asked: string[] = [];
    const client = new Client({ name: 'approval-demo', version: '1.0.0' }, elicit === null ? {} : { capabilities: { elicitation: { form: {} } } });
    if (elicit !== null)
      client.setRequestHandler('elicitation/create', async (req) => {
        asked.push(String((req.params as { message?: string }).message));
        return { action: 'accept', content: { approve: elicit } };
      });
    await client.connect(transport);
    return { client, asked };
  };
  const write = (c: Client, name: string, body: string) => c.callTool({ name: 'files__write_file', arguments: { path: name, text: body } });

  console.log('--- Part A: the client can show questions');
  const a = await connect(true);
  try {
    const r = await write(a.client, 'a.txt', 'written after a yes');
    check(!(r as { isError?: boolean }).isError && a.asked.length === 1, `the question went through the client (${a.asked.length} question), the change ran`);
    check((await readFile(join(work, 'a.txt'), 'utf8')) === 'written after a yes', 'a.txt exists');
  } finally {
    await a.client.close();
  }

  console.log('--- Part B: the client cannot show questions');
  const b = await connect(null);
  try {
    const first = await write(b.client, 'b.txt', 'needs approval');
    const msg = text(first);
    const id = /approval ([0-9a-f]{10})/.exec(msg)?.[1] ?? '';
    check((first as { isError?: boolean }).isError === true && Boolean(id), `the change waits as approval ${id || '(none)'}`);
    console.log(`     the client was told: ${msg.slice(0, 260)}`);
    check(!(await readFile(join(work, 'b.txt'), 'utf8').catch(() => null)), 'nothing was written yet');

    const again = await write(b.client, 'b.txt', 'needs approval');
    check(/approval ([0-9a-f]{10})/.exec(text(again))?.[1] === id, 'asking again gives the same id (the same call is the same approval)');

    const other = await write(b.client, 'b.txt', 'a different body');
    check(/approval ([0-9a-f]{10})/.exec(text(other))?.[1] !== id, 'different arguments are a different approval');

    // the person, in a terminal
    check(
      await approveFlow(id, async () => 'unavailable', home).then(
        () => false,
        (e) => /needs a terminal/.test((e as Error).message),
      ),
      'with no keyboard (piped input) approving is refused',
    );
    console.log(`     person: ${await approveFlow(id, async () => true, home)}`);

    const retry = await write(b.client, 'b.txt', 'needs approval');
    check(!(retry as { isError?: boolean }).isError && (await readFile(join(work, 'b.txt'), 'utf8')) === 'needs approval', 'after approval the same call runs');

    const third = await write(b.client, 'b2.txt', 'needs approval');
    check((third as { isError?: boolean }).isError === true, 'a different file still needs its own approval');
    const replay = text(await write(b.client, 'b.txt', 'needs approval'));
    check(/waiting as approval/.test(replay), 'an approval is used up by one change: the same call waits again');
  } finally {
    await b.client.close();
  }
} finally {
  await rm(home, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
