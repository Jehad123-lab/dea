import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Redactor, readApproval, requestApproval } from '@dea/core';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

/** Run a command to the end with its output in memory (no server is left behind: these commands exit). */
function run(args: string[], input?: string, env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((res) => {
    const p = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ code, out }));
    p.stdin.end(input ?? '');
  });
}

describe('supervised-mode approvals through a real stdio MCP client script', () => {
  it('walks the documented flow and every check passes', async () => {
    const r = await run(['packages/mcp/scripts/approval-flow.ts']);
    expect(r.out).toContain('all checks passed');
    expect(r.out).not.toContain('FAIL');
    expect(r.code).toBe(0);
  }, 120_000);
  it('dea hub approve refuses without a terminal: a piped yes does not approve', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dea-approve-'));
    try {
      const rec = await requestApproval(
        { client: 'demo', app: 'files', tool: 'write_file', where: 'create x.txt', mode: 'supervised', args: { path: 'x.txt' }, redact: new Redactor() },
        home,
      );
      const r = await run(['packages/cli/src/index.ts', 'hub', 'approve', rec.id], 'y\n', { DEA_HUB_HOME: home });
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/needs a terminal/);
      expect((await readApproval(rec.id, home))?.status).toBe('pending');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 60_000);
});
