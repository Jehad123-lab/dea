# How Jehad Uddin — Creative Technologist & Design Engineer works

A teardown by DEA of https://jehaduddin.vercel.app/, 2026-11-03 14:29 UTC, in Chromium 156.0.8078.4.

✔ Verified = DEA saw it directly (runtime object, network log, source map, shader source). ≈ Inferred = a strong signal, not proof. ? Unknown = DEA could not tell, and says why.

✔ This site publishes **no source maps**. Code excerpts are from the shipped (minified) bundle, re-indented by DEA; names like `e`, `t`, `n` are the minifier's, not the author's. Strings, property names, numbers and structure are real.

## 1. The short version

- ✔ Built with Vite; shipped as 12 script files (491.0 KB app code, 1.24 MB libraries) plus 2 inline scripts.
- ✔ Stack: three.js r170, GSAP 3.15.0, React 18.3.1, Vite, Vercel, Sanity.
- ≈ Libraries found inside the bundles: Sanity client, React, GSAP, ScrollTrigger, three.js, React Three Fiber, postprocessing.
- ✔ The visuals are WebGL: three.js r170, 10 scene(s), 68 materials, 67 author-written shader stages (noise (simplex/perlin), fractal noise (fbm), GPU particle simulation (positions/velocities stored in textures, updated each frame), curl noise, instancing, blur).
- ✔ Motion: 44 GSAP calls (gsap.to/from/fromTo/set/timeline) found in the shipped code for GSAP 3.15.0; none ran while DEA watched (they start on scroll, clicks or later chapters), so section 5 lists them as written.
- ✔ Data: 1 API endpoint(s) on q3b5m2q9.apicdn.sanity.io; their content shows up in 1 section(s).
- ✔ Known-vulnerable libraries: none found (retire.js data).

**How it is put together**

- ≈ **Frame loops drive the page**: 26 `requestAnimationFrame` calls and 50 direct style writes in the app code — components update the DOM every frame themselves instead of re-rendering through the framework.
- ≈ **Shared state store** (zustand-style `getState()/setState()/subscribe()`, 86 reads): the WebGL scene and the HTML layers read the same state, so scroll, intro and page changes stay in sync.
- ✔ **No native scroll**: the document is 900px tall in a 900px window, so "scrolling" is the site's own: input (wheel/touch handlers) moves a progress value that the scene and layers read.
- ✔ **Code splitting**: 14 dynamic-import sites; separately loaded app chunks: GLRoot, 9bb51b96, LaterChapters, Work.
- ✔ **Two builds**: modern ES modules plus a legacy (SystemJS / nomodule) copy for old browsers.
- ✔ **Post-processing** chain (EffectComposer / passes) after the 3D render.
- ✔ **GPU particle simulation**: 3 shader pass(es) keep particle positions/velocities in textures and update them on the GPU each frame.
- ✔ **Layered single screen**: 6 of 6 sections sit on top of each other (fixed, at the top), shown and hidden by state — not a stack of blocks you scroll past.
- ✔ Respects **prefers-reduced-motion** (checked in code).
- ✔ Separate **touch behaviour** (checks `hover: none` / `pointer: coarse`).
- ✔ **Adapts quality to the device** (reads GPU name / memory / CPU cores).

## 2. How the code is delivered

- ✔ **Vite**: file name pattern /assets/name-HASH8.js (polyfills-T_rg-xDk.js); file name pattern /assets/name-HASH8.js (main-DQ8m53H8.js); Vite runtime helper (__vite__mapDeps / __vitePreload) in main-DTyWc6eg.js; file name pattern /assets/name-HASH8.js (main-DTyWc6eg.js)

| file | role | size | libraries inside | source map |
|---|---|---|---|---|
| polyfills-T_rg-xDk.js | vendor | 32.8 KB | – | none published |
| main-DQ8m53H8.js | app | 203 B | – | none published |
| main-DTyWc6eg.js | app | 101.9 KB | Sanity client | none published · unpacked |
| react-DRp5II5X.js | vendor | 144.4 KB | React | none published |
| motion-CzGW6FVa.js | vendor | 68.8 KB | GSAP, ScrollTrigger | none published |
| GLRoot-EqD-37OA.js | app | 269.1 KB | – | none published · unpacked |
| three-DVjc41Gk.js | vendor | 675.0 KB | three.js | none published |
| r3f-mHTrlXT1.js | vendor | 125.4 KB | React, React Three Fiber | none published |
| post-Dcv-layX.js | vendor | 227.4 KB | React Three Fiber, postprocessing | none published |
| 9bb51b96 | app | 0 B | – | none published |
| LaterChapters-DnpwaFJD.js | app | 68.4 KB | – | none published · unpacked |
| Work-Bu7IN8Rv.js | app | 51.4 KB | – | none published · unpacked |

## 3. Section by section

### 3.1 Jehad Uddin

`section.hero-statement` · 0px from the top · 900px tall


Code that names this section (`hero-statement`):

_main-DTyWc6eg.js near line 2 (shipped bundle, re-indented by DEA) — in `Zr`_

```js
function Zr() {
  fe();
  const e = p.useRef();
  return b(t => t.ready), p.useEffect(() => {
    let t;
    const n = {
        v: -1
      },
      s = () => {
        t = requestAnimationFrame(s);
        const i = b.getState(),
          a = e.current;
        if (!a) return;
        i.ready && n.v < 0 && (n.v = performance.now());
        const c = n.v < 0 ? 0 : Math.min(1, (performance.now() - n.v - (i.reduced ? 0 : 2900)) / 1300),
          o = pt(Math.min(1, Math.max(0, (l.p - .25) / .55))),
          h = pt(Math.max(0, c)) * (1 - o);
        a.style.opacity = h.toFixed(3), a.style.visibility = h > .005 ? "visible" : "hidden", a.style.setProperty("--rise", ((1 - pt(Math.max(0, c))) * 26 - o * 40).toFixed(1) + "px");
      };
    return s(), () => cancelAnimationFrame(t);
  }, []), r.jsxs("section", {
    ref: e,
    className: "hero-statement",
    "aria-hidden": "true",
    style: {
      opacity: 0,
      visibility: "hidden"
    },
    children: [r.jsxs("div", {
      className: "hs-main",
  // … 16 more lines
```

### 3.2 SCROLL Open Black Hole: Curved spacetime and a bur

`div.text` · 0px from the top · 900px tall

> SCROLL Open Black Hole: Curved spacetime and a burning dust disk, in real time. Open SignalCore: Inner transmissions shaped by emotion, sharpened by clarity. Open Water Simulation: A GPU-driven fluid …

- ✔ Content comes from `GET q3b5m2q9.apicdn.sanity.io/v2025-01-01/data/query/production` — these values from the response are on screen here: "black hole", "water simulation", "inner transmissions shaped by emotion, s…", "signalcore", "auren estate"
- ? No script, animation or data call could be tied to this section; it is likely static HTML/CSS (or rendered by a framework without distinctive names).

### 3.3 div.rock-label

`div.rock-label` · 0px from the top · 900px tall


Code that names this section (`rock-label`):

_main-DTyWc6eg.js near line 2 (shipped bundle, re-indented by DEA) — in `Jr`_

```js
function Jr() {
  const e = p.useRef(),
    t = p.useRef(),
    n = p.useRef(),
    s = p.useRef(),
    i = p.useRef(),
    a = p.useRef(),
    c = p.useRef(),
    o = p.useRef(),
    [h] = p.useState(() => matchMedia("(hover: none) and (pointer: coarse)").matches);
  return p.useEffect(() => {
    let u,
      d = -1,
      m = 0,
      w = 0,
      g = 1,
      E = 160,
      j = 0,
      f = performance.now();
    const k = () => {
      u = requestAnimationFrame(k);
      const S = b.getState(),
        C = (l.beat === 5 || l.beat === 4 && l.p > 13) && !S.open ? S.fragAwake >= 0 ? S.fragAwake : l.beat === 5 && h ? l.fragNear : -1 : -1,
        _ = C >= 0 ? l.fragLab[C] : null,
        W = _ && _.on ? C : -1;
      if (W !== d) if (W >= 0) {
        d = W, m = performance.now();
        const U = Me[W];
        e.current.dataset.name = U.name, e.current.dataset.tag = U.tag || "", i.current.textContent = U.name, a.current.textContent = U.tag || "", c.current.textContent = U.line || "";
      } else w < .02 && (d = -1);
  // … 71 more lines
```

### 3.4 Willow

`section.gal-info` · 0px from the top · 900px tall · 5 links


Code that names this section (`gal-info`):

_main-DTyWc6eg.js near line 2 (shipped bundle, re-indented by DEA) — in `Kr`_

```js
function Kr() {
  fe();
  const e = p.useRef();
  p.useRef();
  const [t, n] = p.useState(0),
    [s, i] = p.useState(1),
    a = p.useRef(0),
    c = p.useRef([]);
  p.useEffect(() => {
    let h;
    const u = () => {
      h = requestAnimationFrame(u);
      const d = e.current;
      if (!d) return;
      const m = l.galOn || 0;
      d.style.opacity = m.toFixed(3), d.style.visibility = m > .01 ? "visible" : "hidden", d.style.pointerEvents = m > .6 ? "" : "none";
      const w = l.galIndex;
      w >= 0 && w !== a.current && (i(w > a.current ? 1 : -1), a.current = w, n(w));
      const g = l.galRects,
        E = c.current;
      for (let j = 0; j < an; j++) {
        const f = E[j];
        if (!f) continue;
        const k = g && g[j],
          S = !!(k && k[4] && m > .6);
        S && (f.style.transform = `translate3d(${k[0].toFixed(1)}px,${k[1].toFixed(1)}px,0)`, f.style.width = (k[2] - k[0]).toFixed(1) + "px", f.style.height = (k[3] - k[1]).toFixed(1) + "px"), f.__on !== S && (f.__on = S, f.style.visibility = S ? "visible" : "hidden", f.tabIndex = S ? 0 : -1);
      }
    };
    return u(), () => cancelAnimationFrame(h);
  }, []);
  // … 68 more lines
```

### 3.5 This is me. Jehad.

`section.home.home2` · 0px from the top · 900px tall · 3 links


Code that names this section (`home`):

_main-DTyWc6eg.js near line 2 (shipped bundle, re-indented by DEA)_

```js
const ot = {
    status: "pending"
  },
  er = typeof location < "u" && /(^|[?&])nocms(&|$)/.test(location.search),
  Ut = (async () => {
    if (er || typeof fetch > "u") return ot.status = "off", !1;
    const e = typeof AbortController < "u" ? new AbortController() : null,
      t = setTimeout(() => e && e.abort(), 2500);
    try {
      const n = await fetch(Jn + encodeURIComponent(Zn), {
        signal: e ? e.signal : void 0,
        credentials: "omit",
        cache: "no-cache"
      });
      if (!n.ok) throw new Error("cms " + n.status);
      const s = Qn(await n.json());
      return ot.status = s ? "applied" : "empty", s && b.setState(i => ({
        contentRev: (i.contentRev || 0) + 1
      })), s;
    } catch {
      return ot.status = "failed", !1;
    } finally {
      clearTimeout(t);
    }
  })(),
  tr = "modulepreload",
  nr = function (e) {
    return "/" + e;
  },
  Xt = {},
  // … 170 more lines
```

### 3.6 canvas

`canvas` · 0px from the top · 900px tall

- ✔ Drawn with WebGL on c1 — see section 4 for the scene and shaders.
- ✔ `webglcontextlost` on canvas → handler in `three-DVjc41Gk.js:3828:24037 (J)`
- ✔ `webglcontextlost` on canvas → handler in `main-DTyWc6eg.js:2:102490`
- ✔ `webglcontextrestored` on canvas → handler in `three-DVjc41Gk.js:3828:24126 (ft)`
- ✔ `webglcontextcreationerror` on canvas → handler in `three-DVjc41Gk.js:3828:24352 (ut)`
- ✔ `click` on button.brand "Jehad Uddin, back to the start" → handler in `react-DRp5II5X.js:38:93 (Br)`
- ✔ `click` on button.pill-link "HomeHomeHome" → handler in `react-DRp5II5X.js:38:93 (Br)`

## 4. WebGL: scene, materials and shaders

- ✔ Renderer: pixel ratio 1, size 1440×900, tone mapping none, colour space srgb, shadows off, antialias false
- ✔ Scene "scene": 145 objects, 68 drawables, 7 lights, fog Fog 60–260 #000000, background #000000
- ✔ Scene "scene": 2 objects, 1 drawables, 0 lights
- ✔ Scene "scene": 2 objects, 1 drawables, 0 lights
- ✔ Scene "scene": 6 objects, 4 drawables, 0 lights
- ✔ Scene "scene": 2 objects, 1 drawables, 0 lights
- ✔ Scene "scene": 2 objects, 1 drawables, 0 lights
- ✔ Scene "scene": 1 objects, 0 drawables, 0 lights
- ✔ Scene "scene": 2 objects, 1 drawables, 0 lights
- ✔ Scene "scene": 2 objects, 1 drawables, 0 lights
- ✔ Scene "scene": 2 objects, 1 drawables, 0 lights

| material | type | used by | uniforms that move |
|---|---|---|---|
| – | ShaderMaterial | Points | uTime |
| – | ShaderMaterial | Points | uTime, uCam, uPtrV, uHole |
| – | ShaderMaterial | Mesh | uRot |
| – | ShaderMaterial | Mesh | uTime |
| – | ShaderMaterial | Mesh | – |
| – | ShaderMaterial | Mesh | – |
| – | SpriteMaterial | Sprite | – |
| – | ShaderMaterial | Mesh, Mesh, Mesh, Mesh, Mesh, Mesh | – |
| – | ShaderMaterial | Points | – |
| – | ShaderMaterial | Mesh | – |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI |
| – | ShaderMaterial | Mesh | uTime, uCam, uColI |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI |
| – | ShaderMaterial | heroHaze | uPix, uTime, uFocus, uOff, uMouse, uMouse2, uVel, uPush, uWake, uTanF |
| – | ShaderMaterial | heroDots | uPix, uTime, uFocus, uOff, uMouse, uMouse2, uVel, uPush, uWake, uTanF |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI, uST |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI, uST |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI, uST |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI, uST |
| – | ShaderMaterial | Mesh | uCam, uTime, uPool, uColI |
| – | ShaderMaterial | Points | uTime, uPix |
| – | ShaderMaterial | heroCloudComposite | – |
| – | ShaderMaterial | Points | uP, uTime, uPix |
| fmw-fabric | MeshPhysicalMaterial | suit_1 | – |
| – | MeshPhysicalMaterial | Mesh | – |
| – | MeshPhysicalMaterial | Mesh | – |
| – | MeshStandardMaterial | Mesh | – |
| – | MeshStandardMaterial | Mesh, Mesh, Mesh, Mesh | – |

### vertex shader s01 (vertex)

✔ Passes between stages: `vD`.
```glsl
void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }
```

### fragment shader s02 (fragment)

✔ Techniques in the code: noise (simplex/perlin), fractal noise (fbm).
✔ Helper functions it defines: `hash()`, `noise()`, `fbm()`.

| uniform | type | what it does | live value | moves? |
|---|---|---|---|---|
| `uTime` | float | a clock in seconds; anything multiplied by it moves on its own; moves through a noise field<br>`float n1 = fbm(d * 2.2 + vec3(0., uTime * 0.004, 0.));` | – | ? |
| `uOn` | float | feeds the final colour<br>`gl_FragColor = vec4(c * (0.35 + 0.65 * tilt) * uOn * uGain, 1.);` | – | ? |
| `uGain` | float | how strong the effect is; feeds the final colour<br>`gl_FragColor = vec4(c * (0.35 + 0.65 * tilt) * uOn * uGain, 1.);` | – | ? |
| `uA` | vec3 | blends/thresholds between values<br>`vec3 c = mix(uA, uB, smoothstep(0.3, 0.75, n2)) * band * 0.75 + uC * lane * 0.25;` | – | ? |
| `uB` | vec3 | blends/thresholds between values<br>`vec3 c = mix(uA, uB, smoothstep(0.3, 0.75, n2)) * band * 0.75 + uC * lane * 0.25;` | – | ? |
| `uC` | vec3 | blends/thresholds between values<br>`vec3 c = mix(uA, uB, smoothstep(0.3, 0.75, n2)) * band * 0.75 + uC * lane * 0.25;` | – | ? |

```glsl
void main(){
  vec3 d = vD;
  float n1 = fbm(d * 2.2 + vec3(0., uTime * 0.004, 0.));
  float n2 = fbm(d * 2.6 + 11.);   // broad, soft: a blush, not texture
  float band = smoothstep(0.25, 0.9, n1) * smoothstep(0.2, 0.8, n2);
  float lane = smoothstep(0.45, 0.75, fbm(d * 1.3 + 7.)); // the milky band
  vec3 c = mix(uA, uB, smoothstep(0.3, 0.75, n2)) * band * 0.75 + uC * lane * 0.25;
  float tilt = smoothstep(-0.6, 0.4, d.y + d.x * 0.3);     // more of it high and to the left
  gl_FragColor = vec4(c * (0.35 + 0.65 * tilt) * uOn * uGain, 1.);
}
```

### vertex shader s03 (vertex)

✔ Passes between stages: `vUv`.
```glsl
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
```

### fragment shader s04 (fragment)

✔ Techniques in the code: GPU particle simulation (positions/velocities stored in textures, updated each frame).
✔ Live material: ShaderMaterial on Mesh.

| uniform | type | what it does | live value | moves? |
|---|---|---|---|---|
| `tPos` | sampler2D | is sampled as a texture, feeds the final colour<br>`void main(){ vec4 P = texture2D(tPos, vUv); vec3 v = texture2D(tVel, vUv).xyz; P.xyz += v …` | render target texture 256×256 | no (in 0.7 s) |
| `tVel` | sampler2D | is sampled as a texture, feeds the final colour<br>`void main(){ vec4 P = texture2D(tPos, vUv); vec3 v = texture2D(tVel, vUv).xyz; P.xyz += v …` | render target texture 256×256 | no (in 0.7 s) |
| `uDt` | float | feeds the final colour<br>`void main(){ vec4 P = texture2D(tPos, vUv); vec3 v = texture2D(tVel, vUv).xyz; P.xyz += v …` | 0.0333 | no (in 0.7 s) |

```glsl
void main(){ vec4 P = texture2D(tPos, vUv); vec3 v = texture2D(tVel, vUv).xyz; P.xyz += v * uDt; gl_FragColor = P; }
```

### fragment shader s06 (fragment)

✔ Techniques in the code: GPU particle simulation (positions/velocities stored in textures, updated each frame), curl noise.
✔ Helper functions it defines: `m289()`, `perm()`, `tis()`, `snoiseG()`, `curl3()`.
✔ Passes between stages: `vUv`.
✔ Live material: ShaderMaterial on Mesh.

| uniform | type | what it does | live value | moves? |
|---|---|---|---|---|
| `tPos` | sampler2D | is sampled as a texture<br>`vec3 p = texture2D(tPos, vUv).xyz; vec4 V = texture2D(tVel, vUv); vec4 H = texture2D(tHome…` | render target texture 256×256 | no (in 0.7 s) |
| `tVel` | sampler2D | is sampled as a texture<br>`vec3 p = texture2D(tPos, vUv).xyz; vec4 V = texture2D(tVel, vUv); vec4 H = texture2D(tHome…` | render target texture 256×256 | no (in 0.7 s) |
| `tHome` | sampler2D | is sampled as a texture<br>`vec3 p = texture2D(tPos, vUv).xyz; vec4 V = texture2D(tVel, vUv); vec4 H = texture2D(tHome…` | data texture 256×256 | no (in 0.7 s) |
| `uDt` | float | purpose not clear from its name; see how it is used below<br>`heat = clamp(heat * exp(-uDt * 2.7) + (f * 2.8 + tz * 3.4) * uDt, 0.0, 1.0); // v0.8.8: co…` | 0.0333 | no (in 0.7 s) |
| `uNT` | float | drives a sine/cosine wave, moves through a noise field<br>`home += vec3(sin(q.y * 1.3 + uNT * 0.7 + q.z), sin(q.z * 1.1 - uNT * 0.55 + q.x * 0.7), si…` | 9.9212 | ✔ yes |
| `uNS` | float | moves through a noise field<br>`vec3 c = curl3(p * uNS + vec3(0.0, uNT * 0.55, uNT * 0.23));` | 0.4234 | ✔ yes |
| `uBreath` | float | purpose not clear from its name; see how it is used below<br>`vec3 home = H.xyz * uBreath;` | 1.042 | ✔ yes |
| `uFlow` | float | purpose not clear from its name; see how it is used below<br>`a += c * uFlow * (0.5 + 0.5 * r2 + 0.7 * wisp + 4.5 * hs);` | 0.3612 | ✔ yes |
| `uStir` | float | purpose not clear from its name; see how it is used below<br>`if (uStir > 0.001) {` | 0.7153 | ✔ yes |
| `uR` | float | purpose not clear from its name; see how it is used below<br>`f = exp(-dl * dl / (uR * uR)) * uStir;` | 1.25 | no (in 0.7 s) |
| `uK` | float | purpose not clear from its name; see how it is used below<br>`float k = uK * mix(1.0, 0.34, hs) * mix(1.0, 0.7, wisp); // v0.8.8: 0.22 → 0.34, ribbons p…` | 3.2 | no (in 0.7 s) |
| `uRo` | vec3 | purpose not clear from its name; see how it is used below<br>`vec3 d = p - uRo; d -= uRd * dot(d, uRd); float dl = length(d);` | 1.076, -1.350, 13.596 | ✔ yes |
| `uRd` | vec3 | purpose not clear from its name; see how it is used below<br>`vec3 d = p - uRo; d -= uRd * dot(d, uRd); float dl = length(d);` | -0.219, 0.139, -0.966 | ✔ yes |
| `uRv` | vec3 | purpose not clear from its name; see how it is used below<br>`a += (tang * 4.8 + uRv * 1.7 - d / max(dl, 0.35) * 0.35) * f * mix(1.0, 0.4, uTrailOn); //…` | -1.919, 0.464, 0.456 | ✔ yes |
| `tTrail` | sampler2D | is sampled as a texture<br>`vec4 tf = texture2D(tTrail, tuv);` | render target texture 160×100 | no (in 0.7 s) |
| `uTrailOn` | float | blends/thresholds between values<br>`a += (tang * 4.8 + uRv * 1.7 - d / max(dl, 0.35) * 0.35) * f * mix(1.0, 0.4, uTrailOn); //…` | 0.9932 | ✔ yes |
| `uTrailK` | float | purpose not clear from its name; see how it is used below<br>`a += (wv * 1.6 - v) * uTrailK * tz * (0.35 + 1.3 * r2 * r2); // each particle answers diff…` | 8 | no (in 0.7 s) |
| `uTanF` | float | purpose not clear from its name; see how it is used below<br>`vec3 wv = (uCR * tf.x * uAsp + uCU * tf.y) * (2.0 * uTanF * cp.w); // screen uv/s -> world…` | 0.3089 | ✔ yes |
| `uAsp` | float | purpose not clear from its name; see how it is used below<br>`vec3 wv = (uCR * tf.x * uAsp + uCU * tf.y) * (2.0 * uTanF * cp.w); // screen uv/s -> world…` | 1.6 | no (in 0.7 s) |
| `uVP` | mat4 | purpose not clear from its name; see how it is used below<br>`vec4 cp = uVP * vec4(p, 1.0);` | matrix | no (in 0.7 s) |
| `uCR` | vec3 | purpose not clear from its name; see how it is used below<br>`vec3 wv = (uCR * tf.x * uAsp + uCU * tf.y) * (2.0 * uTanF * cp.w); // screen uv/s -> world…` | 0.997, 0.003, -0.074 | no (in 0.7 s) |
| `uCU` | vec3 | purpose not clear from its name; see how it is used below<br>`vec3 wv = (uCR * tf.x * uAsp + uCU * tf.y) * (2.0 * uTanF * cp.w); // screen uv/s -> world…` | 0.005, 0.994, 0.113 | no (in 0.7 s) |

```glsl
void main(){
    vec3 p = texture2D(tPos, vUv).xyz; vec4 V = texture2D(tVel, vUv); vec4 H = texture2D(tHome, vUv);
    vec3 v = V.xyz; float heat = V.w;
    float wisp = step(H.w, 0.16);                                     // the loose outer layer
    float r2 = fract(H.w * 37.13 + vUv.x * 7.31 + vUv.y * 3.17);
    // the rest point: on the breathing body, itself drifting on a slow curl (the surface rolls)
    vec3 home = H.xyz * uBreath;
    // (a cheap rolling drift, not a second curl: the flow below carries the detail)
    vec3 q = H.xyz * 0.9;
    home += vec3(sin(q.y * 1.3 + uNT * 0.7 + q.z), sin(q.z * 1.1 - uNT * 0.55 + q.x * 0.7), sin(q.x * 1.2 + uNT * 0.6 - q.y)) * (0.22 + 0.45 * wisp);
    // the cursor's vortex: round its view ray, dragged along its motion
    float f = 0.0;
    vec3 a = vec3(0.0);
    if (uStir > 0.001) {
      vec3 d = p - uRo; d -= uRd * dot(d, uRd); float dl = length(d);
      f = exp(-dl * dl / (uR * uR)) * uStir;
      vec3 tang = cross(uRd, d) / max(dl, 0.35);
      a += (tang * 4.8 + uRv * 1.7 - d / max(dl, 0.35) * 0.35) * f * mix(1.0, 0.4, uTrailOn);   // v0.8.8: with the trail on, the vortex only seeds
    }
    // v0.8.8 (PLAN #4): the pointer's liquid trail (trail.js) drags the particles along ITS velocity at their screen
    // position — the trail's eddies are thin, so the mouse draws several thin ribbons instead of one plume
    float tz = 0.0;
    if (uTrailOn > 0.001) {
      vec4 cp = uVP * vec4(p, 1.0);
      if (cp.w > 0.1) {
        vec2 tuv = cp.xy / cp.w * 0.5 + 0.5;
        if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
          vec4 tf = texture2D(tTrail, tuv);
          vec3 wv = (uCR * tf.x * uAsp + uCU * tf.y) * (2.0 * uTanF * cp.w);   // screen uv/s -> world units/s at its depth
          tz = tf.z * uTrailOn;
  // … 17 more lines
```

### vertex shader s07 (vertex)

✔ Techniques in the code: instancing.
✔ Helper functions it defines: `hs()`, `rotAA()`, `floorH()`, `stoneXform()`.
✔ Passes between stages: `vDark`.
✔ Live material: ShaderMaterial on Mesh, transparent.

| uniform | type | what it does | live value | moves? |
|---|---|---|---|---|
| `uLightG` | vec3 | a light direction or position; blends/thresholds between values<br>`float t = uLightG.y / max(uLightG.y - q.y, 0.3);` | 0.000, 8.750, -1.500 | no (in 0.7 s) |
| `uShC` | vec2 | changes vertex positions<br>`gl_Position = S > 1e-4 && vDark > 0.01 ? vec4((pr - uShC) / uShE, 0.0, 1.0) : vec4(2.0, 2.…` | 0.000, 0.000 | no (in 0.7 s) |
| `uShE` | float | changes vertex positions<br>`gl_Position = S > 1e-4 && vDark > 0.01 ? vec4((pr - uShC) / uShE, 0.0, 1.0) : vec4(2.0, 2.…` | 12 | no (in 0.7 s) |
| `uST` | float | purpose not clear from its name; see how it is used below<br>`float tt = uST / uLoop + hs(rock * 1.71 + 0.3); float loop = floor(tt); float lt = fract(t…` | 0.8 | ✔ yes |
| `uShape` | float | purpose not clear from its name; see how it is used below<br>`float piece = mod(id, uPieces); float rock = floor(id / uPieces) * 4.0 + uShape;` | 0 | no (in 0.7 s) |
| `uPieces` | float | purpose not clear from its name; see how it is used below<br>`float piece = mod(id, uPieces); float rock = floor(id / uPieces) * 4.0 + uShape;` | 4 | no (in 0.7 s) |
| `uLoop` | float | blends/thresholds between values<br>`float tt = uST / uLoop + hs(rock * 1.71 + 0.3); float loop = floor(tt); float lt = fract(t…` | 6.25 | no (in 0.7 s) |
| `uAx` | vec2 | purpose not clear from its name; see how it is used below<br>`vec2 rel = xz - uAx; float r0 = length(rel); float a0 = atan(rel.y, rel.x);` | 0.000, -1.500 | no (in 0.7 s) |
| `uHgt` | sampler2D | is sampled as a texture<br>`float floorH(vec2 xz){ return texture2D(uHgt, xz / (2.0 * uHgtE) + 0.5).r * 2.0 - 1.0; }` | data texture 64×64 | no (in 0.7 s) |
| `uHgtE` | float | purpose not clear from its name; see how it is used below<br>`float floorH(vec2 xz){ return texture2D(uHgt, xz / (2.0 * uHgtE) + 0.5).r * 2.0 - 1.0; }` | 14 | no (in 0.7 s) |

```glsl
void main(){
    vec3 P; mat3 R; float S; stoneXform(P, R, S);
    vec3 q = P + R * (position * S);
    float hy = max(P.y, 0.0);
    float t = uLightG.y / max(uLightG.y - q.y, 0.3);
    vec2 pr = uLightG.xz + (q.xz - uLightG.xz) * t;
    vDark = 0.8 * (1.0 - smoothstep(0.4, 8.0, hy)) * step(q.y, uLightG.y - 0.4);
    gl_Position = S > 1e-4 && vDark > 0.01 ? vec4((pr - uShC) / uShE, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
```

### fragment shader s08 (fragment)

✔ Passes between stages: `vDark`.
```glsl
void main(){ gl_FragColor = vec4(vec3(1.0 - vDark), 1.0); }
```

### fragment shader s10 (fragment)

✔ Live material: ShaderMaterial on Mesh, transparent.

| uniform | type | what it does | live value | moves? |
|---|---|---|---|---|
| `tSrc` | sampler2D | is sampled as a texture<br>`void main(){ float s = texture2D(tSrc, vUv).r * 0.36;` | render target texture 256×256 | no (in 0.7 s) |
| `uA` | float | feeds the final colour<br>`gl_FragColor = vec4(vec3(s), uA); }` | 0.35 | no (in 0.7 s) |
| `uPx` | float | purpose not clear from its name; see how it is used below<br>`s += (texture2D(tSrc, vUv + vec2(uPx, 0.0)).r + texture2D(tSrc, vUv - vec2(uPx, 0.0)).r + …` | 0.0059 | no (in 0.7 s) |

```glsl
void main(){ float s = texture2D(tSrc, vUv).r * 0.36;
    s += (texture2D(tSrc, vUv + vec2(uPx, 0.0)).r + texture2D(tSrc, vUv - vec2(uPx, 0.0)).r + texture2D(tSrc, vUv + vec2(0.0, uPx)).r + texture2D(tSrc, vUv - vec2(0.0, uPx)).r) * 0.16;
    gl_FragColor = vec4(vec3(s), uA); }
```

### heroHaze vertex shader (vertex)

✔ Techniques in the code: GPU particle simulation (positions/velocities stored in textures, updated each frame).
✔ Passes between stages: `vQ`.
✔ Live material: ShaderMaterial on heroHaze, transparent.

| uniform | type | what it does | live value | moves? |
|---|---|---|---|---|
| `tPos` | sampler2D | is sampled as a texture<br>`vec4 P = texture2D(tPos, aRef); vec4 V = texture2D(tVel, aRef);` | render target texture 256×256 | no (in 0.7 s) |
| `tVel` | sampler2D | is sampled as a texture<br>`vec4 P = texture2D(tPos, aRef); vec4 V = texture2D(tVel, aRef);` | render target texture 256×256 | no (in 0.7 s) |
| `uPix` | float | purpose not clear from its name; see how it is used below<br>`float px = uSize * (0.6 + 0.8 * aRnd.x * aRnd.x) * uPix / dist;` | 1456.8127 | ✔ yes |
| `uOn` | float | purpose not clear from its name; see how it is used below<br>`float b = (0.7 + 0.3 * aRnd.y) * (0.65 + 0.55 * front) * dim * formA * uOn * uBright;` | 1 | no (in 0.7 s) |
| `uForm` | float | purpose not clear from its name; see how it is used below<br>`if (uForm < 0.999) { // the opening: particles gather in from a wide slow scatter, each on…` | 0.0608 | no (in 0.7 s) |
| `uSize` | float | the canvas size in pixels, to keep shapes round on any screen<br>`float px = uSize * (0.6 + 0.8 * aRnd.x * aRnd.x) * uPix / dist;` | 0.26 | no (in 0.7 s) |
| `uFocus` | float | hover/active state, usually eased between 0 and 1<br>`float front = clamp(0.5 - (dist - uFocus) * 0.2, 0.0, 1.0);` | 13.6997 | ✔ yes |
| `uStretch` | float | purpose not clear from its name; see how it is used below<br>`vec4 mv0 = modelViewMatrix * vec4(wp - v * uStretch, 1.0); // where it was a moment ago: t…` | 0.05 | no (in 0.7 s) |
| `uHaze` | float | purpose not clear from its name; see how it is used below<br>`float pxD = clamp(px, 1.2, uHaze > 0.5 ? 26.0 : 5.0); // capped: a near particle never bec…` | 1 | no (in 0.7 s) |
| `uBright` | float | purpose not clear from its name; see how it is used below<br>`float b = (0.7 + 0.3 * aRnd.y) * (0.65 + 0.55 * front) * dim * formA * uOn * uBright;` | 0.035 | no (in 0.7 s) |
| `uBeam` | float | purpose not clear from its name; see how it is used below<br>`b *= 1.0 + uBeam * exp(-dot(p.xz, p.xz) / (2.0 * 1.0 * 1.0)) * smoothstep(0.9, 2.2, abs(p.…` | 0.9 | no (in 0.7 s) |
| `uPixV` | vec2 | changes vertex positions<br>`vec2 sp = (s1 - s0) * 0.5 * uPixV; // the streak in pixels` | 1440.000, 900.000 | no (in 0.7 s) |
| `uOff` | vec3 | purpose not clear from its name; see how it is used below<br>`vec3 wp = p + uOff;` | -0.080, 0.003, 0.000 | ✔ yes |

```glsl
void main(){
    vec4 P = texture2D(tPos, aRef); vec4 V = texture2D(tVel, aRef);
    vec3 p = P.xyz, v = V.xyz;
    float formA = 1.0;
    if (uForm < 0.999) {   // the opening: particles gather in from a wide slow scatter, each on its own delay
      float fk = clamp((uForm - aRnd.w * 0.35) / 0.65, 0.0, 1.0); fk = fk * fk * (3.0 - 2.0 * fk);
      p = mix(p + (aRnd.xyz - 0.5) * vec3(26.0, 14.0, 18.0), p, fk); formA = fk;
    }
    vec3 wp = p + uOff;
    vec4 mv = modelViewMatrix * vec4(wp, 1.0);
    vec4 mv0 = modelViewMatrix * vec4(wp - v * uStretch, 1.0);        // where it was a moment ago: the streak
    float dist = max(-mv.z, 0.1);
    vec4 c1 = projectionMatrix * mv, c0 = projectionMatrix * mv0;
    vec2 s1 = c1.xy / max(c1.w, 1e-3), s0 = c0.xy / max(c0.w, 1e-3);
    // size in pixels; sub-pixel points keep a 1.2 px footprint and give up brightness instead (no shimmer)
    float px = uSize * (0.6 + 0.8 * aRnd.x * aRnd.x) * uPix / dist;
    float pxD = clamp(px, 1.2, uHaze > 0.5 ? 26.0 : 5.0);           // capped: a near particle never becomes a big blob
    float dim = min(1.0, (px / 1.2) * (px / 1.2));
    vec2 sp = (s1 - s0) * 0.5 * uPixV;                                // the streak in pixels
    float L = min(max(length(sp) - 1.5, 0.0), uHaze > 0.5 ? 10.0 : 28.0);   // only real motion streaks
    vec2 ax = L > 0.25 ? normalize(sp) : vec2(1.0, 0.0); vec2 nx = vec2(-ax.y, ax.x);
    float ext = pxD * 1.7;                                            // the quad's half-width (the dot's soft skirt)
    vec2 cr = position.xy;                                            // the quad corner, −1..1
    float along = cr.x * (ext + L * 0.5) - L * 0.5;                   // pixels along the streak, 0 = now, −L = a moment ago
    vec2 offPx = ax * along + nx * cr.y * ext;
    gl_Position = c1.w > 0.0 ? vec4((s1 + offPx / (0.5 * uPixV)) * c1.w, c1.z, c1.w) : vec4(2.0, 2.0, 2.0, 1.0);
    vQ = vec3(along / ext, cr.y, L / ext);
    // brightness: front a touch brighter than far (depth fade), the gather, energy spread along a streak
    float front = clamp(0.5 - (dist - uFocus) * 0.2, 0.0, 1.0);
    float b = (0.7 + 0.3 * aRnd.y) * (0.65 + 0.55 * front) * dim * formA * uOn * uBright;
  // … 14 more lines
```

### fragment shader s16 (fragment)

✔ Passes between stages: `vQ`.
```glsl
void main(){
    float du = vQ.x - clamp(vQ.x, -vQ.z, 0.0);
    float r2 = du * du + vQ.y * vQ.y;
    float a = exp(-r2 * 3.0) * vA; if (a < 0.0008) discard;
    gl_FragColor = vec4(vec3(0.86, 0.9, 1.0) * a, 1.0);
  }
```

### fragment shader s18 (fragment)

✔ Passes between stages: `vQ`.
```glsl
void main(){
    float du = vQ.x - clamp(vQ.x, -vQ.z, 0.0);
    float r2 = du * du + vQ.y * vQ.y;
    float a = exp(-r2 * 7.5) * 1.15 + exp(-r2 * 2.2) * 0.12;        // a hot little core, a soft skirt
    a *= mix(0.5, 1.0, clamp(1.0 + vQ.x / max(vQ.z, 1e-3), 0.0, 1.0));   // the tail of a streak fades
    a *= vA; if (a < 0.002) discard;
    gl_FragColor = vec4(vec3(1.0, 0.985, 0.96) * a, 1.0);
  }
```

### vertex shader s19 (vertex)

✔ Passes between stages: `vUv`.
```glsl
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
```

### fragment shader s20 (fragment)

✔ Helper functions it defines: `sdSeg()`.
✔ Passes between stages: `vUv`.

| uniform | type | what it does | live value | moves? |
|---|---|---|---|---|
| `tPrev` | sampler2D | is sampled as a texture<br>`vec4 f = texture2D(tPrev, vUv);` | – | ? |
| `uTexel` | vec2 | blends/thresholds between values<br>`float wl = abs(texture2D(tPrev, vUv - vec2(uTexel.x, 0.)).a), wr = abs(texture2D(tPrev, vU…` | – | ? |
| `uDt` | float | purpose not clear from its name; see how it is used below<br>`vec4 a = texture2D(tPrev, vUv - f.xy * uDt); // advect everything along the velocity` | – | ? |
| `uAsp` | float | purpose not clear from its name; see how it is used below<br>`vec2 q = vec2(uAsp, 1.);` | – | ? |
| `uR` | float | purpose not clear from its name; see how it is used below<br>`float g = exp(-d * d / (uR * uR));` | – | ? |
| `uSplat` | float | purpose not clear from its name; see how it is used below<br>`if (uSplat > 0.) {` | – | ? |
| `uVort` | float | purpose not clear from its name; see how it is used below<br>`vec2 vel = a.xy + vec2(n.y, -n.x) * f.a * uVort * uDt;` | – | ? |
| `uDecV` | float | purpose not clear from its name; see how it is used below<br>`vel *= uDecV; dye *= uDecD;` | – | ? |
| `uDecD` | float | purpose not clear from its name; see how it is used below<br>`vel *= uDecV; dye *= uDecD;` | – | ? |
| `uA` | vec2 | purpose not clear from its name; see how it is used below<br>`float d = sdSeg(vUv * q, uA * q, uB * q);` | – | ? |
| `uB` | vec2 | purpose not clear from its name; see how it is used below<br>`float d = sdSeg(vUv * q, uA * q, uB * q);` | – | ? |
| `uV` | vec2 | purpose not clear from its name; see how it is used below<br>`vel += uV * g * uSplat; // v0.8.8b: a smooth stroke (the fine rotation pattern read as rip…` | – | ? |

```glsl
void main(){
  vec4 f = texture2D(tPrev, vUv);
  vec4 a = texture2D(tPrev, vUv - f.xy * uDt);   // advect everything along the velocity
  // vorticity confinement: the gradient of |curl| (last frame's, in .a) points to the eddy cores
  float wl = abs(texture2D(tPrev, vUv - vec2(uTexel.x, 0.)).a), wr = abs(texture2D(tPrev, vUv + vec2(uTexel.x, 0.)).a);
  float wb = abs(texture2D(tPrev, vUv - vec2(0., uTexel.y)).a), wt = abs(texture2D(tPrev, vUv + vec2(0., uTexel.y)).a);
  vec2 n = vec2(wr - wl, wt - wb); n /= length(n) + 1e-5;
  vec2 vel = a.xy + vec2(n.y, -n.x) * f.a * uVort * uDt;
  float dye = a.z;
  // the pointer: a soft capsule along its path since the last frame (aspect-correct, so it is round on screen)
  if (uSplat > 0.) {
    vec2 q = vec2(uAsp, 1.);
    float d = sdSeg(vUv * q, uA * q, uB * q);
    float g = exp(-d * d / (uR * uR));
    vel += uV * g * uSplat;   // v0.8.8b: a smooth stroke (the fine rotation pattern read as ripples)
    dye = max(dye, g * clamp(length(uV) * 0.9, 0., 1.));
  }
  vel *= uDecV; dye *= uDecD;
  vec2 e = smoothstep(vec2(0.), uTexel * 3., vUv) * smoothstep(vec2(0.), uTexel * 3., 1. - vUv);   // calm at the borders
  vel *= e.x * e.y;
  float m = length(vel); if (m > 3.) vel *= 3. / m;
  // this frame's curl from the source field (used next frame)
  vec2 vl = texture2D(tPrev, vUv - vec2(uTexel.x, 0.)).xy, vr = texture2D(tPrev, vUv + vec2(uTexel.x, 0.)).xy;
  vec2 vb = texture2D(tPrev, vUv - vec2(0., uTexel.y)).xy, vt = texture2D(tPrev, vUv + vec2(0., uTexel.y)).xy;
  float curl = ((vr.y - vl.y) * uAsp - (vt.x - vb.x)) * 0.5;
  gl_FragColor = vec4(vel, clamp(dye, 0., 1.), curl);
}
```

### vertex shader s21 (vertex)

✔ Passes between stages: `vD`.
```glsl
void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }
```

## 5. Motion timeline (GSAP)

? No tween was built while DEA watched (load + scroll). The site's motion is either frame-loop code (see section 1) or starts on a click, hover or a later chapter; the calls below are read from the code.

### Animations written in the code (44)

≈ Found by reading the shipped bundles, not by watching: these include motion that only starts after a click, a page change or a scroll beat. Values in quotes or numbers are literal; anything else is computed at runtime.

| where | call | target | vars |
|---|---|---|---|
| main-DTyWc6eg.js:2:77939 | fromTo | g | opacity: 1, duration: 0.35, ease: "power1.out" |
| main-DTyWc6eg.js:2:78101 | fromTo | g | --ov-bg: 1, duration: 0.7, ease: "power2.out" |
| main-DTyWc6eg.js:2:78171 | fromTo | a.current | clipPath: "inset(0% 0% 0% 0%)", duration: 1.15, ease: "expo.inOut" |
| main-DTyWc6eg.js:2:78309 | fromTo | c.current | scale: 1, duration: 1.6, ease: "expo.out" |
| main-DTyWc6eg.js:2:78382 | fromTo | o.current | opacity: 0, duration: 1.6, ease: "expo.out" |
| main-DTyWc6eg.js:2:78458 | fromTo | h.current | --ov-f: 1, duration: 1.1, ease: "power3.inOut" |
| main-DTyWc6eg.js:2:78539 | fromTo | C | yPercent: 0, opacity: 1, duration: 1, ease: "expo.out", stagger: 0.07 |
| main-DTyWc6eg.js:2:78761 | to | g | opacity: 0, duration: 0.25 |
| main-DTyWc6eg.js:2:78833 | to | j | yPercent: -60, opacity: 0, duration: 0.35, ease: "power2.in", stagger: 0.03 |
| main-DTyWc6eg.js:2:78908 | to | a.current | clipPath: "inset(50% 50% 50% 50%)", duration: 0.6, ease: "expo.inOut" |
| main-DTyWc6eg.js:2:78992 | to | c.current | scale: 1.12, duration: 0.6, ease: "power2.in" |
| main-DTyWc6eg.js:2:79052 | to | g | --ov-bg: 0, duration: 0.5, ease: "power2.inOut" |
| GLRoot-EqD-37OA.js:325:843 | to | P | s: 1, duration: 2, ease: "none" |
| LaterChapters-DnpwaFJD.js:70:1354 | to | c | push: 1, duration: 0.13, ease: "power2.in" |
| LaterChapters-DnpwaFJD.js:70:1401 | to | c | push: 0, duration: 0.85, ease: "expo.out" |
| LaterChapters-DnpwaFJD.js:70:1449 | fromTo | c | glint: 1, duration: 0.42, ease: "power2.inOut" |
| LaterChapters-DnpwaFJD.js:70:1544 | fromTo | c | puff: 0, duration: 0.9, ease: "power2.out" |
| Work-Bu7IN8Rv.js:47:3093 | timeline | – | delay: 0.45 |
| Work-Bu7IN8Rv.js:47:3197 | to | A[de] | v: 1, duration: 1.05, ease: "power4.out" |
| Work-Bu7IN8Rv.js:47:3252 | to | A[de] | l: 1, duration: 0.7, ease: "power3.out" |
| Work-Bu7IN8Rv.js:47:3311 | to | z | v: 1, duration: 1.55, ease: "power4.out" |
| Work-Bu7IN8Rv.js:47:6026 | to | b[d] | v: k?1:0, duration: k?.55:.45, ease: "power3.out", overwrite: !0 |
| Work-Bu7IN8Rv.js:47:6239 | to | P[d] | v: k?1:0, duration: k?.5:.48, ease: k?"power3.out":"power2.inOut", overwrite: !0 |
| Work-Bu7IN8Rv.js:47:6411 | to | X | v: 0, duration: p, ease: "power3.out", overwrite: !0 |
| Work-Bu7IN8Rv.js:47:6561 | to | T | v: d, duration: k, ease: "none", overwrite: !0 |
| Work-Bu7IN8Rv.js:47:6681 | to | X | v: 1, duration: 1.1, ease: "power3.out", overwrite: !0 |
| Work-Bu7IN8Rv.js:47:6765 | to | X | v: 0, duration: 0.75, delay: 0.12, ease: "power2.out", overwrite: !0 |
| Work-Bu7IN8Rv.js:47:9991 | set | o | autoAlpha: 0 |
| Work-Bu7IN8Rv.js:47:10142 | to | o | autoAlpha: 1, duration: 0.3, ease: "power2.out", clearProps: "opacity,visibility" |
| Work-Bu7IN8Rv.js:47:10326 | to | i | autoAlpha: 0, duration: 0.24, ease: "sine.in", overwrite: !0 |
| Work-Bu7IN8Rv.js:47:10636 | fromTo | n | autoAlpha: 1, duration: 0.36, ease: "power2.out", overwrite: !0, clearProps: "opacity,visibility" |
| Work-Bu7IN8Rv.js:47:15702 | set | w | yPercent: h?0:110, autoAlpha: h?1:0, overwrite: !0 |
| Work-Bu7IN8Rv.js:47:15795 | set | a | autoAlpha: 1 |
| Work-Bu7IN8Rv.js:47:15818 | to | a | yPercent: 0, duration: 0.62, ease: "power3.out", delay: A*.06, overwrite: "auto" |
| Work-Bu7IN8Rv.js:47:15900 | to | a | yPercent: 110, duration: 0.32, ease: "power2.in", delay: (w.length-1-A)*.04, overwrite: !0 |
| Work-Bu7IN8Rv.js:47:16004 | set | a | autoAlpha: 0 |
| Work-Bu7IN8Rv.js:47:16145 | set | L.current.flatMap(t=>t?Array.from(t.quer… | yPercent: 110, autoAlpha: 0 |
| Work-Bu7IN8Rv.js:47:22308 | fromTo | e.querySelectorAll(".fl-w") | autoAlpha: 1, y: 0, duration: 1, ease: "expo.out", stagger: 0.03, delay: 0.02, clearProps: "transform,visibility,opacity… |
| Work-Bu7IN8Rv.js:47:26425 | to | r | yo: 0, ao: 0, duration: 0.45, ease: "expo.out" |
| Work-Bu7IN8Rv.js:47:26714 | to | A | scale: 1.06, duration: 0.5, ease: "power3.out", overwrite: "auto" |
| Work-Bu7IN8Rv.js:47:26782 | fromTo | b | clipPath: "inset(0% 0% 0% 0%)", scale: 1, duration: 0.5, ease: "expo.out" |
| Work-Bu7IN8Rv.js:47:34737 | fromTo | i | autoAlpha: 1, y: 0, clearProps: "transform,visibility,opacity" |
| Work-Bu7IN8Rv.js:47:34935 | fromTo | i | autoAlpha: 1, y: 0, scale: 1, duration: 1.15, clearProps: "transform,visibility,opacity" |
| Work-Bu7IN8Rv.js:47:35700 | to | i | k: 1, duration: c, ease: r?"power3.inOut":"power3.out", overwrite: !1 |

## 6. Data flow

- ✔ `GET q3b5m2q9.apicdn.sanity.io/v2025-01-01/data/query/production` ×1 (HTTP 200), called from `main-DTyWc6eg.js:2:22917`. Feeds section 3.2.
  - Query: `{"p":*[_type=="project"&&defined(slug.current)]|order(coalesce(order,1e6) asc,_createdAt asc){"slug":slug.current,name,kind,cat,year,line,desc,url,"case":@["case"],credit,"img":img.asset->{url,"s":source.id,"n":source.name,"d":metadata.dimensions{width,height}},"media":media[].asset->{url,"s":source…`
  - Response keys: `query`, `result`, `syncTags`, `ms`

✔ Files the code fetched itself (not page assets):

- `/models/astronaut.glb` (330.0 KB) ← `GLRoot-EqD-37OA.js:2:1845`
- `/draco/draco_wasm_wrapper.js` (11.7 KB) ← `GLRoot-EqD-37OA.js:2:1845`
- `/draco/draco_decoder.wasm` (59.4 KB) ← `GLRoot-EqD-37OA.js:2:1845`

Full machine-readable spec: `api/openapi.json` (OpenAPI 3.1). Human view: `api.md`.

## 7. Interaction map

- ✔ window `keydown` → `main-DTyWc6eg.js:2:55016`
- ✔ window `pointerdown` → `main-DTyWc6eg.js:2:55016`
- ✔ window `touchend` → `main-DTyWc6eg.js:2:55016`
- ✔ window `click` → `main-DTyWc6eg.js:2:55016`
- ✔ window `keydown` → `main-DTyWc6eg.js:2:57973`
- ✔ window `keydown` → `main-DTyWc6eg.js:2:29438`
- ✔ window `keydown` → `LaterChapters-DnpwaFJD.js:620:2606 (j)`
- ✔ window `resize` → `main-DTyWc6eg.js:2:70680`
- ✔ document `selectionchange` → `react-DRp5II5X.js:37:17073 (uf)`
- ✔ document `visibilitychange` → `main-DTyWc6eg.js:2:40137`
- ✔ document `visibilitychange` → `main-DTyWc6eg.js:2:56415 (a)`
- ✔ document `visibilitychange` → `main-DTyWc6eg.js:2:101886`
- ✔ document `click` → `main-DTyWc6eg.js:2:49838 (callback of addEventListener())`
- ✔ 27 element listeners (webglcontextlost, webglcontextrestored, webglcontextcreationerror, click); per-section ones are listed in section 3.
- ≈ React attaches most handlers once at its root and dispatches them itself, so individual buttons may show no listener of their own.

The `keydown` handler on window:

_main-DTyWc6eg.js near line 2 (shipped bundle, re-indented by DEA)_

```js
const a = c => {
  const o = b.getState();
  o.tier !== "none" && (Fr(c.target) && !o.sound || o.sound && (!A.ac || A.ac.state !== "running")) && _r();
};
```

## 8. Rebuild it

≈ A sketch written by DEA from the measurements above, to start your own version. It is not the site's code.

**Set up**

```bash
npm create vite@latest my-site -- --template react
npm i three@0.170.0 gsap@3.15.0 react@18.3.1 react-dom@18.3.1 @react-three/fiber postprocessing
```

**Fonts:** Timeless Sans Grotesk (licence them before you use them).

**Renderer, as measured**

```js
import * as THREE from 'three';
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
```

**The "stardust-thread fragment shader" shader, wired the same way** (uniform names and starting values are the site's; the GLSL body is in section 4)

```js
const material = new THREE.ShaderMaterial({
  uniforms: {
    uOn: { value: 0.7496 }, // feeds the final colour
    uTime: { value: 0.8722 }, // a clock in seconds; anything multiplied by it moves on its o…
    uCore: { value: 0.55 }, // purpose not clear from its name; see how it is used below
    uGain: { value: 0.8488 }, // how strong the effect is; feeds the final colour
    uShade: { value: 0 }, // purpose not clear from its name; see how it is used below
    uDpr: { value: 1 }, // purpose not clear from its name; see how it is used below
    uCa: { value: new THREE.Color('#d2dfff') }, // blends/thresholds between values
    uCb: { value: new THREE.Color('#ffe5c6') }, // blends/thresholds between values
    uHot: { value: new THREE.Color('#fffaf3') }, // blends/thresholds between values
    uRect: { value: new THREE.Vector4() }, // purpose not clear from its name; see how it is used below
  },
  vertexShader, // see section 4
  fragmentShader,
});
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  material.uniforms.uTime.value = clock.getElapsedTime();
  renderer.render(scene, camera);
});
```

**The data**

```js
const res = await fetch('https://q3b5m2q9.apicdn.sanity.io/v2025-01-01/data/query/production?query=%7B%22p%22%3A*%5B_type%3D%3D%22project%22%26%26defined(slug.current)%5D%7Corder(coalesce(order%2C1e6)%20asc%2C_createdAt%20asc)%7B%22slug%22%3Aslug.current%2Cname%2Ckind%2Ccat%2Cyear%2Cline%2Cdesc%2Curl%2C%22case%22%3A%40%5B%22case%22%5D%2Ccredit%2C%22img%22%3Aimg.asset-%3E%7Burl%2C%22s%22%3Asource.id%2C%22n%22%3Asource.name%2C%22d%22%3Ametadata.dimensions%7Bwidth%2Cheight%7D%7D%2C%22media%22%3Amedia%5B%5D.asset-%3E%7Burl%2C%22s%22%3Asource.id%2C%22n%22%3Asource.name%2C%22d%22%3Ametadata.dimensions%7Bwidth%2Cheight%7D%7D%7D%2C%22s%22%3A*%5B_id%3D%3D%22siteSettings%22%5D%5B0%5D%7Bperson%2Coffer%2Csignoff%2Ccontact%2C%22featured%22%3Afeatured%5B%5D-%3Eslug.current%7D%7D');
const data = await res.json();
// keys DEA saw: query, result, syncTags, ms
```


## 9. What DEA could not see

- ? Original file and variable names (no public source maps). Structure, strings and numbers are real.
- ≈ WebGL ran in software on DEA's machine; the site may pick a different quality level on a real GPU.
- ? Animations that start only after a click or a route change are not in the timeline unless they ran while DEA scrolled.
- ? Code that runs inside workers, iframes from other sites, or WebAssembly is listed but not explained.

Evidence in this run folder: `code.json`, `code/scripts/`, `code/unpacked/`, `code/original/`, `shaders.json`, `api/openapi.json`, `network.har`, `progress.md`.
