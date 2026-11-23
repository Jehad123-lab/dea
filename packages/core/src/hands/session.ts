import { randomBytes } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import { type BrowserChoice, browserInfo, installObservers, launchBrowser, normalizeUrl, releaseBrowser } from '../browser/open.ts';
import { launchProfile, type ProfileContext } from '../browser/profile.ts';
import { newRunId, RunWriter, runsDir } from '../evidence/run.ts';
import { redactText } from '../evidence/secrets.ts';
import {
  type ActionKind,
  type ActionRequest,
  checkAction,
  DEFAULT_POLICY,
  domainAllowed,
  type FormInfo,
  isMutatingRequest,
  isSecretField,
  looksLikeSubmit,
  type Policy,
  riskyUrl,
  sensitiveForm,
} from '../safety/policy.ts';
import { finishHar } from '../see/network.ts';
import type { BrowserInfo, EventSink } from '../types.ts';

export interface HandsOptions {
  browser?: BrowserChoice;
  headless?: boolean;
  viewport?: { width: number; height: number };
  policy?: Policy;
  runsRoot?: string;
  /** live events for UIs */
  onEvent?: EventSink;
  /** take a small screenshot after every action that changes the page (default true) */
  shots?: boolean;
  /** present a GPU name when WebGL runs in software (default true, as in every DEA command) */
  gpuMask?: boolean;
  timeoutMs?: number;
  /**
   * Use DEA's own browser profile of this name (made with `dea browser login <name>`): the logins the person made by hand are
   * there. Every change on any page then asks first in supervised mode; DEA never types passwords either way.
   */
  profile?: string;
}

/** What DEA knows about an element before it touches it. */
export interface ElementInfo {
  tag: string;
  type: string;
  role: string;
  name: string;
  text: string;
  id: string;
  autocomplete: string;
  label: string;
  href: string;
  disabled: boolean;
  inForm: boolean;
  form: FormInfo | null;
}

export interface ActionResult {
  ok: boolean;
  /** allow = done; ask = waiting for the user's OK (see confirm); deny = refused by the policy */
  decision: 'allow' | 'ask' | 'deny';
  action: string;
  kind: ActionKind;
  reason: string;
  url: string;
  title: string;
  /** one-time token: repeat the same action with `confirm: token` once the user has said yes */
  confirm?: string;
  /** what would be sent, for the user to read before saying yes */
  preview?: unknown;
  /** a snapshot, a screenshot path, tab list, etc. */
  data?: unknown;
  error?: string;
  seq: number;
}

export interface LoggedAction {
  seq: number;
  at: string;
  ms: number;
  tab: number;
  action: string;
  kind: ActionKind;
  args: Record<string, unknown>;
  target?: Pick<ElementInfo, 'tag' | 'type' | 'role' | 'name' | 'text'>;
  decision: 'allow' | 'ask' | 'deny';
  reason: string;
  ok: boolean;
  error?: string;
  urlBefore: string;
  urlAfter: string;
  shot?: string;
}

const REF = /^(f\d+)?e\d+$/;
/** the browser flags DEA's own launches use (browser/open.ts ARGS): the profile's browser gets the same ones */
const ARGS_FOR_PROFILE = [
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--hide-scrollbars',
  '--disable-smooth-scrolling',
];
const SHORT = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * DEA's hands: one browser, several tabs, every action asked of the policy first and written to the run's
 * actions.jsonl. Elements are addressed by the refs of the latest snapshot (e12) or by a Playwright selector.
 */
export class HandsSession {
  readonly writer: RunWriter;
  readonly policy: Policy;
  readonly startedAt = new Date().toISOString();
  private browser: Browser | null = null;
  private profile: ProfileContext | null = null;
  private context!: BrowserContext;
  private pages: Page[] = [];
  private current = 0;
  private seq = 0;
  private snaps = 0;
  private pending = new Map<string, { key: string; expires: number }>();
  private log: LoggedAction[] = [];
  private closed = false;
  private blockedNavs: string[] = [];
  /** on while a plain interact action runs: data-changing requests are stopped and the action becomes a question */
  private guardMutations = false;
  private blockedMutations: string[] = [];
  info!: BrowserInfo;

  private constructor(
    writer: RunWriter,
    policy: Policy,
    private opts: HandsOptions,
  ) {
    this.writer = writer;
    this.policy = policy;
  }

  static async start(opts: HandsOptions = {}, firstUrl?: string): Promise<HandsSession> {
    const policy = opts.policy ?? DEFAULT_POLICY;
    const writer = await new RunWriter(newRunId(firstUrl ?? 'https://session.local'), opts.runsRoot ?? runsDir(), opts.onEvent).init();
    const s = new HandsSession(writer, policy, opts);
    const headless = opts.headless ?? true;
    const har = { path: writer.path('network.raw.har'), content: 'omit' as const, mode: 'full' as const };
    if (opts.profile) {
      const pc = await launchProfile({ name: opts.profile, browser: opts.browser, headless, viewport: opts.viewport, args: ARGS_FOR_PROFILE, recordHar: har });
      s.profile = pc;
      s.context = pc.context;
      s.info = {
        name: pc.channel === 'msedge' ? 'Microsoft Edge' : pc.channel === 'chrome' ? 'Google Chrome' : 'Chromium',
        version: pc.version,
        headless,
        channel: pc.channel,
      };
    } else {
      const { browser, channel } = await launchBrowser(opts.browser ?? 'auto', headless);
      s.browser = browser;
      s.info = browserInfo(browser, channel, headless);
      s.context = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1, recordHar: har });
    }
    s.context.setDefaultTimeout(opts.timeoutMs ?? 30_000);
    await installObservers(s.context, opts.gpuMask);
    // The domain rule holds for every way a page can change: typed URLs, links, redirects, scripts, popups.
    await s.context.route('**/*', async (route) => {
      const req = route.request();
      if (s.guardMutations && isMutatingRequest({ method: req.method(), resourceType: req.resourceType(), url: req.url() })) {
        let where = req.url();
        try {
          const u = new URL(where);
          where = `${u.host}${u.pathname}`;
        } catch {}
        s.blockedMutations.push(`${req.method()} ${where}`);
        return route.abort('blockedbyclient');
      }
      if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame()) {
        const d = domainAllowed(s.policy, req.url());
        if (!d.ok) {
          s.blockedNavs.push(`${req.url()} (${d.reason})`);
          return route.abort('blockedbyclient');
        }
      }
      return route.fallback();
    });
    s.context.on('page', (p) => {
      if (!s.pages.includes(p)) s.pages.push(p);
      p.on('close', () => {
        const i = s.pages.indexOf(p);
        if (i >= 0) s.pages.splice(i, 1);
        if (s.current >= s.pages.length) s.current = Math.max(0, s.pages.length - 1);
      });
    });
    const page = await s.context.newPage();
    if (!s.pages.includes(page)) s.pages.push(page);
    await writer.progress(
      `session started (${s.info.name} ${s.info.version}, ${policy.mode} mode; policy: ${policy.source}${opts.profile ? `; DEA profile "${opts.profile}": every change asks first in supervised mode` : ''})`,
    );
    await s.writeRun();
    if (firstUrl) await s.goto(firstUrl);
    return s;
  }

  get runId(): string {
    return this.writer.id;
  }
  get dir(): string {
    return this.writer.dir;
  }
  get page(): Page {
    const p = this.pages[this.current];
    if (!p) throw new Error('No open tab. Open one with goto or newTab.');
    return p;
  }
  get actions(): readonly LoggedAction[] {
    return this.log;
  }

  /** The locator for a ref from the latest snapshot ("e12"), or any Playwright selector ("text=Sign up", "#email"). */
  locate(target: string): Locator {
    const t = target
      .trim()
      .replace(/^\[?ref=/, '')
      .replace(/\]$/, '');
    if (REF.test(t)) return this.page.getByRef(t);
    return this.page.locator(target).first();
  }

  async describe(target: string): Promise<ElementInfo> {
    const loc = this.locate(target);
    return loc.evaluate((el: Element) => {
      const e = el as HTMLInputElement;
      const form = (e.form ?? el.closest('form')) as HTMLFormElement | null;
      const labelOf = (x: Element): string => {
        const id = x.getAttribute('id');
        const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrap = x.closest('label');
        return ((byFor ?? wrap)?.textContent ?? x.getAttribute('aria-label') ?? x.getAttribute('placeholder') ?? '').trim().slice(0, 120);
      };
      const fields = form
        ? Array.from(form.elements)
            .filter((f) => /^(input|textarea|select)$/i.test(f.tagName))
            .map((f) => {
              const i = f as HTMLInputElement;
              return { type: i.type, name: i.name, autocomplete: i.autocomplete, id: i.id, label: labelOf(i) };
            })
        : [];
      return {
        tag: el.tagName.toLowerCase(),
        type: (e.type ?? el.getAttribute('type') ?? '').toString().toLowerCase(),
        role: el.getAttribute('role') ?? '',
        name: (el.getAttribute('aria-label') ?? e.name ?? '').toString(),
        text: (el.textContent ?? e.value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
        id: el.id,
        autocomplete: (e.autocomplete ?? '').toString(),
        label: labelOf(el),
        href: (el as HTMLAnchorElement).href ?? '',
        disabled: Boolean(e.disabled),
        inForm: Boolean(form),
        form: form ? { action: form.action, method: (form.method || 'get').toLowerCase(), fields } : null,
      };
    });
  }

  /** Is clicking this element a submit? Submit buttons, image inputs, default buttons in a form, and submit-sounding words. */
  static clickIsSubmit(info: ElementInfo): boolean {
    if (info.tag === 'input' && /^(submit|image)$/.test(info.type)) return true;
    if (info.tag === 'button' && info.inForm && (info.type === '' || info.type === 'submit')) return true;
    return looksLikeSubmit({ type: info.type, name: info.name, text: info.text });
  }

  // ---------------------------------------------------------------------------------------------
  // the one door every action goes through

  private async act(
    action: string,
    kind: ActionKind,
    args: Record<string, unknown>,
    run: () => Promise<unknown>,
    extra: Partial<ActionRequest> & { target?: ElementInfo; confirmToken?: string; preview?: unknown; url?: string } = {},
  ): Promise<ActionResult> {
    if (this.closed) throw new Error('This session is closed.');
    const seq = ++this.seq;
    const t0 = Date.now();
    const urlBefore = this.pages[this.current]?.url() ?? 'about:blank';
    const key = JSON.stringify({ action, args: redactArgs(args) });
    let confirmed = extra.confirmed ?? false;
    if (extra.confirmToken) {
      const p = this.pending.get(extra.confirmToken);
      if (p && p.key === key && p.expires > Date.now()) confirmed = true;
      this.pending.delete(extra.confirmToken);
    }
    const verdict = checkAction(this.policy, {
      action,
      kind,
      url: extra.url ?? urlBefore,
      confirmed,
      sensitive: extra.sensitive,
      secretField: extra.secretField,
      count: this.log.length,
      profile: Boolean(this.opts.profile),
    });
    let decision = verdict.decision;
    let reason = verdict.reason;
    let ok = decision === 'allow';
    let error: string | undefined;
    let data: unknown;
    let token: string | undefined;
    if (decision === 'ask') {
      token = randomBytes(4).toString('hex');
      this.pending.set(token, { key, expires: Date.now() + 10 * 60_000 });
    }
    if (decision === 'allow') {
      this.blockedNavs = [];
      this.blockedMutations = [];
      // a plain click, selection or key press must not send data; one that tries is stopped and asked about
      this.guardMutations = kind === 'interact' && !confirmed;
      try {
        data = await run();
        if (this.blockedNavs.length) {
          error = `Blocked by the policy: ${this.blockedNavs.join('; ')}`;
          ok = false;
        }
      } catch (e) {
        ok = false;
        error = SHORT((e as Error).message.split('\n')[0], 300);
        if (this.blockedNavs.length) error = `Blocked by the policy: ${this.blockedNavs.join('; ')}`;
      } finally {
        this.guardMutations = false;
      }
      if (this.blockedMutations.length) {
        const sent = [...new Set(this.blockedMutations)].slice(0, 3).join('; ');
        ok = false;
        error = undefined;
        decision = 'ask';
        reason = `${action} tried to send data (${sent}), so it was stopped before anything left the browser. It needs your explicit OK (${this.policy.mode} mode)`;
        token = randomBytes(4).toString('hex');
        this.pending.set(token, { key, expires: Date.now() + 10 * 60_000 });
        this.blockedMutations = [];
      }
    }
    const page = this.pages[this.current];
    let shot: string | undefined;
    if (ok && kind !== 'read' && this.opts.shots !== false && page) {
      shot = `shots/${String(seq).padStart(4, '0')}-${action}.jpg`;
      const buf = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 10_000 }).catch(() => null);
      if (buf) await this.writer.bytes(shot, buf, `shot${seq}`);
      else shot = undefined;
    }
    const entry: LoggedAction = {
      seq,
      at: new Date(t0).toISOString(),
      ms: Date.now() - t0,
      tab: this.current,
      action,
      kind,
      args: redactArgs(args),
      ...(extra.target
        ? { target: { tag: extra.target.tag, type: extra.target.type, role: extra.target.role, name: extra.target.name, text: SHORT(extra.target.text, 80) } }
        : {}),
      decision: decision,
      reason: reason,
      ok,
      ...(error ? { error } : {}),
      urlBefore,
      urlAfter: page?.url() ?? 'about:blank',
      ...(shot ? { shot } : {}),
    };
    this.log.push(entry);
    await appendFile(this.writer.path('actions.jsonl'), `${redactText(JSON.stringify(entry))}\n`);
    await this.writer.progress(`${action} ${decision}${ok ? '' : decision === 'allow' ? ' (failed)' : ''}: ${reason}${error ? ` — ${error}` : ''}`);
    await this.writeRun();
    return {
      ok,
      decision: decision,
      action,
      kind,
      reason: error && decision === 'allow' ? error : reason,
      url: entry.urlAfter,
      title: page ? await page.title().catch(() => '') : '',
      ...(token ? { confirm: token, preview: extra.preview } : {}),
      ...(data !== undefined ? { data } : {}),
      ...(error ? { error } : {}),
      seq,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // looking (always allowed)

  /** The page as an accessibility tree with refs: `- button "Submit order" [ref=e12]`. Refs stay valid until the next snapshot. */
  async snapshot(opts: { maxChars?: number } = {}): Promise<ActionResult> {
    return this.act('snapshot', 'read', {}, async () => {
      const yaml = await this.page.ariaSnapshot({ mode: 'ai', timeout: 15_000 });
      const name = `snapshots/${String(++this.snaps).padStart(3, '0')}.aria.yaml`;
      await this.writer.text(name, yaml, `snapshot${this.snaps}`);
      const max = opts.maxChars ?? 30_000;
      return {
        file: name,
        tabs: await this.tabList(),
        snapshot: yaml.length > max ? `${yaml.slice(0, max)}\n# … cut at ${max} characters; the whole snapshot is in ${name}` : yaml,
      };
    });
  }

  /** A short outline of the current page for investigations: title, headings, description, internal links. Read-only. */
  async outline(): Promise<ActionResult> {
    return this.act('outline', 'read', {}, async () =>
      this.page.evaluate(() => {
        const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        const here = new URL(location.href);
        const links = new Map<string, string>();
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          try {
            const u = new URL((a as HTMLAnchorElement).href, location.href);
            if (u.origin !== here.origin || !/^https?:$/.test(u.protocol)) continue;
            u.hash = '';
            const key = u.toString();
            if (key === here.toString().replace(/#.*$/, '') || links.has(key)) continue;
            if (/\.(pdf|zip|png|jpe?g|webp|gif|svg|mp4|webm)$/i.test(u.pathname)) continue;
            links.set(key, clean(a.textContent || a.getAttribute('aria-label')).slice(0, 80));
          } catch {
            /* ignore */
          }
        }
        // biome-ignore lint/performance/useDomNodeTextContent: visible text is what a reader sees
        const text = clean(document.body?.innerText).slice(0, 600);
        return {
          title: document.title,
          description: clean(document.querySelector('meta[name="description"]')?.getAttribute('content')),
          headings: Array.from(document.querySelectorAll('h1,h2,h3'))
            .map((h) => `${h.tagName.toLowerCase()}: ${clean(h.textContent).slice(0, 100)}`)
            .filter((h) => h.length > 4)
            .slice(0, 14),
          text,
          words: clean(document.body?.textContent).split(' ').length,
          forms: document.forms.length,
          images: document.images.length,
          canvases: document.querySelectorAll('canvas').length,
          links: [...links].slice(0, 80).map(([url, label]) => ({ url, label })),
        };
      }),
    );
  }

  async screenshot(opts: { fullPage?: boolean } = {}): Promise<ActionResult> {
    return this.act('screenshot', 'read', { fullPage: Boolean(opts.fullPage) }, async () => {
      const name = `shots/${String(this.seq).padStart(4, '0')}-screenshot.png`;
      const buf = await this.page.screenshot({ fullPage: Boolean(opts.fullPage), timeout: 20_000 });
      const path = await this.writer.bytes(name, buf, `screenshot${this.seq}`);
      return { file: name, path, bytes: buf.length };
    });
  }

  async tabs(): Promise<ActionResult> {
    return this.act('tabs', 'read', {}, async () => this.tabList());
  }

  private async tabList(): Promise<Array<{ index: number; url: string; title: string; current: boolean }>> {
    return Promise.all(this.pages.map(async (p, i) => ({ index: i, url: p.url(), title: await p.title().catch(() => ''), current: i === this.current })));
  }

  // ---------------------------------------------------------------------------------------------
  // moving around (always allowed, except to a domain the policy blocks)

  async goto(url: string, opts: { confirm?: string; confirmed?: boolean } = {}): Promise<ActionResult> {
    const target = normalizeUrl(url);
    // a link that logs out, deletes or unsubscribes changes the site just by being opened: it asks like a submit
    const risky = riskyUrl(target);
    return this.act(
      risky ? 'goto+risky' : 'goto',
      risky ? 'submit' : 'navigate',
      { url: target },
      async () => {
        const res = await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: this.opts.timeoutMs ?? 45_000 });
        await this.page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
        await this.page.waitForTimeout(800);
        return { status: res?.status() ?? null };
      },
      { url: target, confirmToken: opts.confirm, confirmed: opts.confirmed },
    );
  }

  async back(): Promise<ActionResult> {
    return this.act('back', 'navigate', {}, async () => {
      await this.page.goBack({ waitUntil: 'domcontentloaded' });
      return null;
    });
  }

  async forward(): Promise<ActionResult> {
    return this.act('forward', 'navigate', {}, async () => {
      await this.page.goForward({ waitUntil: 'domcontentloaded' });
      return null;
    });
  }

  async reload(): Promise<ActionResult> {
    return this.act('reload', 'navigate', {}, async () => {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      return null;
    });
  }

  /** Scroll the page by pixels (positive = down), to "top" / "bottom", or until an element is in view. */
  async scroll(opts: { by?: number; to?: 'top' | 'bottom'; target?: string } = {}): Promise<ActionResult> {
    return this.act('scroll', 'navigate', { ...opts }, async () => {
      if (opts.target) await this.locate(opts.target).scrollIntoViewIfNeeded();
      else if (opts.to)
        await this.page.evaluate((to) => window.scrollTo({ top: to === 'top' ? 0 : document.documentElement.scrollHeight, behavior: 'instant' }), opts.to);
      else await this.page.mouse.wheel(0, opts.by ?? 800);
      await this.page.waitForTimeout(500);
      return this.page.evaluate(() => ({ scrollY: Math.round(window.scrollY), height: document.documentElement.scrollHeight }));
    });
  }

  async hover(target: string): Promise<ActionResult> {
    const info = await this.describe(target).catch(() => undefined);
    return this.act(
      'hover',
      'navigate',
      { target },
      async () => {
        await this.locate(target).hover();
        return null;
      },
      { target: info },
    );
  }

  async wait(opts: { ms?: number; text?: string }): Promise<ActionResult> {
    return this.act('wait', 'navigate', { ...opts }, async () => {
      if (opts.text)
        await this.page
          .getByText(opts.text)
          .first()
          .waitFor({ timeout: Math.min(opts.ms ?? 15_000, 60_000) });
      else await this.page.waitForTimeout(Math.min(opts.ms ?? 1000, 60_000));
      return null;
    });
  }

  async newTab(url?: string): Promise<ActionResult> {
    const target = url ? normalizeUrl(url) : undefined;
    return this.act(
      'newTab',
      'navigate',
      { url: target ?? null },
      async () => {
        const p = await this.context.newPage();
        if (!this.pages.includes(p)) this.pages.push(p);
        this.current = this.pages.indexOf(p);
        if (target) await p.goto(target, { waitUntil: 'domcontentloaded' });
        return this.tabList();
      },
      target ? { url: target } : {},
    );
  }

  async switchTab(index: number): Promise<ActionResult> {
    return this.act('switchTab', 'navigate', { index }, async () => {
      if (!this.pages[index]) throw new Error(`No tab ${index}; there are ${this.pages.length}.`);
      this.current = index;
      await this.pages[index].bringToFront();
      return this.tabList();
    });
  }

  async closeTab(index = this.current): Promise<ActionResult> {
    return this.act('closeTab', 'navigate', { index }, async () => {
      const p = this.pages[index];
      if (!p) throw new Error(`No tab ${index}.`);
      await p.close();
      return this.tabList();
    });
  }

  // ---------------------------------------------------------------------------------------------
  // touching (supervised / delegated only), and submitting (always asks)

  /** Click. A click that would submit a form (or buy, send, delete, sign in…) is a submit and needs the user's OK. */
  async click(target: string, opts: { confirm?: string; confirmed?: boolean } = {}): Promise<ActionResult> {
    const info = await this.describe(target);
    const submit = HandsSession.clickIsSubmit(info);
    const isLink = info.tag === 'a' && Boolean(info.href);
    // a link that logs out, deletes, unsubscribes or cancels changes the site just by being opened: clicking it asks
    // like typing its URL does (goto), not like a harmless click (found by safety.e2e.test.ts, Round 16)
    const risky = isLink && !submit && riskyUrl(info.href);
    return this.act(
      submit ? 'submit' : risky ? 'click+risky' : 'click',
      submit || risky ? 'submit' : 'interact',
      { target },
      async () => {
        await this.locate(target).click({ timeout: 10_000 });
        await this.settle();
        return null;
      },
      {
        target: info,
        confirmToken: opts.confirm,
        confirmed: opts.confirmed,
        sensitive: submit ? sensitiveForm(info.form) : null,
        preview: submit ? await this.formPreview(target) : undefined,
        url: isLink && !submit ? info.href : undefined,
      },
    );
  }

  /** Type into a field. Never a password, code or card number. `enter: true` in a form is a submit. */
  async type(target: string, text: string, opts: { enter?: boolean; clear?: boolean; confirm?: string; confirmed?: boolean } = {}): Promise<ActionResult> {
    const info = await this.describe(target);
    const secret = isSecretField(info);
    const submit = Boolean(opts.enter && info.inForm);
    return this.act(
      submit ? 'type+submit' : 'type',
      submit ? 'submit' : 'interact',
      { target, text: secret ? '[hidden]' : text, enter: Boolean(opts.enter) },
      async () => {
        const loc = this.locate(target);
        if (opts.clear !== false) await loc.fill(text);
        else await loc.pressSequentially(text, { delay: 20 });
        if (opts.enter) {
          await loc.press('Enter');
          await this.settle();
        }
        return null;
      },
      {
        target: info,
        secretField: secret,
        confirmToken: opts.confirm,
        confirmed: opts.confirmed,
        sensitive: submit ? sensitiveForm(info.form) : null,
        preview: submit ? await this.formPreview(target) : undefined,
      },
    );
  }

  async select(target: string, values: string | string[], opts: { confirm?: string; confirmed?: boolean } = {}): Promise<ActionResult> {
    const info = await this.describe(target);
    return this.act('select', 'interact', { target, values }, async () => this.locate(target).selectOption(values), {
      target: info,
      confirmToken: opts.confirm,
      confirmed: opts.confirmed,
    });
  }

  async press(key: string, opts: { target?: string; confirm?: string; confirmed?: boolean } = {}): Promise<ActionResult> {
    // no target: the key goes to whatever has focus, so judge that element (Enter in a form field submits it)
    const info = opts.target ? await this.describe(opts.target) : await this.describe(':focus').catch(() => undefined);
    const submit = /^enter$/i.test(key) && Boolean(info?.inForm && info.tag !== 'textarea');
    return this.act(
      submit ? 'press+submit' : 'press',
      submit ? 'submit' : 'interact',
      { key, target: opts.target ?? null },
      async () => {
        if (opts.target) await this.locate(opts.target).press(key);
        else await this.page.keyboard.press(key);
        await this.settle();
        return null;
      },
      { target: info, confirmToken: opts.confirm, confirmed: opts.confirmed, sensitive: submit ? sensitiveForm(info?.form ?? null) : null },
    );
  }

  /**
   * Fill several fields at once and never submit. Text inputs and textareas get the text, checkboxes and radios take
   * true/false ("on"/"off"), selects take an option value or label. Secret fields are refused one by one.
   */
  async fill(fields: Record<string, string | boolean>, opts: { confirm?: string; confirmed?: boolean } = {}): Promise<ActionResult> {
    const infos: Record<string, ElementInfo> = {};
    for (const t of Object.keys(fields)) infos[t] = await this.describe(t);
    const secret = Object.entries(infos).filter(([, i]) => isSecretField(i));
    const shown: Record<string, string | boolean> = {};
    for (const [t, v] of Object.entries(fields)) shown[t] = isSecretField(infos[t]) ? '[hidden]' : v;
    return this.act(
      'fill',
      'interact',
      { fields: shown },
      async () => {
        const done: Array<{ target: string; field: string; as: string }> = [];
        for (const [t, v] of Object.entries(fields)) {
          const i = infos[t];
          const loc = this.locate(t);
          const field = i.label || i.name || i.id || t;
          if (i.tag === 'select') {
            await loc.selectOption(String(v)).catch(async () => loc.selectOption({ label: String(v) }));
            done.push({ target: t, field, as: 'select' });
          } else if (i.type === 'checkbox' || i.type === 'radio') {
            const on = v === true || /^(true|on|yes|1|checked)$/i.test(String(v));
            await loc.setChecked(on);
            done.push({ target: t, field, as: on ? 'checked' : 'unchecked' });
          } else {
            await loc.fill(String(v));
            done.push({ target: t, field, as: 'text' });
          }
        }
        return { filled: done, submitted: false };
      },
      { secretField: secret.length > 0, confirmToken: opts.confirm, confirmed: opts.confirmed },
    );
  }

  /** Submit the form that holds `target` (a field or the submit button). Always asks first; logins and payments never. */
  async submit(target: string, opts: { confirm?: string; confirmed?: boolean } = {}): Promise<ActionResult> {
    const info = await this.describe(target);
    if (!info.inForm) throw new Error(`${target} is not inside a form; use click for buttons outside forms.`);
    return this.act(
      'submit',
      'submit',
      { target },
      async () => {
        const nav = this.page.waitForNavigation({ timeout: 15_000 }).catch(() => null);
        await this.locate(target).evaluate((el: Element) => {
          const f = ((el as HTMLInputElement).form ?? el.closest('form')) as HTMLFormElement;
          const btn = el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && /submit|image/.test(el.type)) ? (el as HTMLElement) : undefined;
          f.requestSubmit(btn as HTMLButtonElement | undefined);
        });
        const res = await nav;
        await this.settle();
        return { status: res?.status() ?? null };
      },
      {
        target: info,
        confirmToken: opts.confirm,
        confirmed: opts.confirmed,
        sensitive: sensitiveForm(info.form),
        preview: await this.formPreview(target),
      },
    );
  }

  /** What a submit would send: form action, method and the current field values (secrets masked). */
  async formPreview(target: string): Promise<unknown> {
    return this.locate(target)
      .evaluate((el: Element) => {
        const f = ((el as HTMLInputElement).form ?? el.closest('form')) as HTMLFormElement | null;
        if (!f) return null;
        const out: Array<{ name: string; value: string }> = [];
        for (const x of Array.from(f.elements) as HTMLInputElement[]) {
          if (!x.name || x.disabled) continue;
          if ((x.type === 'checkbox' || x.type === 'radio') && !x.checked) continue;
          if (/^(submit|button|image|reset|file)$/.test(x.type)) continue;
          const secret = x.type === 'password' || /cc-|one-time-code/.test(x.autocomplete || '');
          out.push({ name: x.name, value: secret ? '[hidden]' : String(x.value).slice(0, 200) });
        }
        return { action: f.action, method: (f.method || 'get').toUpperCase(), fields: out };
      })
      .catch(() => null);
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    await this.page.waitForTimeout(600);
  }

  // ---------------------------------------------------------------------------------------------

  /** run.json for the session: meta plus every action, so `dea report` and list_runs see it like any run. */
  async writeRun(): Promise<void> {
    const page = this.pages[this.current];
    const first = this.log.find((a) => a.action === 'goto' || a.action === 'goto+risky')?.args.url as string | undefined;
    await this.writer.json('run.json', {
      meta: {
        schema: 'dea.run/1',
        id: this.writer.id,
        kind: 'session',
        url: first ?? page?.url() ?? 'about:blank',
        finalUrl: page?.url() ?? 'about:blank',
        title: page ? await page.title().catch(() => '') : '',
        status: null,
        startedAt: this.startedAt,
        finishedAt: new Date().toISOString(),
        browser: this.info,
        viewport: this.opts.viewport ?? { width: 1440, height: 900 },
        files: { ...this.writer.files, actions: 'actions.jsonl', run: 'run.json', progress: 'progress.md' },
        warnings: [],
      },
      policy: this.policy,
      closed: this.closed,
      actions: this.log,
    });
  }

  async close(): Promise<{ runId: string; dir: string; actions: number; report: string }> {
    if (this.closed) return { runId: this.runId, dir: this.dir, actions: this.log.length, report: renderSessionReport(this) };
    this.closed = true;
    await this.context.close().catch(() => {}); // writes the HAR
    if (this.profile) await this.profile.close();
    else await releaseBrowser(this.browser);
    const raw = this.writer.path('network.raw.har');
    try {
      const { summary } = await finishHar(raw, this.writer.path('network.har'), this.log.at(-1)?.urlAfter ?? 'about:blank');
      this.writer.files.har = 'network.har';
      await this.writer.progress(`network: ${summary.requests} requests, ${summary.redactions} secrets redacted`);
    } catch {
      /* no pages were opened */
    }
    const report = renderSessionReport(this);
    await this.writer.text('report.md', report, 'report');
    await this.writeRun();
    await this.writer.progress('session closed');
    return { runId: this.runId, dir: this.dir, actions: this.log.length, report };
  }
}

/** Typed text is kept in the log (it is the evidence of what DEA did), but never anything that looks like a secret. */
export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'fields' && v && typeof v === 'object') {
      const f: Record<string, unknown> = {};
      for (const [fk, fv] of Object.entries(v as Record<string, unknown>))
        f[fk] = isSecretField({ name: fk }) ? '[hidden]' : typeof fv === 'string' ? SHORT(fv, 200) : fv;
      out[k] = f;
    } else if (typeof v === 'string') out[k] = SHORT(v, 300);
    else out[k] = v;
  }
  return out;
}

export function renderSessionReport(s: HandsSession): string {
  const a = s.actions;
  const lines = [
    `# DEA session ${s.runId}`,
    '',
    `- Browser: ${s.info.name} ${s.info.version}${s.info.headless ? ' (headless)' : ''}`,
    `- Mode: **${s.policy.mode}** (policy: ${s.policy.source})`,
    `- Allowed domains: ${s.policy.allowedDomains.length ? s.policy.allowedDomains.join(', ') : 'any'}${s.policy.blockedActions.length ? `; blocked actions: ${s.policy.blockedActions.join(', ')}` : ''}`,
    `- Actions: ${a.length} (${a.filter((x) => x.decision === 'allow' && x.ok).length} done, ${a.filter((x) => x.decision === 'ask').length} waited for an OK, ${a.filter((x) => x.decision === 'deny').length} refused, ${a.filter((x) => x.decision === 'allow' && !x.ok).length} failed)`,
    `- Submits: ${a.filter((x) => x.kind === 'submit' && x.decision === 'allow' && x.ok).length} sent, every one after an explicit OK`,
    '',
    '| # | time | action | target / args | decision | result | page after |',
    '|---|------|--------|---------------|----------|--------|------------|',
  ];
  for (const x of a) {
    const what = x.target ? `${x.target.tag}${x.target.type ? `[${x.target.type}]` : ''} "${x.target.name || x.target.text}"` : JSON.stringify(x.args);
    lines.push(
      `| ${x.seq} | ${x.at.slice(11, 19)} | ${x.action} | ${SHORT(what, 70).replace(/\|/g, '\\|')} | ${x.decision} | ${x.ok ? 'ok' : SHORT(x.error ?? x.reason, 60).replace(/\|/g, '\\|')} | ${SHORT(x.urlAfter, 60)} |`,
    );
  }
  lines.push('', 'Every row is in actions.jsonl with its screenshot (shots/) and the network log (network.har, secrets stripped).', '');
  return lines.join('\n');
}
