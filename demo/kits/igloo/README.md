# Extracted from https://www.igloo.inc (react)

> **QUICK MODE: a rough result.** Two recorded frames, no motion decode, no live trace, no parameter sweep, no research, no build check. Run without `--quick` for the full extract and its scores.

Made by DEA from what the site actually rendered. ✔ Verified = read from the live page. ≈ Inferred = DEA filled a gap.

> **Provenance.** Source: https://www.igloo.inc · extracted 2026-11-27 with DEA.
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
- ✔ `shaders/MousePosProgressProgress2Shader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uMousePos, uProgress, uProgress2, uTriangleAlpha, uAlpha.
- ✔ `shaders/ProgressProgress2Color1Shader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uProgress, uProgress2, uColor1, uColor2, uTriangleAlpha, uAlpha.
- ✔ `shaders/ProgressProgress2NoiseShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uProgress, uProgress2, uTriangleAlpha, uAlpha.
- ✔ `shaders/ProgressProgress2NoiseShader2.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uProgress, uProgress2, uTriangleAlpha, uAlpha.
- ✔ `shaders/MapBlocksColorShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uColor, uColor2, uShow, uRand.
- ✔ `shaders/MapColorShowShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uColor, uShow, uRand, uActive.
- ✔ `shaders/Show1Show2MapShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uShow1, uShow2, uColor, uBlink.
- ✔ `shaders/Show1Show2MapShader2.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uShow1, uShow2, uColor, uBlink.
- ✔ `shaders/Show1Show2MapShader3.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uShow1, uShow2, uColor.
- ✔ `shaders/Color1Color2IntroColorShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uColor1, uColor2, uIntroColor, uProgress.
- ✔ `shaders/NoiseNumbersProgressShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (points). ≈ Starting values guessed for uProgress, uAlpha.
- ✔ `shaders/SizeNumsColorShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uSize, uColor.
- ≈ Placeholders of the same size (your own images go here): `public/textures/1-t27.png`, `public/textures/2-t28.png`, `public/textures/3-t30.png`, `public/textures/4-t29.png`, `public/textures/5-t33.png`

## The site's own frames: (a) capture replay and (b) editable rebuild

Two different things, scored separately. **(a) Capture replay**: the recorded calls played back. It is the ground truth for the score, not code to build on. **(b) Editable rebuild**: the same render graph turned into a three.js project (materials, geometry, cameras, render targets, passes) that you can change; it still reads the recorded vertex and texture bytes where `rebuild.md` says so.

| | canvas | page | in the kit |
|---|---|---|---|
| (a) capture replay | 100% | 100% | no (--own-assets): scored, then removed |
| (b) editable rebuild (99.5% against (a)) | 99.5% | 99.5% | `rebuild/rebuild.js` + `public/rebuild/` (what the project runs) |

- ✔ (b) `public/rebuild/pipeline.json`: 234 draws in the site's order as 29 RawShaderMaterials (GLSL in `public/rebuild/shaders/`), 6 camera(s), 20 render targets, 24 raw WebGL step(s). three.js reproduces the site's matrices from the camera and model matrix on 196 draw(s).
- recorded in (b): 0.2 MB of vertex/index buffers and 7.1 MB of texture pixels and simulation start state; --own-assets: images are coarse colour grids and large meshes are stand-ins, 158 mesh(es) are stand-ins (158 coarse shapes, 0 boxes); their bytes are not in the kit. See `rebuild.md`.

✔ DEA recorded 2 consecutive frames of the site's WebGL right before the reference screenshot: every call with its arguments, and every buffer, texture, shader program and render target as it was when the frames began (read back from the GPU). 45.8 MB in `public/replay/`.

- ✔ `replay/replay.js` runs exactly those calls with the site's own GLSL, geometry and textures: 42 passes, 94 draws, 28 programs. Passes seen (≈ roles read from the facts): meshes, downsample, points (particles), full-screen pass, bloom / blur, bloom (downsample), SMAA anti-aliasing, composite to screen.
- ✔ `render-graph.md`: every pass in order, its target, programs, draws, the textures it reads, blend and depth.
- ≈ Clock uniforms (a value named like time that grew between the frames) advance with real time; everything else replays as recorded, frame after frame. `replay.setUniform(program, name, value)` overrides a value, `replay.setPassEnabled(i, false)` switches a pass off.
- (a) alone: canvas 100%, page 100%. The project does not run it: it is the reference.
- ✔ `public/scene/scene.glb` + `scene/scene.js`: 18 mesh(es) read back from the GPU buffers with their model matrices and the camera (from the view and projection uniforms); see `scene/scene.md`. Rendered with a plain material it scores canvas 27.1%: the placement is the site's, the look is in the replay.
- ≈ --own-assets: 6 uploaded texture(s) in the replay are an 8×8 grid of their own average colours at the same size (tones, no detail); 4 lookup table(s) (colour LUTs, ramps, tiny data textures: the site's code tables, not artwork) are kept as recorded; render targets and geometry are the frames' own.

## How close the rebuild is

DEA rendered `preview/index.html` and compared it with the original first screen after its intro (`preview/original.png` vs `preview/final.png`, side by side in `preview/side-by-side.png`). The score is 0.3 colour + 0.35 brightness layout + 0.35 edges, at 96×60.

- Start: 29.2% similar
- After DEA's own analysis (palette, screen colour, each shader, opacity): 99.5%
- After research and retry: 99.5% (already 99.5% similar (target 92%))
- Final parts: colour 99.8%, brightness layout 99.4%, edges 99.4%
- **Canvas only** (the WebGL picture alone, the site's text hidden; 0.6 × SSIM at three scales + 0.2 × edges + 0.2 × tones): 56.7% at the start → 99.5%; canvas 99.5% (SSIM 99.7%, edges 98.8%, tones 99.5%)
- Kept parameters: background #a0a5b1, text #111111, font system-ui, size 64, program __rebuild, opacity 1
- Page environment: DEA answered 8 CPU cores and 8 GB (navigator.hardwareConcurrency, deviceMemory).

The page score compares colour layout, not text or motion: a high score means the first screen reads the same, not that the code is identical. The canvas score looks only at the 3D picture, so text and colour cannot carry it: read it to judge the effect itself.

## Techniques behind it

Recognised in the decoded pipeline (✔ the evidence), with free sources to learn each one (links only; nothing copied):

- **Mipmap blur bloom (a chain of downsample and upsample passes)**: ✔ Downsampling and Upsampling passes in the frame
- **SMAA anti-aliasing**: ✔ SMAA materials in the frame
- **Blue-noise dithering**: ✔ a blue-noise texture sampled with gl_FragCoord
- **Dissolve / disintegration effect**: ✔ a dissolve uniform in a material
- **Shader-sized point sprites**: ✔ programs that write gl_PointSize

## Gap → path to result

What DEA could not fully decode yet, what it knows anyway, its best reconstruction (Inferred), and the next probe that would close the gap.

### G1. 46 uniform starting value(s) are guesses

**Known**

- ✔ 0 uniform values were read from the live trace.
- ≈ Guessed: MousePosProgressProgress2Shader.uMousePos, MousePosProgressProgress2Shader.uProgress, MousePosProgressProgress2Shader.uProgress2, MousePosProgressProgress2Shader.uTriangleAlpha, MousePosProgressProgress2Shader.uAlpha, ProgressProgress2Color1Shader.uProgress, ProgressProgress2Color1Shader.uProgress2, ProgressProgress2Color1Shader.uColor1, ProgressProgress2Color1Shader.uColor2, ProgressProgress2Color1Shader.uTriangleAlpha …

**Missing:** No live trace was run.

**Next probe**

- `dea trace https://www.igloo.inc --ms 30000`: watch longer and scroll the whole page so every program draws
- `dea trace https://www.igloo.inc --break uniform:uMousePos`: pause where one is set and read the caller variables

### G2. No live GSAP timelines were captured

**Known**

- ✔ CSS @keyframes and transitions are in motion/keyframes.css.

**Missing:** Either the site animates without GSAP, or its intro tweens had finished before DEA read the GSAP instance.

**Next probe**

- `dea motion https://www.igloo.inc`: record motion from the first frame and fit curves
- `dea code https://www.igloo.inc`: read the gsap.to/timeline calls in the code itself


## Where it came from

- design run: 20261127-111954-igloo-inc-e89271cf
- motion run: skipped (quick mode)
- reused from the cache (not observed again in this run): reference + capture (2026-11-27T15:13:24.594Z), design (2026-11-27T11:21:24.029Z), assets (2026-11-27T11:22:17.196Z)
- assets run: 20261127-112124-igloo-inc-8db37312

