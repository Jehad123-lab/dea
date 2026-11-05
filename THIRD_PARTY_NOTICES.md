# Third-party notices

DEA is MIT licensed (see `LICENSE`). It depends on the open-source packages below. Their licences
apply to them; nothing from them is copied into DEA's own source. The built packages (`dea-cli`, `dea-mcp`)
bundle only DEA's own code; every package below is installed from npm as a normal dependency.

## Runtime dependencies

| Package                                                                                | Version | Licence    | Used for                                             |
| -------------------------------------------------------------------------------------- | ------- | ---------- | ---------------------------------------------------- |
| [playwright](https://github.com/microsoft/playwright)                                  | 1.64.1  | Apache-2.0 | Real browser, HAR recording, page tree, CDP sessions |
| [culori](https://github.com/Evercoder/culori)                                          | 4.0.2   | MIT        | Colour parsing, OKLab/OKLCH grouping                 |
| [commander](https://github.com/tj/commander.js)                                        | 15.0.0  | MIT        | The `dea` command line                               |
| [@modelcontextprotocol/server](https://github.com/modelcontextprotocol/typescript-sdk) | 2.4.0   | Apache-2.0 | The `dea-mcp` server                                 |
| [zod](https://github.com/colinhacks/zod)                                               | 4.6.7   | MIT        | MCP tool input schemas                               |
| [webcrack](https://github.com/j4k0xb/webcrack)                                         | 2.16.0  | MIT          | Unpacking and unminifying bundles that have no source map |
| [isolated-vm](https://github.com/laverdet/isolated-vm) (via webcrack)                  | 6.2.0   | ISC          | webcrack's sandbox for evaluating string decoders      |
| [@babel/parser](https://github.com/babel/babel)                                        | 7.29.12 | MIT          | Reading bundles: enclosing functions, GSAP calls       |
| [@babel/generator](https://github.com/babel/babel)                                     | 7.29.12 | MIT          | Re-indenting code excerpts                             |
| [source-map-js](https://github.com/7rulnik/source-map-js)                              | 1.2.2   | BSD-3-Clause | Mapping shipped code back to original files            |
| [@modelcontextprotocol/client](https://github.com/modelcontextprotocol/typescript-sdk) | 2.4.0   | Apache-2.0   | DEA Hub: connecting to other MCP servers, OAuth        |

## Development dependencies

| Package                                   | Licence           |
| ----------------------------------------- | ----------------- |
| typescript                                | Apache-2.0        |
| tsx                                       | MIT               |
| tsdown (build: bundles DEA into dist/)    | MIT               |
| vitest                                    | MIT               |
| @biomejs/biome                            | MIT OR Apache-2.0 |
| @types/node, @types/culori                | MIT               |

## Data fetched at run time (not bundled)

- **retire.js vulnerability repository** (`jsrepository-v4.json`, Apache-2.0, RetireJS project): `dea code`
  downloads it once a day into `.dea/cache/` to check library versions. DEA's matcher is its own code.

## Ideas and public interfaces DEA relies on (no code copied)

- **three.js** (MIT): DEA reads `window.__THREE__` and listens to three.js's own `__THREE_DEVTOOLS__`
  hook, and reads the `SHADER_TYPE` / `SHADER_NAME` defines three.js writes into its shaders.
- **React** (MIT): DEA reads the renderer version React reports to `__REACT_DEVTOOLS_GLOBAL_HOOK__`.
- **GSAP**: DEA reads the public `gsap` object, `window.gsapVersions` and the `_gsap` cache GSAP keeps on
  animated elements. GSAP itself is not bundled.
- **Chrome DevTools Protocol**: Animation, CSS and DOM domains, through Playwright.

## Deliberately not used

- **Wappalyzer / simple-wappalyzer / webappanalyzer** fingerprint data is GPL-3.0. DEA uses its own small
  stack detector (`packages/core/src/see/stack.ts`) so no GPL code or data ends up in DEA. A Wappalyzer
  plugin may be offered later as a separate, optional install.

## Ideas from other projects (no code or text copied)

- [REA](https://github.com/morluto/rea) (MIT licence, by morluto): its way of returning findings as records that carry
  their evidence, limitations, coverage and open unknowns, and of reading a large result summary-first. DEA's evidence
  ledger (`evidence.json`, MCP `report` with `which: evidence`) is written from scratch for web decodes; no REA code or
  documentation text is included.
