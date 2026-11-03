# DEA — decode anything on the web

**DEA opens a website in a real browser and tells you how it was made — and proves it.**

Stack, network, page tree, and above all **design**: the fonts Chrome actually drew, the colours, the type scale,
CSS and GSAP motion with their easing curves, smooth scrolling, three.js scenes and every WebGL shader the page compiled.
Every fact is labelled:

| Label        | Meaning                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| **Verified** | Seen in the page, in Chrome, or in the network traffic. Comes with a pointer you can check. |
| _Inferred_   | DEA's reading of the evidence, always with the reason.                                      |
| Unknown      | Not visible from outside. DEA says so instead of guessing.                                  |

DEA is a CLI for humans and an MCP server for AI agents. Both are doors into the same core. It is read-only:
it looks, scrolls and measures; it never clicks, types or submits anything. Free and open source (MIT).

```text
$ pnpm dea design https://jehaduddin.vercel.app

Design decode: https://jehaduddin.vercel.app/
Fonts: Timeless Sans Grotesk 300/400/700 (self-hosted, 100%)
Type sizes: 13 / 16 / 24 / 32 / 54 px
Colours: dark scheme, bg #000000, text #e9e7e1
On screen: #000000 #060607 #26252a #35363a #44464a
Motion: 82 CSS animations seen, easing expo out, custom ease-out; GSAP 3.15.0
Scroll: custom (wheel drives the scene, page does not scroll)
WebGL: 120 shaders, 38 custom (noise (simplex/perlin), fractal noise (fbm), curl noise, instancing, blur)
```

## Why DEA

Inspector tools show you the DOM. Stack detectors give you a list of logos. Neither tells a designer **why a site feels
the way it does**. DEA reads the things that make the feel — rendered fonts, easing curves, scroll behaviour, shaders,
the three.js scene graph — and writes them down in plain words, each with its evidence.

- **Real browser, real evidence.** Playwright drives Chrome; facts come from the page's own runtime, Chrome DevTools
  Protocol and the recorded network (HAR).
- **Design first.** `design.md` explains the site like a designer would; `design.json` holds the same as
  [W3C design tokens](https://www.designtokens.org/).
- **Honest.** No fact without a label. No label without evidence.
- **Safe by default.** Cookies, auth headers, tokens and signed-URL parameters are stripped before anything is
  written to disk. Tools are read-only.
- **No GPL in the box.** DEA's stack detector is its own; Wappalyzer data (GPL-3.0) is never bundled.

## Install

You need **Node 24** and **pnpm**. DEA uses your installed Chrome or Edge; if neither is found it falls back to
Playwright's Chromium.

**Windows (PowerShell)**

```powershell
winget install Schniz.fnm
# add to your PowerShell profile, then open a new terminal:
#   fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm install 24; fnm use 24
npm install -g pnpm@latest

git clone https://github.com/Jehad123-lab/dea.git
cd dea
pnpm install
pnpm dea design https://threejs.org/examples/webgl_animation_keyframes.html
```

**macOS / Linux**

```bash
git clone https://github.com/Jehad123-lab/dea.git && cd dea
pnpm install
pnpm dea inspect https://threejs.org/examples/webgl_animation_keyframes.html
```

No Chrome or Edge on the machine? `pnpm --filter @dea/core exec playwright install chromium`
(on Linux add `--with-deps`).

## Commands

| Command             | What it does                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `dea inspect <url>` | Open the site and save everything: stack, network log, page tree, fonts, scripts, shaders.                |
| `dea stack <url>`   | What the site is built with, each item with version, label and proof.                                     |
| `dea design <url>`  | The design decode: fonts, colours, type scale, motion, scroll, WebGL. Writes `design.md` + `design.json`. |
| `dea report [run]`  | Print a saved report (`latest` by default). `--design` prints `design.md`, `--json` the raw run.          |
| `dea runs`          | List saved runs, newest first.                                                                            |

Useful flags: `--browser chrome|msedge|chromium`, `--headed` (watch it work), `--json`, `--viewport 1280x800`,
`--steps <n>` (scroll samples for `design`), `--home <dir>` (where runs are saved), `--no-gpu-mask` (see below).

Run it from the repo with `pnpm dea …`, or link the command once with `pnpm --filter @dea/cli link --global` and use `dea …`.

### Example: `dea stack`

```text
$ pnpm dea stack https://jehaduddin.vercel.app

Jehad Uddin — Creative Technologist & Design Engineer

✔ three.js r170  (3d / webgl, Verified)
    global: window.__THREE__ = 170
✔ GSAP 3.15.0  (animation, Verified)
    global: window.gsapVersions = ["3.15.0"]
✔ React 18.3.1  (ui framework, Verified)
    global: __REACT_DEVTOOLS_GLOBAL_HOOK__.inject() = react-dom 18.3.1
≈ Vite  (build tool, Inferred)
    script-url: https://jehaduddin.vercel.app/assets/polyfills-T_rg-xDk.js
    why: the entry script is /assets/<name>-<hash>.js, the Vite build naming
✔ Vercel  (hosting, Verified)
    header: server = Vercel
✔ Sanity  (cms, Verified)
    har: https://q3b5m2q9.apicdn.sanity.io/v2025-01-01/data/query/production?...
```

### Example: from `design.md`

```markdown
## WebGL and 3D

- **Verified** Scene: 145 objects (55 Mesh, 35 Group, 32 Bone, 6 Points, 5 Sprite, 3 DirectionalLight),
  348,063 vertices, 2802 instances; materials ShaderMaterial, SpriteMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial; fog linear #000000; background #000000.
  Named objects: hero, heroFlowCloud, heroHaze, heroDots, heroStones, heroCloudComposite, Astronaut, …
- **Verified** 38 fragment programs are written for this site as three.js ShaderMaterials (none of them named).
- **Verified** Their uniforms: `uTime`, `uA`, `tPos`, `uDt`, `uRo`, `tTrail`, `uTrailOn`, …
- _Inferred_ Techniques in the site’s own shaders: noise (simplex/perlin), fractal noise (fbm), curl noise,
  instancing, blur, volumetric / god rays, film grain, particles, gravitational lensing / black hole, bloom, …
  Why: function and keyword names in the GLSL.
- _Inferred_ Post-processing through the "postprocessing" library: LuminanceMaterial, EffectMaterial, SMAAWeightsMaterial, …

## Motion

- **Verified** 82 CSS animations / transitions ran while DEA watched.
  Durations: 600ms ×40, 300ms ×11, 250ms ×11, 200ms ×11, 900ms ×4 …
  Easing: `cubic-bezier(0.22, 0.9, 0.24, 1)` (custom ease-out) ×17, `cubic-bezier(0.16, 1, 0.3, 1)` (expo out) ×4 …
```

## What each run saves

Runs live in `.dea/runs/<run-id>/` (or `$DEA_HOME/runs`):

| File                        | Contents                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `run.json`                  | Every fact with its label and evidence, plus stack, network summary and page data         |
| `report.md`                 | The human report: stack, WebGL, network, page outline                                     |
| `design.md` / `design.json` | The design decode in plain words / as data and design tokens (`dea design`)               |
| `network.har`               | The full network log, with cookies, auth headers and tokens redacted                      |
| `page.aria.yaml`            | The page tree as an AI-friendly accessibility snapshot                                    |
| `shaders.json`, `shaders/`  | Every shader source the page compiled; the site's own GLSL saved as `.vert`/`.frag` files |
| `frames/`                   | Hero and scroll screenshots used for the on-screen palette and motion checks              |
| `progress.md`               | What DEA did, step by step, with timings                                                  |

## How DEA knows

| Fact                                         | Where it comes from                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| three.js revision, scenes, renderer settings | `window.__THREE__` and three.js's own `__THREE_DEVTOOLS__` hook                                                                         |
| Shaders                                      | `shaderSource()` observed before the site's code runs; three.js `SHADER_TYPE`/`SHADER_NAME` defines tell built-ins from custom GLSL     |
| GSAP                                         | `gsap.version`, `window.gsapVersions`, and the `_gsap` cache GSAP leaves on every element it animates (works even when GSAP is bundled) |
| React version                                | the renderer React reports to its devtools hook                                                                                         |
| Fonts actually drawn                         | Chrome's `CSS.getPlatformFontsForNode` — not just what the CSS asks for                                                                 |
| CSS motion                                   | Chrome's Animation domain (transitions, keyframes, Web Animations) plus every stylesheet, read through CDP                              |
| JS motion                                    | element styles sampled frame by frame while idle (Inferred)                                                                             |
| Smooth scroll                                | `scrollY` sampled every frame after one wheel tick                                                                                      |
| On-screen colours                            | the screenshots themselves, grouped in OKLab, so WebGL and images count                                                                 |

**GPU mask.** Some sites show a static poster when WebGL runs in software (no GPU — servers, CI, some laptops).
When DEA sees a software renderer it tells the page a common GPU name so you get the real 3D, and it writes that it did
so into the run. Use `--no-gpu-mask` to see exactly what a GPU-less visitor gets.

## MCP server (for Claude, Cursor, VS Code, Codex)

`dea-mcp` exposes five read-only tools over stdio:

| Tool            | Does                                                |
| --------------- | --------------------------------------------------- |
| `decode_design` | The full design decode of a URL                     |
| `inspect_site`  | Open a URL and save the evidence                    |
| `detect_stack`  | What a URL is built with, with proof                |
| `report`        | Read a saved `report.md`, `design.md` or `run.json` |
| `list_runs`     | List saved runs                                     |

All tools carry `readOnlyHint: true`. Page text is returned as data, with a note that it is not instructions.
MCP runs are saved in `~/.dea/runs` unless `DEA_HOME` is set.

Claude Desktop (`claude_desktop_config.json`) or Cursor (`.cursor/mcp.json`), with DEA cloned to `C:\code\dea`:

```json
{
  "mcpServers": {
    "dea": {
      "command": "node",
      "args": ["C:/code/dea/packages/mcp/bin/dea-mcp.mjs"]
    }
  }
}
```

Then ask: *"Decode the design of https://threejs.org/examples/webgl_animation_keyframes.html"*.

Test it with the MCP Inspector: `npx @modelcontextprotocol/inspector node packages/mcp/bin/dea-mcp.mjs`.

## Use it from code

```ts
import { decodeDesign, inspectSite, stackSite } from '@dea/core';

const { run, summary } = await stackSite('https://gsap.com');
console.log(summary);
for (const f of run.facts) console.log(f.label, f.claim, f.evidence[0]);
```

## Project layout

```text
packages/
  core/   @dea/core   the engine (private): browser/, see/, design/, evidence/
  cli/    dea         the command line (commander)
  mcp/    dea-mcp     the MCP server (stdio)
```

Core never imports MCP, so the CLI, the tests and the MCP server all call the same functions.
Every Chrome DevTools Protocol call lives in `packages/core/src/design/cdp.ts`, because those domains are experimental.

## Develop

```bash
pnpm lint        # Biome
pnpm typecheck   # TypeScript
pnpm test        # Vitest (unit + MCP in-process + MCP over stdio)
pnpm test:e2e    # also opens a real site
```

CI runs lint, typecheck and tests on every push, then a real-browser smoke test.

## Limits, honestly

- Bundled GSAP hides its individual tweens: DEA can see which elements GSAP moves, not each ease. With `window.gsap` it reads every tween.
- JavaScript motion and scroll timing are sampled, so on a slow machine (software WebGL) they are partial; DEA marks them Unknown when it cannot tell.
- Shader technique names (noise, fresnel, bloom, …) come from function and keyword names in GLSL, so they are Inferred.
- WebGL in Web Workers (OffscreenCanvas in a worker) is not observed yet.
- Pages behind a login are not supported yet (Phase 6, `ask_auth`).

## Roadmap

| Phase  | Goal                                                                                                                                     | Done when                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 0–3 ✅ | Rules + CI, core (see a site), design decoder, read-only MCP server                                                                      | Shipped in this repo                                                                                               |
| 4      | **Publish `dea-mcp` 0.1** — bundle with tsdown (`onlyBundle: @dea/core` so GPL can't slip in), `mcpName` + `server.json`, MCP Registry   | A friend runs `npx -y dea-mcp` on another computer and gets a design report                                        |
| 5      | **Hands** — tabs, snapshots with refs, `browse` / `interact` / `submit`; modes restricted, supervised, delegated; submit always asks     | An AI app fills a test form and the final submit shows you an approval first                                       |
| 6      | **Brain** — `investigate` runs in the background with plan, checkpoints and self-check; bring your own model or let the calling AI think | "How does this site's hero animation work?" returns a report with shaders, easing and evidence, no clicks from you |
| 7      | **Code and API decoder** — scripts via `Debugger`, source maps, webcrack, HAR → OpenAPI, retire.js                                       | DEA writes an OpenAPI file for a public JSON API and names the script that calls each endpoint                     |
| 8      | **Hub** — use other MCP servers (Notion first, then Composio) through a few gateway tools                                                | DEA saves a design report into Notion, after asking you                                                            |
| 9      | **Remote server + sign-in** — streamable HTTP, OAuth (CIMD, then DCR)                                                                    | Add DEA as a Claude connector by URL and run `decode_design`                                                       |
| 10     | **Launch** — 30-second demo, saved example runs, issue templates, changesets                                                             | Someone you don't know installs DEA and opens an issue                                                             |

The default tool list stays small on purpose (about 10 tools), with the rest behind a setting.

## Credits

Made by **Jehad Uddin**. MIT licensed — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
