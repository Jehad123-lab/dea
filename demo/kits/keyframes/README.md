# Extracted from https://threejs.org/examples/webgl_animation_keyframes.html (react)

> **QUICK MODE: a rough result.** Two recorded frames, no motion decode, no live trace, no parameter sweep, no research, no build check. Run without `--quick` for the full extract and its scores.

Made by DEA from what the site actually rendered. ✔ Verified = read from the live page. ≈ Inferred = DEA filled a gap.

> **Provenance.** Source: https://threejs.org/examples/webgl_animation_keyframes.html · extracted 2026-11-27 with DEA.
> The shaders, code, fonts, textures and models came from that site and belong to their owners: study them, and swap in your own before you ship anything public.

## Run it

```bash
npm install
npm run dev
```

## What is here

- ✔ `tokens/tokens.css` (CSS variables), `tokens/tailwind.preset.js`, `tokens/tokens.json` (W3C design tokens): colours, fonts, type sizes, durations and easing curves read from the rendered page.
- No GSAP motion was alive on the page; `motion/keyframes.css` has the CSS motion.
- ✔ `motion/keyframes.css`: the `@keyframes` the site ships and its transition styles as classes.
- No custom shader program was found on the site, so no shader modules were written.

## The site's own frames: (a) capture replay and (b) editable rebuild

Two different things, scored separately. **(a) Capture replay**: the recorded calls played back. It is the ground truth for the score, not code to build on. **(b) Editable rebuild**: the same render graph turned into a three.js project (materials, geometry, cameras, render targets, passes) that you can change; it still reads the recorded vertex and texture bytes where `rebuild.md` says so.

| | canvas | page | in the kit |
|---|---|---|---|
| (a) capture replay | 100% | 98.8% | no (--own-assets): scored, then removed |
| (b) editable rebuild (79.9% against (a)) | 79.9% | 87.4% | `rebuild/rebuild.js` + `public/rebuild/` (what the project runs) |

- ✔ (b) `public/rebuild/pipeline.json`: 790 draws in the site's order as 14 RawShaderMaterials (GLSL in `public/rebuild/shaders/`), 2 camera(s), 0 render targets, 50 raw WebGL step(s). three.js reproduces the site's matrices from the camera and model matrix on 790 draw(s).
- recorded in (b): 0.4 MB of vertex/index buffers and 39.1 MB of texture pixels and simulation start state; --own-assets: images are coarse colour grids and large meshes are stand-ins, 130 mesh(es) are stand-ins (130 coarse shapes, 0 boxes); their bytes are not in the kit. See `rebuild.md`.

✔ DEA recorded 10 consecutive frames of the site's WebGL right before the reference screenshot: every call with its arguments, and every buffer, texture, shader program and render target as it was when the frames began (read back from the GPU). 47.2 MB in `public/replay/`.

- ✔ `replay/replay.js` runs exactly those calls with the site's own GLSL, geometry and textures: 10 passes, 790 draws, 14 programs. Passes seen (≈ roles read from the facts): meshes.
- ✔ `render-graph.md`: every pass in order, its target, programs, draws, the textures it reads, blend and depth.
- ≈ Clock uniforms (a value named like time that grew between the frames) advance with real time; everything else replays as recorded, frame after frame. `replay.setUniform(program, name, value)` overrides a value, `replay.setPassEnabled(i, false)` switches a pass off.
- (a) alone: canvas 100%, page 98.8%. The project does not run it: it is the reference.
- ✔ `public/scene/scene.glb` + `scene/scene.js`: 72 mesh(es) read back from the GPU buffers with their model matrices and the camera (from the view and projection uniforms); see `scene/scene.md`. Rendered with a plain material it scores canvas 26.4%: the placement is the site's, the look is in the replay.
- ≈ --own-assets: 5 uploaded texture(s) in the replay are an 8×8 grid of their own average colours at the same size (tones, no detail); 54 lookup table(s) (colour LUTs, ramps, tiny data textures: the site's code tables, not artwork) are kept as recorded; render targets and geometry are the frames' own.

## How close the rebuild is

DEA rendered `preview/index.html` and compared it with the original first screen after its intro (`preview/original.png` vs `preview/final.png`, side by side in `preview/side-by-side.png`). The score is 0.3 colour + 0.35 brightness layout + 0.35 edges, at 96×60.

- Start: 24.4% similar
- After DEA's own analysis (palette, screen colour, each shader, opacity): 87.4%
- After research and retry: 24.4% (reached 0 rounds)
- Final parts: colour 94.3%, brightness layout 89.7%, edges 79.2%
- **Canvas only** (the WebGL picture alone, the site's text hidden; 0.6 × SSIM at three scales + 0.2 × edges + 0.2 × tones): 35.3% at the start → 79.9%; canvas 79.9% (SSIM 77.9%, edges 72.6%, tones 93.4%, 8.5% hidden under text)
- Kept parameters: background #e2e0e0, text #000000, font monospace, size 13, program __rebuild, opacity 1
- Page environment: DEA answered 8 CPU cores and 8 GB (navigator.hardwareConcurrency, deviceMemory).

The page score compares colour layout, not text or motion: a high score means the first screen reads the same, not that the code is identical. The canvas score looks only at the 3D picture, so text and colour cannot carry it: read it to judge the effect itself.

## Gap → path to result

What DEA could not fully decode yet, what it knows anyway, its best reconstruction (Inferred), and the next probe that would close the gap.

### G1. The first screen of the rebuild is 24.4% similar

**Known**

- ✔ Colour layout 94.3%, brightness layout 89.7%, edges 79.2% against the original first screen.
- ✔ The full render pipeline (1 passes, order and render targets) is in pipeline.js.

**Missing:** Layout, meshes or images outside the shader are not rebuilt.

**Next probe**

- `dea extract https://threejs.org/examples/webgl_animation_keyframes.html --reference-ms 120000`: wait longer for the intro before the reference screenshot
- `dea trace https://threejs.org/examples/webgl_animation_keyframes.html --ms 30000`: read the values and drivers of every uniform

### G2. No live GSAP timelines were captured

**Known**

- ✔ CSS @keyframes and transitions are in motion/keyframes.css.

**Missing:** Either the site animates without GSAP, or its intro tweens had finished before DEA read the GSAP instance.

**Next probe**

- `dea motion https://threejs.org/examples/webgl_animation_keyframes.html`: record motion from the first frame and fit curves
- `dea code https://threejs.org/examples/webgl_animation_keyframes.html`: read the gsap.to/timeline calls in the code itself


## Where it came from

- design run: 20261127-111433-threejs-org-f5acaa34
- motion run: skipped (quick mode)
- reused from the cache (not observed again in this run): design (2026-11-27T11:16:20.793Z), assets (2026-11-27T11:17:04.895Z)
- assets run: 20261127-111620-threejs-org-3cec96c8

