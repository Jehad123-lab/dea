// Round 13: turn an extract's editable rebuild into one Framer code component. The component carries the rebuild
// runner (three.js from esm.sh) and loads the kit's rebuild files from a URL you host; the files cannot live in
// Framer. Shader uniforms that read as numbers or colours become property controls.

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import type { PipelineDoc, UniformValue } from '../replay/rebuild.ts';
import { REBUILD_RUNNER } from '../replay/runner.ts';

export interface FramerControl {
  /** prop name in the component */
  prop: string;
  material: number;
  uniform: string;
  kind: 'number' | 'color';
  /** the recorded value: a number, or [r, g, b] (0..1) for a colour */
  value: number | number[];
  min: number;
  max: number;
}

export interface FramerExport {
  /** the .tsx file to paste into a Framer code file */
  code: string;
  name: string;
  controls: FramerControl[];
}

const COLOR_NAME = /col(ou?r)?|tint|albedo|diffuse|emissive|bg|background/i;
const SKIP_NAME = /^(u?time|itime|iframe|frame|resolution|iresolution|mouse|imouse|pointer|scroll|dpr|pixelratio)$/i;

/** A safe PascalCase component name from a title or host. */
export function framerName(s: string): string {
  const words = s
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 4);
  const n = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Z]/.test(n) ? n : `Dea${n || 'Rebuild'}`;
}

const isNum = (v: UniformValue): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: UniformValue): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * Uniforms worth a property control: plain floats (not clocks or inputs the runner already drives) and 3- or
 * 4-component vectors named like a colour with every channel in 0..1. At most `limit`, in material order.
 */
export function framerControls(p: PipelineDoc, limit = 12): FramerControl[] {
  const driven = new Set<string>();
  for (const c of p.clocks ?? []) driven.add(`${c.program}|${c.uniform}`);
  for (const i of (p.inputs ?? []) as Array<{ program?: number; uniform?: string }>) if (i.uniform != null) driven.add(`${i.program}|${i.uniform}`);
  const out: FramerControl[] = [];
  const used = new Set<string>();
  for (const [m, mat] of p.materials.entries()) {
    for (const [name, v] of Object.entries(mat.uniforms ?? {})) {
      if (out.length >= limit) return out;
      if (SKIP_NAME.test(name) || driven.has(`${mat.program}|${name}`)) continue;
      const base = name.replace(/^u_?(?=[A-Z_])/, '').replace(/[^a-zA-Z0-9]/g, '') || 'value';
      let prop = base[0].toLowerCase() + base.slice(1);
      if (used.has(prop)) prop = `${prop}${m}`;
      if (isNum(v)) {
        const span = Math.max(1, Math.abs(v) * 4);
        out.push({ prop, material: m, uniform: name, kind: 'number', value: v, min: v < 0 ? -span : 0, max: span });
      } else if (isVec(v) && (v.length === 3 || v.length === 4) && COLOR_NAME.test(name) && v.every((x) => x >= 0 && x <= 1)) {
        out.push({ prop, material: m, uniform: name, kind: 'color', value: v.slice(0, 3), min: 0, max: 1 });
      } else continue;
      used.add(prop);
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const hex = (c: number[]) =>
  `#${c
    .map((x) =>
      Math.round(Math.min(1, Math.max(0, x)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** The runner as plain module code: three.js from esm.sh, no exports (a Framer code file exports only the component). */
export function framerRunner(threeRevision = '170'): string {
  return REBUILD_RUNNER.replace(/import \* as THREE_NS from 'three';/, `import * as THREE_NS from "https://esm.sh/three@0.${threeRevision}.0";`).replace(
    /^export (async function|function|const|class) /gm,
    '$1 ',
  );
}

/** Build the component. `url` is the default for its Source control (where public/rebuild/ is hosted). */
export function framerComponent(p: PipelineDoc, o: { name?: string; url?: string; threeRevision?: string; title?: string } = {}): FramerExport {
  const name = framerName(o.name ?? o.title ?? p.url ?? 'Rebuild');
  const controls = framerControls(p);
  const w = Math.max(1, Math.round(p.canvas?.cssW ?? p.canvas?.w ?? 1200));
  const h = Math.max(1, Math.round(p.canvas?.cssH ?? p.canvas?.h ?? 800));
  const ctrlJson = JSON.stringify(controls.map((c) => ({ prop: c.prop, m: c.material, u: c.uniform, kind: c.kind })));
  const defaults = controls.map((c) => `  ${c.prop}: ${c.kind === 'color' ? JSON.stringify(hex(c.value as number[])) : round(c.value as number)},`).join('\n');
  const propCtrls = controls
    .map((c) =>
      c.kind === 'color'
        ? `  ${c.prop}: { type: ControlType.Color, title: ${JSON.stringify(c.uniform)}, defaultValue: ${JSON.stringify(hex(c.value as number[]))} },`
        : `  ${c.prop}: { type: ControlType.Number, title: ${JSON.stringify(c.uniform)}, defaultValue: ${round(c.value as number)}, min: ${round(c.min)}, max: ${round(c.max)}, step: ${round(Math.max(0.001, (c.max - c.min) / 200))} },`,
    )
    .join('\n');
  const code = `// @ts-nocheck
// ${name}: the editable rebuild of ${p.url} made by DEA (dea framer), as one Framer code component.
// Host the kit's framer/site folder anywhere static (Vercel, Netlify, GitHub Pages) and put its URL + "/rebuild/"
// in the Source control. Geometry and textures come from those files: they belong to the site's owner unless the
// kit was made with --own-assets.
import { useEffect, useRef, useState } from "react"
import { addPropertyControls, ControlType, RenderTarget } from "framer"

${framerRunner(o.threeRevision)}

const CONTROLS = ${ctrlJson}

const toRgb = (c) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(c || ""))
  if (m) return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
  const r = /rgba?\\(([^)]+)\\)/i.exec(String(c || ""))
  return r ? r[1].split(",").slice(0, 3).map((x) => Number.parseFloat(x) / 255) : null
}

function applyControls(rb, props) {
  for (const c of CONTROLS) {
    const v = props[c.prop]
    if (v == null) continue
    const cur = rb.pipeline.materials[c.m]?.uniforms?.[c.u]
    if (c.kind === "color") {
      const rgb = toRgb(v)
      if (rgb) rb.setUniform(c.m, c.u, Array.isArray(cur) && cur.length === 4 ? [...rgb, cur[3]] : rgb)
    } else rb.setUniform(c.m, c.u, Number(v))
  }
}

/**
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 * @framerIntrinsicWidth ${w}
 * @framerIntrinsicHeight ${h}
 * @framerDisableUnlink
 */
export default function ${name}(props) {
  const { source, poster, interactive, live, maxDpr, style } = props
  const wrap = useRef(null)
  const canvas = useRef(null)
  const rbRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  // why it is blank, shown only in the Framer editor (a visitor sees the poster or nothing, never an error box)
  const [why, setWhy] = useState("")
  const inCanvas = RenderTarget.current() === RenderTarget.canvas

  useEffect(() => {
    if (!source) {
      setWhy("Set Source to the URL of the hosted framer/site folder + /rebuild/")
      return
    }
    if (!canvas.current) return
    let alive = true
    let io = null
    let ro = null
    let rb = null
    const el = canvas.current
    const onLost = (e) => {
      e.preventDefault()
      setFailed(true)
      setWhy("WebGL stopped on this device (context lost); the poster is shown instead")
      rb?.stop()
    }
    el.addEventListener("webglcontextlost", onLost)
    const inEditor = RenderTarget.current() !== RenderTarget.preview
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
    const still = !live || reduced || inEditor || (typeof location !== "undefined" && /[?&]static\\b/.test(location.search))
    const base = source.endsWith("/") ? source : source + "/"
    setFailed(false)
    setReady(false)
    setWhy("")
    loadPipeline(base)
      .then((data) => {
        if (!alive) return
        const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, maxDpr || 1.5)
        rb = createRebuild(el, data, { listen: interactive && !inEditor, resize: false, pixelRatio: dpr })
        rbRef.current = rb
        applyControls(rb, props)
        rb.fit()
        ro = new ResizeObserver(() => rb.fit())
        ro.observe(wrap.current)
        if (still) rb.renderFrames()
        else {
          // run only while on screen: low-end phones keep their battery and frame budget
          io = new IntersectionObserver(([e]) => (e.isIntersecting ? rb.start() : rb.stop()))
          io.observe(wrap.current)
        }
        setReady(true)
      })
      .catch((e) => {
        if (!alive) return
        setFailed(true)
        const msg = String(e?.message || e)
        setWhy(
          /fetch|network|cors|load|json|unexpected token|404/i.test(msg)
            ? \`Could not load \${base}pipeline.json. Check the URL ends in /rebuild/ and the host sends Access-Control-Allow-Origin (vercel.json or _headers from framer/site).\`
            : \`The rebuild did not start: \${msg.slice(0, 160)}\`,
        )
        if (typeof console !== "undefined") console.warn("[dea]", msg)
      })
    return () => {
      alive = false
      el.removeEventListener("webglcontextlost", onLost)
      io?.disconnect()
      ro?.disconnect()
      rb?.stop()
      rb?.renderer?.dispose()
      rbRef.current = null
    }
  }, [source, interactive, live, maxDpr])

  useEffect(() => {
    if (rbRef.current) applyControls(rbRef.current, props)
  })

  const fill = { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }
  return (
    <div ref={wrap} style={{ position: "relative", overflow: "hidden", ...style }}>
      {poster?.src && (!ready || failed) ? <img src={poster.src} srcSet={poster.srcSet} alt={poster.alt || ""} style={{ ...fill, objectFit: "cover" }} /> : null}
      <canvas ref={canvas} style={{ ...fill, opacity: ready && !failed ? 1 : 0 }} />
      {why && inCanvas ? (
        <div role="status" style={{ position: "absolute", left: 12, right: 12, bottom: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(20,20,24,0.88)", color: "#fff", font: "500 12px/1.4 Inter, sans-serif" }}>
          {why}
        </div>
      ) : null}
    </div>
  )
}

${name}.defaultProps = {
  source: ${JSON.stringify(o.url ?? '')},
  interactive: true,
  live: true,
  maxDpr: 1.5,
${defaults}
}

addPropertyControls(${name}, {
  source: { type: ControlType.String, title: "Source", placeholder: "https://your-site.vercel.app/rebuild/", defaultValue: ${JSON.stringify(o.url ?? '')} },
  poster: { type: ControlType.ResponsiveImage, title: "Poster" },
  live: { type: ControlType.Boolean, title: "Animate", defaultValue: true },
  interactive: { type: ControlType.Boolean, title: "Follow input", defaultValue: true },
  maxDpr: { type: ControlType.Number, title: "Max DPR", defaultValue: 1.5, min: 1, max: 3, step: 0.25 },
${propCtrls}
})
`;
  return { code, name, controls };
}

/** Headers so a page on another origin (Framer) may fetch the hosted files. */
export const FRAMER_HOST_FILES: Record<string, string> = {
  'vercel.json': `${JSON.stringify({ headers: [{ source: '/(.*)', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] }] }, null, 2)}\n`,
  _headers: '/*\n  Access-Control-Allow-Origin: *\n',
};

export interface FramerWriteResult {
  /** the component file */
  file: string;
  /** the folder to deploy */
  site: string;
  name: string;
  controls: FramerControl[];
  /** true when the hosted files include the site's recorded bytes (kit made without --own-assets) */
  siteFiles: boolean;
}

/**
 * Write framer/<Name>.tsx and framer/site/ (the rebuild files plus CORS headers for Vercel and Netlify) into a kit.
 * Refuses a kit that carries the site's recorded files unless `allowSiteFiles`: a Framer template is made to be sold.
 */
export async function writeFramerExport(
  kit: string,
  o: { name?: string; url?: string; threeRevision?: string; allowSiteFiles?: boolean } = {},
): Promise<FramerWriteResult> {
  const manifest = JSON.parse(await readFile(join(kit, 'dea-kit.json'), 'utf8')) as { url: string; title?: string; ownAssets?: boolean };
  let pipeline: PipelineDoc;
  try {
    pipeline = JSON.parse(await readFile(join(kit, 'public', 'rebuild', 'pipeline.json'), 'utf8')) as PipelineDoc;
  } catch {
    throw new Error(
      `This kit has no editable rebuild (public/rebuild/pipeline.json). Extract a page with a WebGL canvas first: dea extract <url> --own-assets`,
    );
  }
  const siteFiles = manifest.ownAssets !== true;
  if (siteFiles && !o.allowSiteFiles)
    throw new Error(
      `This kit carries the site's own recorded files, and a Framer component is made to be shared or sold. Extract again with --own-assets (dea extract ${manifest.url} --own-assets), or pass --allow-site-files for a private test.`,
    );
  const out = framerComponent(pipeline, { name: o.name, title: manifest.title || manifest.url, url: o.url, threeRevision: o.threeRevision });
  const dir = join(kit, 'framer');
  const site = join(dir, 'site');
  await mkdir(join(site, 'rebuild'), { recursive: true });
  await cp(join(kit, 'public', 'rebuild'), join(site, 'rebuild'), { recursive: true });
  // the binary may sit beside pipeline.json (--own-assets) or be the capture replay's (../replay/capture.bin)
  const data = posix.normalize(posix.join('rebuild', pipeline.data));
  if (!data.startsWith('rebuild/')) {
    if (data.startsWith('..')) throw new Error(`pipeline.json points outside the kit (${pipeline.data}).`);
    await mkdir(dirname(join(site, data)), { recursive: true });
    await cp(join(kit, 'public', data), join(site, data));
  }
  for (const [f, body] of Object.entries(FRAMER_HOST_FILES)) await writeFile(join(site, f), body);
  const file = join(dir, `${out.name}.tsx`);
  await writeFile(file, out.code);
  await writeFile(join(dir, 'README.md'), framerReadme(out, manifest.url, siteFiles));
  return { file, site, name: out.name, controls: out.controls, siteFiles };
}

export function framerReadme(out: FramerExport, url: string, siteFiles: boolean): string {
  return `# ${out.name} for Framer

The editable rebuild of ${url}, made by DEA (\`dea framer\`).

1. Deploy the \`site\` folder to any static host. For example: \`npx vercel deploy site --prod\`. CORS headers for
   Vercel (\`vercel.json\`) and Netlify (\`_headers\`) are included, so Framer can load the files.
2. In Framer: Assets > Code > New file, name it ${out.name}, paste \`${out.name}.tsx\`.
3. Drop the component on the canvas and set **Source** to your deploy URL + \`/rebuild/\`.
4. Set a **Poster** image: it shows while loading and if WebGL fails.

Controls: Source, Poster, Animate, Follow input, Max DPR (1.5 by default for low-end phones)${out.controls.length ? `, and the shader values DEA found: ${out.controls.map((c) => `${c.uniform} (${c.kind})`).join(', ')}` : ''}.

In the Framer editor the component draws one still frame; it animates in Preview and on the published site, only
while on screen. Reduced motion or \`?static\` in the page URL keeps it still.
${siteFiles ? "\n**Warning:** these files include the site's own recorded geometry and textures. Keep this private; do not sell or publish it. Extract again with --own-assets for a shareable version.\n" : ''}`;
}
