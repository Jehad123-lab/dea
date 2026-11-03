# dea-cli

**DEA decodes any website and proves it.** Stack, design (fonts Chrome actually drew, colours, type scale, motion and easing,
three.js scenes, WebGL shaders), front-end code (source maps or unpacked bundles), and the APIs a site talks to, as an
OpenAPI 3.1 spec. Every fact is labelled **Verified**, *Inferred* or Unknown, with evidence.

This package is the `dea` command. It also carries DEA's MCP server for AI agents (`dea serve`, `dea serve --http`) and
DEA Hub (connect your apps once; choose what each AI app may do).

> `npm i -g dea-cli`: coming soon (not on npm yet). Until then: clone https://github.com/Jehad123-lab/dea, `pnpm install`,
> and run `pnpm dea …`.

```bash
npm i -g dea-cli   # coming soon
dea design https://gsap.com
dea explain https://example.com
dea api https://hn.algolia.com
dea extract https://example.com --to react --verify-build
dea trace https://example.com --break uniform:uTime
dea library search particles
dea investigate https://gsap.com --goal "fonts, colours and animation tech"
dea serve --http          # MCP over Streamable HTTP on 127.0.0.1:7341, bearer token required
dea mcp install --client claude --hub
```

Needs Node 22.12+ and Chrome or Edge (or `npx playwright install chromium`).

Docs, examples and source: https://github.com/Jehad123-lab/dea. MIT licence, by Jehad Uddin.
