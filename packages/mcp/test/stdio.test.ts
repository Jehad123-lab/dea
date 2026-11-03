import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, describe, expect, it } from 'vitest';

const bin = fileURLToPath(new URL('../bin/dea-mcp.mjs', import.meta.url));
const home = await mkdtemp(join(tmpdir(), 'dea-stdio-'));
afterAll(() => rm(home, { recursive: true, force: true }));

describe('dea-mcp over real stdio', () => {
  it('starts, speaks only MCP on stdout, and lists its tools', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin],
      env: { ...process.env, DEA_HOME: home } as Record<string, string>,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'dea-stdio-test', version: '0.0.0' });
    await client.connect(transport); // any stray console.log on stdout would break this handshake
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('decode_design');
    const r = await client.callTool({ name: 'list_runs', arguments: {} });
    expect(JSON.stringify(r.content)).toContain('No runs yet');
    await client.close();
  });
});
