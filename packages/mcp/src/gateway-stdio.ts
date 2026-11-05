#!/usr/bin/env node
// stdout is the MCP channel: diagnostics go to stderr only.
import { Hub, hubMode } from '@dea/core';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createGateway, elicitApprove } from './gateway.ts';

export async function serveGateway(client: string): Promise<void> {
  const mode = hubMode();
  const hub = new Hub(
    undefined,
    {
      onPause: (c, why) => console.error(`dea-hub: ${c} ${why}`),
      onStderr: () => {},
    },
    { mode },
  );
  const server = createGateway(client, hub);
  hub.opts.approve = elicitApprove(server);
  console.error(`dea-hub: permission mode ${mode}`);
  await server.connect(new StdioServerTransport());
  console.error(`dea-hub: serving connected apps to "${client}" on stdio`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('gateway-stdio.ts')) {
  const i = process.argv.indexOf('--client');
  await serveGateway(i > 0 ? (process.argv[i + 1] ?? 'default') : 'default');
}
