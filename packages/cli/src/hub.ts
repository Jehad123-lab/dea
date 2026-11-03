import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CATALOG,
  checkName,
  connectServer,
  findCatalog,
  Hub,
  hubHome,
  LEVELS,
  type Level,
  listAllTools,
  loadHub,
  parseServersConfig,
  readHistory,
  SecretStore,
  type ServerDef,
  updateHub,
} from '@dea/core';
import type { Command } from 'commander';
import { launchers } from './paths.ts';

const out = (s: string) => process.stdout.write(`${s}\n`);

/** Open a URL in the user's browser (no dependency: the OS's own opener). */
export function openBrowser(url: string): void {
  const p = platform();
  const [cmd, args] = p === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : p === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    /* printed below anyway */
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export function registerHub(program: Command, run: (fn: () => Promise<void>) => Promise<void>): void {
  const hub = program
    .command('hub')
    .description(
      'DEA Hub: connect your apps once (Notion, Linear, Figma, GitHub, any MCP server), then let each AI app use them through DEA with the access you choose',
    );

  hub
    .command('add')
    .description(
      'add an MCP server: a command (stdio) or an https URL, or --json with a standard mcpServers config. Put -- before a command that has its own flags: dea hub add files -- npx -y @modelcontextprotocol/server-filesystem .',
    )
    .argument('[name]', 'a short name, e.g. files')
    .argument('[target...]', 'the command and its arguments, or the server URL')
    .option('--json <file>', 'import servers from a Claude Desktop / Cursor / VS Code config file ("-" reads stdin)')
    .option('--env <KEY=VALUE...>', 'environment for a stdio server (a value of $' + '{env:NAME} reads your own environment at start)')
    .option('--header <Name: value...>', 'a header for a URL server; the value is stored encrypted')
    .option('--sse', 'the server speaks the older SSE transport')
    .action((name: string | undefined, target: string[], f: { json?: string; env?: string[]; header?: string[]; sse?: boolean }) =>
      run(async () => {
        if (f.json) {
          const text = f.json === '-' ? await readStdin() : await readFile(f.json, 'utf8');
          const servers = parseServersConfig(text);
          await updateHub((c) => {
            Object.assign(c.mcpServers, servers);
          });
          out(`Added ${Object.keys(servers).length} server(s): ${Object.keys(servers).join(', ')}`);
          return;
        }
        if (!name || !target.length) throw new Error('Usage: dea hub add <name> <command...|url>   or   dea hub add --json config.json');
        checkName('Server', name);
        const env = Object.fromEntries((f.env ?? []).map((kv) => [kv.split('=')[0], kv.split('=').slice(1).join('=')]));
        let def: ServerDef;
        if (/^https?:\/\//.test(target[0])) {
          const u = new URL(target[0]);
          if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) throw new Error('Remote servers must use https.');
          const headers = Object.fromEntries((f.header ?? []).map((h) => [h.split(':')[0].trim(), h.split(':').slice(1).join(':').trim()]));
          if (Object.keys(headers).length)
            await new SecretStore().patch(name, (s) => {
              s.headers = { ...(s.headers ?? {}), ...headers };
            });
          def = {
            url: u.toString(),
            ...(f.sse ? { type: 'sse' as const } : {}),
            ...(Object.keys(headers).length ? { secretHeaders: Object.keys(headers) } : {}),
          };
        } else def = { command: target[0], args: target.slice(1), ...(Object.keys(env).length ? { env } : {}) };
        await updateHub((c) => {
          c.mcpServers[name] = def;
        });
        out(`Added "${name}". Check it with: dea hub tools ${name}`);
      }),
    );

  hub
    .command('connect')
    .description('connect an app that runs an official MCP server, by name (see dea hub catalog) or URL: logs you in with OAuth in your browser')
    .argument('<app>', 'catalog name (notion, linear, figma, github, ...) or an https MCP URL')
    .option('--name <name>', 'name to save it under (default: the catalog name or the URL host)')
    .option('--client-id <id>', 'your own OAuth app client id, for apps without dynamic registration')
    .option('--scope <scopes>', 'OAuth scopes to ask for (space separated)')
    .option('--token-env <VAR>', 'use a token from this environment variable as a Bearer header instead of OAuth (stored encrypted)')
    .option('--no-open', 'print the login link instead of opening the browser')
    .action((app: string, f: { name?: string; clientId?: string; scope?: string; tokenEnv?: string; open: boolean }) =>
      run(async () => {
        const cat = findCatalog(app);
        const url = cat?.url ?? (/^https:\/\//.test(app) ? app : null);
        if (!url) throw new Error(`"${app}" is not in the catalog. See "dea hub catalog", or pass the server's https URL.`);
        const name = checkName('App', f.name ?? cat?.name ?? new URL(url).hostname.replace(/^(mcp|api)\./, '').split('.')[0]);
        if (cat && !cat.dcr && !cat.open && !f.clientId && !f.tokenEnv)
          out(`Note: ${cat.note ?? `${cat.title} does not allow automatic registration; pass --client-id or --token-env.`}`);
        const secrets = new SecretStore();
        const def: ServerDef = {
          url,
          ...(f.clientId || f.scope
            ? { oauth: { ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.scope ? { scopes: f.scope.split(/\s+/) } : {}) } }
            : {}),
        };
        if (f.tokenEnv) {
          const tok = process.env[f.tokenEnv];
          if (!tok) throw new Error(`$${f.tokenEnv} is empty.`);
          await secrets.patch(name, (s) => {
            s.headers = { ...(s.headers ?? {}), Authorization: `Bearer ${tok}` };
          });
          (def as { secretHeaders?: string[] }).secretHeaders = ['Authorization'];
        }
        out(`Connecting ${cat?.title ?? url} ...`);
        const client = await connectServer(name, def, {
          secrets,
          interactive: true,
          onAuthorize: (u) => {
            out(`\nLog in here (DEA is waiting on 127.0.0.1 for the answer):\n${u.toString()}\n`);
            if (f.open) openBrowser(u.toString());
          },
        });
        const tools = await listAllTools(client);
        await client.close();
        await updateHub((c) => {
          c.mcpServers[name] = def;
        });
        const ro = tools.filter((t) => t.annotations?.readOnlyHint).length;
        out(
          `Connected "${name}": ${tools.length} tools (${ro} read-only). AI apps get read-only access by default; change it with: dea hub allow <client> ${name} full`,
        );
      }),
    );

  hub
    .command('catalog')
    .description('apps with official MCP servers DEA can connect by name')
    .action(() =>
      run(async () => {
        for (const c of CATALOG)
          out(`${c.name.padEnd(16)} ${c.title.padEnd(30)} ${c.open ? 'no login' : c.dcr ? 'one-click login' : 'needs your own app id or token'}`);
      }),
    );

  hub
    .command('list')
    .description('connected apps and AI clients with their access')
    .action(() =>
      run(async () => {
        const cfg = await loadHub();
        const secrets = await new SecretStore().readAll().catch(() => ({}) as Record<string, any>);
        out('Apps:');
        if (!Object.keys(cfg.mcpServers).length)
          out('  none yet: dea hub connect notion   or   dea hub add files -- npx -y @modelcontextprotocol/server-filesystem .');
        for (const [n, d] of Object.entries(cfg.mcpServers)) {
          const how = 'command' in d ? `stdio: ${d.command} ${(d.args ?? []).join(' ')}` : `${d.type === 'sse' ? 'sse' : 'http'}: ${d.url}`;
          const login = 'url' in d ? ((secrets as any)[n]?.tokens ? ' (logged in)' : (secrets as any)[n]?.headers ? ' (token)' : '') : '';
          out(`  ${n.padEnd(16)} ${how}${login}${d.disabled ? ' [disabled]' : ''}`);
        }
        out(`\nAI clients (new ones get "${cfg.defaultLevel}" on every app; alert: pause after ${cfg.alert.max} changing calls in ${cfg.alert.minutes} min):`);
        if (!Object.keys(cfg.clients).length) out('  none yet: dea mcp install --client claude --hub');
        for (const [n, c] of Object.entries(cfg.clients)) {
          const grants = Object.entries(c.apps)
            .map(([a, g]) => `${a}=${g.level}${g.level === 'selected' ? `(${(g.tools ?? []).join(',')})` : ''}`)
            .join(' ');
          out(
            `  ${n.padEnd(16)} ${c.enabled ? 'on ' : 'OFF'} ${grants || `(${c.defaultLevel ?? cfg.defaultLevel} everywhere)`}${c.pausedReason ? `  ← ${c.pausedReason}` : ''}`,
          );
        }
      }),
    );

  hub
    .command('tools')
    .description("an app's tools, marked read-only or changing")
    .argument('<app>')
    .action((app: string) =>
      run(async () => {
        const h = new Hub();
        try {
          const tools = await h.appTools(app);
          for (const t of tools)
            out(
              `${t.annotations?.readOnlyHint ? 'read  ' : t.annotations?.destructiveHint === false ? 'write ' : 'change'}  ${t.name.padEnd(32)} ${(t.description ?? '').split('\n')[0].slice(0, 90)}`,
            );
          out(`\n${tools.length} tools.`);
        } finally {
          await h.close();
        }
      }),
    );

  hub
    .command('call')
    .description('call an app tool yourself, through the same checks and history as an AI client (client name "cli")')
    .argument('<app>')
    .argument('<tool>')
    .argument('[json]', 'arguments as JSON', '{}')
    .option('--as <client>', 'act as this client (to test its permissions)', 'cli')
    .action((app: string, tool: string, json: string, f: { as: string }) =>
      run(async () => {
        const h = new Hub();
        try {
          const r = await h.call(f.as, app, tool, JSON.parse(json));
          for (const c of r.content ?? []) out(c.type === 'text' ? String((c as { text?: string }).text) : `[${c.type}]`);
          if (r.isError) process.exitCode = 1;
        } finally {
          await h.close();
        }
      }),
    );

  hub
    .command('allow')
    .description('set what an AI client may do with an app: full, read (read-only tools), selected (--tools), or off')
    .argument('<client>', 'claude, cursor, vscode, windsurf, codex, or any name')
    .argument('<app>', 'an app name, or * for every app')
    .argument('<level>', LEVELS.join(' | '))
    .option('--tools <names>', 'for "selected": comma-separated tool names')
    .action((client: string, app: string, level: string, f: { tools?: string }) =>
      run(async () => {
        if (!LEVELS.includes(level as Level)) throw new Error(`Level must be one of: ${LEVELS.join(', ')}`);
        checkName('Client', client);
        const cfg = await updateHub((c) => {
          const cl = c.clients[client] ?? { enabled: true, apps: {} };
          if (app === '*') cl.defaultLevel = level as Level;
          else {
            if (!c.mcpServers[app]) throw new Error(`No app "${app}". See: dea hub list`);
            cl.apps[app] = { level: level as Level, ...(level === 'selected' ? { tools: (f.tools ?? '').split(',').filter(Boolean) } : {}) };
          }
          c.clients[client] = cl;
        });
        out(`${client} → ${app}: ${level}${level === 'selected' ? ` (${cfg.clients[client].apps[app]?.tools?.join(', ') || 'no tools yet'})` : ''}`);
      }),
    );

  hub
    .command('off')
    .description('switch an AI client off: every hub call it makes is refused at once')
    .argument('<client>')
    .action((client: string) =>
      run(async () => {
        await updateHub((c) => {
          c.clients[client] = {
            ...(c.clients[client] ?? { apps: {} }),
            enabled: false,
            pausedReason: 'switched off by you',
            pausedAt: new Date().toISOString(),
          };
        });
        out(`${client} is off. Nothing it asks DEA Hub for will run. Back on: dea hub on ${client}`);
      }),
    );

  hub
    .command('on')
    .description('switch an AI client back on')
    .argument('<client>')
    .action((client: string) =>
      run(async () => {
        await updateHub((c) => {
          const cl = c.clients[client] ?? { apps: {}, enabled: true };
          cl.enabled = true;
          delete cl.pausedReason;
          delete cl.pausedAt;
          c.clients[client] = cl;
        });
        out(`${client} is on.`);
      }),
    );

  hub
    .command('alert')
    .description('the safety rule: pause a client that makes more than <max> changing calls in <minutes>')
    .argument('<max>')
    .argument('<minutes>')
    .action((max: string, minutes: string) =>
      run(async () => {
        await updateHub((c) => {
          c.alert = { max: Math.max(0, Number(max)), minutes: Math.max(1, Number(minutes)) };
        });
        out(`Alert: pause after more than ${max} changing calls in ${minutes} min.`);
      }),
    );

  hub
    .command('history')
    .description('every call AI clients made through the hub (arguments summarised, secrets hidden)')
    .option('--client <name>')
    .option('--app <name>')
    .option('-n, --limit <n>', 'how many', '30')
    .option('--json')
    .action((f: { client?: string; app?: string; limit: string; json?: boolean }) =>
      run(async () => {
        const h = await readHistory({ client: f.client, app: f.app, limit: Number(f.limit) });
        if (f.json) {
          out(JSON.stringify(h, null, 2));
          return;
        }
        if (!h.length) {
          out('No calls yet.');
          return;
        }
        for (const l of h)
          out(
            `${l.t.replace('T', ' ').slice(0, 19)}  ${l.client.padEnd(10)} ${`${l.app}.${l.tool}`.padEnd(36)} ${l.blocked ? 'BLOCKED' : l.ok ? 'ok     ' : 'error  '} ${l.destructive ? '✎' : ' '} ${l.args.slice(0, 80)}${l.blocked ? `\n${' '.repeat(21)}↳ ${l.blocked}` : l.error ? `\n${' '.repeat(21)}↳ ${l.error}` : ''}`,
          );
      }),
    );

  hub
    .command('remove')
    .description('remove an app and its stored login')
    .argument('<app>')
    .action((app: string) =>
      run(async () => {
        await updateHub((c) => {
          if (!c.mcpServers[app]) throw new Error(`No app "${app}".`);
          delete c.mcpServers[app];
          for (const cl of Object.values(c.clients)) delete cl.apps[app];
        });
        await new SecretStore().remove(app);
        out(`Removed "${app}" and its stored login.`);
      }),
    );

  hub
    .command('serve')
    .description('run the hub as an MCP server for one AI client (this is what AI apps start; see dea mcp install --hub)')
    .requiredOption('--client <name>', 'which AI client this is: its permissions apply')
    .action(async (f: { client: string }) => {
      checkName('Client', f.client);
      const { serveGateway } = await import('../../mcp/src/gateway-stdio.ts');
      await serveGateway(f.client);
    });

  // ---------------- dea mcp install
  const mcp = program.command('mcp').description('connect DEA to AI apps');
  mcp
    .command('install')
    .description('add DEA to an AI app’s MCP config: claude (Desktop), claude-code, cursor, vscode, windsurf, codex')
    .requiredOption('--client <app>', 'claude | claude-code | cursor | vscode | windsurf | codex')
    .option('--hub', 'also add DEA Hub (your connected apps, with this client’s permissions)')
    .option('--project', 'write the project config in this folder instead of your user config (cursor, vscode, claude-code)')
    .option('--dry-run', 'print what would be written')
    .action((f: { client: string; hub?: boolean; project?: boolean; dryRun?: boolean }) =>
      run(async () => {
        const r = await installClient(f.client, { hub: f.hub, project: f.project, dryRun: f.dryRun });
        out(r);
      }),
    );
}

// ---------------- client configs

export interface ClientTarget {
  file: string;
  /** "mcpServers" for most; VS Code uses "servers"; Codex is TOML */
  key: 'mcpServers' | 'servers' | 'toml';
}

export function clientTarget(client: string, o: { project?: boolean; home?: string; appData?: string; os?: string; cwd?: string } = {}): ClientTarget {
  const home = o.home ?? homedir();
  const os = o.os ?? platform();
  const cwd = o.cwd ?? process.cwd();
  const appData = o.appData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const userCfg = (app: string) =>
    os === 'win32' ? join(appData, app) : os === 'darwin' ? join(home, 'Library', 'Application Support', app) : join(home, '.config', app);
  switch (client) {
    case 'claude':
    case 'claude-desktop':
      return { file: join(userCfg('Claude'), 'claude_desktop_config.json'), key: 'mcpServers' };
    case 'claude-code':
      return { file: o.project ? join(cwd, '.mcp.json') : join(home, '.claude.json'), key: 'mcpServers' };
    case 'cursor':
      return { file: o.project ? join(cwd, '.cursor', 'mcp.json') : join(home, '.cursor', 'mcp.json'), key: 'mcpServers' };
    case 'vscode':
      return { file: o.project ? join(cwd, '.vscode', 'mcp.json') : join(userCfg('Code'), 'User', 'mcp.json'), key: 'servers' };
    case 'windsurf':
      return { file: join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers' };
    case 'codex':
      return { file: join(home, '.codex', 'config.toml'), key: 'toml' };
    default:
      throw new Error(`Unknown client "${client}". Use: claude, claude-code, cursor, vscode, windsurf, codex`);
  }
}

type Launchers = Pick<ReturnType<typeof launchers>, 'node' | 'mcp' | 'cli'>;

export function entriesFor(client: string, o: { hub?: boolean; l?: Launchers } = {}): Record<string, { command: string; args: string[] }> {
  const l = o.l ?? launchers();
  const name = client === 'claude-desktop' ? 'claude' : client;
  const e: Record<string, { command: string; args: string[] }> = { dea: { command: l.node, args: [l.mcp] } };
  if (o.hub) e['dea-hub'] = { command: l.node, args: [l.cli, 'hub', 'serve', '--client', name] };
  return e;
}

/** Merge DEA's entries into the client's config file, keeping everything else; backs the old file up first. */
export async function installClient(
  client: string,
  o: { hub?: boolean; project?: boolean; dryRun?: boolean; target?: ClientTarget; l?: Launchers } = {},
): Promise<string> {
  const t = o.target ?? clientTarget(client, { project: o.project });
  const entries = entriesFor(client, { hub: o.hub, l: o.l });
  const before = await readFile(t.file, 'utf8').catch(() => null);
  let text: string;
  if (t.key === 'toml') {
    let toml = before ?? '';
    for (const [n, e] of Object.entries(entries)) {
      const block = `[mcp_servers.${n}]\ncommand = ${JSON.stringify(e.command)}\nargs = [${e.args.map((a) => JSON.stringify(a)).join(', ')}]\n`;
      const re = new RegExp(`\\[mcp_servers\\.${n.replace('-', '\\-')}\\]\\n(?:(?!\\[)[^\\n]*\\n?)*`, 'm');
      toml = re.test(toml) ? toml.replace(re, block) : `${toml}${toml && !toml.endsWith('\n') ? '\n' : ''}${toml ? '\n' : ''}${block}`;
    }
    text = toml;
  } else {
    const j = before?.trim() ? (JSON.parse(before) as Record<string, any>) : {};
    j[t.key] = { ...(j[t.key] ?? {}) };
    for (const [n, e] of Object.entries(entries)) j[t.key][n] = t.key === 'servers' ? { type: 'stdio', ...e } : e;
    text = `${JSON.stringify(j, null, 2)}\n`;
  }
  if (o.dryRun) return `Would write ${t.file}:\n${text}`;
  await mkdir(dirname(t.file), { recursive: true });
  if (before !== null) await copyFile(t.file, `${t.file}.dea-backup`);
  await writeFile(t.file, text);
  if (o.hub) {
    await updateHub((c) => {
      const n = client === 'claude-desktop' ? 'claude' : client;
      c.clients[n] ??= { enabled: true, apps: {} };
    });
  }
  return `Added ${Object.keys(entries).join(' and ')} to ${t.file}${before !== null ? ` (old file kept as ${t.file}.dea-backup)` : ''}.\nRestart ${client} to load it.${o.hub ? ` Hub access for ${client}: read-only on every app until you run  dea hub allow ${client} <app> full` : ''}`;
}

export { hubHome, launchers };
