# Releasing DEA

Two npm packages (`dea-cli`, `dea-mcp`) and one MCP Registry entry (`io.github.Jehad123-lab/dea`). `@dea/core` is
private and bundled into both, so it is never published.

## Before

1. `main` is green: lint, typecheck, unit tests, build and pack-smoke.
2. The version is the same everywhere. Check with:
   ```
   grep -rn "0\.2\.0" packages/*/package.json packages/*/src server.json scripts/pack-smoke.mjs
   ```
   (`packages/cli/src/index.ts`, `packages/mcp/src/{server,stdio,http,gateway}.ts`, `packages/core/src/hub/client.ts`,
   the three `package.json` files, `server.json` twice, `scripts/pack-smoke.mjs`.)
3. `CHANGELOG.md`: change `unreleased` to today's date.
4. Never reuse a version npm has seen. `dea-cli@0.1.0` is taken forever (a 2014 package); start at 0.2.0.

## Check the tarballs (no publishing)

```
pnpm install --frozen-lockfile
pnpm build
node scripts/pack-smoke.mjs
```
It packs both packages, installs them into an empty folder and runs `dea --version`, `dea hub selftest` and an MCP
`initialize` + `tools/list` over stdio with plain node. It must end with `OK: both packages install and run from their
tarballs.`

## Publish to npm

```
npm login                        # once; use an account with 2FA
cd packages/cli && pnpm publish --access public
cd ../mcp && pnpm publish --access public
```
`pnpm publish` (not `npm publish`) replaces `workspace:*` before packing. Check
`https://www.npmjs.com/package/dea-mcp` shows `mcpName: io.github.Jehad123-lab/dea` in its package.json: the
registry uses it to prove you own the package.

## Publish to the MCP Registry

```
# install the publisher: https://github.com/modelcontextprotocol/registry (releases), or: brew install mcp-publisher
mcp-publisher login github       # signs in as Jehad123-lab, which owns the io.github.Jehad123-lab namespace
mcp-publisher publish            # from the repo root; reads server.json
```
Then search for `dea` on `https://registry.modelcontextprotocol.io`.

## After

- Tag: `git tag v0.2.0 && git push --tags`, and a GitHub release with the CHANGELOG section.
- Try it from scratch on a clean machine: `npx -y dea-mcp` in an MCP client, and `npx -y dea-cli doctor`.
