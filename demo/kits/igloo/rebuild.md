# Editable rebuild of https://www.igloo.inc/

A three.js project made from the render graph DEA recorded: each draw is a three.js object with a RawShaderMaterial (the site's GLSL in `shaders/`), a BufferGeometry, a camera and a model matrix; each framebuffer is a WebGLRenderTarget; the passes run in the site's order from `pipeline.json`. Change a uniform, a blend mode, a shader file, the camera, or switch a pass off, and the picture follows.

**Editable rebuild score: canvas 99.5%, page 99.5%** (against the original first screen).

| | |
|---|---|
| draws | 234 (2 frames, alternating) |
| materials | 29 RawShaderMaterials from 29 programs |
| render targets | 20 |
| cameras | 6 |
| matrices | 196 draws: three.js derives exactly the matrices the site uploaded from the camera and the model matrix |
| raw WebGL steps | 24 (uploads, blits, mipmaps, attachments) |
| clears | 8 |

## Where recorded bytes are still used

- recorded: 71 vertex/index buffers, 0.2 MB (the geometry of each draw)
- recorded: 12 textures, 7.1 MB (image pixels and the starting state of simulation targets)
- --own-assets: the site's images are an 8×8 grid of their own average colours (lookup tables stay as recorded) and 158 large mesh(es) are stand-ins: 158 coarse shape(s) of at most 16 cells per side, 0 box(es); their bytes are not in the kit

### Stand-ins (158, most vertices first, first 40)

| material | program | draw | instances | shares its buffer with | vertices: site → stand-in | triangles turned back / kept both sides | inputs kept | inputs lost (read as 0) |
|---|---|---|---|---|---|---|---|---|
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 6 | program #241 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 6 | program #241 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 4 | program #237 | triangles | - | 11 other draw(s) | 2780 → 495 | 38 / 6 | uv | - |
| 3 | program #235 | triangles | - | 5 other draw(s) | 1703 → 412 | 14 / 2 | uv | - |
| 3 | program #235 | triangles | - | 5 other draw(s) | 1703 → 412 | 14 / 2 | uv | - |
| 3 | program #235 | triangles | - | 5 other draw(s) | 1703 → 412 | 14 / 2 | uv | - |
| 3 | program #235 | triangles | - | 5 other draw(s) | 1703 → 412 | 14 / 2 | uv | - |
| 3 | program #235 | triangles | - | 5 other draw(s) | 1703 → 412 | 14 / 2 | uv | - |
| 3 | program #235 | triangles | - | 5 other draw(s) | 1703 → 412 | 14 / 2 | uv | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1507 → 324 | 86 / 22 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1507 → 324 | 86 / 22 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1498 → 345 | 103 / 32 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1498 → 345 | 103 / 32 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1469 → 332 | 111 / 20 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1469 → 332 | 111 / 20 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1423 → 282 | 116 / 28 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1423 → 282 | 116 / 28 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1231 → 143 | 44 / 14 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1231 → 143 | 44 / 14 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1230 → 139 | 20 / 4 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1230 → 139 | 20 / 4 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1097 → 210 | 79 / 12 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 1097 → 210 | 79 / 12 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 770 → 296 | 55 / 6 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 770 → 296 | 55 / 6 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 593 → 289 | 39 / 18 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 593 → 289 | 39 / 18 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 582 → 279 | 44 / 12 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 582 → 280 | 46 / 16 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 582 → 279 | 44 / 12 | uv, batchId, emission | - |
| 1 | program #229 | triangles | - | 139 other draw(s) | 582 → 280 | 46 / 16 | uv, batchId, emission | - |

- instances: how many copies one draw makes (instanced drawing); "-" is a single copy, also for a batched mesh drawn piece by piece (multi-draw)
- triangles turned back: stand-in triangles that turned over when their corners moved to the cell average and were turned back to face the way the site's did; kept both sides: triangles kept in both windings, the two sides of a thin shell
- all 158 stand-ins: extract.json, replay.rebuild.stats.standIns

## Not carried over

- attribute left as a constant value (2×)

## Passes

- 21: meshes → render target 1440×900 RGBA16F (tex#499) (6 programs) ≈ 13 draw(s) of geometry with more than two triangles
- 22: downsample → render target 36×36 RGBA32F (tex#12) (1 program) ≈ a full-screen draw into a target half the size of the previous one
- 23: points (particles) → render target 1440×900 RGBA16F (tex#499) (9 programs) ≈ 2 draw(s) of gl.POINTS
- 24: full-screen pass → render target 1440×900 RGBA16F (tex#497) (1 program) ≈ a full-screen draw into a render target
- 25: meshes → render target 1440×900 RGBA16F (tex#524) (4 programs) ≈ 6 draw(s) of geometry with more than two triangles
- 26: bloom / blur → render target 1440×900 RGBA16F (tex#526) (1 program) ≈ bloom or blur names in the program
- 27: bloom (downsample) → render target 720×450 RGBA16F (tex#530) (1 program) ≈ bloom or blur names in the program
- 28: bloom (downsample) → render target 360×225 RGBA16F (tex#532) (1 program) ≈ bloom or blur names in the program
- 29: bloom (downsample) → render target 180×113 RGBA16F (tex#533) (1 program) ≈ bloom or blur names in the program
- 30: bloom (downsample) → render target 90×57 RGBA16F (tex#534) (1 program) ≈ bloom or blur names in the program
- 31: bloom (downsample) → render target 45×29 RGBA16F (tex#535) (1 program) ≈ bloom or blur names in the program
- 32: bloom (downsample) → render target 23×15 RGBA16F (tex#536) (1 program) ≈ bloom or blur names in the program
- 33: bloom / blur → render target 45×29 RGBA16F (tex#537) (1 program) ≈ bloom or blur names in the program
- 34: bloom / blur → render target 90×57 RGBA16F (tex#539) (1 program) ≈ bloom or blur names in the program
- 35: bloom / blur → render target 180×113 RGBA16F (tex#540) (1 program) ≈ bloom or blur names in the program
- 36: bloom / blur → render target 360×225 RGBA16F (tex#541) (1 program) ≈ bloom or blur names in the program
- 37: bloom / blur → render target 720×450 RGBA16F (tex#542) (1 program) ≈ bloom or blur names in the program
- 38: full-screen pass → render target 1440×900 RGBA16F (tex#543) (1 program) ≈ a full-screen draw into a render target
- 39: full-screen pass → render target 1440×900 RGBA8 (tex#546) (1 program) ≈ a full-screen draw into a render target
- 40: SMAA anti-aliasing → render target 1440×900 RGBA8 (tex#548) (1 program) ≈ SMAA textures or names in the program
- 41: composite to screen → screen 1440×900 (1 program) ≈ a full-screen draw into the canvas

