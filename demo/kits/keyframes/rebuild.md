# Editable rebuild of https://threejs.org/examples/webgl_animation_keyframes.html

A three.js project made from the render graph DEA recorded: each draw is a three.js object with a RawShaderMaterial (the site's GLSL in `shaders/`), a BufferGeometry, a camera and a model matrix; each framebuffer is a WebGLRenderTarget; the passes run in the site's order from `pipeline.json`. Change a uniform, a blend mode, a shader file, the camera, or switch a pass off, and the picture follows.

**Editable rebuild score: canvas 80.2%, page 87.9%** (against the original first screen).

| | |
|---|---|
| draws | 79 (1 frames, alternating) |
| materials | 14 RawShaderMaterials from 14 programs |
| render targets | 0 |
| cameras | 2 |
| matrices | 79 draws: three.js derives exactly the matrices the site uploaded from the camera and the model matrix |
| raw WebGL steps | 5 (uploads, blits, mipmaps, attachments) |
| clears | 1 |

## Where recorded bytes are still used

- recorded: 301 vertex/index buffers, 0.4 MB (the geometry of each draw)
- recorded: 7 textures, 39.1 MB (image pixels and the starting state of simulation targets)
- --own-assets: the site's images are an 8×8 grid of their own average colours (lookup tables stay as recorded) and 13 large mesh(es) are stand-ins: 13 coarse shape(s) of at most 16 cells per side, 0 box(es); their bytes are not in the kit

### Stand-ins (13, most vertices first)

| material | program | draw | instances | shares its buffer with | vertices: site → stand-in | triangles turned back / kept both sides | inputs kept | inputs lost (read as 0) |
|---|---|---|---|---|---|---|---|---|
| 1 | outline #379 | triangles | - | - | 55921 → 4224 | 1781 / 142 | normal | - |
| 5 | normal #397 | triangles | - | - | 46938 → 4748 | 499 / 46 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | - | 23062 → 2209 | 365 / 48 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | - | 19672 → 4068 | 402 / 30 | normal, uv, uv1 | - |
| 5 | normal #397 | triangles | - | - | 12782 → 1322 | 226 / 24 | normal, uv, uv1 | - |
| 1 | outline #379 | triangles | - | - | 11027 → 1185 | 210 / 14 | normal | - |
| 1 | outline #379 | triangles | - | - | 3206 → 756 | 43 / 0 | normal | - |
| 4 | alpha #393 | triangles | - | - | 2579 → 711 | 41 / 0 | normal, uv, uv1 | - |
| 3 | alpha_0 #387 | triangles | - | - | 2418 → 1728 | 1 / 2 | normal, uv | - |
| 3 | alpha_0 #387 | triangles | - | - | 2418 → 1709 | 2 / 4 | normal, uv | - |
| 3 | alpha_0 #387 | triangles | - | - | 2418 → 1715 | 2 / 2 | normal, uv | - |
| 5 | normal #397 | triangles | - | - | 1792 → 551 | 19 / 2 | normal, uv, uv1 | - |
| 7 | Material_5511 #454 | triangles | - | - | 1612 → 275 | 24 / 2 | normal, uv | - |

- instances: how many copies one draw makes (instanced drawing); "-" is a single copy, also for a batched mesh drawn piece by piece (multi-draw)
- triangles turned back: stand-in triangles that turned over when their corners moved to the cell average and were turned back to face the way the site's did; kept both sides: triangles kept in both windings, the two sides of a thin shell

## Passes

- 0: meshes → screen 1440×900 (14 programs) ≈ 79 draw(s) of geometry with more than two triangles

