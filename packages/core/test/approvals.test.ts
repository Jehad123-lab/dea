import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APPROVAL_TTL_MS,
  approvalIdOf,
  consumeApproval,
  decideApproval,
  Hub,
  listApprovals,
  Redactor,
  readApproval,
  requestApproval,
  updateHub,
} from '../src/index.ts';

let home: string;
let work: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dea-appr-'));
  work = await mkdtemp(join(tmpdir(), 'dea-appr-work-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

const base = { client: 'demo', app: 'files', tool: 'write_file', where: 'create a.txt', mode: 'supervised' as const, redact: new Redactor() };

describe('out-of-band approvals', () => {
  it('the id is a function of the call: key order does not matter, any change does', () => {
    expect(approvalIdOf('c', 'a', 't', { x: 1, y: { b: 1, a: 2 } })).toBe(approvalIdOf('c', 'a', 't', { y: { a: 2, b: 1 }, x: 1 }));
    expect(approvalIdOf('c', 'a', 't', { x: 1 })).not.toBe(approvalIdOf('c', 'a', 't', { x: 2 }));
    expect(approvalIdOf('c', 'a', 't', { x: 1 })).not.toBe(approvalIdOf('d', 'a', 't', { x: 1 }));
    expect(approvalIdOf('c', 'a', 't', { x: 1 })).toMatch(/^[0-9a-f]{10}$/);
  });
  it('request, approve, use once', async () => {
    const args = { path: 'a.txt', text: 'hi' };
    const r = await requestApproval({ ...base, args }, home);
    expect(r.status).toBe('pending');
    expect(await consumeApproval({ ...base, args }, home)).toBeNull(); // pending is not approved
    await decideApproval(r.id, 'approved', home);
    expect((await consumeApproval({ ...base, args }, home))?.status).toBe('used');
    expect(await consumeApproval({ ...base, args }, home)).toBeNull(); // used up
  });
  it('an approval covers exactly the arguments it was asked for', async () => {
    const r = await requestApproval({ ...base, args: { path: 'a.txt', text: 'hi' } }, home);
    await decideApproval(r.id, 'approved', home);
    expect(await consumeApproval({ ...base, args: { path: 'a.txt', text: 'hi!' } }, home)).toBeNull();
    expect(await consumeApproval({ ...base, client: 'other', args: { path: 'a.txt', text: 'hi' } }, home)).toBeNull();
    expect(await consumeApproval({ ...base, args: { path: 'a.txt', text: 'hi' } }, home)).not.toBeNull();
  });
  it('it ends after ten minutes, asked or approved', async () => {
    const t0 = 1_000_000;
    const r = await requestApproval({ ...base, args: { a: 1 } }, home, t0);
    await expect(decideApproval(r.id, 'approved', home, t0 + APPROVAL_TTL_MS + 1)).rejects.toThrow(/ended/);
    const r2 = await requestApproval({ ...base, args: { a: 2 } }, home, t0);
    await decideApproval(r2.id, 'approved', home, t0 + 1000);
    expect(await consumeApproval({ ...base, args: { a: 2 } }, home, t0 + 1000 + APPROVAL_TTL_MS + 1)).toBeNull();
  });
  it('asking again returns the same record; a decided one cannot be decided again', async () => {
    const a = await requestApproval({ ...base, args: { a: 1 } }, home);
    const b = await requestApproval({ ...base, args: { a: 1 } }, home);
    expect(b.id).toBe(a.id);
    expect(b.created).toBe(a.created);
    await decideApproval(a.id, 'denied', home);
    await expect(decideApproval(a.id, 'approved', home)).rejects.toThrow(/already denied/);
  });
  it('the preview hides secrets and cuts long values; the record holds no token', async () => {
    const r = await requestApproval(
      {
        ...base,
        redact: new Redactor(['ghp_supersecretvalue123456']),
        args: { path: 'a', apiKey: 'sk_live_abcdefghijklmnop1234', text: 'x'.repeat(900), note: 'uses ghp_supersecretvalue123456' },
      },
      home,
    );
    expect(r.preview).not.toContain('abcdefghijklmnop');
    expect(r.preview).not.toContain('supersecretvalue');
    expect(r.preview).toContain('[900 characters]');
    expect((await readApproval(r.id, home))?.preview).toBe(r.preview);
    expect((await listApprovals(home)).map((x) => x.id)).toEqual([r.id]);
  });
  it('an id that is not an id is not read from disk', async () => {
    expect(await readApproval('../../etc/passwd', home)).toBeNull();
  });
});

describe('the Hub in supervised mode with no way to ask', () => {
  it('waits for the terminal, runs once after approval, and a denial sticks', async () => {
    await updateHub((c) => {
      c.mcpServers.files = { builtin: 'filesystem', scope: { root: work } };
      c.clients.demo = { enabled: true, apps: { files: { level: 'full' } } };
    }, home);
    const hub = new Hub(home, {}, { mode: 'supervised' }); // no approve callback: nothing here can ask
    try {
      const args = { path: 'x.txt', text: 'one' };
      const first = await hub.call('demo', 'files', 'write_file', args);
      expect(first.isError).toBe(true);
      const id = /approval ([0-9a-f]{10})/.exec(JSON.stringify(first))?.[1] as string;
      expect(id).toBeTruthy();
      expect(JSON.stringify(first)).toContain(`dea hub approve ${id}`);
      await decideApproval(id, 'approved', home);
      const ok = await hub.call('demo', 'files', 'write_file', args);
      expect(ok.isError).toBeFalsy();
      const audit = (await import('../src/index.ts')).readAudit;
      const lines = await audit({ app: 'files' }, home);
      expect(lines.map((l) => l.stage)).toEqual(['denied', 'intent', 'done']);
      expect(lines[1].basis).toMatch(/approved by the user in a terminal \(approval /);
      // used up
      expect(JSON.stringify(await hub.call('demo', 'files', 'write_file', { ...args, overwrite: true }))).toMatch(/waiting as approval/);
      // a denial sticks for the call it was about
      const second = await hub.call('demo', 'files', 'write_file', { path: 'y.txt', text: 'two' });
      const id2 = /approval ([0-9a-f]{10})/.exec(JSON.stringify(second))?.[1] as string;
      await decideApproval(id2, 'denied', home);
      expect(JSON.stringify(await hub.call('demo', 'files', 'write_file', { path: 'y.txt', text: 'two' }))).toMatch(/you declined this change/);
    } finally {
      await hub.close();
    }
  });
});
