import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { deaHome } from '../evidence/run.ts';
import { type HandsOptions, HandsSession } from './session.ts';

/** Where a running session is announced. One session per DEA home. */
export function sessionFile(home = deaHome()): string {
  return join(home, 'session.json');
}

export interface SessionInfo {
  pid: number;
  port: number;
  token: string;
  runId: string;
  dir: string;
  mode: string;
  policy: string;
  browser: string;
  startedAt: string;
}

/** Methods a session answers over its local socket, and the argument names each takes in order. */
export const SESSION_METHODS = {
  snapshot: [],
  screenshot: ['fullPage'],
  tabs: [],
  goto: ['url', 'confirm', 'confirmed'],
  back: [],
  forward: [],
  reload: [],
  scroll: ['by', 'to', 'target'],
  hover: ['target'],
  wait: ['ms', 'text'],
  newTab: ['url'],
  switchTab: ['index'],
  closeTab: ['index'],
  click: ['target', 'confirm', 'confirmed'],
  type: ['target', 'text', 'enter', 'confirm', 'confirmed'],
  select: ['target', 'values'],
  press: ['key', 'target', 'confirm', 'confirmed'],
  fill: ['fields'],
  submit: ['target', 'confirm', 'confirmed'],
} as const;

export type SessionMethod = keyof typeof SESSION_METHODS | 'status' | 'close';

/** Call one session method with named arguments. Shared by the daemon and the MCP server (in-process). */
export async function dispatch(s: HandsSession, method: string, a: Record<string, any>): Promise<unknown> {
  switch (method) {
    case 'snapshot':
      return s.snapshot({ maxChars: a.maxChars });
    case 'screenshot':
      return s.screenshot({ fullPage: a.fullPage });
    case 'tabs':
      return s.tabs();
    case 'goto':
      return s.goto(String(a.url), { confirm: a.confirm, confirmed: a.confirmed === true });
    case 'back':
      return s.back();
    case 'forward':
      return s.forward();
    case 'reload':
      return s.reload();
    case 'scroll':
      return s.scroll({ by: a.by == null ? undefined : Number(a.by), to: a.to, target: a.target });
    case 'hover':
      return s.hover(String(a.target));
    case 'wait':
      return s.wait({ ms: a.ms == null ? undefined : Number(a.ms), text: a.text });
    case 'newTab':
      return s.newTab(a.url);
    case 'switchTab':
      return s.switchTab(Number(a.index));
    case 'closeTab':
      return s.closeTab(a.index == null ? undefined : Number(a.index));
    case 'click':
      return s.click(String(a.target), { confirm: a.confirm, confirmed: a.confirmed === true });
    case 'type':
      return s.type(String(a.target), String(a.text ?? ''), { enter: a.enter === true, confirm: a.confirm, confirmed: a.confirmed === true });
    case 'select':
      return s.select(String(a.target), a.values);
    case 'press':
      return s.press(String(a.key), { target: a.target, confirm: a.confirm, confirmed: a.confirmed === true });
    case 'fill':
      return s.fill(a.fields ?? {});
    case 'submit':
      return s.submit(String(a.target), { confirm: a.confirm, confirmed: a.confirmed === true });
    case 'status':
      return { runId: s.runId, dir: s.dir, mode: s.policy.mode, policy: s.policy, actions: s.actions.length, tabs: (await s.tabs()).data };
    default:
      throw new Error(`Unknown session action "${method}". Known: ${Object.keys(SESSION_METHODS).join(', ')}, status, close`);
  }
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const t = Buffer.concat(chunks).toString('utf8');
  return t ? JSON.parse(t) : {};
}

/**
 * Keep one browser open between CLI commands: a tiny HTTP server on 127.0.0.1 only, guarded by a random token
 * kept in .dea/session.json. It closes itself after `idleMinutes` with nothing asked of it.
 */
export async function serveSession(opts: HandsOptions & { home?: string; url?: string; idleMinutes?: number }): Promise<SessionInfo> {
  const home = opts.home ?? deaHome();
  await mkdir(home, { recursive: true });
  const session = await HandsSession.start({ ...opts, runsRoot: opts.runsRoot ?? join(home, 'runs') }, opts.url);
  const token = randomBytes(24).toString('hex');
  const idleMs = (opts.idleMinutes ?? 30) * 60_000;
  let timer: NodeJS.Timeout | undefined;
  const shutdown = async () => {
    clearTimeout(timer);
    const r = await session.close();
    await rm(sessionFile(home), { force: true });
    server.close();
    return r;
  };
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void shutdown().then(() => process.exit(0)), idleMs);
  };
  let queue: Promise<unknown> = Promise.resolve();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.method !== 'POST' || req.url !== '/call' || req.headers['x-dea-token'] !== token) return send(403, { error: 'forbidden' });
    touch();
    // one action at a time, in the order asked
    queue = queue.then(async () => {
      try {
        const { method, args } = await body(req);
        if (method === 'close') {
          const r = await shutdown();
          send(200, { result: r });
          setTimeout(() => process.exit(0), 50);
          return;
        }
        send(200, { result: await dispatch(session, method, args ?? {}) });
      } catch (e) {
        send(200, { error: (e as Error).message });
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const info: SessionInfo = {
    pid: process.pid,
    port,
    token,
    runId: session.runId,
    dir: session.dir,
    mode: session.policy.mode,
    policy: session.policy.source,
    browser: `${session.info.name} ${session.info.version}`,
    startedAt: session.startedAt,
  };
  await writeFile(sessionFile(home), JSON.stringify(info, null, 2), { mode: 0o600 });
  touch();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void shutdown().finally(() => process.exit(0)));
  return info;
}

/** Talks to a running session. */
export class SessionClient {
  constructor(readonly info: SessionInfo) {}

  /** The running session for this DEA home, or null (a stale file from a crashed session is removed). */
  static async find(home = deaHome()): Promise<SessionClient | null> {
    let info: SessionInfo;
    try {
      info = JSON.parse(await readFile(sessionFile(home), 'utf8'));
    } catch {
      return null;
    }
    try {
      process.kill(info.pid, 0);
    } catch {
      await rm(sessionFile(home), { force: true });
      return null;
    }
    return new SessionClient(info);
  }

  async call<T = any>(method: SessionMethod, args: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.info.port}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dea-token': this.info.token },
      body: JSON.stringify({ method, args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await res.json()) as { result?: T; error?: string };
    if (j.error) throw new Error(j.error);
    return j.result as T;
  }
}
