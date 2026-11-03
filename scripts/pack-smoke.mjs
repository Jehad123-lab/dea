#!/usr/bin/env node
// Release check without publishing: pack dea-cli and dea-mcp exactly as npm would, install the tarballs into an
// empty folder, and run them with plain node (no tsx, no workspace). Exits non-zero on any failure.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'dea-pack-'));
const win = process.platform === 'win32';
const npm = (args, cwd) =>
  execFileSync(win ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', shell: win, env: { ...process.env, npm_config_cache: join(tmp, 'cache') } });
const step = (s) => console.log(`\n== ${s}`);

try {
  step('pack');
  for (const p of ['cli', 'mcp']) npm(['pack', '--pack-destination', tmp], join(root, 'packages', p));
  const tgz = readdirSync(tmp).filter((f) => f.endsWith('.tgz'));
  console.log(tgz.join('\n'));
  if (tgz.length !== 2) throw new Error('expected two tarballs');

  step('install the tarballs into an empty project');
  const app = join(tmp, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), '{"name":"dea-smoke","private":true}\n');
  npm(['install', '--no-audit', '--no-fund', ...tgz.map((f) => join(tmp, f))], app);

  const run = (cmd, args, input) =>
    new Promise((ok, fail) => {
      const c = spawn(cmd, args, { cwd: app, shell: win, env: { ...process.env, DEA_HOME: join(tmp, 'home') } });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (err += d));
      const t = setTimeout(() => c.kill(), 30_000);
      c.on('close', (code) => {
        clearTimeout(t);
        code === 0 || input ? ok(out) : fail(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${err}`));
      });
      if (input) {
        c.stdin.write(input);
        setTimeout(() => c.stdin.end(), 3000);
      } else c.stdin.end();
    });

  step('dea --version (plain node, from dist)');
  const v = (await run(join(app, 'node_modules', '.bin', win ? 'dea.cmd' : 'dea'), ['--version'])).trim();
  console.log(v);
  if (v !== '0.1.0') throw new Error(`unexpected version ${v}`);

  step('dea --help lists serve');
  const help = await run(join(app, 'node_modules', '.bin', win ? 'dea.cmd' : 'dea'), ['--help']);
  if (!help.includes('serve')) throw new Error('serve missing from help');

  step('dea-mcp answers initialize + tools/list on stdio');
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ];
  const out = await run(join(app, 'node_modules', '.bin', win ? 'dea-mcp.cmd' : 'dea-mcp'), [], `${msgs.map((m) => JSON.stringify(m)).join('\n')}\n`);
  const list = out
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((m) => m.id === 2);
  const names = list?.result?.tools?.map((t) => t.name) ?? [];
  console.log(names.join(', '));
  if (!names.includes('decode_design')) throw new Error('decode_design missing');
  console.log('\nOK: both packages install and run from their tarballs.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
