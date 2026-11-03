#!/usr/bin/env node
// stdout is the MCP protocol channel: never console.log here. Diagnostics go to stderr.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.ts';

// MCP apps start servers from unpredictable folders; keep runs in one place unless told otherwise.
process.env.DEA_HOME ??= join(homedir(), '.dea');

serveStdio(createServer, { onerror: (e) => console.error(`dea-mcp: ${e.message}`) });
console.error(`dea MCP server running on stdio (runs saved in ${process.env.DEA_HOME})`);
