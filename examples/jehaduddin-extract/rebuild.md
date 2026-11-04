# Editable rebuild of https://jehaduddin.vercel.app/

A three.js project made from the render graph DEA recorded: each draw is a three.js object with a RawShaderMaterial (the site's GLSL in `shaders/`), a BufferGeometry, a camera and a model matrix; each framebuffer is a WebGLRenderTarget; the passes run in the site's order from `pipeline.json`. Change a uniform, a blend mode, a shader file, the camera, or switch a pass off, and the picture follows.

**Editable rebuild score: canvas 93.1%, page 95.0%** (against the original first screen).

| | |
|---|---|
| draws | 106 (2 frames, alternating) |
| materials | 28 RawShaderMaterials from 28 programs |
| render targets | 29 |
| cameras | 4 |
| matrices | 46 draws: three.js derives exactly the matrices the site uploaded from the camera and the model matrix; 2 differ (modelViewMatrix) |
| raw WebGL steps | 0 (uploads, blits, mipmaps, attachments) |
| clears | 50 |

## Where recorded bytes are still used

- recorded: 60 vertex/index buffers, 5.4 MB (the geometry of each draw)
- recorded: 12 textures, 18.8 MB (image pixels and the starting state of simulation targets)
- these bytes are the site's: for study and prototyping; swap them for your own (`--own-assets`) before you ship

## Passes

- 27: simulation step (GPGPU ping-pong) → render target 256×256 RGBA32F (tex#23) (1 program) ≈ a full-screen draw into a float render target that reads other render targets, with state-like uniform names
- 28: simulation step (GPGPU ping-pong) → render target 256×256 RGBA32F (tex#24) (1 program) ≈ a full-screen draw into a float render target that reads other render targets, with state-like uniform names
- 29: meshes (instanced) → render target 256×256 RGBA8 (tex#25) (1 program) ≈ 4 draw(s) of geometry with more than two triangles
- 30: full-screen pass → render target 256×256 RGBA8 (tex#26) (1 program) ≈ a full-screen draw into a render target
- 31: meshes (instanced) → render target 1440×900 RGBA16F (tex#50) (4 programs) ≈ 10 draw(s) of geometry with more than two triangles
- 32: simulation step (feedback: reads its previous result) → render target 160×100 RGBA16F (tex#85) (1 program) ≈ a full-screen draw into a render target that reads an earlier result (prev/trail/feedback names)
- 33: points (particles) → render target 1440×900 RGBA16F (tex#418) (12 programs) ≈ 3 draw(s) of gl.POINTS
- 34: bloom / blur → render target 1440×900 RGBA16F (tex#140) (1 program) ≈ bloom or blur names in the program
- 35: bloom (downsample) → render target 720×450 RGBA16F (tex#144) (1 program) ≈ bloom or blur names in the program
- 36: bloom (downsample) → render target 360×225 RGBA16F (tex#146) (1 program) ≈ bloom or blur names in the program
- 37: bloom (downsample) → render target 180×113 RGBA16F (tex#147) (1 program) ≈ bloom or blur names in the program
- 38: bloom (downsample) → render target 90×57 RGBA16F (tex#148) (1 program) ≈ bloom or blur names in the program
- 39: bloom (downsample) → render target 45×29 RGBA16F (tex#149) (1 program) ≈ bloom or blur names in the program
- 40: bloom (downsample) → render target 23×15 RGBA16F (tex#150) (1 program) ≈ bloom or blur names in the program
- 41: bloom (downsample) → render target 12×8 RGBA16F (tex#151) (1 program) ≈ bloom or blur names in the program
- 42: bloom (downsample) → render target 6×4 RGBA16F (tex#152) (1 program) ≈ bloom or blur names in the program
- 43: bloom / blur → render target 12×8 RGBA16F (tex#153) (1 program) ≈ bloom or blur names in the program
- 44: bloom / blur → render target 23×15 RGBA16F (tex#155) (1 program) ≈ bloom or blur names in the program
- 45: bloom / blur → render target 45×29 RGBA16F (tex#156) (1 program) ≈ bloom or blur names in the program
- 46: bloom / blur → render target 90×57 RGBA16F (tex#157) (1 program) ≈ bloom or blur names in the program
- 47: bloom / blur → render target 180×113 RGBA16F (tex#158) (1 program) ≈ bloom or blur names in the program
- 48: bloom / blur → render target 360×225 RGBA16F (tex#159) (1 program) ≈ bloom or blur names in the program
- 49: bloom / blur → render target 720×450 RGBA16F (tex#160) (1 program) ≈ bloom or blur names in the program
- 50: simulation step (feedback: reads its previous result) → render target 1440×900 RGBA16F (tex#161) (1 program) ≈ a full-screen draw into a render target that reads an earlier result (prev/trail/feedback names)
- 51: full-screen pass → render target 1440×900 RGBA8 (tex#164) (1 program) ≈ a full-screen draw into a render target
- 52: SMAA anti-aliasing → render target 1440×900 RGBA8 (tex#166) (1 program) ≈ SMAA textures or names in the program
- 53: composite to screen → screen 1440×900 (1 program) ≈ a full-screen draw into the canvas

