#!/usr/bin/env node
// A tiny MCP server for tests: notes kept in memory. One read-only tool, one additive tool, one destructive tool.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

export function notesServer(): McpServer {
  const notes: string[] = ['first note'];
  const s = new McpServer({ name: 'notes', version: '1.0.0' });
  s.registerTool('list_notes', { description: 'List every note.', inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => ({
    content: [{ type: 'text', text: notes.join('\n') || '(none)' }],
  }));
  s.registerTool(
    'add_note',
    {
      description: 'Add a note.',
      inputSchema: z.object({ text: z.string(), apiKey: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ text }) => {
      notes.push(text);
      return { content: [{ type: 'text', text: `added (${notes.length})` }] };
    },
  );
  s.registerTool(
    'delete_note',
    { description: 'Delete a note by number.', inputSchema: z.object({ n: z.number().int() }), annotations: { readOnlyHint: false, destructiveHint: true } },
    async ({ n }) => {
      notes.splice(n - 1, 1);
      return { content: [{ type: 'text', text: `deleted, ${notes.length} left` }] };
    },
  );
  return s;
}

if (process.argv[1]?.endsWith('notes-server.ts')) serveStdio(notesServer);
