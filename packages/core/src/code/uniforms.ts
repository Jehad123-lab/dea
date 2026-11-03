import { activeSource, parseShader, type RawShader, type ShaderInfo, THREE_BUILTIN_UNIFORMS } from '../design/shaders.ts';
import type { MaterialInfo } from './runtime.ts';

export interface UniformExplained {
  name: string;
  type: string;
  meaning: string;
  /** how the shader uses it, read from the code */
  usage: string[];
  /** value read from the live material, and whether it moved during 0.7 s of watching */
  live: { value: string; changed: boolean } | null;
  label: 'Verified' | 'Inferred';
}

export interface ProgramExplained {
  id: string;
  name: string;
  stage: string;
  techniques: string[];
  functions: string[];
  uniforms: UniformExplained[];
  varyings: string[];
  main: string;
  material: MaterialInfo | null;
}

const MEANINGS: Array<[RegExp, string]> = [
  [/^(u_?|i)?time$|elapsed|clock/i, 'a clock in seconds; anything multiplied by it moves on its own'],
  [/mouse|pointer|cursor/i, 'where the cursor is, so the effect follows or reacts to it'],
  [/resolution|viewport|screen(size)?$|^u?size$/i, 'the canvas size in pixels, to keep shapes round on any screen'],
  [/scroll/i, 'how far the page is scrolled, so the effect changes as you scroll'],
  [/progress|transition|mix|reveal|^u?t$/i, 'a 0→1 amount that blends between two states (a transition)'],
  [/hover|active|focus/i, 'hover/active state, usually eased between 0 and 1'],
  [/velocity|speed/i, 'speed: how fast something drifts or how strongly motion stretches it'],
  [/(texture|tex|map|image|tDiffuse|sampler|inputBuffer|scene)\d*$/i, 'an image or render input the shader reads pixels from'],
  [/colou?r|tint|hue|palette/i, 'a colour (tint) mixed into the result'],
  [/intensity|strength|amount|power|gain/i, 'how strong the effect is'],
  [/opacity|alpha/i, 'transparency'],
  [/noise|seed|random/i, 'controls the noise pattern (scale or seed)'],
  [/freq|scale|zoom|density/i, 'spatial scale or frequency of the pattern'],
  [/amp(litude)?|displace|wave/i, 'how far vertices or pixels are pushed'],
  [/aspect|ratio/i, 'width ÷ height, to correct stretching'],
  [/light|sun|dir/i, 'a light direction or position'],
  [/camera|eye|view/i, 'camera data for depth or view-dependent effects'],
  [/radius|size|thickness|width/i, 'a size in scene or screen units'],
  [/count|steps|samples|iterations/i, 'how many loop steps or samples (quality vs speed)'],
  [/audio|fft|frequency|volume/i, 'audio levels, so the visual reacts to sound'],
  [/blackhole|horizon|mass|lens|gravity/i, 'black-hole parameters (mass/horizon) for the light-bending effect'],
];

export function uniformMeaning(name: string): string | null {
  const bare = name.replace(/^(u_|u|i_)(?=[A-Z_])/, '');
  for (const [re, m] of MEANINGS) if (re.test(bare) || re.test(name)) return m;
  return null;
}

function usageLines(src: string, name: string): string[] {
  const re = new RegExp(`\\b${name}\\b`);
  return src
    .split('\n')
    .filter((l) => re.test(l) && !/^\s*uniform\b/.test(l) && !/^\s*\/\//.test(l))
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 3)
    .slice(0, 3)
    .map((l) => (l.length > 140 ? `${l.slice(0, 140)}…` : l));
}

function describeUsage(lines: string[], name: string): string {
  const all = lines.join(' ');
  const bits: string[] = [];
  if (new RegExp(`(sin|cos)\\s*\\([^)]*\\b${name}\\b`).test(all)) bits.push('drives a sine/cosine wave');
  if (new RegExp(`(snoise|noise|fbm|curl|cnoise|pnoise)\\w*\\s*\\([^;]*\\b${name}\\b`).test(all)) bits.push('moves through a noise field');
  if (new RegExp(`(texture2D|texture)\\s*\\(\\s*${name}\\b`).test(all)) bits.push('is sampled as a texture');
  if (new RegExp(`(mix|smoothstep|step)\\s*\\([^;]*\\b${name}\\b`).test(all)) bits.push('blends/thresholds between values');
  if (/gl_Position|position|transformed/.test(all)) bits.push('changes vertex positions');
  if (/gl_FragColor|pc_fragColor|outColor|diffuseColor/.test(all)) bits.push('feeds the final colour');
  return bits.join(', ');
}

/** helpers three.js writes into every program; not the author's */
const THREE_HELPERS = new Set(
  'LinearTransferOETF sRGBTransferEOTF sRGBTransferOETF linearToOutputTexel luminance pow2 pow3 pow4 max3 average saturate whiteComplement inverseTransformDirection transformDirection mat3Transpose equals packNormalToRGB unpackRGBToNormal packDepthToRGBA unpackRGBAToDepth LinearToneMapping ReinhardToneMapping CineonToneMapping ACESFilmicToneMapping AgXToneMapping NeutralToneMapping CustomToneMapping RRTAndODTFit agxDefaultContrastApprox getDistanceAttenuation getSpotAttenuation BRDF_Lambert BRDF_GGX F_Schlick D_GGX V_GGX_SmithCorrelated rand'.split(
    ' ',
  ),
);

/** All uniforms a shader declares, including comma lists ("uniform vec3 uA, uB, uC;"), with their GLSL types. */
export function declaredUniforms(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g)) {
    for (const part of m[2].split(',')) {
      const name = part.trim().replace(/\[.*$/, '');
      if (/^\w+$/.test(name)) out.set(name, m[1]);
    }
  }
  return out;
}

/** The author's own part of a shader: helper function names and main(), without three.js's prefix. */
function authorPart(src: string): { functions: string[]; main: string; varyings: string[] } {
  const a = activeSource(src);
  const functions = [...new Set([...a.matchAll(/^\s*(?:float|vec[234]|mat[234]|void|int|bool)\s+(\w+)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]))].filter(
    (f) => f !== 'main' && !THREE_HELPERS.has(f),
  );
  const varyings = [...new Set([...a.matchAll(/^\s*(?:varying|out|in)\s+(?:(?:lowp|mediump|highp|flat)\s+)*\w+\s+(v\w+)/gm)].map((m) => m[1]))];
  const at = a.search(/void\s+main\s*\(\s*(void)?\s*\)\s*\{/);
  let main = '';
  if (at >= 0) {
    let depth = 0;
    let i = a.indexOf('{', at);
    const begin = at;
    for (; i < a.length; i++) {
      if (a[i] === '{') depth++;
      else if (a[i] === '}' && --depth === 0) break;
    }
    main = a.slice(begin, i + 1);
    const ls = main.split('\n').filter((l) => l.trim() && !/^\s*#include/.test(l));
    main = ls.length > 30 ? `${ls.slice(0, 30).join('\n')}\n  // … ${ls.length - 30} more lines` : ls.join('\n');
  }
  return { functions: functions.slice(0, 20), main, varyings: varyings.slice(0, 12) };
}

/** Explain every custom (author-written) program: what it does, each uniform, and live values. */
export function explainPrograms(raw: RawShader[], materials: MaterialInfo[]): ProgramExplained[] {
  const seen = new Set<string>();
  const out: ProgramExplained[] = [];
  raw.forEach((s, i) => {
    const info: ShaderInfo = parseShader(s, i);
    if (seen.has(info.hash) || info.custom === false) return;
    seen.add(info.hash);
    const src = activeSource(s.source);
    const types = declaredUniforms(src);
    const own = [...types.keys()].filter((n) => !THREE_BUILTIN_UNIFORMS.has(n));
    const mat =
      materials.find((m) => m.name && info.threeName && m.name === info.threeName) ??
      materials.find((m) => m.customProgram && own.length > 0 && own.every((u) => m.uniforms.some((x) => x.name === u))) ??
      null;
    const { functions, main, varyings } = authorPart(s.source);
    const meshName = mat?.meshes.find((n) => !/^(Mesh|Points|Line|LineSegments|Sprite|InstancedMesh)$/.test(n));
    const techniques = [...info.techniques];
    if (own.some((n) => /^(t|u)?(Pos|Position|texturePosition)$/i.test(n)) && /gl_FragColor\s*=\s*(P|pos|p)\b|texture2D\(\s*t?(Pos|Vel)/.test(src))
      techniques.unshift('GPU particle simulation (positions/velocities stored in textures, updated each frame)');
    out.push({
      id: info.id,
      name: info.threeName || mat?.name || (meshName ? `${meshName} ${info.type} shader` : `${info.type} shader ${info.id}`),
      stage: info.type,
      techniques,
      functions,
      varyings,
      main,
      material: mat,
      uniforms: own.map((u) => {
        const usage = usageLines(src, u);
        const live = mat?.uniforms.find((x) => x.name === u) ?? null;
        const how = describeUsage(usage, u);
        const meaning = [uniformMeaning(u), how].filter(Boolean).join('; ') || 'purpose not clear from its name; see how it is used below';
        return {
          name: u,
          type: types.get(u) ?? '?',
          meaning,
          usage,
          live: live ? { value: live.value, changed: live.changed } : null,
          label: live?.changed ? 'Verified' : 'Inferred',
        };
      }),
    });
  });
  return out;
}
