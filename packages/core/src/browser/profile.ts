import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { type BrowserContext, chromium } from 'playwright';
import type { BrowserChoice } from './open.ts';

/**
 * DEA's own browser profile: a folder that belongs to DEA, so a person can log in to a site by hand once and DEA can read that
 * site afterwards.
 *
 * The rules, and where each is kept:
 *  - The folder is always `<profiles home>/<name>`, created by DEA (marker file inside). DEA never opens a folder that is not
 *    its own, and refuses anything that looks like an everyday browser profile (`isEverydayBrowserPath`).
 *  - DEA never attaches to a browser that is already running and never turns on a remote-debugging port for the login window:
 *    `dea browser login` starts a plain browser process with this one folder and waits for the window to close.
 *  - The password is typed by the person into the site's own page in that window. DEA does not see the keys, does not read the
 *    page, and has no password field of its own anywhere. What the browser keeps afterwards (cookies and local storage) stays
 *    in the folder, encrypted by the operating system for that user account, and DEA never copies it out.
 *  - Later work with the profile (`--profile <name>` on `dea session start`) goes through the normal permission modes, and
 *    in supervised mode every change asks first (safety/policy.ts).
 */

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function profilesHome(): string {
  return resolve(process.env.DEA_PROFILES_HOME || join(homedir(), '.dea', 'profiles'));
}

export function validProfileName(name: string): string {
  const n = name.trim().toLowerCase();
  if (!NAME.test(n)) throw new Error(`a profile name is 1 to 32 letters, digits, "-" or "_" (got "${name}")`);
  return n;
}

export function profilePath(name: string, home = profilesHome()): string {
  return join(home, validProfileName(name));
}

/** Folders where a browser keeps the person's own everyday profile. DEA refuses these, whatever it is asked. */
const EVERYDAY = [
  /[\\/]google[\\/]chrome[\\/]user data/i,
  /[\\/]microsoft[\\/]edge[\\/]user data/i,
  /[\\/]chromium[\\/]user data/i,
  /[\\/]bravesoftware[\\/]/i,
  /[\\/]vivaldi[\\/]user data/i,
  /[\\/]opera software[\\/]/i,
  /[\\/]\.config[\\/](google-chrome|chromium|microsoft-edge|brave|vivaldi|opera)/i,
  /[\\/]\.var[\\/]app[\\/]/i,
  /[\\/]snap[\\/]chromium[\\/]/i,
  /[\\/]application support[\\/](google[\\/]chrome|microsoft edge|chromium|bravesoftware|vivaldi)/i,
  /[\\/]firefox[\\/]profiles/i,
  /[\\/]\.mozilla[\\/]firefox/i,
];

/** Does this path look like where a browser keeps the person's everyday profile? */
export function isEverydayBrowserPath(p: string): boolean {
  const full = resolve(p);
  return EVERYDAY.some((r) => r.test(full)) || /[\\/]user data([\\/]|$)/i.test(full);
}

export interface ProfileMarker {
  schema: 'dea.profile/1';
  name: string;
  createdAt: string;
  /** the browser the login window used (the profile is read back by the same family) */
  browser: string | null;
  lastLoginAt: string | null;
  lastUsedAt: string | null;
}

const MARKER = 'dea-profile.json';

async function readMarker(dir: string): Promise<ProfileMarker | null> {
  try {
    const m = JSON.parse(await readFile(join(dir, MARKER), 'utf8')) as ProfileMarker;
    return m && m.schema === 'dea.profile/1' ? m : null;
  } catch {
    return null;
  }
}

/**
 * The folder of a DEA-owned profile. `create` makes it (and only it); without `create` it must already carry DEA's marker.
 * Never returns a folder DEA did not make.
 */
export async function ensureProfile(
  name: string,
  o: { create?: boolean; home?: string; browser?: string } = {},
): Promise<{ dir: string; marker: ProfileMarker }> {
  const home = o.home ?? profilesHome();
  const dir = profilePath(name, home);
  if (isEverydayBrowserPath(dir) || isEverydayBrowserPath(home))
    throw new Error(`${dir} looks like a browser's everyday profile folder. DEA only uses a folder of its own (set DEA_PROFILES_HOME to somewhere else).`);
  const existing = await readMarker(dir);
  if (existing) return { dir, marker: existing };
  if (existsSync(dir)) {
    const files = await readdir(dir).catch(() => [] as string[]);
    if (files.length) throw new Error(`${dir} exists but DEA did not make it (no ${MARKER} inside); DEA does not open folders it did not create.`);
  }
  if (!o.create) throw new Error(`No DEA profile named "${validProfileName(name)}". Make one and log in: dea browser login ${validProfileName(name)}`);
  await mkdir(dir, { recursive: true });
  const marker: ProfileMarker = {
    schema: 'dea.profile/1',
    name: validProfileName(name),
    createdAt: new Date().toISOString(),
    browser: o.browser ?? null,
    lastLoginAt: null,
    lastUsedAt: null,
  };
  await writeFile(join(dir, MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  return { dir, marker };
}

async function writeMarker(dir: string, patch: Partial<ProfileMarker>): Promise<void> {
  const m = await readMarker(dir);
  if (!m) return;
  await writeFile(join(dir, MARKER), `${JSON.stringify({ ...m, ...patch }, null, 2)}\n`);
}

export interface ProfileInfo {
  name: string;
  dir: string;
  createdAt: string;
  lastLoginAt: string | null;
  lastUsedAt: string | null;
  browser: string | null;
  sizeMb: number;
}

async function dirSize(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) n += await dirSize(p);
    else n += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return n;
}

export async function listProfiles(home = profilesHome()): Promise<ProfileInfo[]> {
  const out: ProfileInfo[] = [];
  for (const e of await readdir(home, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    const dir = join(home, e.name);
    const m = await readMarker(dir);
    if (!m) continue;
    out.push({
      name: m.name,
      dir,
      createdAt: m.createdAt,
      lastLoginAt: m.lastLoginAt,
      lastUsedAt: m.lastUsedAt,
      browser: m.browser,
      sizeMb: Math.round((await dirSize(dir)) / 1e5) / 10,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Delete a DEA profile (the folder and everything the browser kept in it: logins included). Only a folder with DEA's marker. */
export async function forgetProfile(name: string, home = profilesHome()): Promise<string> {
  const dir = profilePath(name, home);
  if (!(await readMarker(dir))) throw new Error(`No DEA profile named "${validProfileName(name)}".`);
  if (!resolve(dir).startsWith(resolve(home) + sep)) throw new Error('refusing to delete outside the profiles folder');
  await rm(dir, { recursive: true, force: true });
  return dir;
}

// ---- starting a browser with the profile ----------------------------------------------------------------------------------

/** Where an installed Edge or Chrome lives; null when it is not found (the caller falls back to Playwright's own Chromium). */
export function findBrowserExecutable(choice: BrowserChoice, env: NodeJS.ProcessEnv = process.env, plat: NodeJS.Platform = process.platform): string | null {
  const win = (rel: string) => [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map((b) => join(b as string, rel));
  const table: Record<'msedge' | 'chrome', string[]> = {
    msedge:
      plat === 'win32'
        ? win('Microsoft\\Edge\\Application\\msedge.exe')
        : plat === 'darwin'
          ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
          : ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'],
    chrome:
      plat === 'win32'
        ? win('Google\\Chrome\\Application\\chrome.exe')
        : plat === 'darwin'
          ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
          : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
  };
  const order: Array<'msedge' | 'chrome'> =
    choice === 'msedge' ? ['msedge'] : choice === 'chrome' ? ['chrome'] : choice === 'chromium' ? [] : ['msedge', 'chrome'];
  for (const c of order) for (const p of table[c]) if (existsSync(p)) return p;
  return null;
}

/** The arguments of the login window. No remote-debugging port or pipe: nothing can attach to it, DEA included. */
export function loginArgs(dir: string, url?: string): string[] {
  return [`--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--password-store=basic', '--new-window', url ?? 'about:blank'];
}

export interface LoginResult {
  name: string;
  dir: string;
  browser: string;
  /** how long the window was open (s) */
  seconds: number;
}

/**
 * Open a plain, visible browser window with DEA's profile and wait until the person closes it. The person logs in by hand.
 * DEA starts the process and waits for it to exit: it does not attach, listen, read the pages or type anything.
 * `executable` is for tests; normally the installed Edge, then Chrome, then Playwright's Chromium is used.
 */
export async function loginSession(o: {
  name: string;
  url?: string;
  browser?: BrowserChoice;
  executable?: string;
  home?: string;
  onOpen?: (info: { dir: string; browser: string }) => void;
}): Promise<LoginResult> {
  const exe = o.executable ?? findBrowserExecutable(o.browser ?? 'auto') ?? chromium.executablePath();
  if (!exe || !existsSync(exe))
    throw new Error('No browser was found for the login window. Install Microsoft Edge or Google Chrome, or run: npx playwright install chromium');
  const label = o.executable
    ? basename(o.executable)
    : /msedge|edge/i.test(exe)
      ? 'msedge'
      : /chrome\.exe|google-chrome|Google Chrome/i.test(exe)
        ? 'chrome'
        : 'chromium';
  if (o.url && !/^https:\/\//i.test(o.url)) throw new Error('the login page must be an https:// address');
  const { dir } = await ensureProfile(o.name, { create: true, home: o.home, browser: label });
  const t0 = Date.now();
  o.onOpen?.({ dir, browser: label });
  await new Promise<void>((done, fail) => {
    const child = spawn(exe, loginArgs(dir, o.url), { stdio: 'ignore', windowsHide: false });
    child.once('error', fail);
    child.once('exit', () => done());
  });
  await writeMarker(dir, { lastLoginAt: new Date().toISOString(), browser: label });
  return { name: validProfileName(o.name), dir, browser: label, seconds: Math.round((Date.now() - t0) / 1000) };
}

export interface ProfileContext {
  context: BrowserContext;
  channel: string;
  version: string;
  dir: string;
  close(): Promise<void>;
}

/**
 * Start DEA's own browser on a profile, for DEA's normal work: Playwright launches it (never attaches to a running one), and
 * it is closed when the work ends. Cookies and storage from the login window are there. A second user of the same folder at the
 * same time is refused by the browser itself; the message says so.
 */
export async function launchProfile(o: {
  name: string;
  browser?: BrowserChoice;
  headless?: boolean;
  home?: string;
  viewport?: { width: number; height: number };
  args?: string[];
  recordHar?: { path: string; content: 'omit'; mode: 'full' };
}): Promise<ProfileContext> {
  const { dir } = await ensureProfile(o.name, { home: o.home });
  const choice = o.browser ?? 'auto';
  const order: Array<'msedge' | 'chrome' | 'chromium'> = choice === 'auto' ? ['msedge', 'chrome', 'chromium'] : [choice];
  const errors: string[] = [];
  for (const channel of order) {
    try {
      const context = await chromium.launchPersistentContext(dir, {
        headless: o.headless ?? true,
        ...(channel === 'chromium' ? {} : { channel }),
        args: [...(o.args ?? []), '--password-store=basic'],
        viewport: o.viewport ?? { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        ...(o.recordHar ? { recordHar: o.recordHar } : {}),
      });
      await writeMarker(dir, { lastUsedAt: new Date().toISOString() });
      return {
        context,
        channel,
        version: context.browser()?.version() ?? 'unknown',
        dir,
        close: async () => {
          await context.close().catch(() => {});
        },
      };
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      if (/ProcessSingleton|already running|profile.*in use|SingletonLock/i.test((e as Error).message))
        throw new Error(
          `The profile "${validProfileName(o.name)}" is open in another window (the login window or another DEA session). Close it and try again.`,
        );
      errors.push(`${channel}: ${msg}`);
    }
  }
  throw new Error(`Could not start a browser on the profile.\n${errors.join('\n')}`);
}
