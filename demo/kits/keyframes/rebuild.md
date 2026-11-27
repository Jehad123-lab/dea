# Editable rebuild of https://threejs.org/examples/webgl_animation_keyframes.html

A three.js project made from the render graph DEA recorded: each draw is a three.js object with a RawShaderMaterial (the site's GLSL in `shaders/`), a BufferGeometry, a camera and a model matrix; each framebuffer is a WebGLRenderTarget; the passes run in the site's order from `pipeline.json`. Change a uniform, a blend mode, a shader file, the camera, or switch a pass off, and the picture follows.

**Editable rebuild score: canvas 79.9%, page 87.4%** (against the original first screen).

| | |
|---|---|
| draws | 790 (10 frames, a motion loop of 10 frames, 2500 ms) |
| materials | 14 RawShaderMaterials from 14 programs |
| render targets | 0 |
| cameras | 2 |
| matrices | 790 draws: three.js derives exactly the matrices the site uploaded from the camera and the model matrix |
| raw WebGL steps | 50 (uploads, blits, mipmaps, attachments) |
| clears | 10 |

## Where recorded bytes are still used

- recorded: 301 vertex/index buffers, 0.4 MB (the geometry of each draw)
- recorded: 7 textures, 39.1 MB (image pixels and the starting state of simulation targets)
- --own-assets: the site's images are an 8×8 grid of their own average colours (lookup tables stay as recorded) and 130 large mesh(es) are stand-ins: 130 coarse shape(s) of at most 16 cells per side, 0 box(es); their bytes are not in the kit

### Stand-ins (130, most vertices first, first 40)

| material | program | draw | instances | shares its buffer with | vertices: site → stand-in | triangles turned back / kept both sides | inputs kept | inputs lost (read as 0) |
|---|---|---|---|---|---|---|---|---|
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 1 | outline #379 | triangles | - | 9 other draw(s) | 55921 → 4224 | 1781 / 142 | normal | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 46938 → 10824 | 3363 / 24 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 23062 → 6169 | 292 / 28 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | 9 other draw(s) | 19672 → 4700 | 413 / 26 | normal, uv, uv1 | - |

- instances: how many copies one draw makes (instanced drawing); "-" is a single copy, also for a batched mesh drawn piece by piece (multi-draw)
- triangles turned back: stand-in triangles that turned over when their corners moved to the cell average and were turned back to face the way the site's did; kept both sides: triangles kept in both windings, the two sides of a thin shell
- all 130 stand-ins: extract.json, replay.rebuild.stats.standIns

## Passes

- 9: meshes → screen 1440×900 (14 programs) ≈ 79 draw(s) of geometry with more than two triangles

