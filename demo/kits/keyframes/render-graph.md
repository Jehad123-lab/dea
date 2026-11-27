# Render graph of https://threejs.org/examples/webgl_animation_keyframes.html

Recorded live by DEA: 1 consecutive frames of the site's WebGL2 context (1440×900 drawing buffer), every call with its arguments, and every buffer, texture, program and render target as it was when the frames began. The replay (`replay/replay.js`) runs exactly these calls, so it draws what the site drew.

✔ Verified = read from the recording (target, programs, draws, inputs, blend, depth). ≈ Inferred = the role DEA reads from those facts, with why.

## Frame 1: 1 passes, 79 draws

### Pass 0: meshes (≈)

- ✔ Target: screen 1440×900
- ✔ Programs: SkyShader #378 (sunPosition, rayleigh, turbidity, mieCoefficient, …); outline #379 (diffuse, emissive, roughness, metalness, …); interiors #384 (mapTransform, emissiveMapTransform, diffuse, emissive, …); alpha_0 #387 (mapTransform, diffuse, emissive, roughness, …); alpha #393 (mapTransform, aoMapTransform, diffuse, emissive, …); normal #397 (mapTransform, aoMapTransform, diffuse, emissive, …); normal #427 (mapTransform, aoMapTransform, bindMatrix, bindMatrixInverse, …); Material_5511 #454 (mapTransform, diffuse, emissive, roughness, …); glass_transp #456 (aoMapTransform, diffuse, emissive, roughness, …); glass_transp #458 (aoMapTransform, diffuse, emissive, roughness, …); alpha_glass #459 (mapTransform, aoMapTransform, diffuse, emissive, …); alpha_glass #461 (mapTransform, aoMapTransform, diffuse, emissive, …); Material_5518 #463 (mapTransform, diffuse, emissive, roughness, …); Material_5518 #465 (mapTransform, diffuse, emissive, roughness, …)
- ✔ Draws: 79 (427,143 vertices as triangles)
- ✔ Reads: envMap ← tex#17 256×256 RGBA16F; dfgLUT ← tex#380 16×16 RG16F; emissiveMap ← tex#385 512×512 SRGB8_ALPHA8; map ← tex#388 1024×1024 SRGB8_ALPHA8; aoMap ← tex#394 1024×1024 RGBA8; map ← tex#398 2048×2048 SRGB8_ALPHA8; boneTexture ← tex#428 12×12 RGBA32F
- ✔ Blend on (SRC_ALPHA, 1-SRC_ALPHA, ONE, 1-SRC_ALPHA); depth test on, write off
- ≈ Role: meshes, because 79 draw(s) of geometry with more than two triangles

## Programs

| program | own uniforms | samplers | draws |
|---|---|---|---|
| Material_5518 #465 (mapTransform, diffuse, emissive, roughness, …) | mapTransform, diffuse, emissive, roughness, metalness, opacity, envMapIntensity, envMapRotation, ambientLightColor, map, envMap, dfgLUT | map, envMap, dfgLUT | 4 |
| SkyShader #378 (sunPosition, rayleigh, turbidity, mieCoefficient, …) | sunPosition, rayleigh, turbidity, mieCoefficient, mieDirectionalG, cloudScale, cloudSpeed, cloudCoverage, cloudDensity, cloudElevation, showSunDisc, time | – | 1 |
| outline #379 (diffuse, emissive, roughness, metalness, …) | diffuse, emissive, roughness, metalness, opacity, envMapIntensity, envMapRotation, ambientLightColor, envMap, dfgLUT | envMap, dfgLUT | 3 |
| interiors #384 (mapTransform, emissiveMapTransform, diffuse, emissive, …) | mapTransform, emissiveMapTransform, diffuse, emissive, roughness, metalness, opacity, envMapIntensity, envMapRotation, ambientLightColor, map, emissiveMap, envMap, dfgLUT | map, emissiveMap, envMap, dfgLUT | 1 |
| alpha_0 #387 (mapTransform, diffuse, emissive, roughness, …) | mapTransform, diffuse, emissive, roughness, metalness, opacity, alphaTest, envMapIntensity, envMapRotation, ambientLightColor, map, envMap, dfgLUT | map, envMap, dfgLUT | 4 |
| alpha #393 (mapTransform, aoMapTransform, diffuse, emissive, …) | mapTransform, aoMapTransform, diffuse, emissive, roughness, metalness, opacity, alphaTest, aoMapIntensity, envMapIntensity, envMapRotation, ambientLightColor, map, aoMap, envMap, dfgLUT | map, aoMap, envMap, dfgLUT | 2 |
| normal #397 (mapTransform, aoMapTransform, diffuse, emissive, …) | mapTransform, aoMapTransform, diffuse, emissive, roughness, metalness, opacity, aoMapIntensity, envMapIntensity, envMapRotation, ambientLightColor, map, aoMap, envMap, dfgLUT | map, aoMap, envMap, dfgLUT | 45 |
| normal #427 (mapTransform, aoMapTransform, bindMatrix, bindMatrixInverse, …) | mapTransform, aoMapTransform, bindMatrix, bindMatrixInverse, diffuse, emissive, roughness, metalness, opacity, aoMapIntensity, envMapIntensity, envMapRotation, ambientLightColor, boneTexture, map, aoMap, envMap, dfgLUT | boneTexture, map, aoMap, envMap, dfgLUT | 8 |
| Material_5511 #454 (mapTransform, diffuse, emissive, roughness, …) | mapTransform, diffuse, emissive, roughness, metalness, opacity, envMapIntensity, envMapRotation, ambientLightColor, map, envMap, dfgLUT | map, envMap, dfgLUT | 1 |
| glass_transp #456 (aoMapTransform, diffuse, emissive, roughness, …) | aoMapTransform, diffuse, emissive, roughness, metalness, opacity, aoMapIntensity, envMapIntensity, envMapRotation, ambientLightColor, aoMap, envMap, dfgLUT | aoMap, envMap, dfgLUT | 1 |
| glass_transp #458 (aoMapTransform, diffuse, emissive, roughness, …) | aoMapTransform, diffuse, emissive, roughness, metalness, opacity, aoMapIntensity, envMapIntensity, envMapRotation, ambientLightColor, aoMap, envMap, dfgLUT | aoMap, envMap, dfgLUT | 1 |
| alpha_glass #459 (mapTransform, aoMapTransform, diffuse, emissive, …) | mapTransform, aoMapTransform, diffuse, emissive, roughness, metalness, opacity, aoMapIntensity, envMapIntensity, envMapRotation, ambientLightColor, map, aoMap, envMap, dfgLUT | map, aoMap, envMap, dfgLUT | 2 |
| alpha_glass #461 (mapTransform, aoMapTransform, diffuse, emissive, …) | mapTransform, aoMapTransform, diffuse, emissive, roughness, metalness, opacity, aoMapIntensity, envMapIntensity, envMapRotation, ambientLightColor, map, aoMap, envMap, dfgLUT | map, aoMap, envMap, dfgLUT | 2 |
| Material_5518 #463 (mapTransform, diffuse, emissive, roughness, …) | mapTransform, diffuse, emissive, roughness, metalness, opacity, envMapIntensity, envMapRotation, ambientLightColor, map, envMap, dfgLUT | map, envMap, dfgLUT | 4 |

Change a value live: `replay.setUniform("<program label or id>", "<uniform>", value)`. Switch a pass off: `replay.setPassEnabled(<pass index>, false)`.

