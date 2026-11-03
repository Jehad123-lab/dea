# Contributing to DEA

Thanks for helping. DEA decodes websites for humans and AI agents, so the bar is simple: every claim it prints must be
backed by evidence, and labelled **Verified**, **Inferred** or **Unknown** honestly.

## Set up

You need Node 24 (see `.node-version`) and pnpm (`corepack enable`, or `npm i -g pnpm`).

```bash
git clone https://github.com/Jehad123-lab/dea.git
cd dea
pnpm install
pnpm --filter @dea/core exec playwright install chromium   # only if you have no Chrome or Edge
pnpm dea stack https://threejs.org/examples/webgl_animation_keyframes.html
```

## Before you open a pull request

Run exactly what CI runs:

```bash
pnpm lint        # Biome: formatting and lint (pnpm format fixes most of it)
pnpm typecheck   # tsc, strict
pnpm test        # Vitest unit tests (no network, no browser)
pnpm build       # tsdown: dea-cli and dea-mcp into dist/
```

`pnpm test:e2e` also runs the real-browser tests (needs Chrome, Edge or Playwright's Chromium and a network).

## How the code is laid out

- `packages/core`: everything that decodes. One folder per decoder (`see`, `design`, `code`, `assets`, `motion`,
  `extract`, `debug`, `brain`, `hands`, `hub`). Decoders write a run folder (`.dea/runs/<id>/`) with evidence files.
- `packages/cli`: the `dea` command. Thin: parse flags, call core, print.
- `packages/mcp`: the `dea-mcp` server (stdio and Streamable HTTP). Thin as well.

## Rules for new decoders and outputs

1. Evidence first. Keep the raw evidence (HAR, shader source, screenshots, stacks) in the run folder and point to it.
2. Label honestly. Read from the live page or a file: Verified. Reasoned from evidence: Inferred, with the reason.
   Not known: say so, then add a "Gap → path to result" entry (`packages/core/src/gaps.ts`) with the next probe.
3. Never store secrets. Cookies, tokens, passwords and auth headers are stripped from every file DEA writes
   (`packages/core/src/evidence/secrets.ts`); add a test when you add a new output.
4. Respect owners. Code, shaders, fonts and assets DEA saves belong to the site's owners. Outputs say so.
5. Tests for every pure function (parsers, classifiers, generators). Browser work goes behind `DEA_E2E`.
6. No paid services and no GPL dependencies. MIT-compatible licences only.

## Commit messages

Say what changed for a user, in plain words: "Extract: React scene imports shaders from the project root".

## Licence

By contributing you agree that your contribution is licensed under the MIT licence of this repository.
