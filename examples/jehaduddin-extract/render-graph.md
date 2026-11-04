# Render graph of https://jehaduddin.vercel.app

Recorded live by DEA: 2 consecutive frames of the site's WebGL2 context (1440×900 drawing buffer), every call with its arguments, and every buffer, texture, program and render target as it was when the frames began. The replay (`replay/replay.js`) runs exactly these calls, so it draws what the site drew.

✔ Verified = read from the recording (target, programs, draws, inputs, blend, depth). ≈ Inferred = the role DEA reads from those facts, with why.

## Frame 1: 27 passes, 53 draws

### Pass 0: simulation step (GPGPU ping-pong) (≈)

- ✔ Target: render target 256×256 RGBA32F (tex#19)
- ✔ Programs: program #20 (uDt, uNT, uNS, uBreath, …)
- ✔ Draws: 1 (6 vertices as triangles)
- ✔ Reads: tPos ← tex#24 256×256 RGBA32F (render target); tVel ← tex#23 256×256 RGBA32F (render target); tHome ← tex#21 256×256 RGBA32F; tTrail ← tex#85 160×100 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: simulation step (GPGPU ping-pong), because a full-screen draw into a float render target that reads other render targets, with state-like uniform names

### Pass 1: simulation step (GPGPU ping-pong) (≈)

- ✔ Target: render target 256×256 RGBA32F (tex#11)
- ✔ Programs: program #15 (uDt, tPos, tVel)
- ✔ Draws: 1 (6 vertices as triangles)
- ✔ Reads: tPos ← tex#24 256×256 RGBA32F (render target); tVel ← tex#19 256×256 RGBA32F (render target)
- ✔ Blend off; depth off
- ≈ Role: simulation step (GPGPU ping-pong), because a full-screen draw into a float render target that reads other render targets, with state-like uniform names

### Pass 2: meshes (instanced) (≈)

- ✔ Target: render target 256×256 RGBA8 (tex#25)
- ✔ Programs: program #43 (uLightG, uShC, uShE, uST, …)
- ✔ Draws: 4 (107,520 vertices as triangles)
- ✔ Reads: uHgt ← tex#44 64×64 RGBA8
- ✔ Blend on (ONE, ONE, ONE, ONE); depth off
- ≈ Role: meshes (instanced), because 4 draw(s) of geometry with more than two triangles

### Pass 3: full-screen pass (≈)

- ✔ Target: render target 256×256 RGBA8 (tex#26)
- ✔ Programs: program #48 (uA, uPx, tSrc)
- ✔ Draws: 1 (6 vertices as triangles)
- ✔ Reads: tSrc ← tex#25 256×256 RGBA8 (render target)
- ✔ Blend on (SRC_ALPHA, 1-SRC_ALPHA, ONE, 1-SRC_ALPHA); depth off
- ≈ Role: full-screen pass, because a full-screen draw into a render target

### Pass 4: meshes (instanced) (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#50)
- ✔ Programs: program #71 (diffuse, opacity, fogColor, fogNear, …); program #74 (diffuse, opacity, fogColor, fogNear, …); program #315 (uPix, uOn, uForm, uSize, …); program #316 (uPix, uOn, uForm, uSize, …)
- ✔ Draws: 10 (1,052,970 vertices as triangles)
- ✔ Reads: tPos ← tex#11 256×256 RGBA32F (render target); tVel ← tex#19 256×256 RGBA32F (render target)
- ✔ Blend on (SRC_ALPHA, ONE, SRC_ALPHA, ONE); depth test on, write on
- ≈ Role: meshes (instanced), because 10 draw(s) of geometry with more than two triangles

### Pass 5: simulation step (feedback: reads its previous result) (≈)

- ✔ Target: render target 160×100 RGBA16F (tex#84)
- ✔ Programs: program #89 (uTexel, uDt, uAsp, uR, …)
- ✔ Draws: 1 (6 vertices as triangles)
- ✔ Reads: tPrev ← tex#85 160×100 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: simulation step (feedback: reads its previous result), because a full-screen draw into a render target that reads an earlier result (prev/trail/feedback names)

### Pass 6: points (particles) (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#418)
- ✔ Programs: program #118 (uOn, uRot, uNeb); program #120 (uCam, uFloor, uTime, uOn, …); program #122 (uBase, uAmp, uSeed, uSharp, …); program #123 (uL, uLC, uHero, uFloor, …); program #125 (uL, uLC, uHero, uFloor, …); program #127 (uCore, uST, uShape, uPieces, …); program #128 (uL, uLC, uHero, uFloor, …); program #129 (rotation, center, mapTransform, diffuse, …); program #132 (uTime, uSize, uFade, uAspect, …); program #133 (uTime, uFade, uSize, uDpr); program #134 (uTime, uFloor, uOn, uPix, …); program #135 (tCloud)
- ✔ Draws: 15 (667,428 vertices as triangles, 6,160 vertices as points)
- ✔ Reads: uNeb ← tex#5 768×768 RGBA8; uDetail ← tex#124 256×256 RGBA8; uRockSh ← tex#26 256×256 RGBA8 (render target); uHgt ← tex#44 64×64 RGBA8; map ← tex#130 256×256 SRGB8_ALPHA8; tCloud ← tex#50 1440×900 RGBA16F (render target)
- ✔ Blend on (SRC_ALPHA, ONE, SRC_ALPHA, ONE); depth test on, write off
- ≈ Role: points (particles), because 3 draw(s) of gl.POINTS

### Pass 7: bloom / blur (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#140)
- ✔ Programs: LuminanceMaterial #143 (threshold, smoothing, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#418 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 8: bloom (downsample) (≈)

- ✔ Target: render target 720×450 RGBA16F (tex#144)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#140 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 9: bloom (downsample) (≈)

- ✔ Target: render target 360×225 RGBA16F (tex#146)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#144 720×450 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 10: bloom (downsample) (≈)

- ✔ Target: render target 180×113 RGBA16F (tex#147)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#146 360×225 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 11: bloom (downsample) (≈)

- ✔ Target: render target 90×57 RGBA16F (tex#148)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#147 180×113 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 12: bloom (downsample) (≈)

- ✔ Target: render target 45×29 RGBA16F (tex#149)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#148 90×57 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 13: bloom (downsample) (≈)

- ✔ Target: render target 23×15 RGBA16F (tex#150)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#149 45×29 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 14: bloom (downsample) (≈)

- ✔ Target: render target 12×8 RGBA16F (tex#151)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#150 23×15 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 15: bloom (downsample) (≈)

- ✔ Target: render target 6×4 RGBA16F (tex#152)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#151 12×8 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 16: bloom / blur (≈)

- ✔ Target: render target 12×8 RGBA16F (tex#153)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#152 6×4 RGBA16F (render target); supportBuffer ← tex#151 12×8 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 17: bloom / blur (≈)

- ✔ Target: render target 23×15 RGBA16F (tex#155)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#153 12×8 RGBA16F (render target); supportBuffer ← tex#150 23×15 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 18: bloom / blur (≈)

- ✔ Target: render target 45×29 RGBA16F (tex#156)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#155 23×15 RGBA16F (render target); supportBuffer ← tex#149 45×29 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 19: bloom / blur (≈)

- ✔ Target: render target 90×57 RGBA16F (tex#157)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#156 45×29 RGBA16F (render target); supportBuffer ← tex#148 90×57 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 20: bloom / blur (≈)

- ✔ Target: render target 180×113 RGBA16F (tex#158)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#157 90×57 RGBA16F (render target); supportBuffer ← tex#147 180×113 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 21: bloom / blur (≈)

- ✔ Target: render target 360×225 RGBA16F (tex#159)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#158 180×113 RGBA16F (render target); supportBuffer ← tex#146 360×225 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 22: bloom / blur (≈)

- ✔ Target: render target 720×450 RGBA16F (tex#160)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#159 360×225 RGBA16F (render target); supportBuffer ← tex#144 720×450 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 23: simulation step (feedback: reads its previous result) (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#161)
- ✔ Programs: EffectMaterial #163 (resolution, texelSize, cameraNear, cameraFar, …)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#418 1440×900 RGBA16F (render target); e1Map ← tex#160 720×450 RGBA16F (render target); depthBuffer ← tex#419 1440×900 DEPTH24; e0TTrail ← tex#84 160×100 RGBA16F (render target); e3TBlue ← tex#169 64×64 RGBA8
- ✔ Blend off; depth off
- ≈ Role: simulation step (feedback: reads its previous result), because a full-screen draw into a render target that reads an earlier result (prev/trail/feedback names)

### Pass 24: full-screen pass (≈)

- ✔ Target: render target 1440×900 RGBA8 (tex#164)
- ✔ Programs: EdgeDetectionMaterial #165 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#161 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: full-screen pass, because a full-screen draw into a render target

### Pass 25: SMAA anti-aliasing (≈)

- ✔ Target: render target 1440×900 RGBA8 (tex#166)
- ✔ Programs: SMAAWeightsMaterial #167 (texelSize, resolution, inputBuffer, areaTexture, …)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#164 1440×900 RGBA8 (render target); areaTexture ← tex#170 160×560 RGBA8; searchTexture ← tex#171 64×16 RGBA8
- ✔ Blend off; depth off
- ≈ Role: SMAA anti-aliasing, because SMAA textures or names in the program

### Pass 26: composite to screen (≈)

- ✔ Target: screen 1440×900
- ✔ Programs: EffectMaterial #168 (texelSize, e0BlendOpacity, inputBuffer, e0WeightMap)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#161 1440×900 RGBA16F (render target); e0WeightMap ← tex#166 1440×900 RGBA8 (render target)
- ✔ Blend off; depth off
- ≈ Role: composite to screen, because a full-screen draw into the canvas

## Frame 2: 27 passes, 53 draws

### Pass 27: simulation step (GPGPU ping-pong) (≈)

- ✔ Target: render target 256×256 RGBA32F (tex#23)
- ✔ Programs: program #20 (uDt, uNT, uNS, uBreath, …)
- ✔ Draws: 1 (6 vertices as triangles)
- ✔ Reads: tPos ← tex#11 256×256 RGBA32F (render target); tVel ← tex#19 256×256 RGBA32F (render target); tHome ← tex#21 256×256 RGBA32F; tTrail ← tex#84 160×100 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: simulation step (GPGPU ping-pong), because a full-screen draw into a float render target that reads other render targets, with state-like uniform names

### Pass 28: simulation step (GPGPU ping-pong) (≈)

- ✔ Target: render target 256×256 RGBA32F (tex#24)
- ✔ Programs: program #15 (uDt, tPos, tVel)
- ✔ Draws: 1 (6 vertices as triangles)
- ✔ Reads: tPos ← tex#11 256×256 RGBA32F (render target); tVel ← tex#23 256×256 RGBA32F (render target)
- ✔ Blend off; depth off
- ≈ Role: simulation step (GPGPU ping-pong), because a full-screen draw into a float render target that reads other render targets, with state-like uniform names

### Pass 29: meshes (instanced) (≈)

- ✔ Target: render target 256×256 RGBA8 (tex#25)
- ✔ Programs: program #43 (uLightG, uShC, uShE, uST, …)
- ✔ Draws: 4 (107,520 vertices as triangles)
- ✔ Reads: uHgt ← tex#44 64×64 RGBA8
- ✔ Blend on (ONE, ONE, ONE, ONE); depth off
- ≈ Role: meshes (instanced), because 4 draw(s) of geometry with more than two triangles

### Pass 30: full-screen pass (≈)

- ✔ Target: render target 256×256 RGBA8 (tex#26)
- ✔ Programs: program #48 (uA, uPx, tSrc)
- ✔ Draws: 1 (6 vertices as triangles)
- ✔ Reads: tSrc ← tex#25 256×256 RGBA8 (render target)
- ✔ Blend on (SRC_ALPHA, 1-SRC_ALPHA, ONE, 1-SRC_ALPHA); depth off
- ≈ Role: full-screen pass, because a full-screen draw into a render target

### Pass 31: meshes (instanced) (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#50)
- ✔ Programs: program #71 (diffuse, opacity, fogColor, fogNear, …); program #74 (diffuse, opacity, fogColor, fogNear, …); program #315 (uPix, uOn, uForm, uSize, …); program #316 (uPix, uOn, uForm, uSize, …)
- ✔ Draws: 10 (1,052,970 vertices as triangles)
- ✔ Reads: tPos ← tex#24 256×256 RGBA32F (render target); tVel ← tex#23 256×256 RGBA32F (render target)
- ✔ Blend on (SRC_ALPHA, ONE, SRC_ALPHA, ONE); depth test on, write on
- ≈ Role: meshes (instanced), because 10 draw(s) of geometry with more than two triangles

### Pass 32: simulation step (feedback: reads its previous result) (≈)

- ✔ Target: render target 160×100 RGBA16F (tex#85)
- ✔ Programs: program #89 (uTexel, uDt, uAsp, uR, …)
- ✔ Draws: 1 (6 vertices as triangles)
- ✔ Reads: tPrev ← tex#84 160×100 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: simulation step (feedback: reads its previous result), because a full-screen draw into a render target that reads an earlier result (prev/trail/feedback names)

### Pass 33: points (particles) (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#418)
- ✔ Programs: program #118 (uOn, uRot, uNeb); program #120 (uCam, uFloor, uTime, uOn, …); program #122 (uBase, uAmp, uSeed, uSharp, …); program #123 (uL, uLC, uHero, uFloor, …); program #125 (uL, uLC, uHero, uFloor, …); program #127 (uCore, uST, uShape, uPieces, …); program #128 (uL, uLC, uHero, uFloor, …); program #129 (rotation, center, mapTransform, diffuse, …); program #132 (uTime, uSize, uFade, uAspect, …); program #133 (uTime, uFade, uSize, uDpr); program #134 (uTime, uFloor, uOn, uPix, …); program #135 (tCloud)
- ✔ Draws: 15 (667,428 vertices as triangles, 6,160 vertices as points)
- ✔ Reads: uNeb ← tex#5 768×768 RGBA8; uDetail ← tex#124 256×256 RGBA8; uRockSh ← tex#26 256×256 RGBA8 (render target); uHgt ← tex#44 64×64 RGBA8; map ← tex#130 256×256 SRGB8_ALPHA8; tCloud ← tex#50 1440×900 RGBA16F (render target)
- ✔ Blend on (SRC_ALPHA, ONE, SRC_ALPHA, ONE); depth test on, write off
- ≈ Role: points (particles), because 3 draw(s) of gl.POINTS

### Pass 34: bloom / blur (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#140)
- ✔ Programs: LuminanceMaterial #143 (threshold, smoothing, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#418 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 35: bloom (downsample) (≈)

- ✔ Target: render target 720×450 RGBA16F (tex#144)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#140 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 36: bloom (downsample) (≈)

- ✔ Target: render target 360×225 RGBA16F (tex#146)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#144 720×450 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 37: bloom (downsample) (≈)

- ✔ Target: render target 180×113 RGBA16F (tex#147)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#146 360×225 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 38: bloom (downsample) (≈)

- ✔ Target: render target 90×57 RGBA16F (tex#148)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#147 180×113 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 39: bloom (downsample) (≈)

- ✔ Target: render target 45×29 RGBA16F (tex#149)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#148 90×57 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 40: bloom (downsample) (≈)

- ✔ Target: render target 23×15 RGBA16F (tex#150)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#149 45×29 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 41: bloom (downsample) (≈)

- ✔ Target: render target 12×8 RGBA16F (tex#151)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#150 23×15 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 42: bloom (downsample) (≈)

- ✔ Target: render target 6×4 RGBA16F (tex#152)
- ✔ Programs: DownsamplingMaterial #145 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#151 12×8 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 43: bloom / blur (≈)

- ✔ Target: render target 12×8 RGBA16F (tex#153)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#152 6×4 RGBA16F (render target); supportBuffer ← tex#151 12×8 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 44: bloom / blur (≈)

- ✔ Target: render target 23×15 RGBA16F (tex#155)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#153 12×8 RGBA16F (render target); supportBuffer ← tex#150 23×15 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 45: bloom / blur (≈)

- ✔ Target: render target 45×29 RGBA16F (tex#156)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#155 23×15 RGBA16F (render target); supportBuffer ← tex#149 45×29 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 46: bloom / blur (≈)

- ✔ Target: render target 90×57 RGBA16F (tex#157)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#156 45×29 RGBA16F (render target); supportBuffer ← tex#148 90×57 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 47: bloom / blur (≈)

- ✔ Target: render target 180×113 RGBA16F (tex#158)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#157 90×57 RGBA16F (render target); supportBuffer ← tex#147 180×113 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 48: bloom / blur (≈)

- ✔ Target: render target 360×225 RGBA16F (tex#159)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#158 180×113 RGBA16F (render target); supportBuffer ← tex#146 360×225 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 49: bloom / blur (≈)

- ✔ Target: render target 720×450 RGBA16F (tex#160)
- ✔ Programs: UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#159 360×225 RGBA16F (render target); supportBuffer ← tex#144 720×450 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 50: simulation step (feedback: reads its previous result) (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#161)
- ✔ Programs: EffectMaterial #163 (resolution, texelSize, cameraNear, cameraFar, …)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#418 1440×900 RGBA16F (render target); e1Map ← tex#160 720×450 RGBA16F (render target); depthBuffer ← tex#419 1440×900 DEPTH24; e0TTrail ← tex#85 160×100 RGBA16F (render target); e3TBlue ← tex#169 64×64 RGBA8
- ✔ Blend off; depth off
- ≈ Role: simulation step (feedback: reads its previous result), because a full-screen draw into a render target that reads an earlier result (prev/trail/feedback names)

### Pass 51: full-screen pass (≈)

- ✔ Target: render target 1440×900 RGBA8 (tex#164)
- ✔ Programs: EdgeDetectionMaterial #165 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#161 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: full-screen pass, because a full-screen draw into a render target

### Pass 52: SMAA anti-aliasing (≈)

- ✔ Target: render target 1440×900 RGBA8 (tex#166)
- ✔ Programs: SMAAWeightsMaterial #167 (texelSize, resolution, inputBuffer, areaTexture, …)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#164 1440×900 RGBA8 (render target); areaTexture ← tex#170 160×560 RGBA8; searchTexture ← tex#171 64×16 RGBA8
- ✔ Blend off; depth off
- ≈ Role: SMAA anti-aliasing, because SMAA textures or names in the program

### Pass 53: composite to screen (≈)

- ✔ Target: screen 1440×900
- ✔ Programs: EffectMaterial #168 (texelSize, e0BlendOpacity, inputBuffer, e0WeightMap)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#161 1440×900 RGBA16F (render target); e0WeightMap ← tex#166 1440×900 RGBA8 (render target)
- ✔ Blend off; depth off
- ≈ Role: composite to screen, because a full-screen draw into the canvas

## Programs

| program | own uniforms | samplers | draws |
|---|---|---|---|
| EffectMaterial #168 (texelSize, e0BlendOpacity, inputBuffer, e0WeightMap) | texelSize, e0BlendOpacity, inputBuffer, e0WeightMap | inputBuffer, e0WeightMap | 2 |
| program #20 (uDt, uNT, uNS, uBreath, …) | uDt, uNT, uNS, uBreath, uFlow, uStir, uR, uK, uRo, uRd, uRv, uTrailOn, uTrailK, uTanF, uAsp, uVP, uCR, uCU, tPos, tVel, tHome, tTrail | tPos, tVel, tHome, tTrail | 2 |
| program #15 (uDt, tPos, tVel) | uDt, tPos, tVel | tPos, tVel | 2 |
| program #43 (uLightG, uShC, uShE, uST, …) | uLightG, uShC, uShE, uST, uShape, uPieces, uLoop, uAx, uHgtE, uHgt | uHgt | 8 |
| program #48 (uA, uPx, tSrc) | uA, uPx, tSrc | tSrc | 2 |
| program #71 (diffuse, opacity, fogColor, fogNear, …) | diffuse, opacity, fogColor, fogNear, fogFar | – | 4 |
| program #74 (diffuse, opacity, fogColor, fogNear, …) | diffuse, opacity, fogColor, fogNear, fogFar | – | 12 |
| program #315 (uPix, uOn, uForm, uSize, …) | uPix, uOn, uForm, uSize, uFocus, uStretch, uHaze, uBright, uBeam, uPixV, uOff, tPos, tVel | tPos, tVel | 2 |
| program #316 (uPix, uOn, uForm, uSize, …) | uPix, uOn, uForm, uSize, uFocus, uStretch, uHaze, uBright, uBeam, uPixV, uOff, tPos, tVel | tPos, tVel | 2 |
| program #89 (uTexel, uDt, uAsp, uR, …) | uTexel, uDt, uAsp, uR, uSplat, uVort, uDecV, uDecD, uA, uB, uV, tPrev | tPrev | 2 |
| program #118 (uOn, uRot, uNeb) | uOn, uRot, uNeb | uNeb | 2 |
| program #120 (uCam, uFloor, uTime, uOn, …) | uCam, uFloor, uTime, uOn, uBuild, uCore, uColI, uCoreI, uMist, uColC | – | 2 |
| program #122 (uBase, uAmp, uSeed, uSharp, …) | uBase, uAmp, uSeed, uSharp, uOn, uFloor, uTime, uL, uLC, uCenter, uCam, uCore, uColI, uCoreI, uMist, uColC | – | 2 |
| program #123 (uL, uLC, uHero, uFloor, …) | uL, uLC, uHero, uFloor, uOn, uShadow, uCam, uTime, uPool, uBuild, uCore, uColI, uCoreI, uMist, uColC, uRockShB, uDetail, uRockSh | uDetail, uRockSh | 2 |
| program #125 (uL, uLC, uHero, uFloor, …) | uL, uLC, uHero, uFloor, uOn, uShadow, uCam, uTime, uPool, uBuild, uCore, uColI, uCoreI, uMist, uColC, uRockShB, uDetail, uRockSh | uDetail, uRockSh | 2 |
| program #127 (uCore, uST, uShape, uPieces, …) | uCore, uST, uShape, uPieces, uLoop, uAx, uHgtE, uL, uLC, uHero, uFloor, uOn, uCam, uTime, uPool, uBuild, uColI, uCoreI, uMist, uColC, uHgt | uHgt | 8 |
| program #128 (uL, uLC, uHero, uFloor, …) | uL, uLC, uHero, uFloor, uOn, uShadow, uCam, uTime, uPool, uBuild, uCore, uColI, uCoreI, uMist, uColC, uRockShB, uDetail, uRockSh | uDetail, uRockSh | 2 |
| program #129 (rotation, center, mapTransform, diffuse, …) | rotation, center, mapTransform, diffuse, opacity, fogColor, fogNear, fogFar, map | map | 2 |
| program #132 (uTime, uSize, uFade, uAspect, …) | uTime, uSize, uFade, uAspect, uCam, uPtr, uPtrV, uBox, uHole, uHoleOn | – | 2 |
| program #133 (uTime, uFade, uSize, uDpr) | uTime, uFade, uSize, uDpr | – | 2 |
| program #134 (uTime, uFloor, uOn, uPix, …) | uTime, uFloor, uOn, uPix, uCore, uColC | – | 2 |
| program #135 (tCloud) | tCloud | tCloud | 2 |
| LuminanceMaterial #143 (threshold, smoothing, inputBuffer) | threshold, smoothing, inputBuffer | inputBuffer | 2 |
| DownsamplingMaterial #145 (texelSize, inputBuffer) | texelSize, inputBuffer | inputBuffer | 16 |
| UpsamplingMaterial #154 (texelSize, radius, inputBuffer, supportBuffer) | texelSize, radius, inputBuffer, supportBuffer | inputBuffer, supportBuffer | 14 |
| EffectMaterial #163 (resolution, texelSize, cameraNear, cameraFar, …) | resolution, texelSize, cameraNear, cameraFar, e0BlendOpacity, e0UHole, e0UR, e0UOn, e0UAspect, e0UStreak, e0UGrain, e0UTime, e0UVig, e0UTint, e0UIncl, e0ULens, e0USpin, e0UDisc, e0URing, e0UHalo, e0UShoulder, e0UTilt, e0UDetail, e0UHoleZ, e0UDiscOut, e0UPartZ, e0UStars, e0UFlow, e0USteps, e0UReg, e0USwirl, e0USwirlN, e0UFall, e0UFallOut, e0UStreakC, e0USky, e0UGlitch, e0UTunnel, e0UDive, e0UEarly, e0UTunFlow, e0UWarp, e0UFlash, e0UDofAmt, e0UDofFocus, e0UDofMaxR, e0UTrailOn, e0UTrailAmt, e0USmear, e0UBlueOff, e1BlendOpacity, e1Intensity, e2BlendOpacity, e3BlendOpacity, e3UG, e3UTime, e3UHold, e3UAspect, e3UVeilA, e3UVeilB, e3UVeilF, e3UVeilTint, e3UBlueOff, inputBuffer, e1Map, depthBuffer, e0TTrail, e0TBlue, e3TBlue | inputBuffer, e1Map, depthBuffer, e0TTrail, e0TBlue, e3TBlue | 2 |
| EdgeDetectionMaterial #165 (texelSize, inputBuffer) | texelSize, inputBuffer | inputBuffer | 2 |
| SMAAWeightsMaterial #167 (texelSize, resolution, inputBuffer, areaTexture, …) | texelSize, resolution, inputBuffer, areaTexture, searchTexture | inputBuffer, areaTexture, searchTexture | 2 |

Change a value live: `replay.setUniform("<program label or id>", "<uniform>", value)`. Switch a pass off: `replay.setPassEnabled(<pass index>, false)`.

