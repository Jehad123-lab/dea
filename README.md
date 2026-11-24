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
| `dea stability <url> --runs N` | How much the ORIGINAL site disagrees with itself: the scripted interaction on N fresh loads, with a fixed wait and with phase alignment (the noise floor for any interaction score). |
| `dea trace <url>` | Live debug: every WebGL call that matters (shader compiles, uniforms with values over time, texture uploads) with the code that made it, what drives each uniform (clock, scroll, pointer, viewport), and breakpoints (`--break uniform:uTime`, `--break texImage2D`, `--break url:main.js:120`) that return the caller's stack and variables. |
| `dea library add\|list\|search\|use` | Decode once, reuse everywhere: save kits, find them by site, technique, shader, uniform, ease, colour or font, copy one into a new project. |
| `dea motion <url>` | How it moves: the GSAP timeline tree and ScrollTriggers, CSS/WAAPI animations, Lottie, Rive, Framer, three.js clips, and a frame recording fitted to clocks, eases and springs. Writes `motion.md` and a runnable `motion/timeline.js`. |
| `dea investigate <url> --goal "…"` | Plans and runs the steps that answer your question, with checkpoints; writes a proven report. `--background`, `--resume <run>`. |
| `dea status [run]` | Where an investigation stands, and its report when done. |
| `dea session …` | DEA's hands: a browser that stays open; `start`, `goto`, `snapshot`, `click`, `type`, `fill`, `submit`, `screenshot`, `stop`. |
| `dea search "<query>"`, `dea read <url>` | Free web search and page reading, no keys, every result with its source, time and evidence. See [Search and read](#search-and-read). |
| `dea hub …` | Connect apps (Notion, Linear, GitHub, Vercel, a folder, a web address) once and choose what each AI app may do with them; every change follows the permission mode and is audited. See [DEA Hub](#dea-hub). |
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

## Doctor and bench (is there a graphics card?)

```powershell
pnpm dea doctor                 # Node, the browser, WebGL: a graphics card or software on the CPU, free disk space
pnpm dea doctor --headed        # the same with a browser window (some PCs fall back to software when headless)
pnpm dea bench --headed         # a small built-in scene on your card; writes dea-bench.json and dea-bench.md
pnpm dea bench https://example.org/ --headed   # also the frame rate of one public page, idle and while scrolled
```

`dea doctor` reads the WebGL renderer string the browser gives a page and the browser's own GPU report, and says
**hardware** or **software** (SwiftShader, llvmpipe, Windows' basic driver). In software it prints a plain warning: scenes draw at a few frames
a second, time-driven scenes land in another phase on each load, sites that check for a GPU may show a simpler version, and
frame rates from this machine are not a speed measure of a site or a kit. `dea bench` prints and saves speed numbers (a
full-window shader, many small draws, a 2048 × 2048 texture upload, the animation-frame rate, optionally one page's frame rate)
**only when a hardware GPU is in use**; in software it saves the label "software render, not a speed measure" and no numbers.

The result file holds the GPU name and backend, browser name and version, OS name, release and architecture, CPU model and count,
memory size, Node's version, DEA's version, the time, and the numbers. It holds no host name, user name, folder path, address,
login or environment variable (a test checks the host name, user name and home folder). Send `dea-bench.json` or `dea-bench.md` as it is.

On Windows 11 with Edge: `pnpm dea bench --headed -b msedge` in PowerShell. If it says software, open `edge://gpu`, look for
"Hardware accelerated" next to WebGL, update the graphics driver, and check Settings → System → "Use graphics acceleration when available".

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

### Your own logins (`dea browser`)

For a site that needs you to be signed in, DEA has a browser profile of its own, in `~/.dea/profiles/<name>`. You sign in by hand,
once, and DEA reads that site afterwards.

```powershell
pnpm dea browser login work https://example.org/login   # a visible Edge/Chrome window opens; sign in yourself; close it when done
pnpm dea session start --profile work https://example.org/account
pnpm dea browser profiles                               # name, size, last login, last use
pnpm dea browser forget work --yes                      # deletes the folder and every login in it
```

What it is and is not:

- **DEA's own folder only.** The profile is a folder DEA makes (a marker file inside). DEA never opens a folder it did not make and
  refuses anything that looks like your everyday Chrome, Edge, Brave, Vivaldi, Opera or Firefox profile. There is no mode that uses your
  everyday browser, and DEA never attaches to a browser that is already running: the login window is an ordinary browser process started with
  this one folder and **no remote-debugging port**, so nothing, DEA included, can control or read it.
- **DEA never sees your password.** You type it into the site's own page in that window. DEA does not read the window, has no password
  field of its own, and does not type secrets (`dea session` still refuses password, one-time-code and card fields, and never submits a login or
  payment form, in any mode).
- **What stays on disk.** After you sign in, the browser keeps cookies and local storage in the folder, protected by your operating system account
  (not by a DEA password). Anyone who can read your user folder as you, or any program running as you, can use those logins. Treat the folder like
  a signed-in browser: use a separate account on the site where you can, sign out inside the window when you are done, and run
  `dea browser forget` when you no longer need it. A session cookie works like a password until it expires or you sign out.
- **Work with it is read-first.** `--profile` applies to `dea session` (and to the MCP hands tools when `DEA_PROFILE` is set in the MCP client
  config; a tool call cannot choose a profile). Looking, scrolling and opening pages are free. In **supervised** mode every change (a click, typing, a
  selection) asks first, on every site, because DEA cannot tell which pages are signed in; submits ask in every mode that allows them;
  restricted mode refuses all changes. The session log records what happened.
- **One user at a time.** The browser refuses to open a profile that is already open: close the login window before starting a session.
- A site can still notice an automated browser, sign you out, or ask for another check; DEA does not try to get around that.


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

### Built-in connectors, permission modes, audit

Five connectors need no MCP server, only a **scope you declare** and (where one is needed) a token in **your own environment variable**:

```powershell
pnpm dea hub connectors                                   # what each needs and may do
pnpm dea hub add-connector github --scope repos=you/site --token-env GITHUB_TOKEN
pnpm dea hub add-connector vercel --scope projects=my-site --scope dirs=C:\sites\my-site\dist --token-env VERCEL_TOKEN
pnpm dea hub add-connector gitlab --scope projects=gitlab-org/cli                   # read only; public projects need no token
pnpm dea hub add-connector filesystem --name notes --scope root=C:\notes
pnpm dea hub add-connector http --name api --scope baseUrl=https://api.example.com/v1 --scope methods=GET,POST
pnpm dea hub doctor --live                                # what works right now: browser, PDF, each search source, tokens set; one harmless read per connector
pnpm dea hub selftest --live                              # does this installation do what it says? real read-only calls; skips a token you did not set
pnpm dea hub install --client cursor                      # prints the config to paste (claude, claude-code, cursor, vscode, windsurf, codex, generic); --write merges it, backup kept
pnpm dea hub approvals                                    # changes an AI is waiting to make; dea hub approve <id> / dea hub deny <id>
pnpm dea hub call github comment '{"repo":"you/site","number":4,"body":"thanks"}'   # asks you first
pnpm dea hub audit                                        # every change made or refused: what, where, when, mode
```

| Connector | Reads | Changes (asks / audited) | Scope it needs |
|---|---|---|---|
| `github` | repo, issues, pulls, files | `create_issue`, `comment` | `repos`: `owner/name` or `owner/*` |
| `vercel` | projects, deployments | `deploy_static` (preview; production only if `allowProduction`) | `projects`, `dirs` (folders a deploy may be read from) |
| `gitlab` | project, issues, merge requests, files (public projects without a token; a private one with `GITLAB_TOKEN`) | nothing: read only | `projects`: `group/name` or `group/*`; `host` for a self-managed GitLab |
| `filesystem` | `list_dir`, `read_file` | `write_file` (never replaces without `overwrite`) | `root`: one folder; links out of it are refused |
| `http` | `get` | `send` (POST, PUT, PATCH, DELETE, only if listed) | `baseUrl`, `methods`; never another host, never `..` |

**Permission modes** (the same three DEA's hands use) decide what a *change* may do; looking is always allowed:
`restricted` refuses every change, `supervised` (default) asks you first (in the terminal for `dea hub call`, through your AI
app's own prompt for the gateway; an app that cannot show the prompt gets no changes), `delegated` runs changes without
asking, but only inside the connector's declared scope.

**Approving a change when the AI app cannot show you the question.** Through MCP the question goes through the AI app
(elicitation). If the app cannot show it (many cannot), the change is not refused for good: it waits as an *approval* with an
id, and the AI is told that id. In a terminal you run `dea hub approve <id>`: DEA shows the change (client, app, tool, where it
lands, the arguments with secrets hidden) and asks `[y/N]`. It needs a keyboard (a piped `y` does not count), so an AI app that
only has MCP tools cannot press it. The AI then asks again and the change runs. An approval is for **one exact call** (same
client, app, tool and arguments), works **once**, and ends after **ten minutes**; `dea hub deny <id>` refuses it and the AI is
told you declined. Honest limit: an AI that also has unrestricted shell access to your account could edit DEA's files; nothing
running as you can be fenced off from you. Walk through it with a real stdio MCP client: `pnpm demo:approval` (no network, no
token; it is also a test). Out of scope is refused in every mode. The mode comes from `DEA_MODE`
or `policy.json`; an AI app cannot loosen it. Per-app access levels (`dea hub allow`) apply on top.

**Secrets**: a token is read from the environment variable you name when a call runs, sent only as the Authorization header
of that call, and never stored, printed or logged: not in `hub.json`, the history, the audit log, an error message or a result
(a service that echoes it back is redacted too). DEA never asks you to type a token into a chat or a command.
**No change without a record**: if `audit.jsonl` cannot be written, the change is not made. Nothing posts, emails or buys
by itself: every change is a call you or an AI app you allowed made, inside the scope you declared.

## Search and read

`dea search "three.js instanced mesh"` asks a few **free, keyless** sources at once and says which answered:

- DuckDuckGo's HTML results page (general; its robots.txt allows it); for programming questions also MDN, npm, GitHub
  repository search (no token: 10 searches a minute), Stack Overflow; Wikipedia for short concept queries; Hacker News on request.
  **If the HTML page is blocked, limited or empty, DEA asks DuckDuckGo's lite page** (`duckduckgo-lite`, same engine, robots.txt allows
  it) and says so; it is asked only then, in DEA's fixed source order. Your own SearXNG with `DEA_SEARXNG_URL` (JSON output on).
  Public SearXNG instances answered a script with 429, 418 or a captcha, so DEA does not use them.
- Each result has `title`, `url`, `snippet`, `source`, `fetched_at`, `verified` (fetched live in this call, or from the disk cache
  in `~/.dea/web-cache`) and an `evidence` note. The answer has a **`status`**: `ok`, `partial` (results, but a source was blocked,
  limited or failed: `problems` names each and why), `blocked` (nothing came back and a source refused: `BLOCKED` on the command
  line), or `none`. DEA does not retry around a refusal, rotate addresses or solve captchas. If a live source fails and an older
  cached answer exists, that answer is shown labelled `stale`. `--timeout` bounds the whole call.
- `dea read <url>` fetches one public page and returns its readable text with the same labels. It honours robots.txt, sends its own
  User-Agent, spaces calls to one host, refuses localhost and private addresses, and reports bot-check pages instead of passing them.
  Page text is data, not instructions. What kind of page it was is in `method`:
  - `static`: the page as served.
  - `rendered`: **the page is an empty shell that scripts fill in** (little text, a script, a `#root`), so DEA ran it in its own
    headless browser (a fresh profile: no cookies, no logins; pictures, fonts and media are not downloaded; requests the page makes to
    private or local addresses are refused) and read the result. `--render never|auto|always` (default `auto`). If no browser can
    start, you get the page as served plus a warning that says so, never a pretend render.
  - `pdf`: the PDF's **text layer**, page by page (`[page 1]`, ...), read with [unpdf](https://github.com/unjs/unpdf) (MIT, bundles
    Mozilla's pdf.js, Apache-2.0). `--max-pages` (default 40). A scanned PDF has no text layer and DEA has no OCR: it says so.
  - `feed`: RSS, Atom, sitemaps and sitemap indexes (also `.xml.gz`) as a list of entries (`items`).
- `dea research "<question>"` (MCP tool `research`) is search, read and extract in one call: it searches (or takes `--url`s), opens the
  best pages (one per site first), cuts them into passages and ranks the passages by the question's words, rarer words counting more.
  That is plain code, not a model: the result is the pages' own words with their offset, and a **trail** of every step (what was
  searched, which pages opened, which failed and why). The same question on the same pages gives the same passages in the same order.
- Every call has a time budget (`--timeout`, `timeoutMs`); a call that runs out says which step did, and `research` returns what
  finished. All of these are MCP tools (`search`, `read`, `research`).

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

**Scroll-driven scenes (the scroll tape).** A scene that changes as you scroll is not always a straight-line function of
one uniform: the site may ease the scroll itself, step a timeline, or move hundreds of instances on the CPU and upload the
result. So after the pointer tape, extract continues the recording while the page is scrolled, a stop at a time (a wheel
step, then a few settled frames; eight stops about half a window apart, then back to the top), and reads the DOM beside each
stop. The wheel is the one input every scroll mechanism answers: a native scroll, a *virtual scroll* that never scrolls the
document and moves one container by a transform, or a fixed stage that moves its scene by wheel events. The scroll signal is
the page's own `scrollY` once it has moved by a real amount, otherwise the sum of the wheel it was given. The replay and the
editable rebuild then play the recorded stop nearest to the live, eased scroll, apply first the uploads of the stops the scroll
skipped over (a buffer the site re-uploads only when something changes holds the right bytes), and blend float uniforms and
float uploads between two stops when the recorded frames line up. Verified: the stops, their frames and what changed
between them (read from the recording). Inferred: the picture between two stops. Unknown: state the site keeps between
stops (history, springs) and anything past the probed extent. The fit says how many buffers the site re-uploaded and how
many of them in full at every stop (the others are exact only when scrolling forward). A scroll that changed nothing the
recorder could see is reported as that, with the stops and the mechanism, not as "no scroll input".

**Page map (`page-map.json`, `page-map.md`).** A page with no WebGL gets one from a plain scroll of a fresh load (the sections and canvases in view at each screen). For a scene with WebGL, from the same stops: for each scroll position, which programs drew and how
many draws, how much of the recorded state differs from the top of the page, which sections (`header`, `section`, `main > *`,
`[data-section]`) and canvases are in view with the share of the window, and a scene change flag where the program set or
the draw count changes. It covers as much of the page as the probe scrolled (for a virtual scroll there is no document
height, so the extent is how far the wheel was driven), only the busiest WebGL canvas is recorded, and routes behind links
are not followed.

**Evidence ledger (`evidence.json`, `evidence.md`).** Every finding as data: an id (`scene.replay`, `input.scroll`,
`scroll.tape`, `page.map`, `boot.timeline`, ...), the label (Verified / Inferred / Unknown), the measurement behind it,
how much of the thing was exercised (`complete`, `partial`, `not-exercised`), what limits it, and the probe that would
close it; unknowns link to the findings they follow from; the kit's files carry their sha-256. Absence is never concluded
from partial coverage: "no input answered" is Unknown when the probe could not reach the input. A replay of one held frame
is recorded as what it is (the recording plays back), not as proof of motion. Agents read it with the MCP `report` tool and
`which: "evidence"` (a summary first, then one finding by `finding`, or a slice by `area` or `label`).
The shape is borrowed from how REA (MIT) returns findings with their evidence and unknowns; the code is DEA's own.

**Boot timeline.** The recorder notes when the page's WebGL came up (first canvas, first draw, every program link, in ms
since navigation). `boot.timeline` says whether shader programs were still being linked just before the reference frames
were taken, which is how a reference that is really a loading screen is caught.

**What moves and what is frozen.** Live (`rb.start()`, `replay.start()`) holds the recorded camera: the two recorded
frames carry slightly different camera matrices (a dolly caught mid-move), and playing them one after the other made the
picture shake, so every frame takes the float and matrix uniforms of the last recorded frame while every pass, the
simulation passes included, still runs on the live render targets and the clocks follow the real time. Real pointer,
touch, scroll and window size drive the uniforms the input probe measured following them, as value = scale × eased input
+ offset with the easing found per uniform, applied as a move from the recorded value (recorded + scale × (input − input
at rest)), so an input that has not moved leaves the picture as recorded. The probe moves the pointer across the page,
wheels down and back up (the page's own scroll when it can scroll, the sum of the wheel when a fixed stage moves by wheel
events), and resizes the window, while the recorder notes every float uniform and every matrix per frame. A fit has to earn
its place: it must predict the way back of the pointer's path as well as the way out (a smooth value that merely drifts
with time fits a short pointer path by luck), it may not be steeper than the values it was fitted to, live input is held
inside the range it was measured over and never moves a value by more than the value moved during the probe, a matrix's
3×3 block is made orthogonal again after the move, and a projection keeps its depth range and moves its two scales by at
most 15%. `extract.md` lists each input as ✔ verified live, ≈ inferred (from the uniform's name, not moved by the probe) or
✖ frozen, and `preview/interaction.jpg` is the same scripted pointer and scroll on the site and on the kit, side by side,
with an interaction score (how well the places where the picture changed agree). What the kit does not do: effects that
live in CPU state the page never hands to WebGL as a uniform (a pointer trail drawn from the pointer's history, a physics
simulation of objects) and DOM that moves with scroll (a hero card that shrinks); those play as recorded. When the two
recorded frames differ in more than uniforms (lusion.co places its instances from simulation state), alternating them
flips the picture even with every uniform held; DEA measures that on 8 live frames and, if the replay flips, the replay
plays the last recorded frame alone (`doc.hold = "last"`, said in `extract.md`): steady, and a still picture.
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

Round 5 adds the input probe (wheel, pointer sweeps, resizes) and a scripted interaction check that runs the kit live,
both on a software GPU at 0.3–0.8 frames per second, so a full extract is slower than the table above: lusion.co 856 s
with a new reference capture (353 s with the capture reused), jehaduddin.vercel.app 1163 s with design, motion, assets and
the reference reused (1709 s the first time). `--quick` skips both. Scores now, page / canvas, each measured on its own:

| site | (a) capture replay | (b) editable rebuild | (b) with `--own-assets` | interaction (replay / rebuild) |
| --- | --- | --- | --- | --- |
| lusion.co | 99.8% / 99.5% | 99.8% / 99.5% | 85.0% / 52.3% | 0% (a still frame, see below) / 24.4% |
| jehaduddin.vercel.app | 99.9% / 100% | 99.9% / 100% | 92.1% / 69.1% | 4.0% / 3.7% |

The interaction score is how well the places where the picture changed after a scripted pointer move or wheel turn agree
between the site and the kit (0–100%); the first two columns are scores of the recorded reference frame, which both
kits reproduce by construction, so the last column is the one that says how alive the kit is. The script is a pointer glide,
three wheel depths (400, 1200 and 2000 px) and, for pages that listen for a press, a drag; when a scroll tape was recorded the
site part runs on a fresh load of the page, because a scroll-driven story does not always rewind to its first screen.

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

- **`--budget <minutes>`** (default 10, `DEA_BUDGET_MIN`, 0 = off): a per-site time budget. When it is spent the run skips
  the interaction check, technique research and the build check and says so; five minutes later the command stops with
  exit code 124. A heavy site on a machine without a GPU spends most of its time loading and settling in the browser
  (the pure-JS scoring is under 4% of a run), so the budget cuts the optional browser stages, not the arithmetic.
- **Pointer input in the kit.** A uniform a site sets only while the pointer moves is fitted to the recorded pointer
  (as a position or as the pointer's step times a gain) and driven from the live pointer in the replay and the rebuild.
  A page that listens for a press gets a second tape with the button held; the kit plays it only while the live button
  is down. Dye colours the site picks at random are replayed as recorded, so a splat lands in the right place with its
  recorded colour, not the colour the original happened to pick.
- **Compressed textures and uniform blocks.** BPTC/S3TC/ETC/ASTC textures are allocated with `texStorage` before their
  recorded uploads, and the rebuild binds uniform blocks and multi-draw ranges. Tested on igloo.inc only.

`--section <selector>` scrolls that part of the page into view for the reference, reads only its text, and keeps only
the motion that touches it. `--reference shot.png` compares against your own screenshot (for example one taken on a
machine with a GPU). `--library <name> --tag hero` saves the kit; `--batch urls.txt` extracts a list of sites.

### The whole page (`dea extract`, not `--quick`)

*Scroll-driven WebGL.* The recorded WebGL scenes follow the scroll too: after the first screens (stops close together) the scroll tape
spreads its remaining stops over the rest of the page (a native-scrolling page; a wheel-only page keeps the first stops), re-planning after
every stop from where the page really is, within a stop count, a time, the run budget and a size budget (`--tape-mb`). A stop is recorded
until the page's scroll has nearly settled; identical uploads are stored once. The kit then plays the stop nearest to the live scroll.

The kit follows the page below the first screen. After the first screen is chosen, extract loads the page fresh, waits until
the scene is stable (see below), scrolls it one stop at a time (every 0.8 screens; a page that only answers the wheel is
driven by the wheel and its px-per-step is measured), waits for each stop to settle (lazy content has loaded, lazy images
are in) and reads every visible text block, box, image, video and canvas at its place in the document.
Everything is merged into document coordinates and sorted by how it behaved over the stops: **static** (one place), **fixed**
(a header; it stays in the window and is shown only over the stops where it was seen) or **moving** (keyframes by scroll).
The kit then has the page's height, the same elements at the same scroll positions, a fixed header that stays put, the page's
background at each stop, and a small canvas that is not the 3D scene (a chart, a map) as a picture of what it showed.

- **Scored per scroll stop.** The kit is opened at each stop and compared with the original's screenshot of that stop (same
  scorer as the first screen). `preview/page-stops.jpg` is a contact sheet (original above, kit below; the first, the last and
  the two worst stops are always in it), `page-stops.json` has every number, and `extract.md` has a "The whole page" section.
- **Every label stays.** The whole-page read is *Verified* (with the stops it covers and its limits), the stops under 60% are an
  *Unknown* naming them, and what the page does that the read cannot see (click, hover, menus, forms, other routes) is listed as
  *not reproduced*. Replay, rebuild and `--own-assets` are scored separately, and a first-frame match still proves nothing about
  motion. `--own-assets` keeps the layout and swaps every picture for a placeholder of the same size.
- **Canvases in closed shadow roots.** DEA's page hook records every `attachShadow`, so a canvas the page draws inside a closed
  shadow root (igloo.inc does) is found by the page map, the canvas ranking and the layout read. No `querySelector` can reach it.
- **"Scene stable" instead of a fixed wait.** After a load the run waits until the 64x40 grey thumbnail of the page changes by
  less than 0.8 (of 255) for three reads in a row, no DOM change and no request is in flight. A scene that is still moving at the
  cap is reported as time-driven, not as stable.
- **Phase alignment.** A time-driven scene (igloo.inc) looks different at every moment, so a scripted interaction started at a
  fixed time compares two different pictures. The fresh load now waits until its picture is within 6 (of 255) of the reference
  picture, and the interaction, the run and the ledger record `phase` (aligned or not, how far, how long). An unaligned run is
  an *Unknown* in the ledger, and its interaction score is marked not comparable.
- **`dea stability <url> --runs N --mode both|aligned|fixed`**: runs the same interaction on N fresh loads of the ORIGINAL
  and compares each with run 0, with the old fixed wait and with phase alignment. That is the noise floor: a kit cannot be
  expected to agree with the site more than the site agrees with itself. Writes `stability.json` / `stability.md`.


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

`dea-mcp` exposes 20 tools over stdio (and over HTTP with `dea serve --http`):

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
| `search` | Free web search (no keys): results with source, time, evidence, verified/cached label; blocked sources named |
| `read` | Read one public page as text with the same labels (robots.txt respected, private addresses refused); pages built by scripts are rendered in DEA's own headless browser, PDFs are read from their text layer, RSS/Atom/sitemaps come back as lists |
| `research` | Search, read and extract in one call: the passages that answer a question (ranked by plain code, no model), with the trail of every step |
| `investigate` | Start a background investigation toward a goal; returns a run id |
| `get_run_status` | Steps, progress and the proven report of an investigation |
| `inspect_site` | Open a URL and save the evidence |
| `detect_stack` | What a URL is built with, with proof |
| `report` | Read a saved `report.md`, `design.md`, `explain.md`, `code.md`, `api.md`, `run.json`, or an extract's evidence ledger (`which: evidence`: summary first, then one finding or a slice) |
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

## Same inputs, same outputs, whichever AI drives it

An AI client chooses commands and options. It does not produce any number, label or finding: every result an MCP tool
returns is computed by DEA's code from the inputs (the site, a saved run, the options). So two clients (a different
model, a different app, a different call order) that make the same call read the same result.

How it is kept true:

- **One shape.** The structured tools (`search`, `read`, `research`, `report`, `list_runs`, `detect_stack`, `inspect_site`, `extract`)
  answer `{ schema: "dea.result/1", tool, note, result }`. `content[0]` is that object as canonical JSON (keys sorted,
  numbers rounded to 3 decimals, array order meaningful and fixed by DEA). `structuredContent` carries the same object plus
  `meta`. `content[1]` repeats `meta` as text.
- **Volatile fields live in `meta`**, never in `result`: run ids, timestamps (`fetched_at`, `madeAt`), timings, the machine,
  file hashes, verified/cached state of a search, source status. They are true, and different on every call.
- **Fixed defaults and normal form.** Omitted options mean the same as their documented default; `search` sorts the sources
  into DEA's own order, trims and de-duplicates them, so the order an AI listed them in does not change the answer.
- **Proof in the test suite.** `packages/mcp/test/determinism.test.ts` calls the tools through two clients (other client name,
  other call order, other argument order and spelling, other clock) against a recorded web fixture and a saved run, and asserts
  the `result` text is identical; `packages/core/test/determinism.e2e.test.ts` extracts the same local page twice in a real
  browser and asserts the evidence ledger (scores, page map, findings) is identical except `meta`.

Where it does **not** hold, and how DEA says so:

- A live site changes (content, A/B tests, ads); the same URL is a different input tomorrow. `meta` carries the time.
- Network timing and a loaded machine change what a site shows within a time budget. DEA waits for a stable scene, not a fixed
  time, and says when it could not (`phase` in the evidence ledger).
- Software WebGL (no GPU) runs 0.3 to 0.8 fps, so time-driven scenes land in different phases. DEA aligns the start of a
  comparison to the reference picture (`dea.phase`), and reports the spread of repeated runs (`n`, mean, sd, min, max)
  instead of one number. Where a site disagrees with itself, the number is labelled with that spread.
- Free web search returns what the sources return today; `meta.label` says verified (live), cached or mixed.

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
    src/hub/          MCP client, OAuth, encrypted secrets, access levels, history, alerts, permission modes, audit,
                      built-in connectors (github, vercel, filesystem, http)
    src/web/          free search sources, polite fetch (robots.txt, rate limits), page reader, disk cache
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
- The built-in GitHub, Vercel, filesystem and http connectors are tested in CI against a fake API and a temp folder; the GitLab
  connector against recorded answers of gitlab.com. `dea hub selftest --live` makes real read-only calls (GitHub and GitLab public
  APIs without a token; with `GITHUB_TOKEN`, `VERCEL_TOKEN` or `GITLAB_TOKEN` set in your shell, one read each), but a **valid**
  GitHub or Vercel token has not been run on the machine that built them: the built-in checks only saw the real GitHub API
  refuse a made-up token.
- `read` renders a page only when it looks like an empty shell; a page that shows some text and loads the rest later is read as
  served (`--render always` forces it). A rendered page can differ from run to run (clocks, A/B tests). A scanned PDF has no text.
  Search snippets are the sources' words and sources can change or block at any time. Notion and Slack connectors were not built:
  they cannot be tested against recorded real answers without a token.
  Search sources can change their pages or limits at any time; `dea search` then reports a source as failed instead of guessing.
- Sites behind bot protection (PerimeterX, DataDome, Cloudflare challenges, ...) are reported as `Blocked by bot
  protection` and not captured. DEA does not bypass protection or solve captchas.
- A page that changes with time (a playing hero video, a colour that cycles, an intro) is read at one moment and the
  kit's copy runs on its own clock, so the page score of such a site moves from run to run; look at the side-by-side
  image, not only the number.
- A hero that cycles between slides or colours (locomotive.ca/en) is not reproduced: the kit's copy can show another
  slide than the screenshot, and the page score swings between about 24% and 45% from run to run. Holding the video at
  its captured second made it worse (a black frame) and was removed.
- Pointer-driven draws are replayed from the live pointer for the uniforms DEA can fit (a position, or a step times a
  gain); a site that derives them another way (accumulated velocity, random colours) is replayed with the recorded values.
- Extract reads the whole page's DOM at scroll stops and the busiest canvas. The page layer is absolutely positioned boxes at
  the width it was read (no reflow at other widths), and click, hover, menu and form states, other routes and canvas drawing
  that starts empty (a whiteboard) are not rebuilt. A canvas that is not the scene is a still picture of one moment. A virtual
  (wheel-only) scroll is read by the wheel and kept as native scrolling in the kit; it is tested on a purpose-written page only.
  Scroll-driven 3D is followed through the scroll tape (stops, not a continuous recording), which reaches as far down a long page as
  its budgets allow (stop count, time, the run budget, and what it may add to the recording: `--tape-mb`, 64 MB by default), not always
  the end: where it stopped and why is in the page map and the report (`ended`). A WebGL page whose sections bring their own big
  textures costs several MB per stop, so a long one needs a larger `--tape-mb` (and a larger `--max-capture-mb`) or is covered in part.
- "Scene stable" and "in phase" are judged on a 64x40 grey thumbnail: a change smaller than that is not seen. A time-driven scene
  (igloo.inc) can be started in the same phase as the reference, but its animation over scroll is still not reproduced, and the
  noise floor from `dea stability` is measured over a handful of runs, not a population.
- The scroll tape plays recorded stops: between two stops the picture is the nearest stop (float uniforms and uploads are
  blended only when the recorded frames line up), and state the site keeps between stops (history, springs) is not recorded.
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
| 10 | **Launch kit** — example runs (`examples/`), CONTRIBUTING, SECURITY, CHANGELOG, issue and PR templates | ✅ (demo video recorded: dea-v0.2.0-demo.mp4) |
| 9 | **Remote server** — Streamable HTTP with a bearer token (`dea serve --http`) | ✅ (local); OAuth sign-in later |
| 4 | **Publish `dea-cli` and `dea-mcp` 0.1** — build and pack already verified in CI; npm publish and the MCP Registry entry need the owner's npm login | Next |
| 12 | **`dea run` through Hub** — run decoders as Hub tools for any connected client | Next |

**Later: DEA Studio** — a local web UI (`dea ui`): goal box and step timeline on the left; live browser view and
evidence tabs (Stack, Design, Code, API, Hub history, Report) on the right. Core already streams the events it needs
(`onEvent` / `streamRun`), and investigations already write `checkpoint.json` for it to follow.

The default MCP tool list stays small on purpose (20 tools); connected apps reach AI apps through the separate Hub gateway.

## Credits

Made by **Jehad Uddin**. MIT licensed — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
