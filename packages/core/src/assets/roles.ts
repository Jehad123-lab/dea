// What a texture does in a shader, read from the sampler's name and from how the shader uses what it samples.
// Always Inferred: names and code shapes are strong signals, not proof.

const NAME_ROLES: Array<[RegExp, string]> = [
  [/areaTexture|searchTexture|smaa/i, 'SMAA anti-aliasing lookup table'],
  [/bone|skin/i, 'skinning bone matrices (an animated rig)'],
  [/blue ?noise|TBlue|bnoise/i, 'blue noise (dithering, grain, jittered sampling)'],
  [/position|pos(itions)?$|tPos|velocity|tVel|simulation|sim/i, 'GPU simulation state (positions/velocities stored in a texture)'],
  [/flow ?map|flow|uFlow|fluid/i, 'flow field (moves or distorts the image over time)'],
  [/blue ?noise|noise|perlin|simplex|grain/i, 'noise source (randomness for distortion, grain or dissolves)'],
  [/normal/i, 'surface normals (lighting detail)'],
  [/env|cube|hdr|reflection|irradiance|pmrem/i, 'environment (reflections and image-based lighting)'],
  [/matcap/i, 'matcap (baked lighting look)'],
  [/displace|height|disp/i, 'displacement / height'],
  [/mask|alpha|stencil/i, 'mask (where the effect shows)'],
  [/depth/i, 'depth buffer (post-processing reads scene depth)'],
  [/bloom|glow|luminosity/i, 'glow / bloom input'],
  [/lut|ramp|gradient|palette/i, 'colour ramp / grading table'],
  [/msdf|sdf|font|glyph|atlas/i, 'text or sprite atlas'],
  [/video/i, 'video frame'],
  [/^t?Diffuse$|prev|previous|tInput|uScene|tScene|readBuffer|inputBuffer/i, 'the previous render pass (post-processing input)'],
  [/rough|metal|ao|occlusion|emissive|specular|clearcoat|sheen|transmission/i, 'material detail (PBR map)'],
  [/^map$|^uMap$|tex|texture|image|img|photo|diffuse|albedo|color|colour|uImage/i, 'image / base colour'],
];

export function samplerRole(name: string, source = ''): string {
  for (const [re, role] of NAME_ROLES) if (re.test(name)) return role;
  for (const [re, role] of NAME_ROLES) if (source && re.test(source)) return role;
  return 'texture input';
}

/** How a sampler's result is used in the shader source: distortion, colour, mask, vertex displacement. */
export function samplerUse(name: string, shaders: string[]): string[] {
  const out = new Set<string>();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const src of shaders) {
    const isVertex = /gl_Position/.test(src) && !/gl_FragColor|out\s+vec4\s+\w+\s*;|pc_fragColor/.test(src);
    const re = new RegExp(`(?:(\\w+)\\s*=\\s*|\\b)(?:texture2D|texture|textureLod|texture2DLodEXT)\\s*\\(\\s*${esc}\\b[^;]*;`, 'g');
    for (const m of src.matchAll(re)) {
      const stmt = m[0];
      const v = m[1];
      if (isVertex) out.add('moves vertices (sampled in the vertex shader)');
      if (/\.(r|x)\b/.test(stmt) && /step|smoothstep|discard|alpha|mask/.test(stmt)) out.add('thresholded into a mask');
      if (v) {
        const after = src.slice((m.index ?? 0) + stmt.length, (m.index ?? 0) + stmt.length + 3000);
        if (new RegExp(`\\b(vUv|uv|st|coord\\w*)\\s*[+-]=?\\s*[^;]*\\b${v}\\b|\\b${v}\\b[^;]*\\*[^;]*\\b(strength|amount|intensity|distort\\w*)`).test(after))
          out.add('offsets UVs (distortion)');
        if (new RegExp(`(gl_FragColor|pc_fragColor|outColor|fragColor|diffuseColor)\\s*[*+]?=[^;]*\\b${v}\\b`).test(after)) out.add('feeds the output colour');
        if (new RegExp(`\\bmix\\s*\\([^;]*\\b${v}\\b`).test(after)) out.add('blended with mix()');
        if (new RegExp(`\\b(position|transformed|pos)\\b[^;]*[+]=?[^;]*\\b${v}\\b`).test(after)) out.add('moves vertices');
        if (/\bdiscard\b/.test(after.slice(0, 400)) && new RegExp(`\\b${v}\\b`).test(after.slice(0, 400))) out.add('cuts pixels away (discard)');
      }
      if (/\+\s*\w*time|uTime|time\s*\*/i.test(stmt)) out.add('scrolls over time');
    }
  }
  return [...out];
}

/** A readable name for a shader program from its sources (three.js writes SHADER_NAME / SHADER_TYPE). */
export function programName(shaders: string[], fallback: string): string {
  for (const s of shaders) {
    const n = /#define SHADER_NAME[ \t]+([^\s]+)/.exec(s)?.[1];
    if (n && !/^(ShaderMaterial|RawShaderMaterial)$/.test(n)) return n;
  }
  const uniforms = [...new Set(shaders.flatMap((s) => [...s.matchAll(/uniform\s+\w+\s+([ut][A-Z]\w*)/g)].map((m) => m[1])))].slice(0, 4);
  const type = shaders.map((s) => /#define SHADER_TYPE[ \t]+([^\s]+)/.exec(s)?.[1]).find(Boolean);
  if (uniforms.length) return `${type ?? 'shader'} with ${uniforms.join(', ')}`;
  return type ?? fallback;
}
