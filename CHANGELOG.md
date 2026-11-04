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
