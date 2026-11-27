# Render graph of https://www.igloo.inc

Recorded live by DEA: 1 consecutive frames of the site's WebGL2 context (1440×900 drawing buffer), every call with its arguments, and every buffer, texture, program and render target as it was when the frames began. The replay (`replay/replay.js`) runs exactly these calls, so it draws what the site drew.

✔ Verified = read from the recording (target, programs, draws, inputs, blend, depth). ≈ Inferred = the role DEA reads from those facts, with why.

## Frame 1: 21 passes, 47 draws

### Pass 0: meshes (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#499)
- ✔ Programs: program #258 (uColor1, uColor2, uIntroColor, uProgress); program #264 (uProgress, uProgress2, uAlpha, tNoise, …); program #266 (uProgress, uProgress2, uColor1, uColor2, …); program #268 (uProgress, uProgress2, uAlpha, tNoise, …); program #270 (uAlpha, tWind); program #272 (uMousePos, uProgress, uProgress2, uAlpha, …)
- ✔ Draws: 13 (116,028 vertices as triangles)
- ✔ Reads: tNoise ← tex#102 32×32 0x8e8d; tMap ← tex#147 2048×2048 0x8e8d; tWind ← tex#100 256×256 0x8e8d; tTriangles ← tex#101 512×512 0x8e8d; tMap ← tex#148 2048×2048 0x8e8d; tMap ← tex#149 2048×2048 0x8e8d; tGroundGlow ← tex#150 1024×1024 0x8e8d
- ✔ Blend on (SRC_ALPHA, 1-SRC_ALPHA, ONE, 1-SRC_ALPHA); depth test on, write on
- ≈ Role: meshes, because 13 draw(s) of geometry with more than two triangles

### Pass 1: downsample (≈)

- ✔ Target: render target 36×36 RGBA32F (tex#12)
- ✔ Programs: program #273 (tTexture1, tTexture2)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: tTexture1 ← tex#19 36×36 RGBA32F; tTexture2 ← tex#20 36×36 RGBA32F
- ✔ Blend off; depth test on, write on
- ≈ Role: downsample, because a full-screen draw into a target half the size of the previous one

### Pass 2: points (particles) (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#499)
- ✔ Programs: program #274 (uAlpha, tTexture1); program #282 (uShow1, uShow2, uColor, uBlink, …); program #277 (uShow1, uShow2, uColor, uBlink, …); program #279 (uShow1, uShow2, uColor, uBlink, …); program #284 (uProgress, uAlpha, diffuse, opacity); program #286 (uAlpha, uScrollAlpha, uIntroMaterialize, diffuse, …); program #287 (uSize, uColor); program #288 (uProgress, tNumbers); program #289 (uSize, uColor, tNums)
- ✔ Draws: 10 (8,178 vertices as triangles, 5,406 vertices as lines, 257 vertices as points)
- ✔ Reads: tTexture1 ← tex#12 36×36 RGBA32F (render target); tMap ← tex#42 512×1024 RGBA8; tNumbers ← tex#103 32×1024 0x8e8d; tNums ← tex#187 280×36 RGBA8
- ✔ Blend on (SRC_ALPHA, 1-SRC_ALPHA, ONE, 1-SRC_ALPHA); depth test on, write off
- ≈ Role: points (particles), because 2 draw(s) of gl.POINTS

### Pass 3: full-screen pass (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#497)
- ✔ Programs: program #501 (uLUTSize, uLUTIntensity, uGradientAlpha, tDiffuse, …)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: tDiffuse ← tex#499 1440×900 RGBA16F (render target); tLUT ← tex#502 32×32 RGBA16F
- ✔ Blend off; depth test on, write on
- ≈ Role: full-screen pass, because a full-screen draw into a render target

### Pass 4: meshes (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#524)
- ✔ Programs: program #39 (uIntro, uColor, tScene); program #85 (uColor, uShow, uRand, tMap, …); program #89 (uShow1, uShow2, uColor, tMap); program #94 (uColor, uShow, uRand, uActive, …)
- ✔ Draws: 6 (195 vertices as triangles)
- ✔ Reads: tScene ← tex#497 1440×900 RGBA16F (render target); tMap ← tex#40 128×128 RGBA8; tBlocks ← tex#41 1024×1024 RGBA8; tMap ← tex#42 512×1024 RGBA8; tMap ← tex#43 64×128 RGBA8
- ✔ Blend on (SRC_ALPHA, 1-SRC_ALPHA, ONE, 1-SRC_ALPHA); depth off
- ≈ Role: meshes, because 6 draw(s) of geometry with more than two triangles

### Pass 5: bloom / blur (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#526)
- ✔ Programs: LuminanceMaterial #529 (threshold, smoothing, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#524 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 6: bloom (downsample) (≈)

- ✔ Target: render target 720×450 RGBA16F (tex#530)
- ✔ Programs: DownsamplingMaterial #531 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#526 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 7: bloom (downsample) (≈)

- ✔ Target: render target 360×225 RGBA16F (tex#532)
- ✔ Programs: DownsamplingMaterial #531 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#530 720×450 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 8: bloom (downsample) (≈)

- ✔ Target: render target 180×113 RGBA16F (tex#533)
- ✔ Programs: DownsamplingMaterial #531 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#532 360×225 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 9: bloom (downsample) (≈)

- ✔ Target: render target 90×57 RGBA16F (tex#534)
- ✔ Programs: DownsamplingMaterial #531 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#533 180×113 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 10: bloom (downsample) (≈)

- ✔ Target: render target 45×29 RGBA16F (tex#535)
- ✔ Programs: DownsamplingMaterial #531 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#534 90×57 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 11: bloom (downsample) (≈)

- ✔ Target: render target 23×15 RGBA16F (tex#536)
- ✔ Programs: DownsamplingMaterial #531 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#535 45×29 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom (downsample), because bloom or blur names in the program

### Pass 12: bloom / blur (≈)

- ✔ Target: render target 45×29 RGBA16F (tex#537)
- ✔ Programs: UpsamplingMaterial #538 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#536 23×15 RGBA16F (render target); supportBuffer ← tex#535 45×29 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 13: bloom / blur (≈)

- ✔ Target: render target 90×57 RGBA16F (tex#539)
- ✔ Programs: UpsamplingMaterial #538 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#537 45×29 RGBA16F (render target); supportBuffer ← tex#534 90×57 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 14: bloom / blur (≈)

- ✔ Target: render target 180×113 RGBA16F (tex#540)
- ✔ Programs: UpsamplingMaterial #538 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#539 90×57 RGBA16F (render target); supportBuffer ← tex#533 180×113 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 15: bloom / blur (≈)

- ✔ Target: render target 360×225 RGBA16F (tex#541)
- ✔ Programs: UpsamplingMaterial #538 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#540 180×113 RGBA16F (render target); supportBuffer ← tex#532 360×225 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 16: bloom / blur (≈)

- ✔ Target: render target 720×450 RGBA16F (tex#542)
- ✔ Programs: UpsamplingMaterial #538 (texelSize, radius, inputBuffer, supportBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#541 360×225 RGBA16F (render target); supportBuffer ← tex#530 720×450 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: bloom / blur, because bloom or blur names in the program

### Pass 17: full-screen pass (≈)

- ✔ Target: render target 1440×900 RGBA16F (tex#543)
- ✔ Programs: EffectMaterial #545 (e0BlendOpacity, e0Intensity, inputBuffer, e0Map)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#524 1440×900 RGBA16F (render target); e0Map ← tex#542 720×450 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: full-screen pass, because a full-screen draw into a render target

### Pass 18: full-screen pass (≈)

- ✔ Target: render target 1440×900 RGBA8 (tex#546)
- ✔ Programs: EdgeDetectionMaterial #547 (texelSize, inputBuffer)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#543 1440×900 RGBA16F (render target)
- ✔ Blend off; depth off
- ≈ Role: full-screen pass, because a full-screen draw into a render target

### Pass 19: SMAA anti-aliasing (≈)

- ✔ Target: render target 1440×900 RGBA8 (tex#548)
- ✔ Programs: SMAAWeightsMaterial #549 (texelSize, resolution, inputBuffer, areaTexture, …)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#546 1440×900 RGBA8 (render target); areaTexture ← tex#550 160×560 RGBA8; searchTexture ← tex#551 64×16 RGBA8
- ✔ Blend off; depth off
- ≈ Role: SMAA anti-aliasing, because SMAA textures or names in the program

### Pass 20: composite to screen (≈)

- ✔ Target: screen 1440×900
- ✔ Programs: EffectMaterial #552 (texelSize, e0BlendOpacity, inputBuffer, e0WeightMap)
- ✔ Draws: 1 (3 vertices as triangles)
- ✔ Reads: inputBuffer ← tex#543 1440×900 RGBA16F (render target); e0WeightMap ← tex#548 1440×900 RGBA8 (render target)
- ✔ Blend off; depth off
- ≈ Role: composite to screen, because a full-screen draw into the canvas

## Programs

| program | own uniforms | samplers | draws |
|---|---|---|---|
| EffectMaterial #552 (texelSize, e0BlendOpacity, inputBuffer, e0WeightMap) | texelSize, e0BlendOpacity, inputBuffer, e0WeightMap | inputBuffer, e0WeightMap | 1 |
| program #258 (uColor1, uColor2, uIntroColor, uProgress) | uColor1, uColor2, uIntroColor, uProgress | – | 1 |
| program #264 (uProgress, uProgress2, uAlpha, tNoise, …) | uProgress, uProgress2, uAlpha, tNoise, tMap, tWind, tTriangles | tNoise, tMap, tWind, tTriangles | 1 |
| program #266 (uProgress, uProgress2, uColor1, uColor2, …) | uProgress, uProgress2, uColor1, uColor2, uAlpha, tMap, tTriangles, tNoise | tMap, tTriangles, tNoise | 3 |
| program #268 (uProgress, uProgress2, uAlpha, tNoise, …) | uProgress, uProgress2, uAlpha, tNoise, tMap, tWind, tTriangles | tNoise, tMap, tWind, tTriangles | 5 |
| program #270 (uAlpha, tWind) | uAlpha, tWind | tWind | 2 |
| program #272 (uMousePos, uProgress, uProgress2, uAlpha, …) | uMousePos, uProgress, uProgress2, uAlpha, tNoise, tMap, tWind, tGroundGlow, tTriangles | tNoise, tMap, tWind, tGroundGlow, tTriangles | 1 |
| program #273 (tTexture1, tTexture2) | tTexture1, tTexture2 | tTexture1, tTexture2 | 1 |
| program #274 (uAlpha, tTexture1) | uAlpha, tTexture1 | tTexture1 | 1 |
| program #282 (uShow1, uShow2, uColor, uBlink, …) | uShow1, uShow2, uColor, uBlink, tMap | tMap | 1 |
| program #277 (uShow1, uShow2, uColor, uBlink, …) | uShow1, uShow2, uColor, uBlink, tMap | tMap | 2 |
| program #279 (uShow1, uShow2, uColor, uBlink, …) | uShow1, uShow2, uColor, uBlink, tMap | tMap | 1 |
| program #284 (uProgress, uAlpha, diffuse, opacity) | uProgress, uAlpha, diffuse, opacity | – | 1 |
| program #286 (uAlpha, uScrollAlpha, uIntroMaterialize, diffuse, …) | uAlpha, uScrollAlpha, uIntroMaterialize, diffuse, opacity | – | 1 |
| program #287 (uSize, uColor) | uSize, uColor | – | 1 |
| program #288 (uProgress, tNumbers) | uProgress, tNumbers | tNumbers | 1 |
| program #289 (uSize, uColor, tNums) | uSize, uColor, tNums | tNums | 1 |
| program #501 (uLUTSize, uLUTIntensity, uGradientAlpha, tDiffuse, …) | uLUTSize, uLUTIntensity, uGradientAlpha, tDiffuse, tLUT | tDiffuse, tLUT | 1 |
| program #39 (uIntro, uColor, tScene) | uIntro, uColor, tScene | tScene | 1 |
| program #85 (uColor, uShow, uRand, tMap, …) | uColor, uShow, uRand, tMap, tBlocks | tMap, tBlocks | 1 |
| program #89 (uShow1, uShow2, uColor, tMap) | uShow1, uShow2, uColor, tMap | tMap | 3 |
| program #94 (uColor, uShow, uRand, uActive, …) | uColor, uShow, uRand, uActive, tMap | tMap | 1 |
| LuminanceMaterial #529 (threshold, smoothing, inputBuffer) | threshold, smoothing, inputBuffer | inputBuffer | 1 |
| DownsamplingMaterial #531 (texelSize, inputBuffer) | texelSize, inputBuffer | inputBuffer | 6 |
| UpsamplingMaterial #538 (texelSize, radius, inputBuffer, supportBuffer) | texelSize, radius, inputBuffer, supportBuffer | inputBuffer, supportBuffer | 5 |
| EffectMaterial #545 (e0BlendOpacity, e0Intensity, inputBuffer, e0Map) | e0BlendOpacity, e0Intensity, inputBuffer, e0Map | inputBuffer, e0Map | 1 |
| EdgeDetectionMaterial #547 (texelSize, inputBuffer) | texelSize, inputBuffer | inputBuffer | 1 |
| SMAAWeightsMaterial #549 (texelSize, resolution, inputBuffer, areaTexture, …) | texelSize, resolution, inputBuffer, areaTexture, searchTexture | inputBuffer, areaTexture, searchTexture | 1 |

Change a value live: `replay.setUniform("<program label or id>", "<uniform>", value)`. Switch a pass off: `replay.setPassEnabled(<pass index>, false)`.

