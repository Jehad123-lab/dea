import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkAction, DEFAULT_POLICY, domainAllowed, isSecretField, loadPolicy, parsePolicy, sensitiveForm } from '../src/safety/policy.ts';

const home = await mkdtemp(join(tmpdir(), 'dea-policy-'));
afterAll(() => rm(home, { recursive: true, force: true }));

describe('policy file', () => {
  it('defaults to supervised, any domain', () => {
    const p = loadPolicy(home);
    expect(p.mode).toBe('supervised');
    expect(p.allowedDomains).toEqual([]);
  });

  it('reads .dea/policy.json and lets the command line pick the mode', async () => {
    await writeFile(
      join(home, 'policy.json'),
      JSON.stringify({ mode: 'restricted', allowedDomains: ['Example.com', '*.gsap.com'], blockedActions: ['upload'] }),
    );
    const p = loadPolicy(home);
    expect(p.mode).toBe('restricted');
    expect(p.allowedDomains).toEqual(['example.com', '*.gsap.com']);
    expect(loadPolicy(home, { mode: 'delegated' }).mode).toBe('delegated');
  });

  it('refuses broken or misspelt files instead of silently loosening', async () => {
    expect(() => parsePolicy({ mode: 'god' })).toThrow(/mode must be/);
    expect(() => parsePolicy({ allowedDomain: ['a.com'] })).toThrow(/unknown key "allowedDomain"/);
    expect(() => parsePolicy({ allowedDomains: 'a.com' })).toThrow(/list of strings/);
    await writeFile(join(home, 'policy.json'), '{ not json');
    expect(() => loadPolicy(home)).toThrow(/not valid JSON/);
  });
});

describe('domains', () => {
  const p = parsePolicy({ allowedDomains: ['example.com', '*.gsap.com'], blockedDomains: ['ads.gsap.com'] });
  it('matches exact hosts, www, and wildcards', () => {
    expect(domainAllowed(p, 'https://example.com/a').ok).toBe(true);
    expect(domainAllowed(p, 'https://www.example.com/').ok).toBe(true);
    expect(domainAllowed(p, 'https://gsap.com/').ok).toBe(true);
    expect(domainAllowed(p, 'https://docs.gsap.com/').ok).toBe(true);
    expect(domainAllowed(p, 'https://evil-example.com/').ok).toBe(false);
    expect(domainAllowed(p, 'https://example.com.evil.io/').ok).toBe(false);
  });
  it('blocked beats allowed, and only http(s) pages open', () => {
    expect(domainAllowed(p, 'https://ads.gsap.com/').ok).toBe(false);
    expect(domainAllowed(p, 'file:///etc/passwd').ok).toBe(false);
    expect(domainAllowed(DEFAULT_POLICY, 'https://anything.dev').ok).toBe(true);
  });
});

describe('the gate', () => {
  const sup = parsePolicy({ mode: 'supervised' });
  const res = parsePolicy({ mode: 'restricted' });
  const del = parsePolicy({ mode: 'delegated', blockedActions: ['select'] });

  it('always lets every mode look and scroll', () => {
    for (const p of [sup, res, del]) {
      expect(checkAction(p, { action: 'snapshot', kind: 'read' }).decision).toBe('allow');
      expect(checkAction(p, { action: 'scroll', kind: 'navigate' }).decision).toBe('allow');
    }
  });

  it('restricted never touches; supervised and delegated do', () => {
    expect(checkAction(res, { action: 'click', kind: 'interact' }).decision).toBe('deny');
    expect(checkAction(sup, { action: 'click', kind: 'interact' }).decision).toBe('allow');
    expect(checkAction(res, { action: 'submit', kind: 'submit', confirmed: true }).decision).toBe('deny');
  });

  it('submits ask in every mode until the user says yes', () => {
    expect(checkAction(sup, { action: 'submit', kind: 'submit' }).decision).toBe('ask');
    expect(checkAction(del, { action: 'submit', kind: 'submit' }).decision).toBe('ask');
    expect(checkAction(sup, { action: 'submit', kind: 'submit', confirmed: true }).decision).toBe('allow');
  });

  it('never submits logins or payments and never types secrets, even with a yes', () => {
    for (const p of [sup, del]) {
      expect(checkAction(p, { action: 'submit', kind: 'submit', confirmed: true, sensitive: 'login' }).decision).toBe('deny');
      expect(checkAction(p, { action: 'submit', kind: 'submit', confirmed: true, sensitive: 'payment' }).decision).toBe('deny');
      expect(checkAction(p, { action: 'type', kind: 'interact', secretField: true }).decision).toBe('deny');
    }
  });

  it('honours blockedActions, domains and maxActions', () => {
    expect(checkAction(del, { action: 'select', kind: 'interact' }).decision).toBe('deny');
    const dom = parsePolicy({ allowedDomains: ['httpbin.org'], maxActions: 3 });
    expect(checkAction(dom, { action: 'goto', kind: 'navigate', url: 'https://example.com' }).decision).toBe('deny');
    expect(checkAction(dom, { action: 'goto', kind: 'navigate', url: 'https://httpbin.org/forms/post' }).decision).toBe('allow');
    expect(checkAction(dom, { action: 'scroll', kind: 'navigate', count: 3 }).decision).toBe('deny');
  });
});

describe('sensitive fields and forms', () => {
  it('spots secret fields', () => {
    expect(isSecretField({ type: 'password' })).toBe(true);
    expect(isSecretField({ autocomplete: 'cc-number' })).toBe(true);
    expect(isSecretField({ name: 'card_number' })).toBe(true);
    expect(isSecretField({ name: 'otp' })).toBe(true);
    expect(isSecretField({ type: 'email', name: 'custemail' })).toBe(false);
    expect(isSecretField({ type: 'text', name: 'custname', label: 'Customer name:' })).toBe(false);
  });
  it('spots login and payment forms, and leaves ordinary forms alone', () => {
    expect(
      sensitiveForm({
        action: '/authenticate',
        fields: [
          { type: 'text', name: 'username' },
          { type: 'password', name: 'password' },
        ],
      }),
    ).toBe('login');
    expect(sensitiveForm({ action: '/order', fields: [{ autocomplete: 'cc-number', name: 'n' }] })).toBe('payment');
    expect(
      sensitiveForm({
        action: 'https://httpbin.org/post',
        fields: [
          { type: 'text', name: 'custname' },
          { type: 'email', name: 'custemail' },
        ],
      }),
    ).toBe(null);
  });
});
