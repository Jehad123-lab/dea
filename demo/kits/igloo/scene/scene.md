# 3D scene recovered from https://www.igloo.inc

18 mesh draw(s) read back from the GPU buffers of the recorded frame and written to `public/scene/scene.glb` with their model matrices and the camera. Load it with `scene/scene.js` or open it in Blender.

| draw | vertices | indices | model matrix from | instances | model file (by vertex count) |
|---|---|---|---|---|---|
| 1:14 | 169 | 792 | the modelView matrix (no view matrix: the camera is at the origin) | 1 | – |
| 1:75 | 1,703 | 8,652 | the model matrix uniform | 1 | – |
| 1:78 | 1,703 | 8,652 | the model matrix uniform | 1 | – |
| 1:81 | 1,703 | 8,652 | the model matrix uniform | 1 | – |
| 1:95 | 2,780 | 14,877 | the model matrix uniform | 1 | – |
| 1:98 | 2,780 | 14,877 | the model matrix uniform | 1 | – |
| 1:112 | 2,780 | 14,877 | the model matrix uniform | 1 | – |
| 1:131 | 2,780 | 14,877 | the model matrix uniform | 1 | – |
| 1:140 | 2,780 | 14,877 | the model matrix uniform | 1 | – |
| 1:143 | 2,780 | 14,877 | the model matrix uniform | 1 | – |
| 1:178 | 64 | 96 | the model matrix uniform | 1 | – |
| 1:184 | 60 | 90 | the model matrix uniform | 1 | – |
| 1:189 | 112 | 168 | the model matrix uniform | 1 | – |
| 1:194 | 376 | 564 | the model matrix uniform | 1 | – |
| 1:221 | 8 | 12 | the model matrix uniform | 5 | – |
| 1:263 | 84 | 126 | the model matrix uniform | 1 | – |
| 1:266 | 24 | 36 | the model matrix uniform | 1 | – |
| 1:269 | 12 | 18 | the model matrix uniform | 1 | – |

✔ Camera from draw 1:14's projection uniform (no view matrix): perspective, vertical field of view 30.0°, aspect 1.600, near 0.100, far 1.00e+3.

✔ Geometry and matrices are read from the recording. ≈ A vertex shader can move vertices further (displacement, skinning, morphs, particles on textures): those moves are not baked into the glTF; the replay keeps them.
