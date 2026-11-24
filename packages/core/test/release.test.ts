import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../../scripts/check-release.mjs');
const run = (...args: string[]): { code: number; out: string } => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};

describe('release check (scripts/check-release.mjs)', () => {
  it('finds one version everywhere in this repo', () => {
    const r = run();
    expect(r.out).toMatch(/^OK: version \d+\.\d+\.\d+ everywhere\./);
    expect(r.code).toBe(0);
  });
  it('--release asks for a dated CHANGELOG heading, or passes when it has one', () => {
    const r = run('--release');
    if (r.code === 0) expect(r.out).toContain('CHANGELOG dated');
    else expect(r.out).toContain("put today's date (YYYY-MM-DD) before releasing");
  });
});
