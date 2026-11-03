# Third-party notices

DEA is MIT licensed (see `LICENSE`). It depends on the open-source packages below. Their licences
apply to them; nothing from them is copied into DEA's own source.

## Runtime dependencies

| Package                                                                                | Version | Licence    | Used for                                             |
| -------------------------------------------------------------------------------------- | ------- | ---------- | ---------------------------------------------------- |
| [playwright](https://github.com/microsoft/playwright)                                  | 1.64.1  | Apache-2.0 | Real browser, HAR recording, page tree, CDP sessions |
| [culori](https://github.com/Evercoder/culori)                                          | 4.0.2   | MIT        | Colour parsing, OKLab/OKLCH grouping                 |
| [commander](https://github.com/tj/commander.js)                                        | 15.0.0  | MIT        | The `dea` command line                               |
| [@modelcontextprotocol/server](https://github.com/modelcontextprotocol/typescript-sdk) | 2.4.0   | Apache-2.0 | The `dea-mcp` server                                 |
| [zod](https://github.com/colinhacks/zod)                                               | 4.6.7   | MIT        | MCP tool input schemas                               |

## Development dependencies

| Package                                   | Licence           |
| ----------------------------------------- | ----------------- |
| typescript                                | Apache-2.0        |
| tsx                                       | MIT               |
| vitest                                    | MIT               |
| @biomejs/biome                            | MIT OR Apache-2.0 |
| @modelcontextprotocol/client (tests only) | Apache-2.0        |
| @types/node, @types/culori                | MIT               |

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
