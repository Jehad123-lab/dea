import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BENCH_SCRIPT, bench, PROBE_SCRIPT, probeGpu } from '../src/browser/gpu.ts';
import { launchBrowser, releaseBrowser } from '../src/browser/open.ts';
import { ensureProfile, launchProfile } from '../src/browser/profile.ts';
import { HandsSession } from '../src/hands/session.ts';
import { parsePolicy } from '../src/safety/policy.ts';

let server: Server;
let base = '';
const root = await mkdtemp(join(tmpdir(), 'dea-r10-'));
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/set') {
      // a sign-in the site remembers: a cookie that lasts (the person typed the password in their own window; this stands in for it)
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=abc123; Max-Age=3600; Path=/; HttpOnly' });
      return void res.end('<title>Signed in</title>');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<title>Home</title><p id="who">${req.headers.cookie?.includes('session=abc123') ? 'member' : 'guest'}</p><button type="button" id="b" onclick="document.title='clicked'">Like</button>`,
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server?.close();
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!process.env.DEA_E2E)('GPU readiness (real browser)', () => {
  it('reads the renderer and says hardware or software', async () => {
    const p = await probeGpu({});
    expect(['hardware', 'software']).toContain(p.kind);
    expect(p.renderer).toBeTruthy();
    expect(p.webgl.webgl2 || p.webgl.webgl1).toBe(true);
    expect(p.limits.maxTextureSize).toBeGreaterThan(1024);
  });
  it('the synthetic scene runs and returns numbers (software numbers are for this test only: the bench drops them)', async () => {
    const { browser } = await launchBrowser('auto', true);
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto('about:blank');
      const probe = (await page.evaluate(PROBE_SCRIPT)) as { renderer: string | null };
      expect(probe.renderer).toBeTruthy();
      const t = (await page.evaluate(`(${BENCH_SCRIPT})(300)`)) as {
        fillMedianMs: number;
        fillFrames: number;
        drawsMsPer1000: number;
        uploadMs: number;
        rafFps: number;
      };
      expect(t.fillFrames).toBeGreaterThan(0);
      for (const k of ['fillMedianMs', 'drawsMsPer1000', 'uploadMs', 'rafFps'] as const) expect(t[k], k).toBeGreaterThan(0);
    } finally {
      await releaseBrowser(browser);
    }
  });
  it('the bench keeps no numbers in software, and says why; on a card it keeps them', async () => {
    const r = await bench({ quick: true });
    if (r.result.gpu.kind === 'software') {
      expect(r.meta.timings).toBeNull();
      expect(r.result.timingsNote).toBe('software render, not a speed measure');
      expect(r.result.drew).toBe(true);
    } else if (r.result.gpu.kind === 'hardware') expect(r.meta.timings?.fillMedianMs).toBeGreaterThan(0);
  });
});

describe.skipIf(!process.env.DEA_E2E)('DEA browser profile (real browser)', () => {
  it('what the browser kept in the profile is there the next time, and nowhere else', async () => {
    const home = join(root, 'profiles');
    await ensureProfile('work', { create: true, home });
    const a = await launchProfile({ name: 'work', home, headless: true });
    try {
      const page = await a.context.newPage();
      await page.goto(`${base}/set`);
      await page.goto(base);
      expect(await page.textContent('#who')).toBe('member');
    } finally {
      await a.close();
    }
    const b = await launchProfile({ name: 'work', home, headless: true });
    try {
      const page = await b.context.newPage();
      await page.goto(base);
      expect(await page.textContent('#who')).toBe('member');
    } finally {
      await b.close();
    }
    // a browser started the ordinary way (not on the profile) has no such login
    const { browser } = await launchBrowser('auto', true);
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(base);
      expect(await page.textContent('#who')).toBe('guest');
    } finally {
      await releaseBrowser(browser);
    }
  });
  it('a session on the profile: looking is free, a click asks first, and the OK lets it through', async () => {
    const home = join(root, 'profiles2');
    await ensureProfile('work', { create: true, home });
    process.env.DEA_PROFILES_HOME = home;
    try {
      const s = await HandsSession.start({ profile: 'work', policy: parsePolicy({ mode: 'supervised' }), runsRoot: join(root, 'runs'), shots: false });
      try {
        await s.goto(base);
        const look = await s.snapshot();
        expect(look.decision).toBe('allow');
        const ask = await s.click('#b');
        expect(ask.decision).toBe('ask');
        expect(ask.reason).toMatch(/DEA browser profile/);
        const done = await s.click('#b', { confirm: ask.confirm });
        expect(done.decision).toBe('allow');
        expect(done.ok).toBe(true);
      } finally {
        await s.close();
      }
    } finally {
      delete process.env.DEA_PROFILES_HOME;
    }
  });
});
