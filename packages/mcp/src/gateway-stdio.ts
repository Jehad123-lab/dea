#!/usr/bin/env node
// stdout is the MCP channel: diagnostics go to stderr only.
import { Hub } from '@dea/core';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createGateway } from './gateway.ts';

export async function serveGateway(client: string): Promise<void> {
  const hub = new Hub(undefined, {
    onPause: (c, why) => console.error(`dea-hub: ${c} ${why}`),
    onStderr: () => {},
  });
  const server = createGateway(client, hub);
  await server.connect(new StdioServerTransport());
  console.error(`dea-hub: serving connected apps to "${client}" on stdio`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('gateway-stdio.ts')) {
  const i = process.argv.indexOf('--client');
  await serveGateway(i > 0 ? (process.argv[i + 1] ?? 'default') : 'default');
}
