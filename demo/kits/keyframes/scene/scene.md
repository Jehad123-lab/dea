# 3D scene recovered from https://threejs.org/examples/webgl_animation_keyframes.html

72 mesh draw(s) read back from the GPU buffers of the recorded frame and written to `public/scene/scene.glb` with their model matrices and the camera. Load it with `scene/scene.js` or open it in Blender.

| draw | vertices | indices | model matrix from | instances | model file (by vertex count) |
|---|---|---|---|---|---|
| 0:6 | 24 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object531_normal_0 |
| 0:18 | 11,027 | 27,372 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object674_outline_0 |
| 0:20 | 55,921 | 122,202 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object674_outline_0 |
| 0:25 | 3,206 | 8,898 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object675_outline_0 |
| 0:35 | 88 | 120 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_interiors_0 |
| 0:46 | 2,418 | 5,022 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object619_alpha_0 |
| 0:50 | 2,418 | 5,022 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object619_alpha_0 |
| 0:55 | 170 | 408 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object622_alpha_0 |
| 0:60 | 2,418 | 5,022 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object619_alpha_0 |
| 0:70 | 88 | 168 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_interiors_0 |
| 0:75 | 2,579 | 4,581 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object705_Material #5516_0 |
| 0:84 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:90 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:96 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:102 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:108 | 17 | 72 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › hand2_normal_0 |
| 0:113 | 17 | 72 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › hand2_normal_0 |
| 0:118 | 5 | 9 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › leaf_normal_0 |
| 0:123 | 32 | 138 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › body_normal_0 |
| 0:128 | 17 | 72 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › hand2_normal_0 |
| 0:133 | 17 | 72 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › hand2_normal_0 |
| 0:138 | 171 | 195 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire7_normal_0 |
| 0:144 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:150 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:155 | 169 | 195 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire4_normal_0 |
| 0:161 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:167 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:172 | 169 | 195 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire4_normal_0 |
| 0:177 | 155 | 540 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object081_normal_0 |
| 0:182 | 155 | 540 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object081_normal_0 |
| 0:187 | 171 | 195 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire7_normal_0 |
| 0:192 | 155 | 540 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object081_normal_0 |
| 0:197 | 72 | 138 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object532_normal_0 |
| 0:202 | 24 | 66 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object531_normal_0 |
| 0:207 | 46,938 | 87,828 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_normal_0 |
| 0:213 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:219 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:225 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:231 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:248 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 0:250 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 0:252 | 104 | 429 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_normal_0 |
| 0:254 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 0:256 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 0:258 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 0:260 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 0:276 | 19,672 | 52,050 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_metalmat_0 |
| 0:281 | 150 | 576 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object608_metalmat_0 |
| 0:286 | 16 | 42 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object704_metalmat_0 |
| 0:291 | 1,034 | 2,406 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object675_metalmat_0 |
| 0:296 | 516 | 1,152 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object680_metalmat_0 |
| 0:300 | 516 | 1,152 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object680_metalmat_0 |
| 0:305 | 158 | 612 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object689_metalmat_0 |
| 0:318 | 29 | 117 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 0:333 | 74 | 366 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object078_Plastic_Soft_0 |
| 0:338 | 114 | 348 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 0:343 | 117 | 348 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire2_Plastic_Soft_0 |
| 0:348 | 23,062 | 50,805 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_Plastic_Soft_0 |
| 0:353 | 154 | 384 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object704_Plastic_Soft_0 |
| 0:359 | 12,782 | 28,314 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_paintmat_0 |
| 0:364 | 51 | 180 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object608_paintmat_0 |
| 0:369 | 1,792 | 5,544 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object675_paintmat_0 |
| 0:375 | 312 | 696 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_glassmat_0 |
| 0:380 | 314 | 948 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object675_glassmat_0 |
| 0:387 | 1,612 | 4,746 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_Material #5511_0 |
| 0:396 | 124 | 156 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_glass_transp_0 |
| 0:410 | 417 | 957 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_alpha_glass_0 |
| 0:420 | 300 | 444 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_Material #5512_0 |
| 0:436 | 14 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object706_Material #5518_0 |
| 0:450 | 14 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object706_Material #5518_0 |
| 0:464 | 14 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object706_Material #5518_0 |
| 0:478 | 14 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object706_Material #5518_0 |

✔ Camera from draw 0:6's projection uniform (no view matrix): perspective, vertical field of view 40.0°, aspect 1.600, near 1.00, far 100.

✔ Geometry and matrices are read from the recording. ≈ A vertex shader can move vertices further (displacement, skinning, morphs, particles on textures): those moves are not baked into the glTF; the replay keeps them.
