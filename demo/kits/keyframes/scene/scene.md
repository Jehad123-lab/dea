# 3D scene recovered from https://threejs.org/examples/webgl_animation_keyframes.html

72 mesh draw(s) read back from the GPU buffers of the recorded frame and written to `public/scene/scene.glb` with their model matrices and the camera. Load it with `scene/scene.js` or open it in Blender.

| draw | vertices | indices | model matrix from | instances | model file (by vertex count) |
|---|---|---|---|---|---|
| 9:6 | 24 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object531_normal_0 |
| 9:18 | 11,027 | 27,372 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object674_outline_0 |
| 9:20 | 55,921 | 122,202 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object674_outline_0 |
| 9:25 | 3,206 | 8,898 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object675_outline_0 |
| 9:35 | 2,418 | 5,022 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object619_alpha_0 |
| 9:39 | 2,418 | 5,022 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object619_alpha_0 |
| 9:44 | 170 | 408 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object622_alpha_0 |
| 9:49 | 2,418 | 5,022 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object619_alpha_0 |
| 9:58 | 88 | 168 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_interiors_0 |
| 9:63 | 2,579 | 4,581 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object705_Material #5516_0 |
| 9:70 | 88 | 120 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_interiors_0 |
| 9:81 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:87 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:93 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:99 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:105 | 5 | 9 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › leaf_normal_0 |
| 9:110 | 17 | 72 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › hand2_normal_0 |
| 9:115 | 17 | 72 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › hand2_normal_0 |
| 9:120 | 32 | 138 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › body_normal_0 |
| 9:125 | 17 | 72 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › hand2_normal_0 |
| 9:130 | 17 | 72 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › hand2_normal_0 |
| 9:135 | 171 | 195 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire7_normal_0 |
| 9:141 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:147 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:152 | 169 | 195 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire4_normal_0 |
| 9:158 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:164 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:169 | 169 | 195 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire4_normal_0 |
| 9:174 | 155 | 540 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object081_normal_0 |
| 9:179 | 155 | 540 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object081_normal_0 |
| 9:184 | 171 | 195 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire7_normal_0 |
| 9:189 | 155 | 540 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object081_normal_0 |
| 9:194 | 72 | 138 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object532_normal_0 |
| 9:199 | 24 | 66 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object531_normal_0 |
| 9:204 | 46,938 | 87,828 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_normal_0 |
| 9:210 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:216 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:222 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:228 | 29 | 90 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:246 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 9:248 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 9:250 | 104 | 429 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_normal_0 |
| 9:252 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 9:254 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 9:256 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 9:258 | 114 | 288 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 9:274 | 19,672 | 52,050 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_metalmat_0 |
| 9:279 | 150 | 576 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object608_metalmat_0 |
| 9:284 | 516 | 1,152 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object680_metalmat_0 |
| 9:289 | 1,034 | 2,406 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object675_metalmat_0 |
| 9:294 | 516 | 1,152 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object680_metalmat_0 |
| 9:299 | 16 | 42 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object704_metalmat_0 |
| 9:304 | 158 | 612 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object689_metalmat_0 |
| 9:317 | 29 | 117 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object224_metalmat_0 |
| 9:332 | 74 | 366 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object078_Plastic_Soft_0 |
| 9:337 | 114 | 348 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object688_normal_0 |
| 9:342 | 117 | 348 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › wire2_Plastic_Soft_0 |
| 9:347 | 23,062 | 50,805 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_Plastic_Soft_0 |
| 9:352 | 154 | 384 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object704_Plastic_Soft_0 |
| 9:358 | 12,782 | 28,314 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_paintmat_0 |
| 9:363 | 51 | 180 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object608_paintmat_0 |
| 9:368 | 1,792 | 5,544 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object675_paintmat_0 |
| 9:374 | 312 | 696 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_glassmat_0 |
| 9:379 | 314 | 948 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object675_glassmat_0 |
| 9:386 | 1,612 | 4,746 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_Material #5511_0 |
| 9:395 | 124 | 156 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_glass_transp_0 |
| 9:409 | 417 | 957 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_alpha_glass_0 |
| 9:419 | 300 | 444 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object649_Material #5512_0 |
| 9:435 | 14 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object706_Material #5518_0 |
| 9:449 | 14 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object706_Material #5518_0 |
| 9:463 | 14 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object706_Material #5518_0 |
| 9:477 | 14 | 36 | the model matrix uniform | 1 | ≈ LittlestTokyo.glb › Object706_Material #5518_0 |

✔ Camera from draw 9:6's projection uniform (no view matrix): perspective, vertical field of view 40.0°, aspect 1.600, near 1.00, far 100.

✔ Geometry and matrices are read from the recording. ≈ A vertex shader can move vertices further (displacement, skinning, morphs, particles on textures): those moves are not baked into the glTF; the replay keeps them.
