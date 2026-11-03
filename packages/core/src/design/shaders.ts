import { createHash } from 'node:crypto';
import type { Fact } from '../types.ts';

export interface RawShader {
  api: string;
  type: string;
  source: string;
  t: number;
}

export interface ShaderInfo {
  id: string;
  hash: string;
  api: string;
  type: string;
  lines: number;
  chars: number;
  /** three.js writes "#define SHADER_TYPE ..." and "#define SHADER_NAME ..." into every program it builds */
  threeType: string | null;
  threeName: string | null;
  custom: boolean | null;
  origin: ShaderOrigin;
  uniforms: string[];
  techniques: string[];
  compiledAtMs: number;
}

export const THREE_BUILTIN_UNIFORMS = new Set(
  'modelMatrix modelViewMatrix projectionMatrix viewMatrix normalMatrix cameraPosition isOrthographic toneMappingExposure logDepthBufFC cameraNear cameraFar boneTexture bindMatrix bindMatrixInverse morphTargetBaseInfluence morphTargetInfluences morphTargetsTexture morphTargetsTextureSize diffuse opacity emissive roughness metalness map alphaMap envMap envMapIntensity envMapRotation flipEnvMap reflectivity ior refractionRatio lightMap lightMapIntensity aoMap aoMapIntensity normalMap normalScale bumpMap bumpScale displacementMap displacementScale displacementBias emissiveMap roughnessMap metalnessMap specularMap ambientLightColor lightProbe directionalLights pointLights spotLights hemisphereLights rectAreaLights directionalShadowMap pointShadowMap spotShadowMap fogColor fogNear fogFar fogDensity mapTransform alphaMapTransform normalMapTransform uvTransform alphaTest clearcoat clearcoatRoughness sheen sheenColor sheenRoughness transmission thickness attenuationDistance attenuationColor specularIntensity specularColor dithering size scale rotation center pointLightShadows spotLightShadows directionalLightShadows spotLightMatrix directionalShadowMatrix pointShadowMatrix shadowMap shadowBias shadowRadius matcap gradientMap'.split(
    ' ',
  ),
);

const TECHNIQUES: Array<[string, RegExp]> = [
  ['noise (simplex/perlin)', /\b(snoise|simplex\w*|perlin\w*|cnoise|pnoise|noise[234]?d?)\s*\(/i],
  ['fractal noise (fbm)', /\bfbm\s*\(/i],
  ['curl noise', /\bcurl\w*\s*\(/i],
  ['fresnel rim lighting', /fresnel/i],
  ['ray marching / SDF', /raymarch|\bMAX_STEPS\b|\bsd(Sphere|Box|Torus|Plane|Capsule)\b|\bmap\s*\(\s*vec3/i],
  ['gravitational lensing / black hole', /lensing|schwarzschild|black_?hole|accretion|event_?horizon/i],
  ['chromatic aberration / RGB shift', /chromatic|aberration|rgb_?shift/i],
  ['film grain', /\bgrain\b|filmGrain|uGrain/i],
  ['bloom', /bloom|luminosityHigh|UnrealBloom/i],
  ['blur', /\bblur\b|gaussian|kawase/i],
  ['dithering', /\bdither/i],
  ['particles (point sprites)', /gl_PointSize\s*=/],
  ['instancing', /\binstanceMatrix\b|gl_InstanceID/],
  ['skinned / skeletal animation', /\bboneMatrices\b|USE_SKINNING|skinWeight/],
  ['morph targets', /USE_MORPHTARGETS|morphTargetInfluences/],
  ['physically based lighting', /PHYSICAL|BRDF_GGX|RE_Direct_Physical/],
  ['tone mapping', /TONE_MAPPING|ACESFilmic|AgXToneMapping|NeutralToneMapping/],
  ['refraction / transmission', /USE_TRANSMISSION|refract\s*\(/],
  ['vertex displacement', /position\s*\+[^;]*\b(sin|cos|noise|snoise)\b|displacement/i],
  ['full-screen post-processing pass', /\btDiffuse\b|\binputBuffer\b|\buScene\b/],
  ['volumetric / god rays', /volumetric|godray|god_ray/i],
  ['shadows', /USE_SHADOWMAP|shadow2D|getShadow\s*\(/],
];

const INTERACTIVE: Array<[string, RegExp]> = [
  ['react to the mouse', /\bu?_?(mouse|pointer|cursor)\w*/i],
  ['react to scroll', /\bu?_?(scroll|progress)\w*/i],
  ['animate over time', /\bu?_?(time|elapsed|iTime)\b/i],
  ['react to audio', /\bu?_?(audio|fft|frequency)\w*/i],
];

/** three.js programs it builds for itself, and common addons; not the site author's own GLSL */
const THREE_INTERNAL =
  /^(PMREM\w*|SphericalGaussianBlur|EquirectangularToCubeUV|CubemapToCubeUV|BackgroundMaterial|BackgroundCubeMaterial|DepthMaterial|DistanceRGBA|ShadowMaterial|VSMPass|vsm\w*)$/i;
const THREE_ADDON =
  /^(SkyShader|Water\w*|Reflector\w*|Refractor\w*|CopyShader|OutputShader|LuminosityHighPassShader|UnrealBloom\w*|FXAAShader|SMAA\w*|Bokeh\w*|FilmShader|RGBShiftShader|VignetteShader|GammaCorrectionShader|AfterimageShader|DotScreenShader|HalftoneShader|SAOShader|SSAOShader|GTAOShader|OutlinePass\w*|BlendShader|ConvolutionShader|FocusShader|HorizontalBlurShader|VerticalBlurShader|TriangleBlurShader|Lensflare\w*|SobelOperatorShader|ToonShader\w*|Volume\w*|ColorCorrectionShader|ACESFilmicToneMappingShader|ExposureShader|BrightnessContrastShader|HueSaturationShader|KaleidoShader|MirrorShader|PixelShader|BleachBypassShader|SepiaShader|TechnicolorShader|FreiChenShader|ColorifyShader)$/i;

/**
 * Drop lines inside #ifdef/#ifndef blocks whose macro is not defined, so that
 * three.js's long prefixes (which mention instancing, skinning, etc. inside
 * inactive #ifdefs) do not look like features the page uses.
 * Complex #if expressions are kept (we cannot evaluate them safely).
 */
export function activeSource(src: string): string {
  const defined = new Set([...src.matchAll(/^\s*#define\s+(\w+)/gm)].map((m) => m[1]));
  const out: string[] = [];
  const stack: boolean[] = [];
  const on = () => stack.every(Boolean);
  for (const line of src.split('\n')) {
    const t = line.trim();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^#ifdef\s+(\w+)/))) stack.push(defined.has(m[1]));
    else if ((m = t.match(/^#ifndef\s+(\w+)/))) stack.push(!defined.has(m[1]));
    else if ((m = t.match(/^#if\s+defined\s*\(?\s*(\w+)\s*\)?\s*$/))) stack.push(defined.has(m[1]));
    else if (/^#if\b/.test(t)) stack.push(true);
    else if (/^#elif\b/.test(t)) stack[stack.length - 1] = true;
    else if (/^#else\b/.test(t)) {
      if (stack.length) stack[stack.length - 1] = !stack[stack.length - 1];
    } else if (/^#endif\b/.test(t)) stack.pop();
    else if (on()) out.push(line);
  }
  return out.join('\n');
}

/** materials from the pmndrs "postprocessing" library (EffectComposer, bloom, SMAA, ...) */
const PMNDRS_POSTPROCESSING =
  /^(LuminanceMaterial|AdaptiveLuminanceMaterial|DownsamplingMaterial|UpsamplingMaterial|EffectMaterial|EdgeDetectionMaterial|SMAAWeightsMaterial|CopyMaterial|ConvolutionMaterial|KawaseBlurMaterial|BoxBlurMaterial|GaussianBlurMaterial|TiltShiftBlurMaterial|DepthDownsamplingMaterial|DepthComparisonMaterial|DepthCopyMaterial|DepthMaskMaterial|OutlineMaterial|SSAOMaterial|BokehMaterial|CircleOfConfusionMaterial|GodRaysMaterial|MipmapBlurMaterial|ToneMappingMaterial)$/;

export type ShaderOrigin = 'custom' | 'three-builtin-material' | 'three-internal' | 'three-addon' | 'postprocessing-lib' | 'unknown';

export function parseShader(s: RawShader, i: number): ShaderInfo {
  const src = activeSource(s.source);
  const threeType = s.source.match(/#define SHADER_TYPE\s+(\w+)/)?.[1] ?? null;
  const threeName = s.source.match(/#define SHADER_NAME[ \t]+([^\n]+)/)?.[1]?.trim() || null;
  const uniforms = [...new Set([...src.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+(\w+)/g)].map((m) => m[1]))];
  let origin: ShaderOrigin = 'unknown';
  if (threeType && !/^(Raw)?ShaderMaterial$/.test(threeType)) origin = 'three-builtin-material';
  else if (threeType) {
    if (threeName && THREE_INTERNAL.test(threeName)) origin = 'three-internal';
    else if (threeName && PMNDRS_POSTPROCESSING.test(threeName)) origin = 'postprocessing-lib';
    else if (threeName && THREE_ADDON.test(threeName)) origin = 'three-addon';
    else origin = 'custom';
  } else if (!/#define SHADER_TYPE/.test(s.source)) origin = 'unknown';
  const custom = origin === 'custom' ? true : origin === 'unknown' ? null : false;
  const techniques = TECHNIQUES.filter(([, re]) => re.test(src)).map(([n]) => n);
  return {
    id: `s${String(i + 1).padStart(2, '0')}`,
    hash: createHash('sha1').update(s.source).digest('hex').slice(0, 10),
    origin,
    api: s.api,
    type: s.type,
    lines: s.source.split('\n').length,
    chars: s.source.length,
    threeType,
    threeName,
    custom,
    uniforms: uniforms.filter((u) => !THREE_BUILTIN_UNIFORMS.has(u)),
    techniques,
    compiledAtMs: s.t,
  };
}

export function summarizeShaders(raw: RawShader[]) {
  const seen = new Set<string>();
  const programs: ShaderInfo[] = [];
  raw.forEach((s, i) => {
    const info = parseShader(s, i);
    if (seen.has(info.hash)) return;
    seen.add(info.hash);
    programs.push(info);
  });
  const materials: Record<string, number> = {};
  for (const p of programs) if (p.threeType && p.type === 'fragment') materials[p.threeType] = (materials[p.threeType] ?? 0) + 1;
  const named = (o: ShaderOrigin) => [...new Set(programs.filter((p) => p.origin === o && p.threeName).map((p) => p.threeName as string))];
  const origins = {
    custom: named('custom'),
    unnamedCustom: programs.filter((p) => p.origin === 'custom' && !p.threeName && p.type === 'fragment').length,
    addons: named('three-addon'),
    postprocessing: named('postprocessing-lib'),
    internal: named('three-internal'),
  };
  const customUniforms = [...new Set(programs.filter((p) => p.custom !== false).flatMap((p) => p.uniforms))];
  const techniquesCustom = [...new Set(programs.filter((p) => p.custom !== false).flatMap((p) => p.techniques))];
  const interactivity = INTERACTIVE.filter(([, re]) => customUniforms.some((u) => re.test(u))).map(([n]) => n);
  const techniques = [...new Set(programs.flatMap((p) => p.techniques))];
  return {
    shaderCount: raw.length,
    vertex: raw.filter((s) => s.type === 'vertex').length,
    fragment: raw.filter((s) => s.type === 'fragment').length,
    wgsl: raw.filter((s) => s.type === 'wgsl').length,
    programs,
    materials,
    customPrograms: programs.filter((p) => p.custom === true && p.type === 'fragment').length,
    origins,
    customUniforms,
    interactivity,
    techniques,
    techniquesCustom,
  };
}

export type ShaderSummary = ReturnType<typeof summarizeShaders>;

export function shaderFacts(
  sum: ShaderSummary,
  contexts: Array<{
    id: string;
    type: string;
    width: number;
    height: number;
    cssWidth?: number | null;
    cssHeight?: number | null;
    pixelRatio?: number | null;
    position?: string | null;
  }>,
): Fact[] {
  const facts: Fact[] = [];
  if (contexts.length) {
    facts.push({
      key: 'webgl.contexts',
      claim: `${contexts.length} ${contexts.length === 1 ? 'canvas uses' : 'canvases use'} ${[...new Set(contexts.map((c) => c.type))].join('/')}: ${contexts
        .map(
          (c) =>
            `${c.width}×${c.height} px${c.cssWidth ? ` drawn into ${c.cssWidth}×${c.cssHeight} CSS px${c.pixelRatio ? ` (pixel ratio ${c.pixelRatio})` : ''}` : ''}${c.position === 'fixed' ? ', fixed behind/over the page' : ''}`,
        )
        .join('; ')}.`,
      value: contexts,
      label: 'Verified',
      evidence: [{ source: 'webgl', pointer: 'HTMLCanvasElement.getContext (observed)', excerpt: contexts.map((c) => c.type).join(', ') }],
    });
  }
  if (contexts.length && !sum.shaderCount) {
    facts.push({
      key: 'webgl.no-shaders',
      claim: 'A WebGL context was created but no shaders were compiled while DEA watched.',
      value: null,
      label: 'Inferred',
      evidence: [{ source: 'webgl', pointer: 'getContext observed, shaderSource never called' }],
      why: 'usually a capability check, or 3D that starts later (after a click, a preloader, or scrolling)',
    });
  }
  if (sum.shaderCount) {
    facts.push({
      key: 'webgl.shaders',
      claim: `The page compiled ${sum.shaderCount} shaders (${sum.vertex} vertex, ${sum.fragment} fragment${sum.wgsl ? `, ${sum.wgsl} WGSL` : ''}), ${sum.programs.length} unique.`,
      value: { count: sum.shaderCount, unique: sum.programs.length },
      label: 'Verified',
      evidence: [{ source: 'shader', pointer: 'shaders.json', excerpt: 'captured from shaderSource()' }],
    });
    const mats = Object.entries(sum.materials);
    if (mats.length) {
      facts.push({
        key: 'webgl.materials',
        claim: `three.js materials in use: ${mats.map(([k, v]) => `${k}${v > 1 ? ` ×${v}` : ''}`).join(', ')}.`,
        value: sum.materials,
        label: 'Verified',
        evidence: [{ source: 'shader', pointer: '#define SHADER_TYPE in compiled shaders' }],
      });
    }
    if (sum.origins.postprocessing.length) {
      facts.push({
        key: 'webgl.postprocessing',
        claim: `Post-processing runs through the pmndrs "postprocessing" library: ${sum.origins.postprocessing.join(', ')}.`,
        value: sum.origins.postprocessing,
        label: 'Inferred',
        evidence: [{ source: 'shader', pointer: '#define SHADER_NAME', excerpt: sum.origins.postprocessing.slice(0, 6).join(', ') }],
        why: 'these material names are the ones that library gives its passes',
      });
    }
    if (sum.origins.addons.length || sum.origins.internal.length) {
      facts.push({
        key: 'webgl.three-shaders',
        claim: `three.js's own shader programs: ${[...sum.origins.addons.map((n) => `${n} (addon)`), ...sum.origins.internal].join(', ')}.`,
        value: { addons: sum.origins.addons, internal: sum.origins.internal },
        label: 'Verified',
        evidence: [{ source: 'shader', pointer: '#define SHADER_NAME in compiled shaders' }],
      });
    }
    if (sum.customPrograms) {
      const names = sum.origins.custom.length ? ` (${sum.origins.custom.join(', ')})` : '';
      facts.push({
        key: 'webgl.custom',
        claim: `${sum.customPrograms} program(s) are the site's own GLSL${names}, written as three.js ShaderMaterial/RawShaderMaterial${sum.customUniforms.length ? `, with uniforms ${sum.customUniforms.slice(0, 12).join(', ')}` : ''}.`,
        value: { count: sum.customPrograms, uniforms: sum.customUniforms },
        label: 'Verified',
        evidence: [{ source: 'shader', pointer: '#define SHADER_TYPE ShaderMaterial' }],
      });
    }
    if (sum.techniques.length) {
      facts.push({
        key: 'webgl.techniques',
        claim: `Shader techniques spotted: ${sum.techniques.join(', ')}.`,
        value: sum.techniques,
        label: 'Inferred',
        evidence: sum.programs
          .filter((p) => p.techniques.length)
          .slice(0, 6)
          .map((p) => ({
            source: 'shader' as const,
            pointer: `shader ${p.id} (${p.type}${p.threeType ? `, ${p.threeType}` : ''})`,
            excerpt: p.techniques.join(', '),
          })),
        why: 'matched by function and keyword names in the shader source; names can mislead',
      });
    }
    if (sum.interactivity.length) {
      facts.push({
        key: 'webgl.interactivity',
        claim: `The site's own shaders appear to ${sum.interactivity.join(' and ')}.`,
        value: sum.interactivity,
        label: 'Inferred',
        evidence: [{ source: 'shader', pointer: 'uniform names', excerpt: sum.customUniforms.slice(0, 12).join(', ') }],
        why: 'read from uniform names like uTime or uMouse',
      });
    }
  }
  return facts;
}
