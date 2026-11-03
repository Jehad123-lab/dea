import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ActionResult, type BrowserChoice, deaHome, loadPolicy, MODES, type Mode, SessionClient } from '@dea/core';
import { type Command, Option } from 'commander';

type Out = (s: string) => void;
const out: Out = (s) => process.stdout.write(`${s}\n`);

async function client(): Promise<SessionClient> {
  const c = await SessionClient.find();
  if (!c) throw new Error('No session is running. Start one: dea session start <url>');
  return c;
}

function rel(p: string): string {
  const r = relative(process.cwd(), p);
  return r.startsWith('..') ? p : r;
}

/** One line a human can read, for every action result. */
export function describeResult(r: ActionResult): string {
  if (r.decision === 'deny') return `✖ refused: ${r.reason}`;
  if (r.decision === 'ask') {
    const lines = [`? ${r.action} needs your OK: ${r.reason}`];
    if (r.preview) lines.push(`  would send: ${JSON.stringify(r.preview)}`);
    lines.push('  If that is right, run the same command again with --yes');
    return lines.join('\n');
  }
  if (!r.ok) return `✖ ${r.action} failed: ${r.error ?? r.reason}`;
  const d = r.data as any;
  let tail = '';
  if (d?.path && r.action === 'screenshot') tail = `  saved ${rel(d.path)}`;
  if (d?.filled) tail = `  filled ${d.filled.map((f: any) => `${f.field} (${f.as})`).join(', ')}; nothing submitted`;
  if (d?.scrollY != null) tail = `  scrollY ${d.scrollY} of ${d.height}`;
  if (d?.status != null) tail = `  HTTP ${d.status}`;
  return `✔ ${r.action}  ${r.title ? `"${r.title}" ` : ''}${r.url}${tail}`;
}

async function act(method: Parameters<SessionClient['call']>[0], args: Record<string, unknown>, json?: boolean): Promise<void> {
  const c = await client();
  const r = await c.call<ActionResult>(method, args);
  if (json) return void out(JSON.stringify(r, null, 2));
  if (method === 'snapshot' && r.ok) {
    const d = r.data as { snapshot: string; tabs: Array<{ index: number; title: string; url: string; current: boolean }> };
    out(`# ${r.title}  ${r.url}`);
    if (d.tabs.length > 1) for (const t of d.tabs) out(`# tab ${t.index}${t.current ? ' (current)' : ''}: ${t.title} ${t.url}`);
    out(d.snapshot);
    out('# use the refs: dea session click e12 | type e5 "hello" | fill \'{"e5":"Ada"}\'');
    return;
  }
  if (method === 'tabs' && r.ok) {
    for (const t of r.data as Array<{ index: number; title: string; url: string; current: boolean }>)
      out(`${t.current ? '*' : ' '} ${t.index}  ${t.title}  ${t.url}`);
    return;
  }
  out(describeResult(r));
  if (r.decision === 'deny' || (r.decision === 'allow' && !r.ok)) process.exitCode = 2;
}

function sure(flags: { yes?: boolean; confirm?: string }): Record<string, unknown> {
  return { ...(flags.yes ? { confirmed: true } : {}), ...(flags.confirm ? { confirm: flags.confirm } : {}) };
}

export function registerSession(program: Command, wrap: (fn: () => Promise<void>) => Promise<void>): void {
  const session = program
    .command('session')
    .description('DEA hands: one browser kept open between commands; look, click, type, fill forms. Submits always ask first.')
    .option('--home <dir>', 'where runs and the session live (default ./.dea, or $DEA_HOME)')
    .hook('preAction', (cmd) => {
      const home = cmd.opts().home as string | undefined;
      if (home) process.env.DEA_HOME = home;
    });

  session
    .command('start')
    .description('open a browser (and a first page) that stays open for the next commands')
    .argument('[url]', 'first page to open')
    .addOption(new Option('-b, --browser <name>', 'browser to use').choices(['auto', 'chrome', 'msedge', 'chromium']).default('auto'))
    .addOption(new Option('--mode <mode>', 'permission mode for this session (default: .dea/policy.json, else supervised)').choices([...MODES]))
    .option('--headed', 'show the browser window (you can type passwords there yourself)')
    .option('--idle <minutes>', 'close by itself after this long with nothing to do', '30')
    .option('--viewport <WxH>', 'window size', '1440x900')
    .action((url: string | undefined, flags: { browser: BrowserChoice; mode?: Mode; headed?: boolean; idle: string; viewport: string }) =>
      wrap(async () => {
        const home = deaHome();
        const running = await SessionClient.find(home);
        if (running) {
          out(`A session is already running: ${running.info.runId} (${running.info.mode} mode). Stop it with: dea session stop`);
          if (url) await act('goto', { url });
          return;
        }
        const policy = loadPolicy(home, { mode: flags.mode });
        const m = /^(\d{3,4})x(\d{3,4})$/i.exec(flags.viewport);
        const opts = {
          home,
          url,
          browser: flags.browser,
          headless: !flags.headed,
          idleMinutes: Number(flags.idle),
          policy,
          viewport: m ? { width: Number(m[1]), height: Number(m[2]) } : undefined,
        };
        await mkdir(home, { recursive: true });
        const log = openSync(join(home, 'session.log'), 'a');
        const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'dea-session.mjs');
        const child = spawn(process.execPath, [entry, JSON.stringify(opts)], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
        child.unref();
        const t0 = Date.now();
        let c: SessionClient | null = null;
        while (Date.now() - t0 < 90_000) {
          c = await SessionClient.find(home);
          if (c) break;
          if (child.exitCode != null) break;
          await new Promise((r) => setTimeout(r, 300));
        }
        if (!c) {
          const tail = (await readFile(join(home, 'session.log'), 'utf8').catch(() => '')).split('\n').slice(-6).join('\n');
          throw new Error(`The session did not start.\n${tail}`);
        }
        out(`Session ${c.info.runId} is open (${c.info.browser}, ${c.info.mode} mode; policy: ${c.info.policy}).`);
        out(`Evidence: ${rel(c.info.dir)}`);
        out('Next: dea session snapshot');
      }),
    );

  const simple = (
    name: string,
    desc: string,
    method: Parameters<SessionClient['call']>[0],
    build: (...a: any[]) => Record<string, unknown>,
    args: string[] = [],
    extra?: (c: Command) => Command,
  ) => {
    let cmd = session.command(name).description(desc);
    for (const a of args) cmd = cmd.argument(a);
    if (extra) cmd = extra(cmd);
    cmd.option('--json', 'print JSON');
    cmd.action((...a: any[]) => {
      const flags = a[a.length - 2] as { json?: boolean };
      return wrap(() => act(method, build(...a), flags.json));
    });
  };

  simple('snapshot', 'the page as a tree with refs (e12) to act on', 'snapshot', () => ({}));
  simple('goto', 'open a URL in the current tab', 'goto', (url: string) => ({ url }), ['<url>']);
  simple('back', 'go back', 'back', () => ({}));
  simple('forward', 'go forward', 'forward', () => ({}));
  simple('reload', 'reload the page', 'reload', () => ({}));
  simple(
    'scroll',
    'scroll by pixels (default 800), --to top|bottom, or to a ref',
    'scroll',
    (by: string | undefined, f: any) => ({ by: by ? Number(by) : undefined, to: f.to, target: f.target }),
    ['[pixels]'],
    (c) => c.option('--to <where>', 'top or bottom').option('--target <ref>', 'scroll this element into view'),
  );
  simple('hover', 'hover an element', 'hover', (target: string) => ({ target }), ['<ref>']);
  simple(
    'wait',
    'wait for milliseconds or for some text to appear',
    'wait',
    (ms: string | undefined, f: any) => ({ ms: ms ? Number(ms) : undefined, text: f.text }),
    ['[ms]'],
    (c) => c.option('--text <text>', 'wait until this text is on the page'),
  );
  simple(
    'screenshot',
    'save a screenshot into the run',
    'screenshot',
    (f: any) => ({ fullPage: Boolean(f.full) }),
    [],
    (c) => c.option('--full', 'the whole page, not just the window'),
  );
  simple('tabs', 'list tabs', 'tabs', () => ({}));
  simple('tab', 'switch to a tab', 'switchTab', (i: string) => ({ index: Number(i) }), ['<index>']);
  simple('new-tab', 'open a new tab', 'newTab', (url?: string) => ({ url }), ['[url]']);
  simple('close-tab', 'close a tab (default: current)', 'closeTab', (i?: string) => ({ index: i == null ? undefined : Number(i) }), ['[index]']);
  simple(
    'click',
    'click an element (a submit-like click asks first)',
    'click',
    (target: string, f: any) => ({ target, ...sure(f) }),
    ['<ref>'],
    (c) => c.option('--yes', 'I have read what it will send and I say yes').option('--confirm <token>', 'the one-time token from the ask'),
  );
  simple(
    'type',
    'type into a field (never passwords or card numbers)',
    'type',
    (target: string, text: string, f: any) => ({ target, text, enter: Boolean(f.enter), ...sure(f) }),
    ['<ref>', '<text>'],
    (c) =>
      c
        .option('--enter', 'press Enter after (in a form that is a submit, so it asks)')
        .option('--yes', 'say yes to the submit')
        .option('--confirm <token>', 'token from the ask'),
  );
  simple('select', 'choose option(s) in a <select>', 'select', (target: string, values: string[]) => ({ target, values }), ['<ref>', '<values...>']);
  simple(
    'press',
    'press a key (Enter in a form field asks first)',
    'press',
    (key: string, f: any) => ({ key, target: f.target, ...sure(f) }),
    ['<key>'],
    (c) => c.option('--target <ref>', 'press it in this element').option('--yes', 'say yes to the submit'),
  );
  simple(
    'fill',
    'fill many fields at once and never submit: \'{"e5":"Ada","e9":true}\'',
    'fill',
    (json: string) => {
      try {
        return { fields: JSON.parse(json) };
      } catch {
        throw new Error('fill takes JSON, e.g. dea session fill \'{"e5":"Ada Lovelace","e9":true}\'');
      }
    },
    ['<fields-json>'],
  );
  simple(
    'submit',
    'submit the form holding this field or button (always asks; logins and payments never)',
    'submit',
    (target: string, f: any) => ({ target, ...sure(f) }),
    ['<ref>'],
    (c) => c.option('--yes', 'I have read what it will send and I say yes').option('--confirm <token>', 'the one-time token from the ask'),
  );

  session
    .command('status')
    .description('is a session running, and what has it done')
    .option('--json', 'print JSON')
    .action((flags: { json?: boolean }) =>
      wrap(async () => {
        const c = await SessionClient.find();
        if (!c) return void out('No session is running.');
        const s = await c.call<any>('status');
        if (flags.json) return void out(JSON.stringify(s, null, 2));
        out(`Session ${s.runId}: ${s.mode} mode, ${s.actions} actions, policy ${s.policy.source}`);
        for (const t of s.tabs) out(`${t.current ? '*' : ' '} tab ${t.index}  ${t.title}  ${t.url}`);
      }),
    );

  session
    .command('stop')
    .description('close the browser and write the session report')
    .action(() =>
      wrap(async () => {
        const c = await SessionClient.find();
        if (!c) return void out('No session is running.');
        const r = await c.call<{ runId: string; dir: string; actions: number }>('close');
        out(`Closed. ${r.actions} actions logged. Report: dea report ${r.runId}`);
      }),
    );
}
