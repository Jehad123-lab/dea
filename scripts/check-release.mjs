#!/usr/bin/env node
// Release check: one version everywhere. Reads packages/cli/package.json and checks every other place the version is
// written (the three package.json files, the version constants in the source, server.json twice, pack-smoke.mjs and the
// CHANGELOG heading). With --release it also asks for a dated CHANGELOG heading (not "unreleased"). Exits non-zero on
// any mismatch and prints each one with its file.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const release = process.argv.includes('--release');
const want = JSON.parse(read('packages/cli/package.json')).version;
const problems = [];
const expect = (file, found, what) => {
  if (found !== want) problems.push(`${file}: ${what} is ${found ?? 'missing'}, expected ${want}`);
};

for (const p of ['cli', 'core', 'mcp']) expect(`packages/${p}/package.json`, JSON.parse(read(`packages/${p}/package.json`)).version, 'version');

// source constants: [file, pattern whose first group is the version]
const constants = [
  ['packages/cli/src/index.ts', /const VERSION = '([^']+)'/],
  ['packages/core/src/hub/client.ts', /export const HUB_VERSION = '([^']+)'/],
  ['packages/mcp/src/server.ts', /export const VERSION = '([^']+)'/],
  ['packages/mcp/src/gateway.ts', /name: 'dea-hub', version: '([^']+)'/],
  ['packages/mcp/src/stdio.ts', /console\.error\('(\d+\.\d+\.\d+[^']*)'\)/],
  ['packages/mcp/src/http.ts', /name: 'dea', version: '([^']+)'/],
  ['scripts/pack-smoke.mjs', /if \(v !== '([^']+)'\)/],
];
for (const [file, re] of constants) expect(file, read(file).match(re)?.[1], 'the version');

const server = JSON.parse(read('server.json'));
expect('server.json', server.version, 'version');
for (const [i, p] of (server.packages ?? []).entries()) expect('server.json', p.version, `packages[${i}].version`);
if (!(server.packages ?? []).length) problems.push('server.json: no packages listed');

const head = read('CHANGELOG.md').match(/^## \[([^\]]+)\] - (.+)$/m);
if (!head) problems.push('CHANGELOG.md: no "## [version] - date" heading');
else {
  expect('CHANGELOG.md', head[1], 'the newest heading');
  if (release && !/^\d{4}-\d{2}-\d{2}$/.test(head[2].trim()))
    problems.push(`CHANGELOG.md: the newest heading says "${head[2].trim()}"; put today's date (YYYY-MM-DD) before releasing`);
}

if (problems.length) {
  console.error(`Release check failed (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`OK: version ${want} everywhere${release ? ', CHANGELOG dated' : ''}.`);
