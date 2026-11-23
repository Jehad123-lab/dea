#!/usr/bin/env node
// stdout is the MCP protocol channel: never console.log here. Diagnostics go to stderr.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runInvestigation } from '@dea/core';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.ts';

// MCP apps start servers from unpredictable folders; keep runs in one place unless told otherwise.
process.env.DEA_HOME ??= join(homedir(), '.dea');

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (argv[0] === 'investigate' && flag('--resume')) {
  // the detached worker behind the investigate tool: finish the run from its checkpoint, then exit
  const browser = flag('--browser') as 'auto' | 'chrome' | 'msedge' | 'chromium' | undefined;
  try {
    await runInvestigation({ resume: flag('--resume') as string }, { browser, headless: true });
    process.exit(0);
  } catch (e) {
    console.error(`dea-mcp investigate: ${(e as Error).message}`);
    process.exit(1);
  }
} else if (argv.includes('--http')) {
  const { serveHttpFromArgs } = await import('./http.ts');
  await serveHttpFromArgs(argv, 'dea-mcp');
} else if (argv.includes('--help') || argv.includes('-h')) {
  console.error(`dea-mcp: DEA's MCP server (decode any website's stack, design, code and APIs, with evidence).

  dea-mcp                 serve on stdio (what AI apps start)
  dea-mcp --http          serve over Streamable HTTP on 127.0.0.1:7341 with a bearer token
     --port <n>  --host <addr>  --client <name>  --new-token
  dea-mcp --version`);
} else if (argv.includes('--version') || argv.includes('-v')) {
  console.error('0.2.0');
} else {
  serveStdio(() => createServer(), { onerror: (e) => console.error(`dea-mcp: ${e.message}`) });
  console.error(`dea MCP server running on stdio (runs saved in ${process.env.DEA_HOME})`);
}
