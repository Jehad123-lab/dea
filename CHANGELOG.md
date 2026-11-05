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

### Act and connect

- Hands (`dea session`, MCP `browse` / `interact` / `submit`): a browser that stays open, with a policy file; submits
  always ask, logins and payments are never automated.
- `dea investigate --goal`: plans and runs the steps, with checkpoints and resume, and writes a proven report.
- DEA Hub: connect apps once and choose what each AI app may do with them; history and a kill switch.
- `dea-mcp`: 17 tools over stdio, or over Streamable HTTP with `dea serve --http` (127.0.0.1, bearer token).
- `dea mcp install --client claude|claude-code|cursor|vscode|windsurf|codex`.

### Build

- `dea-cli` and `dea-mcp` build with tsdown and run from `dist/` with plain Node 24; CI runs lint, typecheck, unit
  tests, a packed-tarball smoke test, a real-browser test on Ubuntu, and Windows with Microsoft Edge.
