// Turn decoded facts into files you can run: design tokens (CSS variables, a Tailwind preset, W3C tokens.json),
// motion (GSAP module, CSS keyframes), shaders (three.js RawShaderMaterial modules) and a minimal scene for
// React (react-three-fiber), vanilla three.js or a Framer code component.

import { declaredUniforms } from '../code/uniforms.ts';
import type { Driver } from '../debug/trace.ts';
import { parseShader, THREE_BUILTIN_UNIFORMS } from '../design/shaders.ts';

export type Target = 'react' | 'vanilla' | 'framer';

export interface ProgramSource {
  id: string;
  name: string;
  shaders: string[];
  samplers: Array<{
    sampler: string;
    texture: string | null;
    file: string | null;
    renderTarget: boolean;
    width: number | null;
    height: number | null;
    wrap: string;
    filter: string;
  }>;
}

export interface ShaderModule {
  name: string;
  file: string;
  fullscreen: boolean;
  points: boolean;
  uniforms: Array<{ name: string; type: string; value: string; note?: string; driver?: Driver; driverFrom?: 'trace' | 'name' }>;
  textures: Array<{ sampler: string; file: string | null; placeholder: boolean; note?: string }>;
  code: string;
  vertex: string;
  fragment: string;
}

type W3C = Record<string, Record<string, { $type: string; $value: unknown; $description?: string }>>;

const ident = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
    .join('')
    .replace(/^(\d)/, 'S$1')
    .slice(0, 40) || 'Shader';

/**
 * A readable module name for a program: the material's own name when it has one ("EffectMaterial", "fmw-fabric"),
 * else its first uniforms without the u/t prefix ("ShaderMaterial with uCore, uST, uAx" → "CoreStAxShader").
 */
export function shaderName(material: string): string {
  const m = /^(?:Raw)?ShaderMaterial with (.+)$/.exec(material);
  if (!m) return ident(material);
  const words = m[1]
    .split(/,\s*/)
    .map((u) => u.replace(/\s*\+\d+$/, '').replace(/^[ut](?=[A-Z])/, ''))
    .filter((u) => /^\w+$/.test(u))
    .slice(0, 3)
    .map((u) => (u === u.toUpperCase() ? u[0] + u.slice(1).toLowerCase() : u));
  return words.length ? `${ident(words.join(' '))}Shader` : 'Shader';
}

const cssName = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

/** tokens.json (W3C design tokens format), tokens.css (custom properties) and a Tailwind preset. */
export function tokenFiles(tokens: W3C, extra: { eases?: string[] } = {}): { json: string; css: string; tailwind: string } {
  const t: W3C = JSON.parse(JSON.stringify(tokens ?? {}));
  if (extra.eases?.length) {
    t.gsapEase = {};
    for (const e of extra.eases.slice(0, 12)) t.gsapEase[cssName(e)] = { $type: 'other', $value: e, $description: 'GSAP ease used on the site' };
  }
  const vars: string[] = [];
  const tw: Record<string, Record<string, string>> = { colors: {}, fontFamily: {}, fontSize: {}, transitionDuration: {}, transitionTimingFunction: {} };
  for (const [k, v] of Object.entries(t.color ?? {})) {
    vars.push(`  --color-${cssName(k)}: ${v.$value};`);
    tw.colors[cssName(k)] = `var(--color-${cssName(k)})`;
  }
  for (const [k, v] of Object.entries(t.fontFamily ?? {})) {
    const fam = String(v.$value);
    vars.push(`  --font-${cssName(k)}: ${/[\s]/.test(fam) ? `"${fam}"` : fam}, system-ui, sans-serif;`);
    tw.fontFamily[cssName(k)] = `var(--font-${cssName(k)})`;
  }
  for (const [k, v] of Object.entries(t.fontSize ?? {})) {
    vars.push(`  --text-${cssName(k)}: ${v.$value};`);
    tw.fontSize[cssName(k)] = `var(--text-${cssName(k)})`;
  }
  for (const [k, v] of Object.entries(t.duration ?? {})) {
    vars.push(`  --duration-${cssName(k)}: ${v.$value};`);
    tw.transitionDuration[cssName(k)] = `var(--duration-${cssName(k)})`;
  }
  for (const [k, v] of Object.entries(t.cubicBezier ?? {})) {
    vars.push(`  --ease-${cssName(k)}: cubic-bezier(${(v.$value as number[]).join(', ')});`);
    tw.transitionTimingFunction[cssName(k)] = `var(--ease-${cssName(k)})`;
  }
  const css = `/* Design tokens extracted by DEA. Values were read from the rendered page (Verified); names are DEA's. */\n:root {\n${vars.join('\n')}\n}\n\nbody {\n  ${t.color?.background ? 'background: var(--color-background);' : ''}\n  ${t.color?.text ? 'color: var(--color-text);' : ''}\n  ${t.fontFamily?.primary ? 'font-family: var(--font-primary);' : ''}\n}\n`;
  const tailwind = `// Tailwind preset extracted by DEA. Use: presets: [require('./tailwind.preset.js')] (or import it in tailwind.config.js)\n// It points at the CSS variables in tokens.css, so import tokens.css once in your app.\n/** @type {import('tailwindcss').Config} */\nexport default {\n  theme: {\n    extend: ${JSON.stringify(tw, null, 2).replace(/\n/g, '\n    ')},\n  },\n};\n`;
  return { json: `${JSON.stringify(t, null, 2)}\n`, css, tailwind };
}

/** CSS @keyframes and transition utility classes from the motion decode. */
export function keyframesCss(
  keyframes: Array<{ name: string; css: string }>,
  transitions: Array<{ property: string; duration: string; easing: string; example: string }>,
): string {
  const L = ['/* CSS motion extracted by DEA: the @keyframes the site ships, and its transition styles as classes. */', ''];
  for (const k of keyframes.slice(0, 40)) L.push(k.css, '');
  transitions.slice(0, 12).forEach((t, i) => {
    L.push(
      `/* seen on ${t.example} */`,
      `.dea-transition-${i + 1} {\n  transition-property: ${t.property};\n  transition-duration: ${t.duration};\n  transition-timing-function: ${t.easing};\n}`,
      '',
    );
  });
  return `${L.join('\n')}\n`;
}

const WRAP: Record<string, string> = { CLAMP_TO_EDGE: 'ClampToEdgeWrapping', REPEAT: 'RepeatWrapping', MIRRORED_REPEAT: 'MirroredRepeatWrapping' };
const FILTER: Record<string, string> = {
  NEAREST: 'NearestFilter',
  LINEAR: 'LinearFilter',
  NEAREST_MIPMAP_NEAREST: 'NearestMipmapNearestFilter',
  LINEAR_MIPMAP_NEAREST: 'LinearMipmapNearestFilter',
  NEAREST_MIPMAP_LINEAR: 'NearestMipmapLinearFilter',
  LINEAR_MIPMAP_LINEAR: 'LinearMipmapLinearFilter',
};
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

/** A uniform as DEA's live trace saw it: its last value and what drives it. */
export interface Observed {
  value: number[];
  driver: Driver;
  setBy?: string | null;
}

const num = (x: number) => String(Math.round(x * 10000) / 10000);

/** A JavaScript literal for a value the trace saw, in the uniform's GLSL type. */
export function observedLiteral(type: string, v: number[]): string | null {
  if (!v.length || v.some((x) => !Number.isFinite(x))) return null;
  switch (type) {
    case 'float':
    case 'int':
    case 'uint':
      return num(v[0]);
    case 'bool':
      return v[0] ? 'true' : 'false';
    case 'vec2':
    case 'ivec2':
      return v.length >= 2 ? `new THREE.Vector2(${num(v[0])}, ${num(v[1])})` : null;
    case 'vec3':
    case 'ivec3':
      return v.length >= 3 ? `new THREE.Vector3(${num(v[0])}, ${num(v[1])}, ${num(v[2])})` : null;
    case 'vec4':
    case 'ivec4':
      return v.length >= 4 ? `new THREE.Vector4(${v.slice(0, 4).map(num).join(', ')})` : null;
    case 'mat3':
      return v.length >= 9 ? `new THREE.Matrix3().fromArray([${v.slice(0, 9).map(num).join(', ')}])` : null;
    case 'mat4':
      return v.length >= 16 ? `new THREE.Matrix4().fromArray([${v.slice(0, 16).map(num).join(', ')}])` : null;
    default:
      return null;
  }
}

/** A driver guessed from the uniform's name when there is no trace. */
export function guessDriver(name: string, type: string): Driver | null {
  if (/time/i.test(name) && type === 'float') return { kind: 'clock', perSecond: 1, r2: 0 };
  if (/res(olution)?$|viewport/i.test(name) && type === 'vec2') return { kind: 'viewport', of: 'size' };
  if (/aspect/i.test(name) && type === 'float') return { kind: 'viewport', of: 'aspect' };
  return null;
}

function defaultValue(name: string, type: string, last: Record<string, number>, seen?: Observed): { value: string; note?: string } {
  const lit = seen ? observedLiteral(type, seen.value) : null;
  if (lit) return { value: lit, note: `✔ last value seen on the site (live trace)${seen?.setBy ? `, set by ${seen.setBy}` : ''}` };
  const v = last[name];
  switch (type) {
    case 'float':
      return v != null
        ? { value: String(Math.round(v * 10000) / 10000), note: 'last value seen on the site' }
        : { value: /time/i.test(name) ? '0' : '1', note: 'not seen: a guess' };
    case 'int':
    case 'bool':
      return { value: '0', note: 'not seen: a guess' };
    case 'vec2':
      if (/res(olution)?|size|viewport/i.test(name)) return { value: 'new THREE.Vector2(innerWidth, innerHeight)', note: 'set on resize' };
      if (/mouse|pointer/i.test(name)) return { value: 'new THREE.Vector2(0.5, 0.5)', note: 'pointer position' };
      return {
        value: v != null ? `new THREE.Vector2(${v}, ${v})` : 'new THREE.Vector2(0, 0)',
        note: v != null ? 'first component seen on the site' : 'not seen: a guess',
      };
    case 'vec3':
      if (/col(ou)?r|tint|base|light|core|glow/i.test(name)) return { value: 'new THREE.Color(1, 1, 1)', note: 'a colour: not seen, set yours' };
      return { value: 'new THREE.Vector3(0, 0, 0)', note: 'not seen: a guess' };
    case 'vec4':
      return { value: 'new THREE.Vector4(0, 0, 0, 1)', note: 'not seen: a guess' };
    case 'mat3':
      return { value: 'new THREE.Matrix3()' };
    case 'mat4':
      return { value: 'new THREE.Matrix4()' };
    default:
      return { value: 'null' };
  }
}

/** The site's own (custom) shader programs, best first: the ones with a clock and the most own uniforms. */
export function pickPrograms(programs: ProgramSource[], max = 6, prefer: Set<string> = new Set()): ProgramSource[] {
  const seen = new Set<string>();
  return programs
    .filter((p) => p.shaders.length >= 2)
    .filter((p) => {
      const frag = p.shaders.find((s) => !/gl_Position/.test(s)) ?? p.shaders[1];
      const info = parseShader({ api: 'webgl', type: 'fragment', source: frag, t: 0 } as never, 0);
      const key = p.shaders.map((s) => s.length).join(':') + p.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return info.custom === true || /^ShaderMaterial|^RawShaderMaterial|^shader with/.test(p.name);
    })
    .map((p) => {
      const own = [...declaredUniforms(p.shaders.join('\n')).keys()].filter((n) => !THREE_BUILTIN_UNIFORMS.has(n));
      return {
        p,
        score: own.length + (own.some((n) => /time/i.test(n)) ? 10 : 0) - (p.samplers.some((s) => s.renderTarget) ? 6 : 0) + (prefer.has(p.id) ? 20 : 0),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.p);
}

/** One program → a module exporting its GLSL and createMaterial(): a three.js RawShaderMaterial with the exact GLSL the site compiled. */
export function shaderModule(
  p: ProgramSource,
  o: {
    last: Record<string, number>;
    textureDir: string;
    ownAssets: boolean;
    textureName: (file: string) => string;
    /** from DEA's live trace, keyed "<program name>|<uniform>" or "<uniform>" */
    observed?: Record<string, Observed>;
  },
): ShaderModule {
  const vertex = p.shaders.find((s) => /gl_Position/.test(s)) ?? p.shaders[0];
  const fragment = p.shaders.find((s) => s !== vertex) ?? p.shaders[1];
  const name = shaderName(p.name);
  const types = declaredUniforms(`${vertex}\n${fragment}`);
  const fullscreen =
    /gl_Position\s*=\s*vec4\s*\(\s*(position|aPosition|a_position)\b/.test(vertex) || /gl_Position\s*=\s*vec4\s*\(\s*position\.xy/.test(vertex);
  const points = /gl_PointSize/.test(vertex);
  const uniforms: ShaderModule['uniforms'] = [];
  const textures: ShaderModule['textures'] = [];
  for (const [u, type] of types) {
    if (THREE_BUILTIN_UNIFORMS.has(u)) continue;
    if (/^sampler/.test(type)) {
      const s = p.samplers.find((x) => x.sampler === u);
      if (s?.renderTarget)
        textures.push({
          sampler: u,
          file: null,
          placeholder: false,
          note: 'drawn by another pass on the site (render target): wire your own WebGLRenderTarget here',
        });
      else if (s?.file)
        textures.push({
          sampler: u,
          file: `${o.textureDir}/${o.textureName(s.file)}`,
          placeholder: o.ownAssets,
          note: o.ownAssets ? `placeholder ${s.width}×${s.height}: put your own image here` : undefined,
        });
      else textures.push({ sampler: u, file: null, placeholder: false, note: 'no texture was bound when DEA watched' });
      uniforms.push({ name: u, type, value: 'null' });
      continue;
    }
    const seen = o.observed?.[`${p.name}|${u}`] ?? o.observed?.[u];
    const d = defaultValue(u, type, o.last, seen);
    const moving = seen && !['constant', 'unknown', 'animated'].includes(seen.driver.kind) ? seen.driver : null;
    const guessed = moving ? null : seen ? null : guessDriver(u, type);
    uniforms.push({
      name: u,
      type,
      value: d.value,
      note: d.note,
      ...(moving ? { driver: moving, driverFrom: 'trace' as const } : guessed ? { driver: guessed, driverFrom: 'name' as const } : {}),
    });
  }
  const s = (n: string) => p.samplers.find((x) => x.sampler === n);
  const texLines = textures
    .filter((t) => t.file)
    .map((t) => {
      const sm = s(t.sampler);
      const wrap = WRAP[sm?.wrap.split(' / ')[0] ?? ''] ?? 'ClampToEdgeWrapping';
      const filters = (sm?.filter ?? '').split(' / ');
      return `  ${t.sampler}: { file: '${t.file}', wrap: '${wrap}', minFilter: '${FILTER[filters[0]] ?? 'LinearFilter'}', magFilter: '${FILTER[filters[1]] ?? 'LinearFilter'}' },${t.placeholder ? ' // placeholder: your own image' : ''}`;
    });
  const code = `// ${p.name}: a shader program from the site, rebuilt by DEA.
// Verified: the GLSL below is exactly what the site compiled (three.js chunks already expanded), so it runs as a
// RawShaderMaterial with no changes. Inferred: uniform starting values marked "guess" and the geometry.
import * as THREE from 'three';

export const vertexShader = /* glsl */ \`${esc(vertex)}\`;

export const fragmentShader = /* glsl */ \`${esc(fragment)}\`;

/** Textures this program samples, with the wrap and filter the site used. */
export const textures = {
${texLines.join('\n')}
};

export function createMaterial(overrides = {}) {
  const loader = new THREE.TextureLoader();
  const tex = (t) => {
    const x = loader.load(t.file);
    x.wrapS = x.wrapT = THREE[t.wrap];
    x.minFilter = THREE[t.minFilter];
    x.magFilter = THREE[t.magFilter];
    return x;
  };
  return new THREE.RawShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    uniforms: {
${uniforms.map((u) => `      ${u.name}: { value: ${/^sampler/.test(u.type) ? (textures.find((t) => t.sampler === u.name)?.file ? `tex(textures.${u.name})` : 'null') : u.value} },${u.note ? ` // ${u.type}: ${u.note}` : /^sampler/.test(u.type) ? ` // ${textures.find((t) => t.sampler === u.name)?.note ?? u.type}` : ''}`).join('\n')}
      ...overrides,
    },
  });
}

${driversCode(uniforms)}
export const meta = { name: '${name}', fullscreen: ${fullscreen}, points: ${points} };
`;
  return { name, file: `shaders/${name}.js`, fullscreen, points, uniforms, textures, code, vertex, fragment };
}

/** The drivers block of a shader module: what moves each uniform on the site, and update() to apply it per frame. */
export function driversCode(uniforms: ShaderModule['uniforms']): string {
  const rows = uniforms
    .filter((u) => u.driver)
    .map(
      (u) =>
        `  ${u.name}: ${JSON.stringify(u.driver)}, // ${u.driverFrom === 'trace' ? '≈ inferred from the live trace (values against clock, scroll, pointer)' : '≈ guessed from the name'}`,
    );
  return `/** What moves each uniform on the site. Apply every frame with update(material, state). */
export const drivers = {
${rows.join('\n')}
};

/** state: { time (s), scrollY (px), pointer: { x, y } (px), width, height } */
export function update(material, state) {
  for (const [k, d] of Object.entries(drivers)) {
    const u = material.uniforms[k];
    if (!u) continue;
    if (d.kind === 'viewport' && d.of === 'size' && u.value && u.value.isVector2) {
      u.value.set(state.width, state.height);
      continue;
    }
    const v =
      d.kind === 'clock'
        ? state.time * d.perSecond
        : d.kind === 'scroll'
          ? d.scale * state.scrollY + d.offset
          : d.kind === 'pointer'
            ? d.scale * (d.axis === 'x' ? state.pointer.x : state.pointer.y) + d.offset
            : d.kind === 'viewport'
              ? d.of === 'width' ? state.width : d.of === 'height' ? state.height : state.width / state.height
              : null;
    if (v == null) continue;
    if (typeof u.value === 'number') u.value = v;
    else if (u.value && 'x' in u.value) u.value.x = v;
  }
}
`;
}

const sceneBody = (mods: ShaderModule[], indent: string) => {
  const m = mods[0];
  return [
    `const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });`,
    `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));`,
    `const size = () => [el.clientWidth || window.innerWidth, el.clientHeight || window.innerHeight];`,
    `renderer.setSize(...size());`,
    `el.appendChild(renderer.domElement);`,
    `const scene = new THREE.Scene();`,
    m?.fullscreen
      ? `const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // the site draws this program as a full-screen quad`
      : `const camera = new THREE.PerspectiveCamera(45, size()[0] / size()[1], 0.1, 100);\n${indent}camera.position.z = 3; // Inferred: the site's camera was not part of this program`,
    `const material = createMaterial();`,
    m?.points
      ? `// the program sizes points (gl_PointSize): a grid of points stands in for the site's own geometry (Inferred)\n${indent}const n = 128;\n${indent}const geo = new THREE.PlaneGeometry(2, 2, n - 1, n - 1);\n${indent}const mesh = new THREE.Points(geo, material);`
      : `const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);`,
    `scene.add(mesh);`,
    `const clock = new THREE.Clock();`,
    `const pointer = { x: 0, y: 0 };`,
    `window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });`,
    `const tick = () => {`,
    `  const t = clock.getElapsedTime();`,
    `  const [w, h] = size();`,
    `  update(material, { time: t, scrollY: window.scrollY, pointer, width: w, height: h }); // the drivers DEA saw on the site`,
    `  renderer.render(scene, camera);`,
    `};`,
    `renderer.setAnimationLoop(tick);`,
    `const onResize = () => { const [w, h] = size(); renderer.setSize(w, h); if (camera.isPerspectiveCamera) { camera.aspect = w / h; camera.updateProjectionMatrix(); } };`,
    `window.addEventListener('resize', onResize);`,
  ]
    .map((l) => indent + l)
    .join('\n');
};

/** The first screen's text as the browser laid it out (from the reference page): viewport size and boxes. */
export interface HeroLayout {
  viewport: { width: number; height: number };
  boxes: Array<{
    tag: string;
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    letterSpacing: string;
    lineHeight: string;
    color: string;
    textTransform: string;
    textAlign: string;
    opacity: number;
  }>;
  /** ✔ where the site's WebGL canvas sits on the first screen (its box, and the rounded corners of the box that clips it) */
  canvas?: { x: number; y: number; w: number; h: number; radius: string } | null;
  /** ✔ the page's own background colour (body, else html) */
  background?: string | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Each text block as an absolutely placed element in viewport units, so it scales with the window like a full-screen
 * hero. Verified: text, font, size, weight, colour and position at the reference size. Inferred: the units (the site's
 * own layout system, flex or grid, is not rebuilt).
 */
export function heroStyles(l: HeroLayout): Array<{ tag: string; text: string; style: Record<string, string> }> {
  const vw = (px: number) => `${r2((px / l.viewport.width) * 100)}vw`;
  const vh = (px: number) => `${r2((px / l.viewport.height) * 100)}vh`;
  const tags = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'span', 'a', 'li', 'small', 'strong', 'em', 'button', 'label']);
  return l.boxes.map((b) => ({
    tag: tags.has(b.tag) ? (b.tag === 'a' || b.tag === 'button' ? 'span' : b.tag) : 'div',
    text: b.text,
    style: {
      position: 'absolute',
      left: vw(b.x),
      top: vh(b.y),
      width: vw(b.w + 2),
      margin: '0',
      fontFamily: b.fontFamily,
      fontSize: `max(10px, ${vw(b.fontSize)})`,
      fontWeight: b.fontWeight,
      letterSpacing: b.letterSpacing === 'normal' ? 'normal' : b.letterSpacing,
      lineHeight: /px$/.test(b.lineHeight) ? String(r2(Number.parseFloat(b.lineHeight) / b.fontSize)) : b.lineHeight,
      color: b.color,
      textTransform: b.textTransform,
      textAlign: b.textAlign === 'start' ? 'left' : b.textAlign,
      ...(b.opacity < 1 ? { opacity: String(b.opacity) } : {}),
      whiteSpace: 'pre-wrap',
    },
  }));
}

const cssText = (st: Record<string, string>) =>
  Object.entries(st)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${v}`)
    .join('; ');
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Hero.jsx for React: the first screen's text, placed as on the site. */
export function heroJsx(l: HeroLayout): string {
  const items = heroStyles(l);
  return `// The first screen's text, placed where the site placed it (read from the live page at ${l.viewport.width}×${l.viewport.height}).
// ✔ text, fonts, sizes, weights, colours and positions. ≈ units: viewport-relative absolute placement, not the site's own flex/grid.
const items = ${JSON.stringify(items, null, 2)};
// ✔ where the site's canvas sat and the page background
const sceneCss = ${JSON.stringify(sceneCss(l, '.dea-scene'))};

export default function Hero() {
  return (
    <section style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {sceneCss && <style>{sceneCss}</style>}
      {items.map((it, i) => {
        const Tag = it.tag;
        return (
          <Tag key={i} style={it.style}>
            {it.text}
          </Tag>
        );
      })}
    </section>
  );
}
`;
}

/** CSS that puts the WebGL canvas where the site had it and paints the page background (both read from the live page). */
export function sceneCss(l: HeroLayout, selector = '#scene'): string {
  const vw = (px: number) => `${r2((px / l.viewport.width) * 100)}vw`;
  const vh = (px: number) => `${r2((px / l.viewport.height) * 100)}vh`;
  const out: string[] = [];
  if (l.background) out.push(`html, body { background: ${l.background}; }`);
  const c = l.canvas;
  if (c && (c.w < l.viewport.width * 0.98 || c.h < l.viewport.height * 0.98 || (c.radius && c.radius !== '0px')))
    out.push(
      `${selector} { inset: auto !important; left: ${vw(c.x)} !important; top: ${vh(c.y)} !important; width: ${vw(c.w)} !important; height: ${vh(c.h)} !important; border-radius: ${c.radius || '0px'}; overflow: hidden; }`,
      `${selector} canvas { width: 100% !important; height: 100% !important; display: block; }`,
    );
  return out.join('\n');
}

/** The same hero as plain HTML, for the vanilla project and the preview. */
export function heroHtml(l: HeroLayout): string {
  const css = sceneCss(l);
  return `${css ? `<style>\n${css}\n</style>\n` : ''}<section class="dea-hero" style="position: relative; width: 100vw; height: 100vh; overflow: hidden">\n${heroStyles(
    l,
  )
    .map((it) => `  <${it.tag} style="${escHtml(cssText(it.style)).replace(/"/g, '&quot;')}">${escHtml(it.text)}</${it.tag}>`)
    .join('\n')}\n</section>`;
}

/** Technique stand-ins: small, original modules DEA uses where a site's own system (e.g. a GPGPU simulation) is not rebuilt. */
export interface Standin {
  kind: 'particles';
  spread: number;
  x: number;
  y: number;
  color: string;
}

/** standins/particles.js: a soft gaussian cloud of points. Original code by DEA, not the site's. */
export function particlesStandin(): string {
  return `// ≈ Stand-in written by DEA (not the site's code): where the site runs a GPGPU particle simulation, a soft cloud of
// points in the same place and colour. Swap it for a real simulation (see "Techniques behind it" in README.md).
export function createParticles(THREE, o = {}) {
  const n = o.count ?? 24000;
  const spread = o.spread ?? 0.8;
  const pos = new Float32Array(n * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  for (let i = 0; i < n; i++) {
    pos[i * 3] = gauss() * spread * 0.55;
    pos[i * 3 + 1] = gauss() * spread * 0.45;
    pos[i * 3 + 2] = gauss() * spread * 0.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: o.size ?? 1.6,
    sizeAttenuation: false,
    color: new THREE.Color(o.color ?? '#ffffff'),
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.position.set(o.x ?? 0, o.y ?? 0, 0);
  return points;
}
`;
}

/** The files of a small runnable project for the chosen target. */
export function projectFiles(
  target: Target,
  o: {
    mods: ShaderModule[];
    title: string;
    site: string;
    threeVersion: string;
    hasMotion: boolean;
    heading: string;
    layout?: HeroLayout | null;
    standin?: Standin | null;
    /** the site's recorded frames replayed (replay/replay.js + public/replay/) instead of one shader program */
    replay?: boolean;
    /** the editable three.js rebuild of the recorded render graph (rebuild/rebuild.js + public/rebuild/) */
    rebuild?: boolean;
  },
): Record<string, string> {
  const m = o.mods[0];
  const files: Record<string, string> = {};
  // the editable rebuild needs three.js r170 or newer (render targets around existing framebuffers, per-material blend colour)
  const minor = Number(o.threeVersion.replace(/^r/, '').replace(/^0\./, '').split('.')[0]) || 170;
  const three = `^0.${o.rebuild ? Math.max(170, minor) : o.threeVersion.replace(/^r/, '')}.0`;
  if (target === 'vanilla') {
    files['scene.js'] =
      `// A minimal three.js scene that runs the site's main shader program.\nimport * as THREE from 'three';\n${m ? `import { createMaterial, update } from './${m.file}';` : ''}\n${o.standin ? "import { createParticles } from './standins/particles.js';\n" : ''}\nexport function mountScene(el = document.body) {\n${m ? sceneBody(o.mods, '  ') : '  // no custom shader program was found on the site'}\n${m && o.standin ? `  scene.add(createParticles(THREE, ${JSON.stringify({ spread: o.standin.spread, x: o.standin.x, y: o.standin.y, color: o.standin.color })})); // ≈ technique stand-in, not the site's code\n` : ''}  return () => { renderer.setAnimationLoop(null); window.removeEventListener('resize', onResize); renderer.dispose(); el.removeChild(renderer.domElement); };\n}\n`;
    files['main.js'] =
      `import './tokens/tokens.css';\nimport './motion/keyframes.css';\nimport { mountScene } from './scene.js';\n${o.hasMotion ? "import { buildMotion } from './motion/timeline.js';\n" : ''}\nmountScene(document.getElementById('scene'));\n${o.hasMotion ? 'buildMotion();\n' : ''}`;
    files['index.html'] =
      `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${o.title} (rebuilt with DEA)</title>\n    <style>html, body { margin: 0; } #scene { position: fixed; inset: 0; z-index: -1; } h1 { font-size: var(--dea-hero-size, 64px); margin: 30vh 8vw 0; }</style>\n  </head>\n  <body>\n    <div id="scene"></div>\n    ${o.layout ? heroHtml(o.layout).replace(/\n/g, '\n    ') : `<h1>${o.heading}</h1>`}\n    <script type="module" src="./main.js"></script>\n  </body>\n</html>\n`;
    files['package.json'] =
      `${JSON.stringify({ name: 'dea-extract', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { three, gsap: '^3.12.5' }, devDependencies: { vite: '^6.0.0' } }, null, 2)}\n`;
  } else if (target === 'react') {
    files['src/Scene.jsx'] =
      `// The site's main shader program in react-three-fiber.\nimport { Canvas, useFrame, useThree } from '@react-three/fiber';\nimport { useMemo } from 'react';\n${m ? `import { createMaterial, update } from '../${m.file}';` : ''}\n\nconst pointer = { x: 0, y: 0 };\nif (typeof window !== 'undefined') window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; });\n\nfunction ShaderMesh() {\n  const material = useMemo(() => ${m ? 'createMaterial()' : 'null'}, []);\n  const size = useThree((s) => s.size);\n  useFrame(({ clock }) => {\n    if (!material) return;\n    // the drivers DEA saw on the site: clock, scroll, pointer, viewport\n    ${m ? 'update(material, { time: clock.getElapsedTime(), scrollY: window.scrollY, pointer, width: size.width, height: size.height });' : ''}\n  });\n  if (!material) return null;\n  return ${m?.points ? '<points material={material}><planeGeometry args={[2, 2, 127, 127]} /></points>' : '<mesh material={material}><planeGeometry args={[2, 2]} /></mesh>'};\n}\n\n${o.standin ? `import * as THREE from 'three';\nimport { createParticles } from '../standins/particles.js';\n\n// ≈ technique stand-in (not the site's code)\nfunction Particles() {\n  const points = useMemo(() => createParticles(THREE, ${JSON.stringify({ spread: o.standin.spread, x: o.standin.x, y: o.standin.y, color: o.standin.color })}), []);\n  return <primitive object={points} />;\n}\n\n` : ''}export default function Scene() {\n  return (\n    <Canvas ${m?.fullscreen ? 'orthographic camera={{ left: -1, right: 1, top: 1, bottom: -1, near: 0, far: 1 }}' : 'camera={{ position: [0, 0, 3], fov: 45 }}'} className="dea-scene" style={{ position: 'fixed', inset: 0, zIndex: -1 }}>\n      <ShaderMesh />\n${o.standin ? '      <Particles />\n' : ''}    </Canvas>\n  );\n}\n`;
    files['src/App.jsx'] =
      `import { useEffect } from 'react';\nimport Scene from './Scene.jsx';\n${o.layout ? "import Hero from './Hero.jsx';\n" : ''}import '../tokens/tokens.css';\nimport '../motion/keyframes.css';\n${o.hasMotion ? "import { buildMotion } from '../motion/timeline.js';\n" : ''}\nexport default function App() {\n  ${o.hasMotion ? 'useEffect(() => { const tls = buildMotion(); return () => tls.forEach((t) => t.kill()); }, []);' : ''}\n  return (\n    <>\n      <Scene />\n      ${o.layout ? '<Hero />' : `<h1 style={{ fontSize: 'var(--dea-hero-size, 64px)', margin: '30vh 8vw 0' }}>${o.heading}</h1>`}\n    </>\n  );\n}\n`;
    if (o.layout) files['src/Hero.jsx'] = heroJsx(o.layout);
    files['src/main.jsx'] =
      `import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\n\ncreateRoot(document.getElementById('root')).render(<App />);\n`;
    files['index.html'] =
      `<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${o.title} (rebuilt with DEA)</title><style>html, body { margin: 0; }</style></head>\n  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>\n`;
    files['vite.config.js'] =
      `import react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\n\nexport default defineConfig({ plugins: [react()] });\n`;
    files['package.json'] =
      `${JSON.stringify({ name: 'dea-extract', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { three, gsap: '^3.12.5', react: '^19.0.0', 'react-dom': '^19.0.0', '@react-three/fiber': '^9.0.0' }, devDependencies: { vite: '^6.0.0', '@vitejs/plugin-react': '^4.3.0' } }, null, 2)}\n`;
  } else {
    // Framer code component: three from a URL import (Framer resolves https imports), shader inline
    files['DeaScene.tsx'] = `// A Framer code component that runs the site's main shader program. Paste into a new Code File in Framer.
// Textures: upload them to your Framer project (or any https URL) and paste the URLs in the property panel.
import { useEffect, useRef } from "react"
import { addPropertyControls, ControlType } from "framer"
import * as THREE from "https://esm.sh/three@0.${o.threeVersion.replace(/^r/, '')}.0"

const vertexShader = \`${m ? esc(m.vertex) : ''}\`
const fragmentShader = \`${m ? esc(m.fragment) : ''}\`
${m ? `\n${driversCode(m.uniforms).replace(/export /g, '')}` : ''}

export default function DeaScene(props) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        const loader = new THREE.TextureLoader()
        const uniforms: Record<string, { value: any }> = {
${(m?.uniforms ?? []).map((u) => `            ${u.name}: { value: ${/^sampler/.test(u.type) ? `props.${u.name} ? loader.load(props.${u.name}) : null` : u.value} },`).join('\n')}
        }
        const material = new THREE.RawShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true })
${m ? sceneBody(o.mods, '        ').replace('        const material = createMaterial();\n', '') : ''}
        return () => { renderer.setAnimationLoop(null); window.removeEventListener("resize", onResize); renderer.dispose(); el.removeChild(renderer.domElement) }
    }, [${(m?.textures ?? []).map((t) => `props.${t.sampler}`).join(', ')}])
    return <div ref={ref} style={{ width: "100%", height: "100%", ...props.style }} />
}

addPropertyControls(DeaScene, {
${(m?.textures ?? []).map((t) => `    ${t.sampler}: { type: ControlType.String, title: "${t.sampler}", defaultValue: "" },`).join('\n')}
})
`;
  }
  if (o.standin && target !== 'framer') files['standins/particles.js'] = particlesStandin();
  if (o.replay && target === 'vanilla')
    files['scene.js'] =
      `// The site's own WebGL frames, replayed call for call with its shaders, buffers, textures and render targets\n// (see render-graph.md for the passes). The shader modules in shaders/ are the same programs as editable three.js materials.\nimport { mountReplay } from './replay/replay.js';\n\nexport function mountScene(el = document.body) {\n  let stop = null;\n  let dead = false;\n  mountReplay(el, { base: '/replay/' }).then((s) => {\n    if (dead) s();\n    else stop = s;\n  });\n  return () => {\n    dead = true;\n    if (stop) stop();\n  };\n}\n`;
  if (o.replay && target === 'react')
    files['src/Scene.jsx'] =
      `// The site's own WebGL frames, replayed call for call with its shaders, buffers, textures and render targets\n// (see render-graph.md for the passes). replay.setUniform(...) and replay.setPassEnabled(...) change it live.\nimport { useEffect, useRef } from 'react';\nimport { mountReplay } from '../replay/replay.js';\n\nexport default function Scene() {\n  const ref = useRef(null);\n  useEffect(() => {\n    let stop = null;\n    let dead = false;\n    mountReplay(ref.current, { base: '/replay/' }).then((s) => {\n      if (dead) s();\n      else stop = s;\n    });\n    return () => {\n      dead = true;\n      if (stop) stop();\n    };\n  }, []);\n  return <div ref={ref} className="dea-scene" style={{ position: 'fixed', inset: 0, zIndex: -1 }} />;\n}\n`;
  const rebuildNote =
    "// The editable rebuild: the site's render graph as three.js objects (rebuild/rebuild.js reads public/rebuild/pipeline.json).\n// Each draw is a RawShaderMaterial with the site's GLSL (public/rebuild/shaders/), cameras and model matrices are three.js\n// matrices, framebuffers are WebGLRenderTargets. rb.uniforms[i].name.value, rb.setPassEnabled(i, false) and the shader\n// files change it. Vertex and texture bytes are recorded from the site (see rebuild.md for where).\n";
  if (o.rebuild && target === 'vanilla')
    files['scene.js'] =
      `${rebuildNote}import { mountRebuild } from './rebuild/rebuild.js';\n\nexport function mountScene(el = document.body) {\n  let rb = null;\n  let dead = false;\n  mountRebuild(el, { base: '/rebuild/' }).then((r) => {\n    rb = r;\n    if (dead) r.stop();\n  });\n  return () => {\n    dead = true;\n    if (rb) {\n      rb.stop();\n      rb.renderer.dispose();\n    }\n  };\n}\n`;
  if (o.rebuild && target === 'react')
    files['src/Scene.jsx'] =
      `${rebuildNote}import { useEffect, useRef } from 'react';\nimport { mountRebuild } from '../rebuild/rebuild.js';\n\nexport default function Scene() {\n  const ref = useRef(null);\n  useEffect(() => {\n    let rb = null;\n    let dead = false;\n    mountRebuild(ref.current, { base: '/rebuild/' }).then((r) => {\n      rb = r;\n      if (dead) r.stop();\n    });\n    return () => {\n      dead = true;\n      if (rb) {\n        rb.stop();\n        rb.renderer.dispose();\n        rb.renderer.domElement.remove();\n      }\n    };\n  }, []);\n  return <div ref={ref} className="dea-scene" style={{ position: 'fixed', inset: 0, zIndex: -1 }} />;\n}\n`;
  return files;
}

export interface PipelinePass {
  index: number;
  target: string;
  programs: string[];
  programNames: string[];
  draws: number;
  inputs: string[];
}

/**
 * pipeline.js: the render passes of one recorded frame, in order, with their render targets (size and type) and the
 * textures each pass reads. Full-screen passes run the extracted shader modules; passes that draw a scene are hooks.
 */
export function pipelineModule(
  passes: PipelinePass[],
  textures: Array<{ id: string; width: number | null; height: number | null; internalFormat: string; type: string; renderTarget: boolean }>,
  mods: Map<string, ShaderModule>,
  programs: ProgramSource[],
  site: string,
): string {
  const rtIds = [...new Set(passes.map((p) => p.target).filter((t) => t !== 'screen' && t !== 'framebuffer'))];
  const typeOf = (t: { internalFormat: string; type: string }) =>
    /32F|^FLOAT$/.test(t.internalFormat) || t.type === 'FLOAT'
      ? 'THREE.FloatType'
      : /16F|HALF/.test(t.internalFormat + t.type)
        ? 'THREE.HalfFloatType'
        : 'THREE.UnsignedByteType';
  const imports = [...new Set([...mods.values()].map((m) => m.name))];
  const L: string[] = [
    `// The render pipeline of one recorded frame of ${site}, rebuilt by DEA.`,
    '// Verified: the order of the passes, the size and type of each render target, and which textures each pass read',
    '// (recorded at the WebGL calls). Inferred: the wiring of samplers to targets below, and the scene hooks for passes',
    "// that drew the site's own meshes with library materials.",
    "import * as THREE from 'three';",
    ...imports.map((n) => `import { createMaterial as ${n}Material } from './shaders/${n}.js';`),
    '',
    'export function createPipeline(renderer, hooks = {}) {',
    '  const targets = {',
  ];
  for (const id of rtIds) {
    const t = textures.find((x) => x.id === id);
    if (!t?.width || !t.height) continue;
    L.push(`    ${id}: new THREE.WebGLRenderTarget(${t.width}, ${t.height}, { type: ${typeOf(t)}, depthBuffer: false }), // ${t.internalFormat || t.type}`);
  }
  L.push(
    '  };',
    '  const quadScene = new THREE.Scene();',
    '  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));',
    '  quadScene.add(quad);',
    '  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);',
    '  const materials = {',
  );
  for (const [pid, m] of mods) L.push(`    ${pid}: ${m.name}Material(),`);
  L.push(
    '  };',
    '  const input = (material, wiring) => {',
    '    for (const [sampler, id] of Object.entries(wiring)) if (material.uniforms[sampler] && targets[id]) material.uniforms[sampler].value = targets[id].texture;',
    '  };',
    '  const fullscreen = (material, wiring) => {',
    '    input(material, wiring);',
    '    quad.material = material;',
    '    renderer.render(quadScene, quadCamera);',
    '  };',
    '  const passes = [',
  );
  for (const p of passes.slice(0, 80)) {
    const target = p.target === 'screen' || p.target === 'framebuffer' ? 'null' : `'${p.target}'`;
    const pid = p.programs[0];
    const m = mods.get(pid);
    const prog = programs.find((x) => x.id === pid);
    const wiring: Record<string, string> = {};
    for (const s of prog?.samplers ?? []) if (s.texture && p.inputs.includes(s.texture) && targets(s.texture)) wiring[s.sampler] = s.texture;
    const label = `pass ${p.index}: ${p.programNames.slice(0, 3).join(', ')}${p.programNames.length > 3 ? '…' : ''} → ${p.target} (${p.draws} draw${p.draws > 1 ? 's' : ''})`;
    if (m?.fullscreen && p.programs.length === 1 && p.draws === 1)
      L.push(`    { target: ${target}, run: () => fullscreen(materials.${pid}, ${JSON.stringify(wiring)}) }, // ${label}`);
    else
      L.push(
        `    { target: ${target}, run: () => hooks.scene?.(renderer, { pass: ${p.index}, reads: ${JSON.stringify(p.inputs)} }) }, // ${label}: draw your scene here${m ? ` (uses materials.${pid})` : ''}`,
      );
  }
  L.push(
    '  ];',
    '  return {',
    '    targets,',
    '    materials,',
    '    passes,',
    '    render(time = performance.now() / 1000) {',
    '      for (const m of Object.values(materials)) for (const [k, u] of Object.entries(m.uniforms)) if (/time/i.test(k) && typeof u.value === "number") u.value = time;',
    '      for (const p of passes) {',
    '        renderer.setRenderTarget(p.target ? targets[p.target] ?? null : null);',
    '        p.run();',
    '      }',
    '      renderer.setRenderTarget(null);',
    '    },',
    '  };',
    '}',
    '',
  );
  return L.join('\n');
  function targets(id: string) {
    return rtIds.includes(id);
  }
}
