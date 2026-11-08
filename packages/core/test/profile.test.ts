import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ensureProfile,
  findBrowserExecutable,
  forgetProfile,
  isEverydayBrowserPath,
  listProfiles,
  loginArgs,
  loginSession,
  profilePath,
  validProfileName,
} from '../src/browser/profile.ts';
import { checkAction, DEFAULT_POLICY, type Policy } from '../src/safety/policy.ts';

const roots: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'dea-prof-'));
  roots.push(d);
  return d;
};
afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

describe('a DEA browser profile is a folder DEA made, never the everyday browser', () => {
  it('names are plain', () => {
    expect(validProfileName(' Work ')).toBe('work');
    for (const bad of ['', '../x', 'a/b', 'a b', '.hidden', 'x'.repeat(40), 'C:\\x']) expect(() => validProfileName(bad), bad).toThrow(/profile name/);
  });
  it('refuses the folders where a browser keeps the everyday profile', () => {
    for (const p of [
      'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Default',
      'C:\\Users\\me\\AppData\\Local\\Microsoft\\Edge\\User Data',
      '/home/me/.config/google-chrome/Default',
      '/home/me/.config/microsoft-edge',
      '/Users/me/Library/Application Support/Google/Chrome/Default',
      '/home/me/.mozilla/firefox/abc.default',
      '/anything/User Data/Profile 1',
    ])
      expect(isEverydayBrowserPath(p), p).toBe(true);
    expect(isEverydayBrowserPath('/home/me/.dea/profiles/work')).toBe(false);
    expect(isEverydayBrowserPath('C:\\Users\\me\\.dea\\profiles\\work')).toBe(false);
  });
  it('a profiles home inside an everyday profile folder is refused', async () => {
    await expect(ensureProfile('work', { create: true, home: '/home/me/.config/google-chrome/dea' })).rejects.toThrow(/everyday profile/);
  });
  it('makes its own folder with a marker, and finds it again', async () => {
    const home = await tmp();
    const a = await ensureProfile('work', { create: true, home, browser: 'msedge' });
    expect(a.dir).toBe(profilePath('work', home));
    expect(existsSync(join(a.dir, 'dea-profile.json'))).toBe(true);
    const b = await ensureProfile('work', { home });
    expect(b.marker.createdAt).toBe(a.marker.createdAt);
    expect((await listProfiles(home)).map((p) => p.name)).toEqual(['work']);
  });
  it('does not open a profile that does not exist unless asked to make it', async () => {
    const home = await tmp();
    await expect(ensureProfile('nope', { home })).rejects.toThrow(/No DEA profile named "nope"/);
  });
  it('does not adopt a folder it did not make', async () => {
    const home = await tmp();
    await mkdir(join(home, 'mine'), { recursive: true });
    await writeFile(join(home, 'mine', 'Cookies'), 'x');
    await expect(ensureProfile('mine', { create: true, home })).rejects.toThrow(/did not make it/);
    await expect(forgetProfile('mine', home)).rejects.toThrow(/No DEA profile/);
    expect(existsSync(join(home, 'mine', 'Cookies'))).toBe(true);
  });
  it('forget deletes only a DEA profile', async () => {
    const home = await tmp();
    await ensureProfile('work', { create: true, home });
    await forgetProfile('work', home);
    expect(existsSync(profilePath('work', home))).toBe(false);
  });
  it('the login window has no remote-debugging port or pipe: nothing can attach to it', () => {
    const args = loginArgs('/x/profiles/work', 'https://example.com/');
    expect(args).toContain('--user-data-dir=/x/profiles/work');
    expect(args.join(' ')).not.toMatch(/remote-debugging|enable-automation|headless/);
  });
  it('finds Edge on Windows in the usual folders, and nothing when it is not there', () => {
    expect(findBrowserExecutable('msedge', { PROGRAMFILES: '/nonexistent' }, 'win32')).toBeNull();
    expect(findBrowserExecutable('chromium', {}, 'win32')).toBeNull();
  });
});

describe('the login window: DEA starts the process and waits for it to close', () => {
  it.skipIf(process.platform === 'win32')('runs the browser with the profile folder only, then records the login time (a stand-in browser)', async () => {
    const home = await tmp();
    const dir = await tmp();
    const exe = join(dir, process.platform === 'win32' ? 'fakebrowser.cmd' : 'fakebrowser.sh');
    const argsFile = join(dir, 'args.txt');
    if (process.platform === 'win32') await writeFile(exe, `@echo off\r\necho %* > "${argsFile}"\r\n`);
    else {
      await writeFile(exe, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\n`);
      await chmod(exe, 0o755);
    }
    let opened = '';
    const r = await loginSession({ name: 'work', executable: exe, home, url: 'https://example.com/', onOpen: (i) => (opened = i.dir) });
    expect(r.dir).toBe(profilePath('work', home));
    expect(opened).toBe(r.dir);
    const seen = await readFile(argsFile, 'utf8');
    expect(seen).toContain(`--user-data-dir=${r.dir}`);
    expect(seen).not.toMatch(/remote-debugging/);
    const [p] = await listProfiles(home);
    expect(p.lastLoginAt).not.toBeNull();
  });
  it('only https pages can be the first page', async () => {
    const home = await tmp();
    await expect(loginSession({ name: 'work', executable: process.execPath, home, url: 'http://insecure.example/' })).rejects.toThrow(/https/);
    await expect(loginSession({ name: 'work', executable: process.execPath, home, url: 'file:///etc/passwd' })).rejects.toThrow(/https/);
  });
});

describe('changes on a page of a profile ask first in supervised mode', () => {
  const sup: Policy = { ...DEFAULT_POLICY, mode: 'supervised' };
  const del: Policy = { ...DEFAULT_POLICY, mode: 'delegated' };
  it('without a profile, a click is allowed in supervised mode (as before)', () => {
    expect(checkAction(sup, { action: 'click', kind: 'interact', url: 'https://example.com/' }).decision).toBe('allow');
  });
  it('with a profile, a click or typing asks; with the OK it goes ahead', () => {
    expect(checkAction(sup, { action: 'click', kind: 'interact', url: 'https://example.com/', profile: true }).decision).toBe('ask');
    expect(checkAction(sup, { action: 'type', kind: 'interact', url: 'https://example.com/', profile: true, confirmed: true }).decision).toBe('allow');
  });
  it('looking and opening pages stay free; restricted mode still refuses changes; passwords are never typed', () => {
    expect(checkAction(sup, { action: 'snapshot', kind: 'read', profile: true }).decision).toBe('allow');
    expect(checkAction(sup, { action: 'goto', kind: 'navigate', url: 'https://example.com/', profile: true }).decision).toBe('allow');
    expect(checkAction({ ...DEFAULT_POLICY, mode: 'restricted' }, { action: 'click', kind: 'interact', profile: true }).decision).toBe('deny');
    expect(checkAction(sup, { action: 'type', kind: 'interact', profile: true, secretField: true, confirmed: true }).decision).toBe('deny');
    expect(checkAction(sup, { action: 'submit', kind: 'submit', profile: true, sensitive: 'login', confirmed: true }).decision).toBe('deny');
  });
  it('delegated mode follows its own table (changes allowed, submits ask)', () => {
    expect(checkAction(del, { action: 'click', kind: 'interact', profile: true }).decision).toBe('allow');
    expect(checkAction(del, { action: 'submit', kind: 'submit', profile: true }).decision).toBe('ask');
  });
});
