# Changelog

All notable changes to DEA. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - unreleased

The first version published to npm. 0.1.0 was never published: npm will not take `dea-cli@0.1.0`, because an unrelated
package of that name published and withdrew 0.1.0 in 2014 and npm never reuses a version number. Everything listed under
0.1.0 below ships in 0.2.0.

### Added

- Round 53: cost material variants grouped by shared vertex buffers, and debug panels masked to their full extent. Since
  Round 50 a real material keeps every draw of its buffers real, so on lusion.co materials 4, 6 and 5 each scored exactly like
  the real-meshes variant (91.6%) and used up the budget the colour grids needed. Stand-ins now record their position buffer;
  materials that share one are scored once together (`costMaterialGroups`), and a group holding every stand-in is left out.
  On threejs.org's skinning example the lil-gui root is 607 px tall while its rows run on to the bottom of the screen: a
  debug panel now covers every visible box inside it, so that 310x293 strip is masked too.
- Round 52: `--own-assets-cost-only`, and Stats.js found at any depth. lusion.co's base extract plus one cost variant ran past
  300 s on a software GPU. `--own-assets-cost-only` (implies `--own-assets-cost`) takes the recording an earlier run with
  the same flags left in the cache, and scores the shipped rebuild and the cost variants only: no new watch of the site, no
  text-layout judging, whole-page read, sweep, research, interaction check or build check. With nothing cached it stops at
  once and says which run to make first. Round 51 missed threejs.org's Stats.js box, which the examples append inside
  #container: the canvas-only fixed box is now looked for in every div, not only under body.
- Round 51: debug UI left out of the scores. threejs.org's skinning example scored 78.6% on the page against 91% on the
  canvas: the lil-gui Controls panel and the Stats.js FPS box are drawn over the page, and DEA never rebuilds them. The
  layout read now finds debug panels (lil-gui, dat.gui, Tweakpane, Leva, Stats.js by its id or as a small fixed box of
  canvases; never anything over half the screen). The page score paints them the same grey in both pictures, the canvas
  score hides them like text, and the run says what was left out and where.
- Round 50: real-mesh cost variants keep shared buffers, and --own-assets-cost has a time budget. On threejs.org's skinning
  example, "the site's meshes for VanguardBodyMat only" scored -19 points: the body's shadow pass draws the same buffers with
  another material, stayed a stand-in, and its buffers were zeroed, so the real body drew from zeros. Now every draw that reads
  the position buffer of a real-material draw stays real, and the buffers a real draw reads are never zeroed (shipped kits are
  unchanged: they have no real materials). lusion.co's cost run (76 passes, 170 draws) ran past 300 s on a software GPU:
  `--own-assets-cost-budget <s>` (default 240, 30-3600) stops before a variant that would not fit, judged by the slowest one
  so far, and lists the rest as not scored.
- Round 49: smooth motion-loop playback. A loop recorded on a slow machine holds each frame for up to 250 ms (keyframes:
  30 frames at about 4 per second), so the live kit stepped. Live, the runner now blends each recorded frame into the next by
  the time already spent on it: uniforms, model matrices, uniform-block and vertex floats, and float texture uploads (three.js
  bone textures). A 4x4 block that is an affine matrix in both frames turns as a rotation (position lerp, quaternion slerp,
  scale lerp), so a bone half-way through a turn keeps its size; other floats blend number by number. The jump from the
  last frame back to the first is blended only when the loop closes on itself: pipeline.json `loop.closed` (`loopClosed`:
  the wrap is no bigger than 1.5x the median step between frames) or `options.smoothWrap`; a slice cut out of a longer
  animation shows that jump as recorded. `options.smooth: false` plays the frames as recorded.
- Round 48: clocks in uniform blocks and compact motion loops. igloo.inc keeps its time in a WebGL2 uniform block ("Global",
  binding 0) uploaded with bufferSubData each frame, so --quick still found 0 clocks and the live demo stood still.
  uboClocksOf matches the n-th uniform-block upload to a buffer in frame 0 with the n-th in frame 1; a float that moved like a
  clock (isClockStep: seconds at 0.1-10x real time, ms, or a +1 frame counter) and is not part of a run of more than two
  neighbouring floats that moved (a matrix or vector) goes to pipeline.json uboClocks { buf, byte, base, rate }; the rebuild
  runner writes base + rate x elapsed ms into the uploaded bytes live. pipeline.json frames are compacted (compactFrames): frame
  0 in full, a later frame's step as { $from } plus only what differs ($uni: changed uniforms only); the runner and the Framer
  export expand them (expandFrames). A --frames 30 loop of three.js keyframes wrote 89 MB of repeated draw steps.
  compactCapture also writes byte ranges with the same content once (sha1, 64 bytes and up), for data a loop re-uploads.
- Round 47: motion that plays. The live demos stood still: --quick recorded one frame, and one frame has no clocks (uTime
  needs two to get a rate). Two frames are now recorded by default, in --quick too (no pointer or scroll tape there, so
  SwiftShader boxes stay fast). --frames <n> (2-120, extract and record) records a motion loop: with 3 or more frames
  pipeline.json gets loop { n, ms } (loopTiming: each frame's gap to the next timestamp, the last takes the lower median,
  4-250 ms) and the rebuild plays the frames in order at that timing and loops, instead of holding the last one, so a CPU
  animation (three.js AnimationMixer: model matrices and bone-texture uploads set each frame, three.js keyframes' train,
  fan and character) moves. Each frame's uploads run in order, so ping-pong simulations keep their read/write order;
  options.loop false holds the old way. rebuild.md names the loop. The (a) capture replay is unchanged.
- Round 46: Round 45's outline-shell push removed. On three.js keyframes the shipped canvas stayed at 80.2% while the uv1
  split alone closed 0.6 points of material 5's gap; tones fell 0.6 and material 1's gap grew (+3.4 to +3.7): bigger black
  shells darkened the picture, and the thin outlines (smaller than a cell) did not come back. The UV-set split stays.
  --own-assets-grid <n> (default 8, 2-64): cells per side of each image's colour grid, for images and the stand-ins' UV split
  alike. A finer grid keeps more of the site's artwork, so it is the user's choice and never the default. --own-assets-cost also
  scores 16x16 and 32x32 grids (never shipped), so the choice has numbers. rebuild.md and the report name the grid used.
- Round 45: --own-assets stand-ins for three.js keyframes (Littlest Tokyo). Outline shells: a culled mesh whose visible faces
  point inward (its signed volume from the site's triangles disagrees with the visible winding; the outline_0 meshes, material 1
  outline #379) is an outline shell, and each stand-in corner moves out to the farthest of the site's vertices it stands for,
  along the cell's outward direction. The scene-wide shell has larger cells than the parts it wraps, and cell averages sit
  inside a curved surface, so the shell sank into the parts and the outlines were gone; a bigger shell only shows more rim,
  since its outside faces are culled. Every UV set splits a cell, not only the first: material 5 (normal #397) reads its colour
  atlas through uv and its AO map through uv1, a different layout, and uv1 was averaged across AO islands. Same position grid
  and triangles: no more of the site's shape is shipped. rebuild.md counts the pushed shell corners. visibleWinding(cull).
- Round 44: live demo. vercel.json builds demo/ (the dea-framer-hero builds failed with no output directory): demo/build.mjs
  builds every --own-assets kit in demo/kits/<slug> with Vite under /<slug>/ (a kit with public/replay/, the site's own
  bytes, is never published) and writes a landing page with the scores from demo/demos.json. Generated kits load
  rebuild/, replay/ and scene.glb from Vite's base, so a kit also runs under a sub-path.
- Round 43: --own-assets stand-in cells also split by the colour-grid cell their UV falls in (8x8, the image repeats), so a cell
  that spans several islands of a texture atlas no longer averages its UVs into some other part of the atlas (aimed at three.js
  keyframes' material 5, normal #397, +7.9 points with real meshes). Same position grid: no more of the site's shape. The
  rebuild.md stand-in table shows per row how many triangles were turned back and kept on both sides, explains the instances
  column ("-" also for a batched mesh drawn piece by piece) and points to extract.json for every row when it shows only 40.
- Round 42: --own-assets stand-in triangles keep the site's facing: a triangle that turned over when its corners moved to
  their cell's average is turned back (with back-face culling it disappeared), and a thin shell whose front and back
  collapse onto the same corners keeps both sides (the same corners in the other winding are no longer dropped as a
  duplicate). Aimed at igloo.inc's dome panels (material 1), which drew dark and hollow.
- Round 41: --own-assets stand-ins of batched meshes (many objects in one vertex buffer, multi-draw: igloo.inc's material 1,
  70 stand-ins) take their cell grid from the vertices the draw uses, not the whole buffer, so a small piece keeps its own
  16 cells per side. Id inputs (batchId, objectId, ...) keep one vertex's id per cell instead of an average (an average of two
  ids is a third object's). The rebuild.md stand-in table shows how many other draws share each buffer.
- Round 40: --own-assets stand-ins carry every float view of a vertex input (half floats and normalized or plain integers:
  the quantized normals and UVs of compressed meshes were dropped and read as 0); integer inputs are listed as lost.
  rebuild.md has a stand-in table (material, program, draw, instances, vertices site -> stand-in, inputs kept and lost) and
  extract.json carries it (rebuild.stats.standIns). --own-assets-cost also scores the site's meshes one material at a time
  (the 6 materials with the most stand-ins), so the cost line names the material the (b) gap comes from; variants are built
  one at a time. extract.md's cost line no longer repeats its label; the textures/ previews are in extract.json's file list.
- Round 39: --own-assets stand-ins keep hard edges: the cell key also carries the normal's main direction, so a flat-shaded
  model's faces are no longer averaged into one blurred normal (same 16-cell position grid: no more of the site's shape), and
  averaged normals are length 1 again. three.js keyframes (b): canvas 72.2% -> 77.5% in the sandbox, 77.0% on a PC (page 82% -> 85%). Round 38 fixes: the
  cost variants no longer stay in extract.json's file list, the cost line is in extract.md and extract.json (rebuild.ownCost,
  with vsReplay and stats), and --own-assets-cost without --own-assets says it is ignored.
- Round 38: `--own-assets-cost` (with `--own-assets`): also scores two never-shipped variants of the rebuild (the site's real
  images + stand-in meshes, image colour grids + the site's real meshes), each from its own folder, and prints what each
  placeholder kind costs. three.js keyframes: shipped 72.2%, real images 73.6% (+1.4), real meshes 88.8% (+16.6).
- Round 36: a WebGL canvas inside a CLOSED shadow root is found: the page script keeps the canvas that made each context
  (`__DEA__.canvasRefs`, `allCanvases`, `holds`), and the post-loader WebGL check, the loader checks and the layout read use it
  (igloo.inc mounts its three.js canvas in a closed root, so 3 of 4 runs skipped the recording).
- Round 35: after a loading screen, a big WebGL canvas that is on screen but whose frame count did not move is recorded anyway
  (the recorder stops in 15 s if nothing ever drew) instead of being dropped as "no WebGL" (igloo.inc flake on a slow box).
- Round 35: an unrecorded run labels its canvas score as DEA's own shader-module draft, not (a) or (b).
- Round 34: the recorder stops after 8 s on a page that never made a WebGL context (`NO_CONTEXT_MS`) instead of waiting the
  full 90 s meant for on-demand scenes (framer.com quick run).
- Round 33: a page renderer crash is recorded when it happens (`page.on('crash')` in `openSite`, `session.crashed`, a warning in the
  run) instead of surfacing later as "Target page, context or browser has been closed" on an unrelated call.

- Round 32: the page environment is reported (timings "page environment: ...", extract.md "Page environment:", extract.json
  `diff.referenceEnv`, kept in the capture cache): the GPU name and CPU masks DEA applied, WebGL contexts the page lost
  (`webglcontextlost`, time and canvas size), and an html class naming a fallback mode (static, fallback, no-webgl, lite, reduced,
  poster). jehaduddin.vercel.app's post chain lost its context on software WebGL and switched to "vscroll static", and no output
  said so; `__DEA__.coresMasked` was set but never printed.

- Round 31: the GPU mask (on by default, off with the existing no-mask option) also answers `navigator.hardwareConcurrency` and
  `navigator.deviceMemory` with at least 8, recorded as `__DEA__.coresMasked`. jehaduddin.vercel.app picks its quality tier from
  the core count (>= 8 "high", else "mid"); a 2-vCPU box got a poster image instead of the 3D hero.
- Round 31: the timings say when a WebGL canvas was on screen under the loader and is gone afterwards (it belonged to the loader).

- Round 30: after a loading screen, the reference waits for the WebGL scene (`postLoaderGlWait`, `GL_ON_SCREEN`): when the page
  showed a loader and no visible canvas (10% of the viewport or more) is drawing yet, DEA waits up to 60 s (quick) / 120 s (full)
  for one, nudging the pointer and scroll once after 10 s for a scene that mounts on first input, then takes the reference again.
  The timings say whether it drew. jehaduddin.vercel.app's watch ended at 162 s while the hero was still a poster image, so
  nothing was recorded.

- Round 29: the reference watch looks through a flat loading screen while it runs (`shouldPeel`): once the kept frame and the
  current frame are both flat and the picture has sat still for `FLAT_STILL_MS` or the watch has passed its hard cap, the loader's
  layers are hidden and a detailed page behind them becomes the reference. Not gated on the loader check. A flat look puts the
  loader back (`LOADER_UNHIDE`) and retries after 30 s, at most 4 times.
- Round 29: `LOADER_WHY` logs, whenever it changes, why the loader check matched or turned candidates down (named element, cover,
  text length, main canvas, counter layer) in the timings; every poll with `DEA_DEBUG_LOADER=1`.

- Round 28: a loader still covering the page when the reference watch ends is hidden (`LOADER_HIDE`: its layers get
  visibility hidden) and the reference is taken through it when that shows a detailed page. The timings log says so.
  jehaduddin.vercel.app's counter crawls 63 -> 64 and stalls on software WebGL while the site behind it is already laid out.
- Round 28: extract.md warns about a loader or near-uniform reference whatever the score (`--no-replay` on
  jehaduddin.vercel.app scored 95% against its "28" preloader and said nothing, because the warning only came with a low score).

- Round 27: the loader check (`LOADER_VISIBLE`, `LOADER_PROGRESS`) also sees a loader with no loader-like class or role:
  an element whose whole text is a 0-100 counter inside a fixed or absolute layer covering most of the viewport
  (jehaduddin.vercel.app's black "63" screen, which made the watch stop and became the reference).
- Round 27: `--own-assets` keeps lookup tables as recorded (`isLookupTable`: 3D textures, strips up to 4 rows or columns,
  tables up to 64x64). They are the site's code tables (colour LUTs, ramps, noise), not artwork, and averaging them shifted
  igloo.inc's colours (mauve background, pink rim). The report counts them.

- Round 26: `--own-assets` images are the average colours of an 8x8 grid at the same size (`coarseTones`, `TEX_GRID`)
  instead of a grey checker: an image keeps its tones and none of its detail, as a mesh stand-in keeps a shape and none of
  the model. lusion.co's rebuild sat at 53.6% with all 50 meshes as stand-ins because every texture was grey.
- Round 26: mesh stand-ins carry the draw's other float vertex attributes (normals, UVs, a wireframe's barycentrics,
  colours), averaged per cluster under the site's attribute names, so the site's shader reads real inputs instead of zeros.
  igloo.inc's 79 stand-ins drew its wireframe intro from zero barycentrics (rebuild 50.6% against the replay).

- Round 25: the reference watch no longer settles on a flat loading screen. A frame is "flat" when its 96x60 thumbnail
  has a luminance standard deviation under 8 and fewer than 1% edge pixels (`extract/refwait.ts`). A flat best frame
  buys more time past the hard cap (up to +20 s in quick mode, +60 s in full mode) while the picture still changes
  (it stops after 10 s without change), and a flat frame never replaces a detailed one. Before, only a rising loader
  percentage bought time past the hard cap, and quick mode never went past it: igloo.inc's grey loader has no
  percentage, so the reference was the grey screen (page score 29.9%, canvas edges 0%, the replay "matched" it 100% by
  replaying grey). When the kept frame is still flat, the report says so ("The reference looks like a loading screen")
  and the evidence ledger marks the reference Unknown.
- Round 25: `--own-assets` coarse stand-ins for TRIANGLE_STRIP and TRIANGLE_FAN draws (converted to triangle ids, GL
  strip winding, index buffers and WebGL2's fixed primitive-restart index respected) and for instanced draws (the runner
  builds the stand-in or the box as instanced geometry and keeps the recorded per-instance attributes and the instance
  count, so every instance still draws). On lusion.co all 50 large meshes were boxes before (rebuild canvas 53.6% against
  99% for the replay). A mesh that stays a box records why in `stats.boxReasons` (`mode N`, `index buffer unreadable`,
  `too few triangles left after clustering`), listed in rebuild.md as "boxes, by reason".

### Changed

- Round 34: technique detection reads only the GLSL that compiles (`activeGlsl`): code inside an `#ifdef` whose macro is not
  defined is ignored, so three.js material chunks no longer report a heightmap (three.js keyframes example).
- Round 33: the design decode survives a closed CDP session: Chrome's stylesheet and platform-font read retries on a fresh
  session and otherwise goes on with computed styles, with a warning (a PR #24 run lost its design stage ~65 s in and retried).
  The stage retry message names the likely cause.
- Round 33: the GPU name in "Page environment" is cut at a word (up to 110 characters), never mid-id ("(Subzero) (0").
- Round 33: the cache line counts stages handed in with `--from` ("N stage(s) reused (M from --from)") and the summary lists them.
- Round 33: run.json `startedAt` is the start of the extract run (it was stamped while writing, 149 ms before `finishedAt`).

- Round 32: "the loading screen finished after N s" is logged on any loader-to-no-loader change, with the last counter value only
  when one was read (PR #24's run had no counter reading and no line).

- Round 31: when the wait after the loader finds no drawing WebGL canvas, recording is skipped instead of waiting 90 s for frames
  that cannot come (a scored run went past a 300 s shell limit).

- Round 30: a visible loader over a flat kept frame holds the watch to the long cap even when its counter pauses (a --no-replay
  run stopped at 96 s on the flat loader while the next reached the hero at 163 s).
- Round 30: "the loading screen finished after N s" is logged once (it repeated on every poll after the loader cleared).

- Round 29: the watch clock (base length, hard cap, counter stall) starts at the first frame the watch got, not at page load. On
  software WebGL jehaduddin.vercel.app's first screenshots took ~49 s and ate the 2.5x hard cap. A safety stop at the long cap
  plus 2 minutes from page load remains. The end-of-watch look through the loader no longer needs the loader check to match.

- Round 28: quick mode follows a rising loader counter up to 180 s (`QUICK_LOADER_CAP_MS`; it used to stop at its 2.5x hard
  cap), and a counter is stuck after 60 s without going up (`PCT_STALL_MS`, was 45 s). Only the counter buys this time.
- Round 28: loader checks share one set of page helpers. A bare 0-100 counter (digits may be split into up to 3 spans) counts on
  any layer covering 40% of the viewport, positioned or not, but a layer (or a loader-named element) that holds the main canvas or
  more than a little text is the page, not a loader (lusion.co's real first screen was reported as a loader).

- Round 27: when the screenshot taken after recording is flat but the watch had kept a detailed frame, the watched frame is
  the reference. If every watch screenshot failed, one more is taken, so `preview/original.png` is never empty (`--no-replay`
  crashed on a 0-byte reference with "image did not load").
- Round 27: wording: "an 8×8 grid of their own average colours", "50 coarse shape(s) of at most 16 cells per side, 0 box(es)".

- Round 26: the reference watch keeps going while a loader is on screen even when its picture holds still (a counter stuck
  at 63 on jehaduddin.vercel.app outlasted the 10 s still cutoff and the black loader became ref.png). `FLAT_STILL_MS` is
  20 s and applies only with no loader; the quick-mode extra wait for a flat frame is 30 s.
- Round 26: `CAPTURE_CACHE_VERSION` 5, and a cached capture whose reference is flat is taken again instead of reused (a
  warm cache served PR #17's grey igloo.inc capture after the loader fix).
- Round 26: rebuild.md no longer prints "these bytes are the site's" under `--own-assets` when no mesh is a box.

- Round 25: the extract summary and the report counted every `--own-assets` mesh as a box ("3 mesh(es) are boxes")
  even when it was a coarse stand-in. They now say e.g. "3 mesh(es) are stand-ins (3 coarse shapes, 0 boxes)"
  (`standinSummary`), and rebuild.md gives the box count instead of "the rest boxes".
- Round 25: `docs/scoreboard.json` targets from the owner's PC (`--own-assets --quick`): jehaduddin.vercel.app page
  0.84 / canvas 0.85 (measured 84.8% / 86.3%, replay 94.7% canvas); lusion.co floors page 0.80 / canvas 0.50 (82.9% /
  53.6%, expected to rise with the instanced stand-ins); igloo.inc a canvas floor of 0.70 only (rebuild canvas 72.1%; its
  29.9% page score is against the grey loader, pending the loader fix); framer.com page 0.70 (70.3% with `--no-cache`,
  the live hero changed), no canvas target.

- Extract `--own-assets`: a large mesh is drawn as a coarse stand-in of its own shape instead of a box (`proxyMesh`,
  vertex clustering to at most 16 cells per side of its bounding box; collapsed triangles dropped, no UVs, normals from
  the faces). The kit still carries none of the mesh's buffers, only that sketch. A box is kept when too little is left.
  jehaduddin.vercel.app (`--quick`, same capture, same machine): editable rebuild canvas 62.4% with boxes, 87.6% with
  stand-ins (91.1% against the capture replay). Image placeholders were measured too and made no difference there.
- Extract: a canvas score now measures the canvas, not what is painted over it. The recorder copies the canvas in the
  same task as the site's own last recorded frame (`grabCanvasFrame`, `CAP.canvasPng()`), because a canvas without
  `preserveDrawingBuffer` holds nothing once that task ends and a screenshot taken later can lose the picture or show a
  loading screen's overlay instead. The copy goes to the kit as `preview/canvas-original.png` and replaces the screenshot
  as the reference side of the canvas score when the screenshot's canvas region carries less than half the canvas's light
  (`canvasCoveredByPage`). jehaduddin.vercel.app, whose loading screen paints an overlay over a very dark full-screen
  WebGL layer: (a) capture replay canvas 58.9% -> 94.7%, (b) editable rebuild canvas 62.8% -> 84.6% (94.7% without
  --own-assets). Where the screenshot does show the canvas, the score reads the same pixels as before.
- Browsers close on the way out. Every browser DEA starts is tracked, and SIGINT, SIGTERM, SIGHUP, an uncaught error, the
  `--budget` hard stop and the post-result watchdog close them before the process leaves; a browser whose `close()` does
  not return within the deadline has its processes (read over CDP `SystemInfo.getProcessInfo`) killed, so no Chromium is
  left behind (`packages/core/src/browser/lifecycle.ts`; `dea extract ... | Ctrl-C` exits 130 with nothing running).
- Extract: the reference watch no longer waits on an animated loading screen. Past its hard cap only a rising loader
  counter buys more time (up to 7 minutes, full runs only); quick runs stop at the hard cap. lusion.co on a 2-vCPU box
  sat in this step for 13+ minutes before; a quick run now leaves it in under a minute.
- Extract: a recording over the size cap is shrunk to fit instead of dropped. Read-only 8-bit 2D images lose their
  largest mip level (the browser's own smaller levels move up, nothing re-filtered) or are halved with a box filter,
  largest first (`fitCapture`). The three.js keyframes example (114.3 MB, one 4096x4096 mipmapped texture) now keeps its
  capture replay: canvas 100%, page 98.8%, where before it had none.
- `dea scoreboard`: the newest full run of a site is used, and a quick one only when there is none (`--full-only` skips
  quick runs); a quick run below a full-run target is shown as "below target (quick)", not counted as a regression;
  a miss too small to show at one decimal is printed with enough digits (or as "100% minus 1.1e-16"); `--timings` prints
  the time per site; `--extract` without `--sites` says so; the command exits within 5 s of writing the board even when a
  crashed browser left a handle open.
- `dea scoreboard`: DEA's reference-site scoreboard. Reads the newest saved extract run of each site in a sites file
  (`docs/scoreboard.json`: lusion.co, jehaduddin.vercel.app, a three.js example, igloo.inc, framer.com), or extracts them
  all with `--extract`, and compares the kept page and canvas scores and the editable rebuild's own scores with their
  targets. Writes markdown (`--out`) or JSON, and exits 1 when a target is missed or a site did not run. `extract.json` now
  records the capture replay's and the editable rebuild's own scores, so the board can show both.
- `live.yml` (proposed): a nightly scoreboard job that writes the board to the run page and keeps it as an artifact.
- `dea hub approvals --client <name>`: only the changes one AI client asked for.
- `record.e2e.test.ts`: `dea record` in a real browser against a local page; the second call comes from the cache and
  does not load the page again. The proposed CI runs it with the safety tests.
- `pnpm check:release` (`scripts/check-release.mjs`): checks that every version string, `server.json` and the newest
  CHANGELOG heading agree; `--release` also asks for a dated heading.
- `dea doctor`: when the browser will not start, it says how to fix it (the missing system libraries and how to install
  them, or how to install a browser).
- `dea runs --client <name>`: list the runs of one `dea serve --http` client (kept in `<home>/clients/<name>/runs`).
- Docs: `docs/remote.md` explains per-client runs, `--profile-client`, per-client Hub approvals, and the `recordOnly` /
  `dea record` split for slow machines; the CLI README lists `dea record`, `dea framer` and `--profile-client`.

- `dea framer` puts a still of the rebuild itself (`poster.png`, DEA's render of the editable rebuild, never the site's
  screenshot) beside `pipeline.json`. The component shows it while loading, on phones without WebGL and after a context
  loss when no Poster is set, and hides it if the file is missing.
- The MCP `extract` tool takes `recordOnly`: only the slow reference capture, kept in the cache for the next extract (the
  tool list stays at 20).
- When no browser starts because the system is missing libraries Chromium needs, DEA names them and says how to install
  them (`npx playwright install-deps chromium`, or without sudo: unpack the packages and set `LD_LIBRARY_PATH`).
- `dea serve --http --profile-client <names...>` (`dea-mcp --http --profile-client a,b`): only the named clients may use
  the DEA browser profile in `DEA_PROFILE` (your own sign-ins). Every other remote client browses with a fresh,
  signed-out browser. Before, every client with a token drove your signed-in profile. The local stdio server is unchanged.
- `dea serve --http`: each token (client) has its own runs folder, `<home>/clients/<client>/runs`. `list_runs`, `report`
  and "latest" never show another client's runs, or runs made by the CLI on the same machine. Background investigations
  started by a client resume in that client's folder (`DEA_RUNS_DIR`). `withRunsRoot()` in core.
- Preview scoring works offline after one online run: the preview pages go through DEA's content cache, and a pinned CDN
  file (an exact version on jsDelivr, esm.sh or unpkg, such as `three@0.170.0`) is kept past the cache's age limit
  because its bytes can never change. `isImmutableUrl()` in core.
- `test/safety.e2e.test.ts` (runs with `DEA_E2E=1`): Round 11's safety rules proved in a real browser. A click whose script
  sends a POST is stopped and asks, and sends only after the OK; a read-only click is not stopped; a logout link asks,
  typed or clicked; Enter in a form field asks.
- `dea record <url>`: only the slow part of `dea extract` (the reference screenshot and the site's recorded WebGL frames),
  kept in the cache. A later `dea extract <url>` with the same capture options reuses it instead of opening the site
  again, so a slow machine or a time-limited box can do extract in parts (record, then the stages, then extract `--from`).
- The Framer component says why it is blank, in the Framer editor only: no Source set, the Source could not be loaded
  (wrong URL, a 404 page, or missing CORS headers), or WebGL stopped on the device. Visitors still see the poster or
  nothing, never an error box.
- `dea framer <run>`: the editable rebuild as one Framer code component (three.js from esm.sh, property controls for
  Source, Poster, Animate, Follow input, Max DPR and up to 12 shader values; DPR capped at 1.5, runs only on screen,
  still in the editor, with reduced motion or `?static`; poster on load and on WebGL loss), plus `framer/site/` to host
  with CORS headers for Vercel and Netlify. Refuses a kit carrying the site's files unless `--allow-site-files`.
- `dea prune`: remove runs older than N days (30), keeping the newest 5 and any folder with a `KEEP` file; a dry run
  unless `--yes`.
- The MCP `submit` tool can approve any waiting interact action (`action` + the same arguments + the token); `select`
  and `fill` take a confirm token in the session, daemon and CLI.
- `dea-kit.json` records `ownAssets`; `dea library add` warns when a kit carries the site's recorded files.

### Fixed

- Clicking a link that logs out, deletes, unsubscribes or cancels now asks first, the same as typing its URL. Before, only
  `goto` asked, and a click on such a link went through. Found by the new real-browser safety tests.

### Safety

- A plain click, select, key press or fill that tries to send data (POST, PUT, PATCH, DELETE) is stopped before it
  leaves the browser and asks first; tracking beacons pass.
- Enter in a form field is judged as a submit, with or without a target.
- Opening a link that logs out, deletes, unsubscribes or cancels asks first (supervised, delegated) or is refused
  (restricted).

### Changed

- Versions are 0.2.0 everywhere: the three packages, the CLI, the MCP server, the Hub, the HTTP health answer and
  `server.json`.

## [0.1.0] - never published

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
