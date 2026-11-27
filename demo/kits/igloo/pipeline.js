// The render pipeline of one recorded frame of https://www.igloo.inc, rebuilt by DEA.
// Verified: the order of the passes, the size and type of each render target, and which textures each pass read
// (recorded at the WebGL calls). Inferred: the wiring of samplers to targets below, and the scene hooks for passes
// that drew the site's own meshes with library materials.
import * as THREE from 'three';
import { createMaterial as MousePosProgressProgress2ShaderMaterial } from './shaders/MousePosProgressProgress2Shader.js';
import { createMaterial as ProgressProgress2Color1ShaderMaterial } from './shaders/ProgressProgress2Color1Shader.js';
import { createMaterial as ProgressProgress2NoiseShaderMaterial } from './shaders/ProgressProgress2NoiseShader.js';
import { createMaterial as ProgressProgress2NoiseShader2Material } from './shaders/ProgressProgress2NoiseShader2.js';
import { createMaterial as MapBlocksColorShaderMaterial } from './shaders/MapBlocksColorShader.js';
import { createMaterial as MapColorShowShaderMaterial } from './shaders/MapColorShowShader.js';
import { createMaterial as Show1Show2MapShaderMaterial } from './shaders/Show1Show2MapShader.js';
import { createMaterial as Show1Show2MapShader2Material } from './shaders/Show1Show2MapShader2.js';
import { createMaterial as Show1Show2MapShader3Material } from './shaders/Show1Show2MapShader3.js';
import { createMaterial as Color1Color2IntroColorShaderMaterial } from './shaders/Color1Color2IntroColorShader.js';
import { createMaterial as NoiseNumbersProgressShaderMaterial } from './shaders/NoiseNumbersProgressShader.js';
import { createMaterial as SizeNumsColorShaderMaterial } from './shaders/SizeNumsColorShader.js';

export function createPipeline(renderer, hooks = {}) {
  const targets = {
    t89: new THREE.WebGLRenderTarget(1440, 900, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t11: new THREE.WebGLRenderTarget(36, 36, { type: THREE.FloatType, depthBuffer: false }), // RGBA32F
    t90: new THREE.WebGLRenderTarget(1440, 900, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t99: new THREE.WebGLRenderTarget(1440, 900, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t100: new THREE.WebGLRenderTarget(1440, 900, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t101: new THREE.WebGLRenderTarget(720, 450, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t102: new THREE.WebGLRenderTarget(360, 225, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t103: new THREE.WebGLRenderTarget(180, 113, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t104: new THREE.WebGLRenderTarget(90, 57, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t105: new THREE.WebGLRenderTarget(45, 29, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t106: new THREE.WebGLRenderTarget(23, 15, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t107: new THREE.WebGLRenderTarget(45, 29, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t108: new THREE.WebGLRenderTarget(90, 57, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t109: new THREE.WebGLRenderTarget(180, 113, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t110: new THREE.WebGLRenderTarget(360, 225, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t111: new THREE.WebGLRenderTarget(720, 450, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t112: new THREE.WebGLRenderTarget(1440, 900, { type: THREE.HalfFloatType, depthBuffer: false }), // RGBA16F
    t113: new THREE.WebGLRenderTarget(1440, 900, { type: THREE.UnsignedByteType, depthBuffer: false }), // RGBA8
    t114: new THREE.WebGLRenderTarget(1440, 900, { type: THREE.UnsignedByteType, depthBuffer: false }), // RGBA8
  };
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const materials = {
    p29: MousePosProgressProgress2ShaderMaterial(),
    p27: ProgressProgress2Color1ShaderMaterial(),
    p30: ProgressProgress2NoiseShaderMaterial(),
    p31: ProgressProgress2NoiseShader2Material(),
    p14: MapBlocksColorShaderMaterial(),
    p16: MapColorShowShaderMaterial(),
    p23: Show1Show2MapShaderMaterial(),
    p24: Show1Show2MapShader2Material(),
    p15: Show1Show2MapShader3Material(),
    p22: Color1Color2IntroColorShaderMaterial(),
    p33: NoiseNumbersProgressShaderMaterial(),
    p36: SizeNumsColorShaderMaterial(),
  };
  const input = (material, wiring) => {
    for (const [sampler, id] of Object.entries(wiring)) if (material.uniforms[sampler] && targets[id]) material.uniforms[sampler].value = targets[id].texture;
  };
  const fullscreen = (material, wiring) => {
    input(material, wiring);
    quad.material = material;
    renderer.render(quadScene, quadCamera);
  };
  const passes = [
    { target: 't89', run: () => hooks.scene?.(renderer, { pass: 1, reads: ["t48","t57","t39","t46","t55","t56","t52"] }) }, // pass 1: ShaderMaterial with uColor1, uColor2, uIntroColor, uProgress, ShaderMaterial with uProgress, uProgress2, tNoise, tMap, ShaderMaterial with uProgress, uProgress2, uColor1, uColor2… → t89 (13 draws): draw your scene here (uses materials.p22)
    { target: 't11', run: () => hooks.scene?.(renderer, { pass: 2, reads: ["t7","t8"] }) }, // pass 2: ShaderMaterial with tTexture1, tTexture2, uProjMatrix, uViewMatrix → t11 (1 draw): draw your scene here
    { target: 't89', run: () => hooks.scene?.(renderer, { pass: 3, reads: ["t11","t29","t54","t33"] }) }, // pass 3: ShaderMaterial with uCount, tTexture1, tTexture2, uMousePos, ShaderMaterial with uShow1, uShow2, tMap, uColor, ShaderMaterial with uShow1, uShow2, tMap, uColor… → t89 (10 draws): draw your scene here
    { target: 't90', run: () => hooks.scene?.(renderer, { pass: 4, reads: ["t89","t91"] }) }, // pass 4: ShaderMaterial with tDiffuse, tLUT, uLUTSize, uLUTIntensity → t90 (1 draw): draw your scene here
    { target: 't99', run: () => hooks.scene?.(renderer, { pass: 5, reads: ["t90","t27","t28","t29","t30"] }) }, // pass 5: ShaderMaterial with tScene, uIntro, uColor, ShaderMaterial with tMap, tBlocks, uColor, uColor2, ShaderMaterial with uShow1, uShow2, tMap, uColor… → t99 (6 draws): draw your scene here
    { target: 't100', run: () => hooks.scene?.(renderer, { pass: 6, reads: ["t99"] }) }, // pass 6: LuminanceMaterial → t100 (1 draw): draw your scene here
    { target: 't101', run: () => hooks.scene?.(renderer, { pass: 7, reads: ["t100"] }) }, // pass 7: DownsamplingMaterial → t101 (1 draw): draw your scene here
    { target: 't102', run: () => hooks.scene?.(renderer, { pass: 8, reads: ["t101"] }) }, // pass 8: DownsamplingMaterial → t102 (1 draw): draw your scene here
    { target: 't103', run: () => hooks.scene?.(renderer, { pass: 9, reads: ["t102"] }) }, // pass 9: DownsamplingMaterial → t103 (1 draw): draw your scene here
    { target: 't104', run: () => hooks.scene?.(renderer, { pass: 10, reads: ["t103"] }) }, // pass 10: DownsamplingMaterial → t104 (1 draw): draw your scene here
    { target: 't105', run: () => hooks.scene?.(renderer, { pass: 11, reads: ["t104"] }) }, // pass 11: DownsamplingMaterial → t105 (1 draw): draw your scene here
    { target: 't106', run: () => hooks.scene?.(renderer, { pass: 12, reads: ["t105"] }) }, // pass 12: DownsamplingMaterial → t106 (1 draw): draw your scene here
    { target: 't107', run: () => hooks.scene?.(renderer, { pass: 13, reads: ["t106","t105"] }) }, // pass 13: UpsamplingMaterial → t107 (1 draw): draw your scene here
    { target: 't108', run: () => hooks.scene?.(renderer, { pass: 14, reads: ["t107","t104"] }) }, // pass 14: UpsamplingMaterial → t108 (1 draw): draw your scene here
    { target: 't109', run: () => hooks.scene?.(renderer, { pass: 15, reads: ["t108","t103"] }) }, // pass 15: UpsamplingMaterial → t109 (1 draw): draw your scene here
    { target: 't110', run: () => hooks.scene?.(renderer, { pass: 16, reads: ["t109","t102"] }) }, // pass 16: UpsamplingMaterial → t110 (1 draw): draw your scene here
    { target: 't111', run: () => hooks.scene?.(renderer, { pass: 17, reads: ["t110","t101"] }) }, // pass 17: UpsamplingMaterial → t111 (1 draw): draw your scene here
    { target: 't112', run: () => hooks.scene?.(renderer, { pass: 18, reads: ["t99","t111"] }) }, // pass 18: EffectMaterial → t112 (1 draw): draw your scene here
    { target: 't113', run: () => hooks.scene?.(renderer, { pass: 19, reads: ["t112"] }) }, // pass 19: EdgeDetectionMaterial → t113 (1 draw): draw your scene here
    { target: 't114', run: () => hooks.scene?.(renderer, { pass: 20, reads: ["t113","t115","t116"] }) }, // pass 20: SMAAWeightsMaterial → t114 (1 draw): draw your scene here
    { target: null, run: () => hooks.scene?.(renderer, { pass: 21, reads: ["t112","t114"] }) }, // pass 21: EffectMaterial → screen (1 draw): draw your scene here
  ];
  return {
    targets,
    materials,
    passes,
    render(time = performance.now() / 1000) {
      for (const m of Object.values(materials)) for (const [k, u] of Object.entries(m.uniforms)) if (/time/i.test(k) && typeof u.value === "number") u.value = time;
      for (const p of passes) {
        renderer.setRenderTarget(p.target ? targets[p.target] ?? null : null);
        p.run();
      }
      renderer.setRenderTarget(null);
    },
  };
}
