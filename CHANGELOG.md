# Changelog

All notable changes to DEA. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - unreleased

The first release: decode a website with evidence, use what comes out, and let AI agents do the same.

### Decode

- `dea inspect`, `dea stack`: open a site in a real browser (your Chrome or Edge, or Playwright's Chromium) and save
  the evidence: network log with secrets stripped, page tree, fonts, scripts, shaders; what it is built with, each item
  with a version, a label (Verified / Inferred) and its proof.
- `dea design`: fonts per element, colours, type scale, spacing, CSS and GSAP motion, scroll behaviour, three.js scenes
  and shaders.
- `dea explain`, `dea code`, `dea api`: every script, published source maps rebuilt into original files, unpacked
  bundles, GSAP calls, shaders, listeners, known-vulnerable libraries; the APIs a page calls as OpenAPI 3.1, with the
  script line that calls each one.
- `dea assets`: every texture WebGL received (PNG previews, format, wrap/filter), render targets read back, GLB/glTF,
  KTX2, HDR/EXR, video, Lottie, Rive, fonts; the render pipeline of one frame; and the network → source → runtime chain
  (file ← loading code → program.sampler → shader line).
- `dea motion`: the live GSAP tree and ScrollTriggers, CSS/WAAPI, Lottie, Rive, Framer Motion, Theatre.js, three.js
  clips, and frame recordings fitted to clocks, eases and springs, as a runnable `timeline.js`.
- `dea trace`: live debug of WebGL with call stacks: shader compiles, every uniform with its values over time and what
  drives it (clock, scroll, pointer, viewport), texture uploads; breakpoints on WebGL calls, uniforms and script lines
  that return the caller's variables.
- Every report ends with "Gap → path to result": what is known, what is missing, the best reconstruction now, and the
  next probe. `dea investigate` runs those probes itself.

### Same result whichever AI drives it

- Structured MCP answers: `search`, `read`, `report`, `list_runs`, `detect_stack`, `inspect_site` and `extract` return
  `{ schema: "dea.result/1", tool, note, result }` as canonical JSON in `content[0]` (keys sorted, numbers rounded to 3
  decimals); run ids, times, timings, machine, file hashes and cache state are in `meta` (`structuredContent.meta`,
  `content[1]`), never in `result`.
- `search` asks the sources in DEA's own fixed order whatever order the caller listed them in.
- Tests: two clients with different call order, argument order and clock read the same `result` text; the same local
  page extracted twice gives the same evidence ledger (real-browser test).
- README: "Same inputs, same outputs, whichever AI drives it", with where it does not hold.

### Use

- `dea extract --to react|vanilla|framer`: design tokens (CSS variables, a Tailwind preset, W3C tokens for Figma
  Tokens Studio), GSAP and CSS motion, the first screen's text as laid out on the site, the site's shaders as three.js
  modules with traced uniform values and drivers, the render pipeline, textures (or same-size placeholders), a build
  check, a visual diff against the original, technique stand-ins kept only when they improve the match, research in
  free sources with citations, and a provenance note.
- `dea library add|list|search|use|remove`: decode once, reuse in every project; `dea extract --batch urls.txt`.
- A canvas-only score beside the page score on every extract (SSIM at three scales, edges and tones of the WebGL
  canvas with the text hidden), and `dea score` to score any two screenshots the same way.
- The site's own WebGL frames, recorded right before the reference screenshot and rebuilt two ways: a call-for-call
  capture replay (the ground truth) and an editable three.js project (RawShaderMaterials with the site's GLSL, render
  targets, cameras and model matrices, the passes in the site's order), each scored on its own; `render-graph.md` with
  Verified/Inferred per pass; meshes and camera read back into `scene/scene.glb`; `--own-assets` placeholders.
- The first screen's HTML around the canvas: text, pills and buttons, see-through overlays and inline SVG logos, with
  the site's fonts in their right style.
- WebGL frame recording in `dea extract`, scored two ways: (a) the capture replay, the recorded calls played back
  (`replay/replay.js`), and (b) the editable rebuild, the recorded render graph as a three.js project (RawShaderMaterials
  with the site's GLSL, geometry, cameras, render targets, passes in order; `rebuild/rebuild.js`, `rebuild.md`). A
  per-pass `render-graph.md` (Verified / Inferred) and the frame's meshes in `scene/scene.glb`. `--max-capture-mb`,
  `--no-replay`; `--own-assets` keeps the site's recorded bytes out of the kit.
- Headings keep the space where they break onto a new line; uniform "set by" names the line that assigns `.value`.

- `--timings` on every browser command (`extract`, `design`, `motion`, `assets`, `trace`, `inspect`, `score`): the wall
  time of each stage, nested, and the peak memory of DEA and of DEA plus its browsers. Always saved as `timings.json` in
  the run.
- Faster extracts: a per-URL content cache (`--no-cache`, `--cache-dir`, `--cache-max-mb`, `dea cache info|clear`)
  for files, finished decoder runs and the reference capture; one pool of browsers reused across stages and `--batch`;
  design, motion and assets → trace side by side after the reference capture (`--concurrency`, `--overlap`); waits that
  end when the page is drawing and no loader covers it; a sweep that skips knobs which change nothing on screen; and
  `--quick`, a clearly labelled rough mode. lusion.co 676 s → 327 s cold, 61 s warm; jehaduddin.vercel.app 1046 s →
  690 s cold, 142 s warm, on a 4-core machine without a GPU, full-mode scores within 0.3 points of before.

### Live input (round 5)

- Live kits hold the recorded camera (no shake: 8 consecutive frames change by 0.1–0.7 on a 0–255 scale, against 5–11 when
  the two recorded frames are played alternately), and the generated project puts the canvas under the page's text
  (`zIndex: 0`) and can show the replay beside the rebuild (`?view=replay`).
- The input probe wheels (the page's own scroll, or the sum of the wheel when a fixed stage moves by wheel events),
  moves the pointer and resizes the window; matrices (model, view, projection, normal) are fitted per draw to the pointer
  and to the scroll. `extract.md` says per input whether it is verified live, inferred from a name, or frozen, and
  `preview/interaction.jpg` plays the same pointer and scroll script on the site and on the kit with an interaction score.
- A fit moves the recorded value instead of replacing it (recorded + scale × (input − input at rest)); it is held inside
  the range it was measured over; a matrix is kept orthogonal; a projection keeps its depth range; a fit must predict the
  way back of the pointer's path and may not be steeper than its data. Before, the first pointer event blacked out the
  lusion.co rebuild (interaction score 1% → 24%).
- The first-screen layout read finds fades and overlays painted by `::before` / `::after` (the bottom of jehaduddin's
  page is darkened by one; the replay was up to 2× too bright there; page score 82.6% → 99.9%). A regular expression
  that lost its backslash in a template literal had silently disabled the whole layout read; `inpage-scripts.test.ts`
  now parses every in-page script, and the real-browser CI job prints failing assertions as annotations.
- A replay whose two recorded frames flip even with held uniforms (lusion.co) now plays the last recorded frame alone: DEA
  measures 8 live frames, patches the capture (`hold: "last"`) when they flip and measures again.
- The capture cache is keyed by the recorder's source, so a changed recorder never serves old probe data.

### General engine (round 6: other public sites)

Found by running other sites; each rule is general, none is written for one site.

- A bot-protection wall (PerimeterX, Cloudflare, DataDome, Akamai, Imperva, Kasada, captcha pages) is detected from the
  response status and headers, the page's own words and its challenge markers, and DEA stops with `Blocked by bot
  protection (<vendor>)` and a non-zero exit. It never tries to get past the wall, never solves a captcha, and writes no
  kit, so a block page is not mistaken for the site. A site that only loads a protection script is not called a wall.
- Paint order inside positioned elements: content of a positioned element without a z-index paints with that element, not
  below it (a white button's label no longer hides under the button; the nav bar no longer covers its own links).
- The capture cache key now includes the first-screen reader, so a reader change takes the capture again instead of
  reusing an older reading.
- A first-screen colour written in a newer colour space (oklch, oklab, lab, `color()`) is read back as sRGB, so the page
  background no longer falls back to a design token.
- Inline SVG icons that point at a shared sprite (`<use href="#id">`) are rebuilt with the shapes they reference.
- Button-like inputs (`type=button|submit|reset`) put their `value` on the page as text.
- Text that was one line stays one line; a block of several lines keeps its measured height and clips as the site did.
- Text kept only for screen readers (clipped to nothing) is not drawn.
- A playing hero video starts the kit's `<video>` at the second it had reached when the first screen was read; a video
  that had not shown a frame yet is drawn as its poster picture.
- Rotated text (a vertical label) is placed as its unrotated box turned about its centre; `writing-mode` is kept.
- Text a mask hides (a rolling label keeps a second copy of each letter behind its overflow clip) is read as what shows.
- The three.js revision is read out of whatever a site reports (`170`, `r170`, `0.170.0`, or a fork's own words such as
  `178 - modified by <studio>`), so the rebuild preview and the project point at a version a CDN serves. Before this, a
  fork's version string made the editable rebuild of one heavy site draw nothing (canvas 27.9%); after it, 98.9%.
- First-screen `<video>`, large images and CSS `url()` backgrounds become layers; fonts are emitted rule by rule with
  weight, style and `unicode-range`; text runs keep bold, colour and underline; box shadows and the page background
  (sampled at nine points) are kept.

### General engine (round 7)

Found by running igloo.inc and the WebGL fluid simulation; each rule is general.

- Compressed textures (BPTC, S3TC, ETC, ASTC, RGTC, PVRTC) are allocated with `texStorage2D/3D` over their whole mip chain
  before the recorded `compressedTexSubImage*` uploads, in the replay and in the rebuild. Before, they were allocated with
  `texImage2D`, which WebGL refuses for compressed formats, so every one of them was empty (igloo.inc: the dome and every
  other BC7 texture; the replay's dome was dark where the site's glows).
- The editable rebuild binds uniform blocks: each program's block bindings, each draw's buffers (`bindBufferBase/Range`)
  and the `bufferSubData` that rewrites a block while frames run. Before, a draw that read a uniform block was discarded by
  WebGL with no error shown, and the igloo.inc rebuild was black.
- A program given the model matrix and the model-view matrix but no view matrix gets a camera of `modelView x model^-1`, so
  three.js reproduces the site's model-view (before, 238 of igloo.inc's draws were off).
- `WEBGL_multi_draw` calls become one draw per range in the rebuild (they were skipped).
- Pointer-driven uniforms on the tape: a uniform the site sets only while the pointer moves (a splat's point and force) is
  fitted to the recorded pointer, as a position in one of six spaces or as the pointer's step times a gain, per set within
  a frame, and set from the live pointer in the replay and in the rebuild.
- Drag as an input: a page that listens for a press (`mousedown`, `pointerdown`, `touchstart`) gets a second tape with the
  button held; it is kept only when the hovering tape found nothing that follows the pointer. A kit with a drag tape plays
  it only while the live button is held, and the interaction check adds a drag step for such pages. On the WebGL fluid
  simulation (splats exist only while dragging) the kit now draws the splat where the drag goes.
- A run-time budget per site (`--budget <minutes>`, default 10, env `DEA_BUDGET_MIN`, 0 = off): once it is spent the
  interaction check, technique research and the build check are skipped and the run says so; 5 minutes later the command
  stops with exit code 124.
- A stage whose page crashes gets one more go, and a crash in the optional motion stage no longer ends the run (added after a full activetheory.net run died with "Target crashed"; inferred, the retry has not fired since).
- The `inputs:` line reports the pointer as verified when a recorded pointer tape follows it (it said "frozen" while the kit was following the pointer).
- The canvas to record is ranked by the part of it that is on screen (a taller canvas further down the page no longer wins
  over the first screen's), with canvases wholly off screen as the fallback.
- A hero video that was playing starts at the second it had reached in the kit's React page (a hold in the static preview was tried and removed: it showed a black frame).
- The scroll tape: extract records the page at scroll stops (a wheel step, then settled frames, eight stops and back to the
  top; native scroll or a virtual scroll that only answers the wheel) and the replay and the editable rebuild play the
  stop nearest to the live, eased scroll, with the uploads of skipped stops applied first and float uniforms and uploads
  blended between two stops when the frames line up. Verified on a purpose-written virtual-scroll scene (replay and rebuild
  forward, backward and between stops); the kit follows scroll-driven scenes that a straight-line fit of one uniform could not.
- The scroll signal: the page's own `scrollY` once it has moved by a real amount, else the sum of the wheel (a document a few
  pixels taller than the window used to read as native scrolling while the wheel drove a virtual scroll).
- Page map (`page-map.json` / `.md`): per scroll stop, the programs and draws, the change against the top, the sections and
  canvases in view, and where the scene changes.
- Evidence ledger (`evidence.json` / `.md`) and MCP `report` with `which: evidence`: every finding with its label, measurement,
  coverage (`complete`, `partial`, `not-exercised`), limits and next probe; unknowns link to findings; kit files carry sha-256;
  summary first, one finding or a slice on request. Absence is not concluded from partial coverage.
- Boot timeline: first canvas, first draw and program links from the recorder, so a reference taken while shaders were still
  linking is reported.
- The scripted interaction check runs on a fresh load of the site whenever a scroll tape was recorded (a story that plays forward
  does not always rewind, and the original's "rest" was then a later scene than the kit's), and its scroll part now has three
  depths (400, 1200 and 2000 px of wheel) so the tape is compared at more than the first stop.
- The page map finds canvases inside open shadow roots and sections that are direct children of `body`, `#root`, `#app` or `#__next`.
- A page with no WebGL gets its page map too (`page-map.json` / `.md`, found by scrolling a fresh load a screen at a time):
  the sections in view at each stop, how far the probe got, and an Unknown in the ledger saying which sections the kit does not
  contain. The map lists the innermost sections (a wrapper that holds other sections is not one).

### The whole page, and time-driven scenes

- `dea extract` follows the whole page: a fresh load, scene stable, then one stop per 0.8 screens (native scroll, or a wheel-only
  virtual scroll with its measured px per step), each stop settled so lazy content has loaded. Elements are merged into document
  coordinates and classed static, fixed (a header that stays in the window) or moving (keyframes by scroll); the kit has the page's
  height, the same elements at the same scroll positions, the background at each stop, and small canvases as pictures.
- The kit is scored at every scroll stop (`preview/page-stops.jpg`, `page-stops.json`, a "The whole page" section in `extract.md`);
  the ledger gets `page.whole` (Verified), `page.weak` (Unknown, the stops under 60%) and `input.phase`. `--own-assets` keeps the
  layout and uses placeholders for pictures.
- Canvases in closed shadow roots are found (the page hook records every `attachShadow`; igloo.inc keeps its canvas in one, which
  no query reaches). The page map, the canvas ranking and the layout read use it.
- A "scene stable" wait replaces the fixed wait before the fresh-load reference: a picture thumbnail, DOM changes and the network
  must be quiet; a scene still moving at the cap is reported as time-driven.
- Phase alignment for time-driven scenes: the fresh load waits until its picture is close to the reference picture; the result is
  recorded in `interaction.json` and the ledger, and an unaligned run is an Unknown.
- `dea stability <url> --runs N --mode both|aligned|fixed`: the interaction on N fresh loads of the original compared with the
  first, with a fixed wait and with phase alignment (`stability.json` / `stability.md`), the noise floor for interaction scores.
- When no first-screen reading beats the plain heading, the whole-page read can stand on its own if its first screen is no worse.
- A screenshot that fails once under heavy software WebGL is retried, then taken from the page's own surface.

### Round 10: the whole page for scroll-driven WebGL, a GPU check, DEA's own logins

- **The scroll tape covers the whole page.** It used to record eight stops down the first 3,000 px of a long page, so a scene that
  changes further down was never recorded. Now the first stops are close together (the first screens), and the rest of a native-scrolling
  page is spread over the stops that the stop count (40), the time (15 minutes), the run budget and the size budget (`--tape-mb`, default
  64 MB added to the recording) still allow, re-planned after every stop from where the page actually is; a stop is recorded until the scroll
  signal holds still, a long wheel input is given as a stream of notches (a site may limit what one event moves), and the page's wheel ratio
  is measured from the first stops. When a budget ends the tape before the end of the page, the recording says where and why (`ended`, in
  the page map and the report) instead of looking complete.
- **Smaller recordings.** The same bytes uploaded twice (a buffer re-sent every frame, a texture that did not change) are stored once, in the
  recorder and again when the capture is compacted; the capture cache key changed (a recording made by the older tape is not served).
- **`dea doctor`**: Node, the browser, WebGL (the renderer string and the browser's own GPU report), free disk space; says *hardware* or
  *software* (SwiftShader, llvmpipe, Windows' basic driver) and, for software, a plain warning with what to try.
- **`dea bench [url]`**: a small built-in scene (a full-window shader, many small draws, a texture upload, the animation-frame rate), and with a
  url the frame rate of that public page idle and while scrolled; writes `dea-bench.json` and `dea-bench.md`. Speed numbers only for a hardware
  GPU; software is labelled "software render, not a speed measure" and carries none. The file holds no host name, user name, path or login (tested).
  Windows runs both in CI in Edge.
- **`dea browser login|profiles|forget`** and `--profile <name>` on `dea session start` (`DEA_PROFILE` for the MCP hands tools): a browser
  profile that belongs to DEA, in `~/.dea/profiles`, which you sign in to by hand in a plain visible window with no remote-debugging port. DEA
  never opens a folder it did not make, refuses everyday browser profile folders, never attaches to a running browser, and never sees or types a
  password. In supervised mode every change on a session that uses a profile asks first. The risk is written in the README.
- **Loading screens**: the reference watch keeps waiting while the loader shows progress (a rising counter or a picture that keeps changing),
  up to seven minutes, and says so; a stuck loader is still reported, not copied.
- Design only, not built: a read-only mail connector for the Hub (`docs/hub.md`), because it cannot be tested honestly without recorded answers.

### Hub: free search and built-in connectors

- `dea search` and `dea read` (MCP tools `search`, `read`): free keyless sources (DuckDuckGo HTML, MDN, npm, GitHub repository
  search, Stack Overflow, Wikipedia, Hacker News, your own SearXNG); each result carries source, time, a verified/cached label and an
  evidence note; robots.txt is read, calls are spaced, private addresses are refused, blocked or rate-limited sources are reported
  as such and never worked around; answers are cached on disk.
- Built-in connectors in the Hub: `github` (read repos, issues, pulls, files; create issue, comment), `vercel` (list, static
  deploy), `filesystem` (one folder), `http` (one base address). Each needs a declared scope and takes its token from an
  environment variable you name.
- Every Hub call now follows the permission mode (restricted, supervised, delegated). Supervised asks before a change: in the
  terminal for `dea hub call`, through the AI app's own prompt (MCP elicitation) for the gateway; an app that cannot show the
  prompt gets no changes. Set `DEA_MODE=delegated` for the old behaviour inside the grants you gave.
- `dea hub audit` (`~/.dea/audit.jsonl`: what, where, when, mode for every change or refusal; a change that cannot be recorded
  is not made), `dea hub doctor [--live]`, `dea hub mode`, `dea hub connectors`, `dea hub add-connector`.
- History and audit lines hide secrets in free text and URL parameters as well as in argument names; tests prove tokens do not
  appear in results, errors, history, audit or config.

### Hub, phase 2

- `search`: when DuckDuckGo's HTML page is blocked, limited or empty, DuckDuckGo's lite page answers as a labelled fallback; the
  answer has `status` (`ok`, `partial`, `blocked`, `none`) and `problems` (each failed source and why); a time budget bounds the
  call; sources are still asked in DEA's fixed order.
- `read`: pages that scripts build are rendered in DEA's own headless browser (`render: auto|never|always`; private addresses
  refused; failure falls back to the served page with a warning); PDFs are read from their text layer (unpdf, MIT); RSS, Atom,
  sitemaps and gzipped sitemaps come back as lists; `method` says which; `timeoutMs` bounds the call.
- New `research` tool and `dea research`: search, read and extract in one call, passages ranked by plain code, with a trail of every
  step. The default MCP tool list is now 20 tools.
- Supervised mode, outside the AI: when the AI app cannot show the question, the change waits as an approval; `dea hub approve <id>`
  (needs a terminal), `dea hub deny`, `dea hub approvals`; one exact call, once, ten minutes. `pnpm demo:approval` walks it with a
  real stdio MCP client and is a test.
- `dea hub selftest [--live]`: offline checks of modes, approvals, scope, redaction and connectors; with `--live`, real read-only
  calls, and one read per token you put in `GITHUB_TOKEN`, `VERCEL_TOKEN` or `GITLAB_TOKEN`; an unset variable is skipped.
- `dea hub doctor` now says what works right now (browser render, PDF, each search source with `--live`, tokens set by name).
- `dea hub install --client <app>|generic`: prints the config to paste; `--write` merges it and keeps a backup under a name that is
  free (an earlier backup is never overwritten); a file that is not plain JSON is left untouched.
- New connector `gitlab` (read only; public projects need no token). Every Hub call has a time budget (60 s); a change that times
  out says its outcome is unknown.

### Act and connect

- Hands (`dea session`, MCP `browse` / `interact` / `submit`): a browser that stays open, with a policy file; submits
  always ask, logins and payments are never automated.
- `dea investigate --goal`: plans and runs the steps, with checkpoints and resume, and writes a proven report.
- DEA Hub: connect apps once and choose what each AI app may do with them; history and a kill switch.
- `dea-mcp`: 20 tools over stdio, or over Streamable HTTP with `dea serve --http` (127.0.0.1, bearer token).
- `dea mcp install --client claude|claude-code|cursor|vscode|windsurf|codex`.

### Build

- `dea-cli` and `dea-mcp` build with tsdown and run from `dist/` with plain Node 24; CI runs lint, typecheck, unit
  tests, a packed-tarball smoke test, a real-browser test on Ubuntu, and Windows with Microsoft Edge.
