import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import {
  auditPath,
  CATALOG,
  CONNECTORS,
  type Connector,
  capabilities,
  checkName,
  connectServer,
  decideApproval,
  findCatalog,
  findConnector,
  Hub,
  hubHome,
  hubMode,
  isEnvVarName,
  LEVELS,
  type Level,
  listAllTools,
  listApprovals,
  loadHub,
  parseServersConfig,
  readApproval,
  readAudit,
  readHistory,
  SecretStore,
  type ServerDef,
  selftest,
  selftestFailed,
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

/** Ask on the terminal. No terminal (piped input) means nobody is there to say yes: the answer is no. */
async function askYesNo(question: string): Promise<boolean | 'unavailable'> {
  if (!process.stdin.isTTY) return 'unavailable';
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question}\n[y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/**
 * `dea hub approve <id>`: show the waiting change and ask. Needs a person at a keyboard (no --yes, no piped answer): that is the
 * whole point, an AI app that only has MCP tools cannot press it.
 */
export async function approveFlow(id: string, ask: (q: string) => Promise<boolean | 'unavailable'>, home = hubHome()): Promise<string> {
  const r = await readApproval(id, home);
  if (!r) throw new Error(`There is no approval ${id}. See: dea hub approvals`);
  if (r.status !== 'pending') throw new Error(`Approval ${id} is already ${r.status}.`);
  if (Date.parse(r.expires) <= Date.now()) throw new Error(`Approval ${id} ended (it lasts ten minutes). Ask the AI to try again and a new one is made.`);
  const yes = await ask(
    `${r.client} wants to change something:\n  ${r.tool} on ${r.app}: ${r.where}\n  mode: ${r.mode}\n  arguments:\n${r.preview.replace(/^/gm, '    ')}\nAllow this one change?`,
  );
  if (yes === 'unavailable') throw new Error('Approving needs a terminal where you can type. Open one yourself and run: dea hub approve ' + id);
  if (yes !== true) return `Not approved. ${id} stays waiting until it ends; run dea hub deny ${id} to refuse it.`;
  await decideApproval(id, 'approved', home);
  return `Approved ${id}: ${r.client} can now make exactly this change once in the next ten minutes (it has to ask again).`;
}

/** key=value[,value...] pairs into a scope object: list-valued keys become arrays, true/false become booleans. */
function parseScope(pairs: string[]): Record<string, unknown> {
  const LISTS = new Set(['repos', 'projects', 'dirs', 'methods']);
  const scope: Record<string, unknown> = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i <= 0) throw new Error(`--scope wants key=value, got "${p}"`);
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    scope[k] = LISTS.has(k)
      ? v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : v === 'true'
        ? true
        : v === 'false'
          ? false
          : v;
  }
  return scope;
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
          const how =
            'builtin' in d
              ? `built-in ${d.builtin}: ${Object.entries(d.scope)
                  .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
                  .join(
                    ' ',
                  )}${d.tokenEnv ? `  (token from ${isEnvVarName(d.tokenEnv) ? `$${d.tokenEnv}` : 'a variable whose name looks like a token: remove and re-add this app'})` : ''}`
              : 'command' in d
                ? `stdio: ${d.command} ${(d.args ?? []).join(' ')}`
                : `${d.type === 'sse' ? 'sse' : 'http'}: ${d.url}`;
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
    .description(
      'call an app tool yourself, through the same checks, permission mode and history as an AI client (client name "cli"); a change asks you first in supervised mode',
    )
    .argument('<app>')
    .argument('<tool>')
    .argument('[json]', 'arguments as JSON', '{}')
    .option('--as <client>', 'act as this client (to test its permissions)', 'cli')
    .option('--yes', 'approve this one change in advance (supervised mode only; restricted still refuses, scope still applies)')
    .action((app: string, tool: string, json: string, f: { as: string; yes?: boolean }) =>
      run(async () => {
        const mode = hubMode();
        const h = new Hub(
          undefined,
          {},
          {
            mode,
            approve: async (r) =>
              f.yes === true ? true : await askYesNo(`Allow this change?\n  ${r.tool} on ${r.app}: ${r.where}\n  ${r.args}\n  mode: ${r.mode}`),
          },
        );
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
    .command('connectors')
    .description('built-in connectors (GitHub, GitLab read-only, Vercel deploy, one folder, one web address): what each needs and what its scope means')
    .action(() =>
      run(async () => {
        for (const c of Object.values(CONNECTORS)) {
          out(`${c.id.padEnd(11)} ${c.title}`);
          out(
            `            token: ${c.needsToken ? `from an environment variable (default $${c.defaultTokenEnv})` : 'optional, from an environment variable (--token-env)'}`,
          );
          for (const [k, v] of Object.entries(c.scopeHelp)) out(`            scope ${k}: ${v}`);
          out(
            `            tools: ${c.tools.map((t) => `${t.name}${(typeof t.kind === 'function' ? 'write' : t.kind) === 'write' ? '*' : ''}`).join(', ')}   (* changes things)`,
          );
        }
        out('\nAdd one:  dea hub add-connector github --scope repos=you/your-repo --token-env GITHUB_TOKEN');
      }),
    );

  hub
    .command('add-connector')
    .description('add a built-in connector with a declared scope; the token stays in YOUR environment variable, never in a file')
    .argument('<kind>', `one of: ${Object.keys(CONNECTORS).join(', ')}`)
    .option('--name <app>', 'name to use in DEA Hub (default: the kind)')
    .option('--token-env <VAR>', 'NAME of the environment variable that holds the token (never the token itself)')
    .option(
      '--scope <key=value...>',
      'scope entries, e.g. repos=a/b,c/d  root=C:\\notes  baseUrl=https://api.example.com  methods=GET,POST',
      (v, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .action((kind: string, f: { name?: string; tokenEnv?: string; scope: string[] }) =>
      run(async () => {
        const c = findConnector(kind);
        if (!c) throw new Error(`No built-in connector "${kind}". Known: ${Object.keys(CONNECTORS).join(', ')}`);
        const name = checkName('App', f.name ?? c.id);
        if (f.tokenEnv !== undefined && !isEnvVarName(f.tokenEnv))
          throw new Error(
            '--token-env takes the NAME of an environment variable (like GITHUB_TOKEN), and that looks like a token. Nothing was saved; the value was not stored or shown again. Never paste a token into a command or a chat.',
          );
        const scope = parseScope(f.scope);
        c.validateScope(scope);
        await updateHub((cfg) => {
          cfg.mcpServers[name] = {
            builtin: c.id,
            ...(f.tokenEnv ? { tokenEnv: f.tokenEnv } : c.defaultTokenEnv ? { tokenEnv: c.defaultTokenEnv } : {}),
            scope,
          };
        });
        const env = f.tokenEnv ?? c.defaultTokenEnv;
        out(`Added "${name}" (${c.id}). ${env ? `Token: from $${env} ${process.env[env] ? '(set in this shell)' : '(not set in this shell yet)'}.` : ''}`);
        out(`See what it may do: dea hub tools ${name}.  Check it: dea hub doctor${c.probe ? ' --live' : ''}.  Mode now: ${hubMode()}.`);
      }),
    );

  hub
    .command('mode')
    .description(
      'the permission mode every hub call goes through: restricted (read-only), supervised (changes ask first), delegated (changes run inside scope)',
    )
    .action(() =>
      run(async () => {
        const m = hubMode();
        out(`${m}${process.env.DEA_MODE ? ' (from DEA_MODE)' : ' (from the policy file or the default)'}`);
        out(
          m === 'restricted'
            ? 'Only reading. Changes are refused.'
            : m === 'supervised'
              ? 'Reading runs. Every change asks you first.'
              : 'Reading and changes run, but only inside each connector’s declared scope.',
        );
        out('Change it for one run:  DEA_MODE=delegated   or in policy.json: { "mode": "supervised" }');
      }),
    );

  hub
    .command('audit')
    .description('every change a connector made or was refused: what, where, when, in which mode (no secrets)')
    .option('--limit <n>', 'last n lines', '30')
    .option('--app <app>')
    .action((f: { limit: string; app?: string }) =>
      run(async () => {
        const lines = await readAudit({ limit: Number(f.limit) || 30, app: f.app });
        if (!lines.length) return void out(`No changes recorded yet (${auditPath()}).`);
        for (const l of lines)
          out(
            `${l.t.replace('T', ' ').slice(0, 19)}  ${l.stage.padEnd(7)} ${l.mode.padEnd(10)} ${`${l.app}.${l.tool}`.padEnd(28)} ${l.where}${l.stage === 'denied' || l.error ? `  — ${l.error ?? l.basis}` : ''}`,
          );
      }),
    );

  hub
    .command('install')
    .description('connect an AI app to DEA Hub: prints the config to paste; --write merges it into the app’s config file (backup kept, nothing else touched)')
    .requiredOption('--client <app>', `${CLIENTS.join(' | ')} | generic`)
    .option('--write', 'merge it into the app’s config file instead of only printing')
    .option('--with-decode', 'also add DEA’s decode tools (dea) next to the Hub (dea-hub)')
    .option('--project', 'the project config in this folder instead of your user config (cursor, vscode, claude-code)')
    .action((f: { client: string; write?: boolean; withDecode?: boolean; project?: boolean }) =>
      run(async () => {
        if (f.client !== 'generic' && !(CLIENTS as readonly string[]).includes(f.client) && f.client !== 'claude-desktop')
          throw new Error(`Unknown client "${f.client}". Use: ${CLIENTS.join(', ')}, generic`);
        if (!f.write) return void out(previewInstall(f.client, { hubOnly: !f.withDecode, project: f.project }));
        if (f.client === 'generic') throw new Error('generic has no config file DEA knows: copy the printed snippet into your client.');
        out(await installClient(f.client, { hub: true, hubOnly: !f.withDecode, project: f.project }));
      }),
    );

  hub
    .command('selftest')
    .description(
      'does this installation do what it says? offline checks always; --live also makes real read-only calls (public ones, and your tokens from GITHUB_TOKEN / VERCEL_TOKEN / GITLAB_TOKEN if set)',
    )
    .option('--live', 'make real read-only calls; a token variable that is not set is skipped, never asked for')
    .option('--json', 'print JSON')
    .action((f: { live?: boolean; json?: boolean }) =>
      run(async () => {
        const checks = await selftest({ live: f.live });
        if (f.json) out(JSON.stringify({ live: Boolean(f.live), checks }, null, 2));
        else {
          for (const c of checks) out(`${c.status === 'pass' ? 'pass' : c.status === 'skip' ? 'skip' : 'FAIL'}  [${c.group}] ${c.title}\n      ${c.note}`);
          const n = (s: string) => checks.filter((c) => c.status === s).length;
          out(`\n${n('pass')} passed, ${n('skip')} skipped, ${n('fail')} failed${f.live ? '' : '  (offline only: add --live for real calls)'}`);
        }
        if (selftestFailed(checks)) process.exitCode = 1;
      }),
    );

  hub
    .command('doctor')
    .description(
      'what works right now (browser render, PDF, search sources, tokens set) and every connected app: token present, scope valid, tools listed; --live also asks each search source and makes one harmless read per connector',
    )
    .option('--live', 'make one read call per built-in connector to prove the token works')
    .action((f: { live?: boolean }) =>
      run(async () => {
        const cfg = await loadHub();
        const names = Object.keys(cfg.mcpServers);
        out(`Mode: ${hubMode()}   Home: ${hubHome()}   Audit: ${auditPath()}\n`);
        out(`What works on this machine${f.live ? ' (asked just now)' : ''}:`);
        for (const c of await capabilities({ live: f.live }))
          out(
            `  ${c.status === 'works' ? 'ok     ' : c.status === 'limited' ? 'limited' : c.status === 'no' ? 'NO     ' : 'unknown'} ${c.title}\n          ${c.note}`,
          );
        out('');
        if (!names.length) return void out('No apps connected yet. Try: dea hub connectors');
        const h = new Hub();
        let bad = 0;
        try {
          for (const [n, d] of Object.entries(cfg.mcpServers)) {
            const row = (ok: boolean, msg: string) => {
              if (!ok) bad++;
              out(`  ${ok ? 'ok  ' : 'FAIL'} ${n.padEnd(14)} ${msg}`);
            };
            if ('builtin' in d) {
              const c = findConnector(d.builtin) as Connector | undefined;
              if (!c) {
                row(false, `unknown built-in connector "${d.builtin}"`);
                continue;
              }
              try {
                c.validateScope(d.scope);
              } catch (e) {
                row(false, `scope: ${(e as Error).message}`);
                continue;
              }
              const env = d.tokenEnv ?? c.defaultTokenEnv;
              if (env && !isEnvVarName(env)) {
                row(false, 'tokenEnv is not an environment variable name (a token was pasted there); remove this app and add it again');
                continue;
              }
              if (c.needsToken && !(env && process.env[env])) {
                row(false, `token: $${env} is not set in this shell`);
                continue;
              }
              let live = '';
              if (f.live && c.probe) {
                try {
                  live = `; live: ${await c.probe({ token: env ? process.env[env] : undefined, scope: d.scope, fetch, redact: new (await import('@dea/core')).Redactor([env ? process.env[env] : undefined]) })}`;
                } catch (e) {
                  row(false, `live check failed: ${(e as Error).message}`);
                  continue;
                }
              }
              row(true, `${c.tools.length} tools, scope valid${env ? `, $${env} ${process.env[env] ? 'set' : 'not set (optional)'}` : ''}${live}`);
            } else {
              try {
                row(true, `${(await h.appTools(n)).length} tools listed over MCP`);
              } catch (e) {
                row(false, `could not connect: ${(e as Error).message.slice(0, 160)}`);
              }
            }
          }
        } finally {
          await h.close();
        }
        if (bad) process.exitCode = 1;
      }),
    );

  hub
    .command('approvals')
    .description('changes an AI asked for that are waiting for your OK (supervised mode, when the AI app cannot show you the question itself)')
    .option('--client <name>', 'only what this AI client asked for')
    .action((f: { client?: string }) =>
      run(async () => {
        const list = (await listApprovals(hubHome())).filter(
          (r) => r.status === 'pending' && Date.parse(r.expires) > Date.now() && (!f.client || r.client === f.client),
        );
        if (!list.length) return void out(f.client ? `Nothing from ${f.client} is waiting for your OK.` : 'Nothing is waiting for your OK.');
        for (const r of list)
          out(`${r.id}  ${r.client} wants ${r.tool} on ${r.app}: ${r.where}   (until ${r.expires})\n    dea hub approve ${r.id}   or   dea hub deny ${r.id}`);
      }),
    );

  hub
    .command('approve')
    .description('say yes to ONE waiting change (shows it first; needs a terminal, so an AI app cannot press it)')
    .argument('<id>', 'the approval id the AI was given (see dea hub approvals)')
    .action((id: string) =>
      run(async () => {
        out(await approveFlow(id, askYesNo));
      }),
    );

  hub
    .command('deny')
    .description('say no to a waiting change')
    .argument('<id>')
    .action((id: string) =>
      run(async () => {
        await decideApproval(id, 'denied', hubHome());
        out(`Denied ${id}. The AI is told you declined if it asks again.`);
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

export const CLIENTS = ['claude', 'claude-code', 'cursor', 'vscode', 'windsurf', 'codex'] as const;

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
      throw new Error(`Unknown client "${client}". Use: ${CLIENTS.join(', ')}, generic`);
  }
}

type Launchers = Pick<ReturnType<typeof launchers>, 'node' | 'mcp' | 'cli'>;

export function entriesFor(client: string, o: { hub?: boolean; hubOnly?: boolean; l?: Launchers } = {}): Record<string, { command: string; args: string[] }> {
  const l = o.l ?? launchers();
  const name = client === 'claude-desktop' ? 'claude' : client;
  const e: Record<string, { command: string; args: string[] }> = o.hubOnly ? {} : { dea: { command: l.node, args: [l.mcp] } };
  if (o.hub || o.hubOnly) e['dea-hub'] = { command: l.node, args: [l.cli, 'hub', 'serve', '--client', name] };
  return e;
}

type Entries = Record<string, { command: string; args: string[] }>;

/** The text to paste into a client's MCP config: the same shape the client's own file uses. */
export function snippetFor(client: string, entries: Entries): string {
  if (client === 'codex')
    return Object.entries(entries)
      .map(([n, e]) => `[mcp_servers.${n}]\ncommand = ${JSON.stringify(e.command)}\nargs = [${e.args.map((a) => JSON.stringify(a)).join(', ')}]\n`)
      .join('\n');
  const key = client === 'vscode' ? 'servers' : 'mcpServers';
  return `${JSON.stringify({ [key]: Object.fromEntries(Object.entries(entries).map(([n, e]) => [n, key === 'servers' ? { type: 'stdio', ...e } : e])) }, null, 2)}\n`;
}

/** A backup name that does not exist yet: an earlier backup is never overwritten. */
async function freeBackupName(file: string): Promise<string> {
  const first = `${file}.dea-backup`;
  if (
    !(await readFile(first).then(
      () => true,
      () => false,
    ))
  )
    return first;
  for (let i = 2; ; i++) {
    const n = `${file}.dea-backup-${i}`;
    if (
      !(await readFile(n).then(
        () => true,
        () => false,
      ))
    )
      return n;
  }
}

/**
 * Print what DEA would put in a client's MCP config, without touching any file (what `dea hub install` does without --write).
 * `generic` is any other MCP client: the standard mcpServers snippet.
 */
export function previewInstall(client: string, o: { hubOnly?: boolean; project?: boolean; l?: Launchers; target?: ClientTarget } = {}): string {
  const entries = entriesFor(client, { hubOnly: o.hubOnly !== false, hub: true, l: o.l });
  const snippet = snippetFor(client === 'generic' ? 'claude' : client, entries);
  if (client === 'generic')
    return `Add this to your MCP client's server list (the standard "mcpServers" shape):\n\n${snippet}\nThen restart the client. Hub access starts read-only on every app: dea hub allow generic <app> full  to widen it.`;
  const t = o.target ?? clientTarget(client, { project: o.project });
  return `${client} reads its MCP servers from ${t.file}. Add:\n\n${snippet}\nOr let DEA merge it (keeping everything else, and a backup of your file):  dea hub install --client ${client} --write`;
}

/** Merge DEA's entries into the client's config file, keeping everything else; backs the old file up first, under a name that is free. */
export async function installClient(
  client: string,
  o: { hub?: boolean; hubOnly?: boolean; project?: boolean; dryRun?: boolean; target?: ClientTarget; l?: Launchers } = {},
): Promise<string> {
  const t = o.target ?? clientTarget(client, { project: o.project });
  const entries = entriesFor(client, { hub: o.hub, hubOnly: o.hubOnly, l: o.l });
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
    let j: Record<string, any>;
    try {
      j = before?.trim() ? (JSON.parse(before) as Record<string, any>) : {};
    } catch {
      throw new Error(
        `${t.file} is not plain JSON (comments or a trailing comma?), so DEA did not touch it. Add this yourself:\n\n${snippetFor(client, entries)}`,
      );
    }
    j[t.key] = { ...(j[t.key] ?? {}) };
    for (const [n, e] of Object.entries(entries)) j[t.key][n] = t.key === 'servers' ? { type: 'stdio', ...e } : e;
    text = `${JSON.stringify(j, null, 2)}\n`;
  }
  if (o.dryRun) return `Would write ${t.file}:\n${text}`;
  await mkdir(dirname(t.file), { recursive: true });
  let backup: string | null = null;
  if (before !== null) {
    backup = await freeBackupName(t.file);
    await copyFile(t.file, backup);
  }
  await writeFile(t.file, text);
  if (o.hub || o.hubOnly) {
    await updateHub((c) => {
      const n = client === 'claude-desktop' ? 'claude' : client;
      c.clients[n] ??= { enabled: true, apps: {} };
    });
  }
  return `Added ${Object.keys(entries).join(' and ')} to ${t.file}${backup ? ` (your old file is kept as ${backup})` : ''}.\nRestart ${client} to load it.${o.hub || o.hubOnly ? ` Hub access for ${client}: read-only on every app until you run  dea hub allow ${client} <app> full` : ''}`;
}

export { hubHome, launchers };
