# Extracted from https://jehaduddin.vercel.app (react)

Made by DEA from what the site actually rendered. ✔ Verified = read from the live page. ≈ Inferred = DEA filled a gap.

> **Provenance.** Source: https://jehaduddin.vercel.app · extracted 2026-11-03 with DEA.
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
- ✔ `shaders/CoreStAxShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uFog. ✔ 22 value(s) from the live trace. Drivers: ≈ uST ← a clock: +0.0125 per second (wall time here); ≈ uTime ← a clock: +0.01 per second (wall time here); ≈ uPool ← a clock: +0.0003 per second (wall time here); ≈ uColI ← a clock: +0.0001 per second (wall time here).
- ✔ `shaders/BaseLCoreShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uHaze, uFog. ✔ 16 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.0099 per second (wall time here); ≈ uColI ← a clock: +0.0001 per second (wall time here).
- ✔ `shaders/DetailLLcShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uFog. ≈ uRockSh come from another render pass on the site: wire your own render target. ✔ 16 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.01 per second (wall time here); ≈ uPool ← a clock: +0.0003 per second (wall time here); ≈ uColI ← a clock: +0.0001 per second (wall time here).
- ✔ `shaders/DetailLLcShader2.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uFog. ≈ uRockSh come from another render pass on the site: wire your own render target. ✔ 16 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.01 per second (wall time here); ≈ uPool ← a clock: +0.0003 per second (wall time here); ≈ uColI ← a clock: +0.0001 per second (wall time here).
- ✔ `shaders/ViewOnCaShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (full-screen quad). ✔ 11 value(s) from the live trace. Drivers: ≈ uView ← the viewport size.
- ✔ `shaders/CamFloorCoreShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ✔ 10 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.0099 per second (wall time here); ≈ uColI ← a clock: +0.0001 per second (wall time here).
- ✔ `shaders/TimeCamPtrShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (points). ✔ 10 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.01 per second (wall time here); ≈ uAspect ← the viewport aspect.
- ✔ `shaders/ViewDprOnShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (full-screen quad). ✔ 9 value(s) from the live trace. Drivers: ≈ uView ← the viewport size.
- ✔ `shaders/RippleRipRipTexelShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (≈ plane stand-in geometry). ≈ Starting values guessed for uRip, uRipTexel, uRipAmp, uTime, uSwell, uGlint. ✔ 1 value(s) from the live trace. Drivers: ≈ guess: uTime ← a clock: +1 per second (seconds); ≈ guess: uRes ← the viewport size.
- ✔ `shaders/PosDtRoShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (full-screen quad). ✔ 18 value(s) from the live trace. Drivers: ≈ uNS ← a clock: +0.0001 per second (wall time here); ≈ uAsp ← the viewport aspect.
- ✔ `shaders/TimeCoreColCShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (points). ✔ 6 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.01 per second (wall time here).
- ✔ `shaders/TimeShader.js`: the exact GLSL the site compiled, as a three.js RawShaderMaterial (points). ✔ 4 value(s) from the live trace. Drivers: ≈ uTime ← a clock: +0.01 per second (wall time here).
- ✔ The site’s texture files: `public/textures/1-t16.png`, `public/textures/2-t22.png`, `public/textures/3-t1.png`, `public/textures/4-t7.png`, `public/textures/5-t8.png`, `public/textures/6-t10.png`, `public/textures/7-t11.png`

## How close the rebuild is

DEA rendered `preview/index.html` and compared it with the original first screen after its intro (`preview/original.png` vs `preview/final.png`, side by side in `preview/side-by-side.png`). The score is 0.3 colour + 0.35 brightness layout + 0.35 edges, at 96×60.

- Start: 73.2% similar
- After DEA's own analysis (palette, screen colour, each shader, opacity): 88.1%
- After research and retry: 88.1% (searches found no new values to try)
- Final parts: colour 95.9%, brightness layout 79.8%, edges 89.6%
- Kept parameters: background #000000, text #e9e7e1, font Timeless Sans Grotesk, size 32, program CoreStAxShader, opacity 1, standin particles, spread 0.8, standinX 0, standinY 0.35, standinColor #ffffff

### Research rounds

- Round 1: searched “"jehaduddin.vercel.app" background color hex”, “Jehad Uddin — Creative Technologist & Design Engineer brand colors”; 8 findings; tried 0 value(s), none helped.
- Round 2: searched “jehaduddin.vercel.app css font-family”, “Jehad Uddin — Creative Technologist & Design Engineer website design colors fonts”; 15 findings; tried 0 value(s), none helped.

The score compares colour layout, not text or motion: a high score means the first screen reads the same, not that the code is identical.

## Does it build?

✔ `npm install && npm run build` passed on DEA's machine in 8 s (Vite).

## Techniques behind it

Recognised in the decoded pipeline (✔ the evidence), with free sources to learn each one (links only; nothing copied):

- **GPGPU particle simulation (positions and velocities in float textures, ping-pong render targets)**: ✔ samplers tPos and tVel read and written by full-screen passes
  - [Crafting a Dreamy Particle Effect with Three.js and GPGPU](https://tympanus.net/codrops/2024/12/19/crafting-a-dreamy-particle-effect-with-three-js-and-gpgpu/) via duckduckgo
  - [gpgpu | Codrops](https://tympanus.net/codrops/tag/gpgpu/) via duckduckgo
  - [GitHub - DGFX/codrops-dreamy-particles: Dreamy Particles for Codrops](https://github.com/DGFX/codrops-dreamy-particles) via duckduckgo
- **Mipmap blur bloom (a chain of downsample and upsample passes)**: ✔ Downsampling and Upsampling passes in the frame
  - [MipmapBlurPass | postprocessing - Next.js Starter Blog](https://pmndrs.github.io/postprocessing/public/docs/class/src/passes/MipmapBlurPass.js~MipmapBlurPass.html) via duckduckgo
  - [three.js webgl - postprocessing - unreal bloom](https://threejs.org/examples/webgl_postprocessing_unreal_bloom.html) via duckduckgo
  - [UnrealBloomPass - three.js docs](https://threejs.org/docs/pages/UnrealBloomPass.html) via duckduckgo
- **SMAA anti-aliasing**: ✔ SMAA materials in the frame
  - [SMAAEffect | postprocessing - Next.js Starter Blog](https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/SMAAEffect.js~SMAAEffect.html) via duckduckgo
  - [three.js webgl - postprocessing smaa](https://threejs.org/examples/webgl_postprocessing_smaa) via duckduckgo
  - [three.js webgl - postprocessing smaa](https://threejs.org/examples/webgl_postprocessing_smaa.html) via duckduckgo
- **Blue-noise dithering**: ✔ a blue-noise texture sampled with gl_FragCoord
  - [fubax-shaders/Shaders/BlueNoiseDither.fxh at master · Fubaxiusz/fubax ...](https://github.com/Fubaxiusz/fubax-shaders/blob/master/Shaders/BlueNoiseDither.fxh) via duckduckgo
  - [Free blue noise textures - GitHub](https://github.com/Calinou/free-blue-noise-textures) via duckduckgo
  - [GitHub - bartwronski/BlueNoiseGenerator](https://github.com/bartwronski/BlueNoiseGenerator) via duckduckgo
- **Heightmap terrain (vertex displacement from a texture)**: ✔ a height texture sampled in a vertex shader
  - [Discard vertex spikes from terrain created via displacement map](https://discourse.threejs.org/t/discard-vertex-spikes-from-terrain-created-via-displacement-map/84450) via duckduckgo
  - [GitHub - IceCreamYou/THREE.Terrain: A procedural terrain generation ...](https://github.com/IceCreamYou/THREE.Terrain) via duckduckgo
  - [GitHub - mode777/normalmapped-terrain: PoC: normal-map-driven terrain ...](https://github.com/mode777/normalmapped-terrain/tree/main/) via duckduckgo
- **Ripple / wave simulation in a feedback texture**: ✔ a pass that reads its own previous frame (tPrev) with a texel size
  - [GitHub - DCtheTall/webgl-ripple: A WebGL ripple effect utility written ...](https://github.com/DCtheTall/webgl-ripple) via duckduckgo
  - [GitHub - lolrazh/enhanced-jquery-ripples: Realistic WebGL-powered water ...](https://github.com/lolrazh/enhanced-jquery-ripples) via duckduckgo
  - [Recursive Trail Ping‑Pong (Three.js Render‑to‑Texture Feedback)](https://discourse.threejs.org/t/recursive-trail-ping-pong-three-js-render-to-texture-feedback/89718) via duckduckgo
- **Dissolve / disintegration effect**: ✔ a dissolve uniform in a material
  - [Implementing a Dissolve Effect with Shaders and Particles in Three.js ...](https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/) via duckduckgo
  - [Emissive Dissolve Effect - GitHub](https://github.com/JatinChopra/emissive-dissolve-effect) via duckduckgo
  - [GitHub - ScreamingRoot/three.js-dissolve-vfx-example](https://github.com/ScreamingRoot/three.js-dissolve-vfx-example) via duckduckgo
- **Shader-sized point sprites**: ✔ programs that write gl_PointSize
  - [gl_PointSize in world's space - Questions - three.js forum](https://discourse.threejs.org/t/gl-pointsize-in-worlds-space/77996) via duckduckgo
  - [PointsMaterial - three.js docs](https://threejs.org/docs/pages/PointsMaterial.html) via duckduckgo
  - [ShaderMaterial - three.js docs](https://threejs.org/docs/pages/ShaderMaterial.html) via duckduckgo

## Gap → path to result

What DEA could not fully decode yet, what it knows anyway, its best reconstruction (Inferred), and the next probe that would close the gap.

### G1. 29 uniform starting value(s) are guesses

**Known**

- ✔ 139 uniform values were read from the live trace.
- ≈ Guessed: CoreStAxShader.uFog, BaseLCoreShader.uHaze, BaseLCoreShader.uFog, DetailLLcShader.uFog, DetailLLcShader2.uFog, RippleRipRipTexelShader.uRip, RippleRipRipTexelShader.uRipTexel, RippleRipRipTexelShader.uRipAmp, RippleRipRipTexelShader.uTime, RippleRipRipTexelShader.uSwell …

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

- design run: 20261103-130003-jehaduddin-vercel-app-1dd1d4d0
- motion run: 20261103-124325-jehaduddin-vercel-app-3e12806f
- assets run: 20261103-131342-jehaduddin-vercel-app-ecfc0d29
- live trace run: 20261103-133057-jehaduddin-vercel-app-fc7e2ee9

