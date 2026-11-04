# Extracted from https://jehaduddin.vercel.app (react)

Made by DEA from what the site actually rendered. ✔ Verified = read from the live page. ≈ Inferred = DEA filled a gap.

> **Provenance.** Source: https://jehaduddin.vercel.app · extracted 2026-11-04 with DEA.
> The shaders, code, fonts, textures and models came from that site and belong to their owners: study them, and swap in your own before you ship anything public.

## Run it

```bash
npm install
npm run dev
```

## What is here

- ✔ `tokens/tokens.css` (CSS variables), `tokens/tailwind.preset.js`, `tokens/tokens.json` (W3C design tokens): colours, fonts, type sizes, durations and easing curves read from the rendered page.
- ✔ `motion/timeline.js`: the GSAP timelines and ScrollTriggers read from the live GSAP instance; `buildMotion()` builds them. ≈ Targets that were JavaScript objects are placeholders you pass in.
- ✔ `motion/keyframes.css`: the `@keyframes` the site ships and its transition styles as classes.
- ✔ `shaders/CoreStAxShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uFog. ✔ 22 value(s) from the live trace. Drivers: ≈ uST ← a clock: +0.013 per second (wall time here); ≈ uTime ← a clock: +0.0118 per second (wall time here); ≈ uPool ← a clock: +0.0003 per second (wall time here); ≈ uColI ← a clock: +0.0002 per second (wall time here).
- ✔ `shaders/BaseLCoreShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uHaze, uFog. ✔ 16 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.0117 per second (wall time here); ≈ uColI ← a clock: +0.0002 per second (wall time here).
- ✔ `shaders/DetailLLcShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uFog. ≈ uRockSh come from another render pass on the site: wire your own render target. ✔ 16 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.0118 per second (wall time here); ≈ uPool ← a clock: +0.0003 per second (wall time here); ≈ uColI ← a clock: +0.0002 per second (wall time here).
- ✔ `shaders/DetailLLcShader2.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uFog. ≈ uRockSh come from another render pass on the site: wire your own render target. ✔ 16 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.0118 per second (wall time here); ≈ uPool ← a clock: +0.0003 per second (wall time here); ≈ uColI ← a clock: +0.0002 per second (wall time here).
- ✔ `shaders/ViewOnCaShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (full-screen quad). ✔ 11 value(s) from the live trace. Drivers: ≈ uView ← the viewport size.
- ✔ `shaders/CamFloorCoreShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ✔ 10 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.0117 per second (wall time here); ≈ uColI ← a clock: +0.0002 per second (wall time here).
- ✔ `shaders/TimeCamPtrShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (points). ✔ 10 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.0118 per second (wall time here); ≈ uAspect ← the viewport aspect.
- ✔ `shaders/PSrcShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (points). ≈ Starting values guessed for uP, uPend, uCloudY, uOn, uDstMix. ✔ 1 value(s) from the live trace. Drivers: ≈ guess: uTime ← a clock: +1 per second (seconds).
- ✔ `shaders/ViewDprOnShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (full-screen quad). ✔ 9 value(s) from the live trace. Drivers: ≈ uView ← the viewport size.
- ✔ `shaders/RippleRipRipTexelShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uRip, uRipTexel, uRipAmp, uSwell, uGlint, uCaustK. ✔ 1 value(s) from the live trace. Drivers: ≈ guess: uTime ← a clock: +1 per second (seconds); ≈ guess: uRes ← the viewport size.
- ✔ `shaders/PosDtRoShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (full-screen quad). ✔ 18 value(s) from the live trace. Drivers: ≈ uNS ← a clock: +0.0001 per second (wall time here); ≈ uAsp ← the viewport aspect.
- ✔ `shaders/TimeCoreColCShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (points). ✔ 6 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.0118 per second (wall time here).
- ✔ The site’s texture files: `public/textures/1-t16.png`, `public/textures/2-t22.png`, `public/textures/3-t1.png`, `public/textures/4-t7.png`, `public/textures/5-t8.png`, `public/textures/6-t10.png`, `public/textures/7-t11.png`

## The site's own frames: (a) capture replay and (b) editable rebuild

Two different things, scored separately. **(a) Capture replay**: the recorded calls played back. It is the ground truth for the score, not code to build on. **(b) Editable rebuild**: the same render graph turned into a three.js project (materials, geometry, cameras, render targets, passes) that you can change; it still reads the recorded vertex and texture bytes where `rebuild.md` says so.

| | canvas | page | in the kit |
|---|---|---|---|
| (a) capture replay | 93.1% | 95% | `replay/replay.js` + `public/replay/` (the site's bytes) |
| (b) editable rebuild (100% against (a)) | 93.1% | 95% | `rebuild/rebuild.js` + `public/rebuild/` (what the project runs) |

- ✔ (b) `public/rebuild/pipeline.json`: 106 draws in the site's order as 28 RawShaderMaterials (GLSL in `public/rebuild/shaders/`), 4 camera(s), 29 render targets, 0 raw WebGL step(s). three.js reproduces the site's matrices from the camera and model matrix on 46 draw(s), not on 2.
- recorded in (b): 5.4 MB of vertex/index buffers and 18.8 MB of texture pixels and simulation start state (the site's own bytes: for study and prototyping). See `rebuild.md`.

✔ DEA recorded 2 consecutive frames of the site's WebGL right before the reference screenshot: every call with its arguments, and every buffer, texture, shader program and render target as it was when the frames began (read back from the GPU). 24.2 MB in `public/replay/`.

- ✔ `replay/replay.js` runs exactly those calls with the site's own GLSL, geometry and textures: 54 passes, 106 draws, 28 programs. Passes seen (≈ roles read from the facts): simulation step (GPGPU ping-pong), meshes (instanced), full-screen pass, simulation step (feedback: reads its previous result), points (particles), bloom / blur, bloom (downsample), SMAA anti-aliasing, composite to screen.
- ✔ `render-graph.md`: every pass in order, its target, programs, draws, the textures it reads, blend and depth.
- ≈ Clock uniforms (a value named like time that grew between the frames) advance with real time; everything else replays as recorded, frame after frame. `replay.setUniform(program, name, value)` overrides a value, `replay.setPassEnabled(i, false)` switches a pass off.
- (a) alone: canvas 93.1%, page 95%. The project does not run it: it is the reference.
- ✔ `public/scene/scene.glb` + `scene/scene.js`: 18 mesh(es) read back from the GPU buffers with their model matrices and the camera (from the view and projection uniforms); see `scene/scene.md`. Rendered with a plain material it scores canvas 18.1%: the placement is the site's, the look is in the replay.

## How close the rebuild is

DEA rendered `preview/index.html` and compared it with the original first screen after its intro (`preview/original.png` vs `preview/final.png`, side by side in `preview/side-by-side.png`). The score is 0.3 colour + 0.35 brightness layout + 0.35 edges, at 96×60.

- Start: 50.7% similar
- After DEA's own analysis (palette, screen colour, each shader, opacity): 95%
- After research and retry: 95% (already 95% similar (target 92%))
- Final parts: colour 95.8%, brightness layout 93.6%, edges 95.6%
- **Canvas only** (the WebGL picture alone, the site's text hidden; 0.6 × SSIM at three scales + 0.2 × edges + 0.2 × tones): 1.6% at the start → 93.1%; canvas 93.1% (SSIM 93.5%, edges 96%, tones 89.2%, 5% hidden under text)
- Kept parameters: background #000000, text #e9e7e1, font Timeless Sans Grotesk, size 32, program __rebuild, opacity 1

The page score compares colour layout, not text or motion: a high score means the first screen reads the same, not that the code is identical. The canvas score looks only at the 3D picture, so text and colour cannot carry it: read it to judge the effect itself.

## Does it build?

✔ `npm install && npm run build` passed on DEA's machine in 6 s (Vite).

## Techniques behind it

Recognised in the decoded pipeline (✔ the evidence), with free sources to learn each one (links only; nothing copied):

- **GPGPU particle simulation (positions and velocities in float textures, ping-pong render targets)**: ✔ samplers tPos and tVel read and written by full-screen passes
- **Mipmap blur bloom (a chain of downsample and upsample passes)**: ✔ Downsampling and Upsampling passes in the frame
- **SMAA anti-aliasing**: ✔ SMAA materials in the frame
- **Blue-noise dithering**: ✔ a blue-noise texture sampled with gl_FragCoord
- **Heightmap terrain (vertex displacement from a texture)**: ✔ a height texture sampled in a vertex shader
- **Ripple / wave simulation in a feedback texture**: ✔ a pass that reads its own previous frame (tPrev) with a texel size
- **Dissolve / disintegration effect**: ✔ a dissolve uniform in a material
- **Shader-sized point sprites**: ✔ programs that write gl_PointSize

## Gap → path to result

What DEA could not fully decode yet, what it knows anyway, its best reconstruction (Inferred), and the next probe that would close the gap.

### G1. 33 uniform starting value(s) are guesses

**Known**

- ✔ 136 uniform values were read from the live trace.
- ≈ Guessed: CoreStAxShader.uFog, BaseLCoreShader.uHaze, BaseLCoreShader.uFog, DetailLLcShader.uFog, DetailLLcShader2.uFog, PSrcShader.uP, PSrcShader.uPend, PSrcShader.uCloudY, PSrcShader.uOn, PSrcShader.uDstMix …

**Missing:** The trace never saw these set (they belong to programs that did not draw while DEA watched, or are set once before the trace hook).

**Next probe**

- `dea trace https://jehaduddin.vercel.app --ms 30000`: watch longer and scroll the whole page so every program draws
- `dea trace https://jehaduddin.vercel.app --break uniform:uFog`: pause where one is set and read the caller variables

### G2. Samplers fed by other passes

**Known**

- ✔ DetailLLcShader.uRockSh, DetailLLcShader2.uRockSh read textures the site draws at runtime.

**Missing:** Which pass writes each one is wired by order in pipeline.js (Inferred), not read from the code.

**Best reconstruction now (Inferred):** pipeline.js connects each pass to the targets it read in the recorded frame.

**Next probe**

- `dea assets https://jehaduddin.vercel.app`: see which program drew into which target, and the call that created each target


## Where it came from

- design run: 20261104-055319-jehaduddin-vercel-app-a8ad9adf
- motion run: 20261104-055716-jehaduddin-vercel-app-d04068b7
- assets run: 20261104-055829-jehaduddin-vercel-app-333004c3
- live trace run: 20261104-060002-jehaduddin-vercel-app-27844dff

