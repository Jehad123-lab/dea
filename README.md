# DEA — decode anything on the web

**DEA opens a website in a real browser and tells you how it was made — and proves it.**

Stack, network, page tree, and above all **design**: the fonts Chrome actually drew, the colours, the type scale,
CSS and GSAP motion with their easing curves, smooth scrolling, three.js scenes and every WebGL shader the page compiled.
Every fact is labelled:

| Label | Meaning |
|---|---|
| **Verified** | Seen in the page, in Chrome, or in the network traffic. Comes with a pointer you can check. |
| *Inferred* | DEA's reading of the evidence, always with the reason. |
| Unknown | Not visible from outside. DEA says so instead of guessing. |

DEA is a CLI for humans and an MCP server for AI agents. Both are doors into the same core. It is read-only:
it looks, scrolls and measures; it never clicks, types or submits anything. Free and open source (MIT).

```text
$ pnpm dea design https://jehaduddin.vercel.app

Design decode: https://jehaduddin.vercel.app/
Fonts: Timeless Sans Grotesk 300/400/700 (self-hosted, 100%)
Type sizes: 13 / 16 / 24 / 32 px
Colours: dark scheme, bg #000000, text #e9e7e1
On screen: #000000 #010101 #26252a #35363a #16161b
Motion: 93 CSS animations seen, easing custom ease-out (fast start, long soft landing), expo out, ease-in-out; GSAP 3.15.0 loaded (animates JS values, not HTML elements)
Scroll: custom (wheel drives the scene, page does not scroll), 1 screen
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
  written to disk. Tools read by default; anything that changes a site or an app asks you first.
- **No GPL in the box.** DEA's stack detector is its own; Wappalyzer data (GPL-3.0) is never bundled.

## Install

> **`npm install -g dea-cli` and `npx dea-mcp`: coming soon.** DEA is not on npm yet; until the first release, run it
> from a clone as below.

From source, you need **Node 24** and **pnpm**. DEA uses your installed Chrome or Edge; if neither is found it falls back to
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

Real reports from these commands are in [`examples/`](examples/).

## Commands

| Command | What it does |
|---|---|
| `dea inspect <url>` | Open the site and save everything: stack, network log, page tree, fonts, scripts, shaders. |
| `dea stack <url>` | What the site is built with, each item with version, label and proof. |
| `dea design <url>` | The design decode: fonts, colours, type scale, motion, scroll, WebGL. Writes `design.md` + `design.json`. |
| `dea explain <url>` | The deep teardown: how the site's code works, section by section, with real code excerpts. Writes `explain.md`. |
| `dea code <url>` | Every script, source maps (original files when published), unpacked bundles, GSAP calls, shaders, listeners, known-vulnerable libraries. |
| `dea api <url>` | The APIs the page talks to, as OpenAPI 3.1 (`api/openapi.json`) with auth kinds only, never values. |
| `dea assets <url>` | Every visual asset the page uses: WebGL textures (PNG preview, format, wrap/filter, and which shader sampler draws each), render targets, GLB models, images, KTX2/HDR, video, Lottie, Rive, fonts. Writes `assets/` + `assets.md`. |
| `dea extract <url> --to react\|vanilla\|framer` | A kit you can use: tokens (`tokens.css`, Tailwind preset, W3C `tokens.json`), motion (`timeline.js`, `keyframes.css`), the first screen's text placed as on the site, shaders as three.js modules with uniform values and drivers from a live trace, the render pipeline, textures by path; then a build check, a visual diff, research and a "Gap → path to result" section. `--section`, `--own-assets`, `--verify-build`, `--reference`, `--library`, `--batch`. |
| `dea trace <url>` | Live debug: every WebGL call that matters (shader compiles, uniforms with values over time, texture uploads) with the code that made it, what drives each uniform (clock, scroll, pointer, viewport), and breakpoints (`--break uniform:uTime`, `--break texImage2D`, `--break url:main.js:120`) that return the caller's stack and variables. |
| `dea library add\|list\|search\|use` | Decode once, reuse everywhere: save kits, find them by site, technique, shader, uniform, ease, colour or font, copy one into a new project. |
| `dea motion <url>` | How it moves: the GSAP timeline tree and ScrollTriggers, CSS/WAAPI animations, Lottie, Rive, Framer, three.js clips, and a frame recording fitted to clocks, eases and springs. Writes `motion.md` and a runnable `motion/timeline.js`. |
| `dea investigate <url> --goal "…"` | Plans and runs the steps that answer your question, with checkpoints; writes a proven report. `--background`, `--resume <run>`. |
| `dea status [run]` | Where an investigation stands, and its report when done. |
| `dea session …` | DEA's hands: a browser that stays open; `start`, `goto`, `snapshot`, `click`, `type`, `fill`, `submit`, `screenshot`, `stop`. |
| `dea hub …` | Connect apps (Notion, Linear, GitHub, …) once and choose what each AI app may do with them. See [DEA Hub](#dea-hub). |
| `dea mcp install --client <app>` | Add DEA to Claude, Claude Code, Cursor, VS Code, Windsurf or Codex. |
| `dea report [run]` | Print a saved report (`latest` by default). `--design`, `--explain`, `--json`. |
| `dea runs` | List saved runs, newest first. |

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
## Code teardown (`dea explain`)

`dea explain` pauses the page in Chrome's debugger, collects every script it ran, looks for public source maps (and
rebuilds the original files when they exist), unpacks minified bundles with webcrack, reads GSAP calls, shaders and
event listeners, and links API responses to the sections that show them. From DEA's run on the author's own portfolio:

```markdown
## 1. The short version
- ✔ Built with Vite; shipped as 12 script files (491.0 KB app code, 1.24 MB libraries) plus 2 inline scripts.
- ✔ Stack: three.js r170, GSAP 3.15.0, React 18.3.1, Vite, Vercel, Sanity.
- ✔ The visuals are WebGL: three.js r170, 10 scene(s), 68 materials, 67 author-written shader stages
  (noise (simplex/perlin), fractal noise (fbm), GPU particle simulation, curl noise, instancing, blur).
- ✔ Data: 1 API endpoint(s) on q3b5m2q9.apicdn.sanity.io; their content shows up in 1 section(s).
- ≈ Frame loops drive the page: 26 requestAnimationFrame calls and 50 direct style writes in the app code.
- ✔ No native scroll: the document is 900px tall in a 900px window, so "scrolling" is the site's own.
- ✔ Code splitting: 14 dynamic-import sites; separately loaded app chunks: GLRoot, LaterChapters, Work.
```

Checked against that site's source: 43 of 43 GSAP calls found, 38 with identical values (the other 5 are computed at
run time). On excalidraw.com DEA rebuilt 694 original files from its public source maps; on hn.algolia.com `dea api`
found `POST /1/indexes/{index}/query` and named its auth as the `x-algolia-api-key` header (value redacted).

## Investigate (`dea investigate`)

Ask a question; DEA plans the steps that answer it (no language model needed), runs each with a checkpoint, and writes
`report.md` where every claim cites evidence `[E#]` from the runs it made.

```text
$ dea investigate https://gsap.com --goal "Which fonts and colours does it use, what is it built with, and what do its main pages cover?"
Plan (rules): "use" → what it is built with; "fonts" → how it looks and moves; "pages" → what the other pages contain

- ✔ GSAP 3.15.0 (animation) [E2]
- ✔ Text is set mostly in Mori (drawn with PP Mori), 100% of characters. [E7][E8]
- ✔ Dark scheme: background #0e100f (near-black), text #fffce1 (lime-tinted off-white), accents #fec5fb, #ff8709,
  #0ae448; text contrast 18.43:1. [E10]
- ✔ GSAP 3.15.0 animates 273 elements …; 44 ScrollTriggers, 1 pinned sections. [E14][E15]
- ✔ https://gsap.com/pricing/ — "Pricing | GSAP": h1: Pricing: Now Free! … [E20]

| E2 | …-gsap-com-d73cc061 | run.json | global: window.gsap.version | 3.15.0 |
```

- `--background` returns at once; `dea status <run>` shows each step and says when a background process died.
- `--resume <run>` continues from `checkpoint.json` without redoing finished steps.
- Other pages are read with DEA's hands in restricted mode, on that site only: look and scroll, never type or submit.
- `--then notion:notion-create-pages` sends the report through [DEA Hub](#dea-hub) as the client `dea-brain`.
- Optional language model: set `DEA_LLM_BASE_URL` and `DEA_LLM_MODEL` (any OpenAI-compatible endpoint, e.g. a free
  local Ollama at `http://localhost:11434/v1`). It may only choose among DEA's own steps, and any sentence of its
  answer that cites no DEA evidence is removed. Off by default.

## Hands (`dea session`)

One browser kept open between commands. Elements are addressed by the refs in the latest snapshot (`e12`).

```powershell
pnpm dea session start https://httpbin.org/forms/post
pnpm dea session snapshot
pnpm dea session fill '{"e7":"Jehad","e11":"jehad@example.com"}'
pnpm dea session submit e30          # asks first: prints exactly what would be sent
pnpm dea session submit e30 --yes    # after you have read it
pnpm dea session stop                # writes the session report with a screenshot per action
```

`.dea/policy.json` (see `policy.example.json`) sets the mode — `restricted` (look and scroll), `supervised` (default:
acts, asks before submits), `delegated` (submits without asking) — plus allowed/blocked domains and actions. Logins and
payments are never automated. Every action is logged to `actions.jsonl`.

## DEA Hub

Connect your apps once; every AI app then reaches them **only through DEA**, with the access you choose per app and
per AI app. Tokens never leave your computer and are never shown to the AI apps.

```powershell
pnpm dea hub catalog                         # 32 official remote MCP servers (Notion, Linear, Sentry, Stripe, …)
pnpm dea hub connect notion                  # signs in through your browser (OAuth); tokens saved encrypted
pnpm dea hub add files -- npx -y @modelcontextprotocol/server-filesystem C:\notes
pnpm dea mcp install --client claude --hub   # Claude now sees connected apps through DEA
pnpm dea hub allow claude notion read        # full | read | selected --tools a,b | off
pnpm dea hub history --client claude         # every call: when, which tool, arguments with secrets hidden
pnpm dea hub off claude                      # kill switch, takes effect on a running app; dea hub on claude
pnpm dea hub alert 5 10                      # pause an AI app after 5 changing/deleting calls in 10 minutes
```

- New AI apps start at **read**: only tools the app marks read-only (`readOnlyHint`) are visible.
- Settings live in `~/.dea/hub.json`; secrets in `~/.dea/secrets.enc` (AES-256-GCM; key in `~/.dea/hub.key` or `DEA_HUB_KEY`).
- Bring an existing `mcpServers` config with `dea hub add --json claude_desktop_config.json`.
- Apps without automatic sign-up (GitHub, Slack, Figma, …) take `--client-id` from your own OAuth app, or `--token-env`.

## WebGL and 3D
- **Verified** Scene: 145 objects (55 Mesh, 35 Group, 32 Bone, 6 Points, 5 Sprite, 3 DirectionalLight),
  348,063 vertices, 2802 instances; materials ShaderMaterial, SpriteMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial; fog linear #000000; background #000000.
  Named objects: hero, heroFlowCloud, heroHaze, heroDots, heroStones, heroCloudComposite, Astronaut, …
- **Verified** 38 fragment programs are written for this site as three.js ShaderMaterials (none of them named).
- **Verified** Their uniforms: `uTime`, `uA`, `tPos`, `uDt`, `uRo`, `tTrail`, `uTrailOn`, …
- *Inferred* Techniques in the site’s own shaders: noise (simplex/perlin), fractal noise (fbm), curl noise,
  instancing, blur, volumetric / god rays, film grain, particles, gravitational lensing / black hole, bloom, …
  Why: function and keyword names in the GLSL.
- *Inferred* Post-processing through the "postprocessing" library: LuminanceMaterial, EffectMaterial, SMAAWeightsMaterial, …

## Extract (`dea extract`)

Decoding is only useful if you can use what comes out. `dea extract` runs the design, motion and assets decoders and a
short live WebGL trace (or reuses earlier runs with `--from design=<id>,motion=<id>,assets=<id>,trace=<id>`) and writes
a small project that builds:

- `tokens/tokens.css`, `tokens/tailwind.preset.js`, `tokens/tokens.json` (W3C design tokens, opens in Figma Tokens
  Studio): colours, fonts (the site's own font files with `@font-face`), sizes, durations and easing curves.
- `motion/timeline.js`: the GSAP timelines and ScrollTriggers read from the live GSAP instance, as `buildMotion()`, with
  the same durations, eases, staggers and triggers; `motion/keyframes.css`: the site's `@keyframes` and transitions.
- `src/Hero.jsx` (React) or the hero markup (vanilla): the first screen's text with the font, size, weight, colour and
  position the browser gave it, in viewport units. Verified values; the absolute placement is Inferred.
- `shaders/<Name>.js`: each of the site's own shader programs as a three.js `RawShaderMaterial` with the exact GLSL it
  compiled. Uniform starting values come from the live trace (✔, with the code that set them); the rest are marked
  as guesses. `drivers` + `update(material, state)` replay what moves each uniform on the site (a clock, the scroll,
  the pointer, the viewport). Textures carry the site's wrap and filter; render-target inputs are marked.
- `pipeline.js`: the render passes of one recorded frame, in order, with each render target's size and type and the
  textures each pass read, so a multi-pass site (simulation → scene → bloom → composite) can be rebuilt in order.
- A minimal scene for `--to react` (react-three-fiber + Vite), `--to vanilla` (three.js + Vite) or `--to framer`
  (a Framer code component). Textures go to `public/textures/`; `--own-assets` writes same-size placeholders.
- `dea-kit.json` (what is inside, for the library) and a provenance note on every kit: the source URL, the date, and
  that the site's code, shaders, fonts and assets belong to their owners.

`--verify-build` runs `npm install && npm run build` in the kit and reports it. Then DEA takes a reference screenshot of
the original (it waits out a loading screen: a visible progressbar or a full-screen "loader" element buys more time),
renders the rebuild, and scores it (0.3 colour + 0.35 brightness layout + 0.35 edges, at 96×60). It tries its own facts
first (screen colour, palette, each shader, the full pipeline), then researches with free search (DuckDuckGo's HTML page
by default; `DEA_SEARCH=searxng` with `DEA_SEARXNG_URL`, `DEA_SEARCH=github` with `DEA_GITHUB_TOKEN`, `DEA_SEARCH=none`
to stay offline) for up to 3 rounds, keeping a value only when the score improves. It also recognises the techniques
in the pipeline (GPGPU particles, mipmap bloom, SMAA, blue-noise dithering, heightmaps, ripple simulations, dissolves,
point sprites) and cites free sources for each (Codrops, the three.js forum and docs, Shadertoy, CodePen, GitHub). No
code is copied from any source. Anything still open goes into **Gap → path to result** with the next command to run.

**Two scores, always side by side.** The page score above rewards matching text, layout and colour: a flat stand-in
behind the right heading can score high while the 3D looks nothing like the site. So every extract also reports a
**canvas-only score**: only the WebGL canvas region, every text box hidden, scored as 0.6 × SSIM (structural
similarity of luminance at three scales) + 0.2 × edge correlation + 0.2 × tone histogram. It moves only when the
picture itself gets closer. `dea score original.png rebuild.png --layout layout.json` scores any two screenshots the
same way.

From real runs on the author's portfolio and on lusion.co (reference screenshots taken by DEA on a machine without a
GPU, so the sites' WebGL ran in software):

```text
$ dea extract https://jehaduddin.vercel.app --to react --verify-build
Extracted https://jehaduddin.vercel.app for react: 113 files
techniques: gpgpu, mipmap-bloom, smaa, blue-noise, heightmap, ripple-sim, dissolve, points
build: npm run build passed (6 s)
visual diff (page): 50.7% → 95% after analysis
visual diff (canvas 93.1% (SSIM 93.5%, edges 96%, tones 89.2%, 5% hidden under text)), from 1.6% at the start
(a) capture replay, the recorded frames played back (ground truth, not editable): canvas 93.1%, page 95% · 54 passes, 106 draws, 28 programs, 24.2 MB (render-graph.md)
(b) editable rebuild, three.js from the render graph (rebuild.md): canvas 93.1%, page 95%, 100% against (a) · 28 RawShaderMaterials, 4 cameras, 29 render targets; recorded bytes still used: 5.4 MB geometry, 18.8 MB textures · what the project runs
scene: 18 meshes + camera in public/scene/scene.glb

$ dea extract https://lusion.co --to react --verify-build
visual diff (page): 20% → 99.8% after analysis
visual diff (canvas 99.7% (SSIM 99.7%, edges 99.9%, tones 99.6%, 3.1% hidden under text)), from 16.8% at the start
(b) editable rebuild, three.js from the render graph (rebuild.md): canvas 99.7%, page 99.8%, 99.9% against (a) · 14 RawShaderMaterials, 4 cameras, 18 render targets
```

| Site | Hand-written rebuild (before) page / canvas | Editable rebuild from the recording page / canvas |
|---|---|---|
| jehaduddin.vercel.app | 88.1% / 50.9% | 95.0% / 93.1% |
| lusion.co | 24.4% / 13.8% | 99.8% / 99.7% |

**The site's own frames: a capture replay and an editable rebuild.** For WebGL heroes a hand-written stand-in is
never the real thing. So right before the reference screenshot, `dea extract` records two consecutive frames of the
site's busiest WebGL context: every call with its arguments, and every buffer, texture, shader program and render target
as it was when the frames began (read back from the GPU). From that recording it makes two different things and scores
each on its own:

- **(a) Capture replay** (`replay/replay.js`): the recorded calls played back, call for call. It is the ground truth
  for the score, not code to build on.
- **(b) Editable rebuild** (`rebuild/rebuild.js` + `public/rebuild/pipeline.json`): the same render graph as a three.js
  project. Every draw is a three.js object with a `RawShaderMaterial` (the site's own GLSL, one file per program in
  `public/rebuild/shaders/`), its blend, depth, cull and stencil state as material properties, a `BufferGeometry`, and
  the site's camera and model matrix as three.js matrices; every framebuffer is a `WebGLRenderTarget`; the passes run in
  the site's order. Change a uniform, a shader file, the camera, or switch a pass off (`rb.setPassEnabled(i, false)`),
  and the picture follows. It still reads the recorded vertex buffers and texture pixels; `rebuild.md` says exactly
  where and how many bytes.

`render-graph.md` lists every pass with its target, programs, draws, inputs, blend and depth (✔ Verified from the
recording) and the role DEA reads from them (≈ Inferred, with why). The project runs the editable rebuild when it
beats DEA's own start; side-by-sides for both are in `preview/side-by-side-replay.png` and
`preview/side-by-side-rebuild.png`. Meshes in the frame are also read back into `scene/scene.glb` (positions, normals,
UVs, model matrices, the camera), matched to the site's GLB files by vertex count. `--own-assets` swaps the site's
images for placeholders and large meshes for boxes, and leaves the capture replay out of the kit (it is scored, then
removed); `--max-capture-mb` caps the recording (64 MB after compaction by default); `--no-replay` turns all of it off.

The recorded bytes are the site's own: use them to study and prototype, and swap in your own before you ship.

**The first screen's HTML around the canvas.** Extract reads the first screen as the browser laid it out at the moment
of the reference: each text block (font, size, weight, colour, position), the flat shapes under them (pills, buttons,
badges: background, gradient, border, rounded corners), see-through overlays over the picture (a fade or vignette on
a positioned layer), and inline SVG logos with their computed paint. Labels hidden by their own overflow (a "Close"
waiting below "Menu") are left out. Fonts the site loads are copied with their weight and style, so an italic file
cannot stand in for the upright one. With `--own-assets`, logos and images become placeholders of the same size.

**What moves and what is frozen.** Live (`rb.start()`, `replay.start()`) holds the recorded camera: the two recorded
frames carry slightly different camera matrices (a dolly caught mid-move), and playing them one after the other made the
picture shake, so every frame takes the float and matrix uniforms of the last recorded frame while every pass, the
simulation passes included, still runs on the live render targets and the clocks follow the real time. Real pointer,
touch, scroll and window size drive the uniforms the input probe measured following them, as value = scale × eased input
+ offset with the easing found per uniform. The probe moves the pointer across the page, wheels down and back up (the
page's own scroll when it can scroll, the sum of the wheel when a fixed stage moves by wheel events), and resizes the
window, while the recorder notes every float uniform and every matrix per frame; live scroll is held inside the range it
probed. `extract.md` lists each input as ✔ verified live, ≈ inferred (from the uniform's name, not moved by the probe) or
✖ frozen, and `preview/interaction.jpg` is the same scripted pointer and scroll on the site and on the kit, side by side.
A uniform that changes without following any input (a sim seed, a noise offset) plays as recorded. The drawing buffer keeps
the recorded size.

**Where the time goes.** Every browser command (`extract`, `design`, `motion`, `assets`, `trace`, `inspect`, `score`)
writes `timings.json` in its run: the wall time of each stage (browser launch, page load, network-idle and settle waits,
each decoder, the reference watch, the WebGL capture, building the replay and the rebuild, rendering and scoring,
research, the build check, writing the kit), stages that ran inside others nested under them, and the peak memory of DEA
itself and of DEA plus the browsers it started (Linux reads the second from `/proc`; elsewhere it is left out).
`--timings` also prints the table when the command ends.

**Speed.** On a 4-core machine without a GPU (software WebGL), measured with `--timings`:

| site | before (round 4) | cold (empty cache) | warm (cached) | page / canvas score, before → now |
| --- | --- | --- | --- | --- |
| lusion.co | 676 s | 327 s | 61 s | 99.6% / 99.0% → 99.8% / 99.6% |
| jehaduddin.vercel.app (`--reference-ms 150000`) | 1046 s | 690 s | 142 s | 85.9% / 84.4% → 85.6% / 84.5% |

What changed:

- **Cache.** Pages and their files go through a per-URL cache (`~/.dea/cache`, or `--cache-dir`): static GETs answered
  200 without `no-store`, each decoder's finished run, and the reference screenshot with its recorded frames. A second
  extract of the same URL reuses them and says so in the summary ("reused from the cache: ..."). Entries older than 24
  hours are dropped, and the least recently used go first once the cache passes `--cache-max-mb` (1024).
  `--no-cache` observes everything again; `dea cache info` and `dea cache clear` show and empty it. A capture whose
  recording failed is not kept.
- **Browsers are reused.** One pool of browsers serves every stage of an extract and every URL of `--batch`; a stage
  borrows an idle browser and closes only its own page. Stages that run side by side get a browser each, because a
  browser draws all its pages' WebGL in one GPU process and they would queue behind each other.
- **Stages run side by side.** The reference screenshot and WebGL capture run first, on their own (a heavy site's intro
  on a machine without a GPU slows to a crawl when other pages render beside it, and the reference would catch the
  loading screen; `--overlap` runs them together, which is faster with a GPU). Then design, motion and
  assets → trace run in parallel (`--concurrency 3`).
- **Shorter waits.** A page that is already drawing WebGL stops waiting for the network to go quiet (3D sites often
  stream forever) once it has drawn 20 frames; the settle wait ends when the page draws frames and no loading screen
  covers it; without `--reference-ms` the reference watch ends when the page has settled (no loader, the best frame not
  beaten for a few samples, 45 s at most); the parameter sweep stops trying a knob whose first two values change
  nothing on screen.
- **`--quick`** (labelled QUICK MODE in the summary and the report): one recorded frame, a 20 s reference watch, no
  motion, trace, sweep, research or build check. Rough, for a first look; run without it for the real result.

`--section <selector>` scrolls that part of the page into view for the reference, reads only its text, and keeps only
the motion that touches it. `--reference shot.png` compares against your own screenshot (for example one taken on a
machine with a GPU). `--library <name> --tag hero` saves the kit; `--batch urls.txt` extracts a list of sites.

## Live debug (`dea trace`)

When reading the code is not enough, watch it run. `dea trace` wraps WebGL before the page's scripts start and records,
while it waits, moves the pointer, scrolls and scrolls back:

- every shader program compiled, with the code that compiled it;
- every uniform the page sets: last value, range, number of calls, the code on the stack when WebGL received it
  (mapped through source maps when the site publishes them), and what drives it, read from how its values moved
  against the clock, the scroll and the pointer (Inferred, with the fit);
- every texture upload, with its size, source and the code that uploaded it.

`--break` pauses the page: on a WebGL call (`texImage2D`, `shaderSource`, `linkProgram`, `drawElements`), on a uniform
being set (`uniform:uTime`), or on a script position (`url:GLRoot:1174:520`), and records the caller's stack and local
variables, then resumes. From the author's portfolio:

```text
$ dea trace https://jehaduddin.vercel.app --break texImage2D url:GLRoot:1174:520
WebGL trace: 37 programs compiled, 420 uniforms set (80 changing), 49 texture uploads
  uNT (ShaderMaterial with tPos, uDt, uRo, tTrail) ← animated on its own between 0 and 4.9503; set by GLRoot-EqD-37OA.js:912:3134 (_) via three-DVjc41Gk.js:3725:8487
  break texImage2D: 2 hit(s), first at three-DVjc41Gk.js:3804:7462 (it)
  break url:GLRoot:1174:520: 1 hit(s), first at GLRoot-EqD-37OA.js:1174:520
```

`dea assets` gives the static side of the same chain: each file → the script line that loaded it → the program and
sampler it is drawn with → the shader line that samples it, e.g.
`bluenoise64.png ← GLRoot-EqD-37OA.js:1174:520 via three (load) → EffectMaterial.e0TBlue → fragment shader line 795`.

## Library (`dea library`)

```bash
dea library add <extract-run> --name jehad-hero --tag hero particles   # or: dea extract <url> --library jehad-hero
dea library list
dea library search gpgpu power3        # every word must match: site, tags, techniques, shaders, uniforms, eases, colours, fonts
dea library use jehad-hero ./my-new-site && cd my-new-site && npm install && npm run dev
```

Kits live in `~/.dea/library` (`DEA_LIBRARY` to move it), copied without `node_modules` or `dist`.

## Assets (`dea assets`)

DEA watches WebGL itself, so it sees textures however they arrive (image, `ImageBitmap`, canvas, video, data computed in
JavaScript, compressed). For each texture it saves a PNG preview of what was uploaded, its size, format, wrap, filter and
mipmaps, and the shader program and sampler uniform it is drawn with, read at the draw call. What the texture does
there is read from the sampler name and the shader code (noise that offsets UVs, a GPU simulation state, an environment
map) and labelled Inferred. Render targets are read back after the page ran (float targets are shown normalised).
Downloaded files are saved with a manifest: GLB/glTF (meshes, materials and their texture slots, animations, embedded
image sizes), KTX2 headers, HDR sizes, Lottie (fps, length, layers), Rive versions, fonts and video.

```text
$ pnpm dea assets https://jehaduddin.vercel.app
Textures in WebGL: 61 (18 previews saved), render targets read back: 7
Files: 3 font, 3 image, 1 glb
What drives what:
  bluenoise64.png → e0TBlue in EffectMaterial: blue noise (dithering, grain, jittered sampling)
  data texture t7 (256×256) → tPos in ShaderMaterial with tPos, uDt: GPU simulation state (positions/velocities stored in a texture)
```

Third-party assets belong to their owners: use them to learn and as reference, and swap in your own before you ship.

## Motion (`dea motion`)

DEA reads GSAP's own timeline tree (from `gsap.globalTimeline`, or from the instances it saw being built when GSAP is
bundled): every timeline and tween with its position, duration, ease, stagger, targets, from/to values, labels and the
script line that created it, and every ScrollTrigger with start/end, scrub and pin. It also lists running CSS animations
and transitions, `@keyframes`, Web Animations, Lottie and three.js clips, and notes Rive, Framer Motion and Theatre.js.
Motion no library describes is recorded every frame (shader uniforms and moving elements, still and while scrolling) and
fitted: a clock, an oscillation with its period, an eased move with the closest GSAP ease, a spring, or a value that
follows the scroll. `motion/timeline.js` rebuilds it as a GSAP module you can run.

## Motion in the design decode
- **Verified** 82 CSS animations / transitions ran while DEA watched.
  Durations: 600ms ×40, 300ms ×11, 250ms ×11, 200ms ×11, 900ms ×4 …
  Easing: `cubic-bezier(0.22, 0.9, 0.24, 1)` (custom ease-out) ×17, `cubic-bezier(0.16, 1, 0.3, 1)` (expo out) ×4 …
```

## What each run saves

Runs live in `.dea/runs/<run-id>/` (or `$DEA_HOME/runs`):

| File | Contents |
|---|---|
| `run.json` | Every fact with its label and evidence, plus stack, network summary and page data |
| `report.md` | The human report: stack, WebGL, network, page outline |
| `design.md` / `design.json` | The design decode in plain words / as data and design tokens (`dea design`) |
| `network.har` | The full network log, with cookies, auth headers and tokens redacted |
| `page.aria.yaml` | The page tree as an AI-friendly accessibility snapshot |
| `shaders.json`, `shaders/` | Every shader source the page compiled; the site's own GLSL saved as `.vert`/`.frag` files |
| `frames/` | Hero and scroll screenshots used for the on-screen palette and motion checks |
| `progress.md` | What DEA did, step by step, with timings |

## How DEA knows

| Fact | Where it comes from |
|---|---|
| three.js revision, scenes, renderer settings | `window.__THREE__` and three.js's own `__THREE_DEVTOOLS__` hook |
| Shaders | `shaderSource()` observed before the site's code runs; three.js `SHADER_TYPE`/`SHADER_NAME` defines tell built-ins from custom GLSL |
| GSAP | `gsap.version`, `window.gsapVersions`, and the `_gsap` cache GSAP leaves on every element it animates (works even when GSAP is bundled) |
| React version | the renderer React reports to its devtools hook |
| Fonts actually drawn | Chrome's `CSS.getPlatformFontsForNode` — not just what the CSS asks for |
| CSS motion | Chrome's Animation domain (transitions, keyframes, Web Animations) plus every stylesheet, read through CDP |
| JS motion | element styles sampled frame by frame while idle (Inferred) |
| Smooth scroll | `scrollY` sampled every frame after one wheel tick |
| On-screen colours | the screenshots themselves, grouped in OKLab, so WebGL and images count |

**GPU mask.** Some sites show a static poster when WebGL runs in software (no GPU — servers, CI, some laptops).
When DEA sees a software renderer it tells the page a common GPU name so you get the real 3D, and it writes that it did
so into the run. Use `--no-gpu-mask` to see exactly what a GPU-less visitor gets.

## MCP server (for Claude, Cursor, VS Code, Codex)

`dea-mcp` exposes 17 tools over stdio (and over HTTP with `dea serve --http`):

| Tool | Does |
|---|---|
| `decode_design` | The full design decode of a URL |
| `decode_code` | The code teardown (`explain.md`) |
| `decode_api` | The APIs a page calls, as OpenAPI |
| `decode_assets` | Textures (with what each drives), render targets, models, media, with a manifest |
| `decode_motion` | GSAP tree, ScrollTriggers, CSS/WAAPI, Lottie, clips, fitted recordings, and a GSAP rebuild |
| `extract` | A runnable kit (tokens, GSAP/CSS motion, hero layout, three.js shader modules with traced values and drivers, pipeline, scene) with a build check, visual diff, research and gaps |
| `trace_webgl` | Live debug: WebGL compiles, uniforms (values, drivers, setter), uploads, with stacks; breakpoints with caller variables |
| `library` | List, search and reuse saved kits |
| `investigate` | Start a background investigation toward a goal; returns a run id |
| `get_run_status` | Steps, progress and the proven report of an investigation |
| `inspect_site` | Open a URL and save the evidence |
| `detect_stack` | What a URL is built with, with proof |
| `report` | Read a saved `report.md`, `design.md`, `explain.md`, `code.md`, `api.md` or `run.json` |
| `list_runs` | List saved runs |
| `browse` | Hands: open, snapshot, scroll, screenshot, tabs |
| `interact` | Hands: click, type, fill, select, hover (never submits) |
| `submit` | Hands: submit a form; asks you first unless your policy is `delegated` |

Read tools carry `readOnlyHint: true`; `submit` is the only `destructiveHint`. Page text is returned as data, with a
note that it is not instructions. MCP runs are saved in `~/.dea/runs` unless `DEA_HOME` is set.

The easy way: `pnpm dea mcp install --client claude` (or `claude-code`, `cursor`, `vscode`, `windsurf`, `codex`).
It merges DEA into that app's config, keeps everything else and saves a backup; `--dry-run` shows the change first,
`--project` writes the project file (`.cursor/mcp.json`, `.vscode/mcp.json`), `--hub` also adds the DEA Hub gateway.

By hand, with DEA cloned to `C:\code\dea`:

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

### Live events (for UIs)

Every command takes `onEvent`, and `streamRun` turns any command into an async stream. Events are plain JSON
(`run.started`, `step`, `frame`, `fact`, `warning`, `run.finished`, `run.failed`), ready for a WebSocket or SSE.

```ts
import { decodeDesign, streamRun } from '@dea/core';

const { events, result } = streamRun((onEvent) => decodeDesign('https://lusion.co', { onEvent, frameData: true }));
for await (const e of events) {
  if (e.type === 'step') console.log('·', e.step);
  if (e.type === 'frame') showImage(e.file, e.data); // base64 JPEG when frameData is on
  if (e.type === 'fact') console.log(e.fact.label, e.fact.claim);
}
const design = await result;
```

## Project layout

```text
packages/
  core/   @dea/core   the engine (private)
    src/browser/      open a real browser with DEA's observers installed
    src/see/          inspect, page snapshot, network (HAR), stack detector
    src/design/       fonts, colours, type, motion, scroll, three.js, shaders; all CDP calls in design/cdp.ts
    src/code/         scripts via the debugger, source maps, webcrack, GSAP/shader/listener maps, explain.md, HAR → OpenAPI
    src/hands/        the browser session: tabs, refs, actions, actions.jsonl
    src/safety/       permission modes: restricted, supervised, delegated (enforced in core)
    src/brain/        investigate: planner, checkpoints, proven report, optional model
    src/hub/          MCP client, OAuth, encrypted secrets, access levels, history, alerts
    src/evidence/     run folders, secret stripping
  cli/    dea         the command line (commander)
  mcp/    dea-mcp     the MCP server (stdio) and the Hub gateway
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

- Bundled GSAP hides its individual tweens at run time: DEA reads them from the shipped code instead, where computed
  values show up under the minifier's names. With `window.gsap` it reads every live tween.
- JavaScript motion and scroll timing are sampled, so on a slow machine (software WebGL) they are partial; DEA marks them Unknown when it cannot tell.
- Shader technique names (noise, fresnel, bloom, …) come from function and keyword names in GLSL, so they are Inferred.
- Without source maps, code excerpts keep the minifier's names (`e`, `t`, `n`); DEA says so at the top of `explain.md`.
- `dea api` names which script calls an endpoint only when Chrome records an initiator; for many fetches it shows `–`.
- WebGL in Web Workers (OffscreenCanvas in a worker) is not observed yet.
- Extract rebuilds the site's shaders, tokens, motion and first-screen text, not its whole app: a multi-pass scene runs
  pass by pass through `pipeline.js`, but the site's own meshes and scene graph are hooks you fill. On a machine without
  a GPU, heavy sites render slowly in software, so the reference screenshot can still show a loader; use `--reference`.
- `dea trace` reads values when WebGL receives them; on three.js sites the line that changes `.value` runs earlier in the
  frame, so "set by" points at the frame loop's render call, and driver kinds are correlations (Inferred).
- Pages behind a login are not decoded; Hands never automates logins or payments.
- DEA Hub: apps that refuse automatic OAuth sign-up (GitHub, Slack, Figma, Asana, HubSpot, Box) need your own OAuth
  client id or a token. Hub runs locally over stdio; a remote URL for it is Phase 9.
- `investigate` without a language model writes claims and evidence, not prose; its planner is keyword rules.

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| 0–3 | Rules + CI, core (see a site), design decoder, read-only MCP server | ✅ |
| 5 | **Hands** — tabs, snapshots with refs, `browse` / `interact` / `submit`; modes restricted, supervised, delegated; submit always asks | ✅ |
| 6 | **Brain** — `investigate` in the background with plan, checkpoints, resume, proven report; optional OpenAI-compatible model | ✅ (planner is rules; model optional) |
| 7 | **Code and API decoder** — `Debugger` scripts, source maps, webcrack, GSAP/shader/listener maps, HAR → OpenAPI, retire.js | ✅ |
| 8 | **Hub** — DEA as MCP client and gateway: connect apps once, per-app × per-client access, history, kill switch, alerts; `dea mcp install` | ✅ (local, stdio) |
| 11 | **Use what you decode** — `extract` (tokens, motion, hero layout, shader modules, pipeline, build check, visual diff, research, stand-ins), `trace` (live WebGL debug with breakpoints), the asset chain, `library` | ✅ |
| 10 | **Launch kit** — example runs (`examples/`), CONTRIBUTING, SECURITY, CHANGELOG, issue and PR templates | ✅ (demo video still to do) |
| 9 | **Remote server** — Streamable HTTP with a bearer token (`dea serve --http`) | ✅ (local); OAuth sign-in later |
| 4 | **Publish `dea-cli` and `dea-mcp` 0.1** — build and pack already verified in CI; npm publish and the MCP Registry entry need the owner's npm login | Next |
| 12 | **`dea run` through Hub** — run decoders as Hub tools for any connected client | Next |

**Later: DEA Studio** — a local web UI (`dea ui`): goal box and step timeline on the left; live browser view and
evidence tabs (Stack, Design, Code, API, Hub history, Report) on the right. Core already streams the events it needs
(`onEvent` / `streamRun`), and investigations already write `checkpoint.json` for it to follow.

The default MCP tool list stays small on purpose (17 tools); connected apps reach AI apps through the separate Hub gateway.

## Credits

Made by **Jehad Uddin**. MIT licensed — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
