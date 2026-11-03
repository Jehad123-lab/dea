// Network → source → runtime, as one chain: which script line asked for a file (Chrome's initiator stack, mapped
// through the site's published source maps when there are any), and where the pixels end up (program, sampler, the
// shader line that samples them). Plus the render pipeline of one frame: which program drew into which target, in order.

import { SourceMapConsumer } from 'source-map-js';
import type { CdpFrame } from '../code/initiator.ts';

export interface Origin {
  /** "src/gl/blueNoise.js:6 (load)" or "index-B2x.js:1:20345 (Xe)" */
  where: string;
  /** the library call it went through, e.g. "three-DVjc41Gk.js (load)" */
  via?: string;
  /** the code at that position (bundled code when there is no source map) */
  excerpt?: string;
  label: 'Verified' | 'Inferred';
  how: string;
  frames: string[];
}

const LIB =
  /node_modules|\/three\/|three\.module|\bthree-[\w-]+\.js|\br3f-[\w-]+\.js|\bpost-[\w-]+\.js|\bdrei-|gsap|react-dom|scheduler|@react-three|postprocessing|vite\/|webpack\/runtime|\bvendor\b|polyfill|framework-[\w]+\.js/i;

/** Map CDP frames through source maps (fetched once per script) and pick the first frame in the site's own code. */
export async function originOf(
  frames: CdpFrame[],
  fetchText: (url: string) => Promise<string | null>,
  cache: Map<string, SourceMapConsumer | null>,
  texts: Map<string, string> = new Map(),
): Promise<Origin | null> {
  const code = frames.filter((f) => /^https?:/.test(f.url));
  if (!code.length) return null;
  const mapped: Array<{ text: string; lib: boolean; mapped: boolean; f: CdpFrame; content?: string | null }> = [];
  for (const f of code.slice(0, 16)) {
    let consumer = cache.get(f.url);
    if (consumer === undefined) {
      consumer = null;
      try {
        const js = await fetchText(f.url);
        if (js) texts.set(f.url, js);
        const ref = js ? /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m.exec(js.slice(-2000))?.[1] : null;
        let raw: string | null = null;
        if (ref?.startsWith('data:')) raw = Buffer.from(ref.slice(ref.indexOf(',') + 1), ref.includes(';base64') ? 'base64' : 'utf8').toString('utf8');
        else raw = await fetchText(new URL(ref ?? `${f.url.split('?')[0]}.map`, f.url).href);
        if (raw?.trim().startsWith('{')) consumer = new SourceMapConsumer(JSON.parse(raw));
      } catch {
        consumer = null;
      }
      cache.set(f.url, consumer);
    }
    const file = f.url.split('?')[0].split('/').pop() ?? f.url;
    if (consumer) {
      const pos = consumer.originalPositionFor({ line: f.lineNumber + 1, column: f.columnNumber });
      if (pos.source) {
        const src = pos.source.replace(/^webpack:\/\/\/?|^\.\.\/|^\/?(\.\/)?/g, '').replace(/^(\.\.\/)+/, '');
        const content = pos.line ? consumer.sourceContentFor(pos.source, true)?.split('\n')[pos.line - 1]?.trim().slice(0, 140) : null;
        mapped.push({
          text: `${src}:${pos.line}${pos.name || f.functionName ? ` (${pos.name || f.functionName})` : ''}`,
          lib: LIB.test(src),
          mapped: true,
          f,
          content,
        });
        continue;
      }
    }
    mapped.push({
      text: `${file}:${f.lineNumber + 1}:${f.columnNumber + 1}${f.functionName ? ` (${f.functionName})` : ''}`,
      lib: LIB.test(f.url),
      mapped: false,
      f,
    });
  }
  const own = mapped.find((m) => m.mapped && !m.lib) ?? mapped.find((m) => !m.lib) ?? mapped[0];
  const lib = mapped.find((m) => m.lib);
  // the code at that position: the original line from the source map, or a slice of the bundled line around the column
  let excerpt = own.content ?? undefined;
  if (!excerpt) {
    const line = texts.get(own.f.url)?.split('\n')[own.f.lineNumber];
    if (line) excerpt = line.slice(Math.max(0, own.f.columnNumber - 70), own.f.columnNumber + 90).trim();
  }
  return {
    where: own.text,
    via: lib && lib !== own ? lib.text : undefined,
    excerpt,
    label: 'Verified',
    how: own.mapped ? 'Chrome’s initiator stack, mapped through the site’s source map' : 'Chrome’s initiator stack (no source map published: bundle position)',
    frames: mapped.map((m) => m.text).slice(0, 8),
  };
}

/** The first line in a program's shaders that samples this sampler: "fragment line 212: vec4 bnz = texture2D(tBlue, …)". */
export function samplingLine(shaders: string[], sampler: string): { stage: 'vertex' | 'fragment'; line: number; code: string } | null {
  const re = new RegExp(`\\b(texture2D|texture|textureLod|texelFetch|texture2DLodEXT)\\s*\\(\\s*${sampler.replace(/[^\w]/g, '')}\\b`);
  for (const src of shaders) {
    const stage = /gl_Position/.test(src) && !/gl_FragColor|pc_fragColor|out\s+(highp\s+|mediump\s+)?vec4\s+\w+\s*;/.test(src) ? 'vertex' : 'fragment';
    const lines = src.split('\n');
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) return { stage, line: i + 1, code: lines[i].trim().slice(0, 120) };
  }
  return null;
}

export interface Draw {
  program: string;
  target: string;
  inputs: string[];
}

export interface Pass {
  index: number;
  /** "screen" or a texture id */
  target: string;
  programs: string[];
  draws: number;
  inputs: string[];
}

/** Group one frame's draw calls into passes: consecutive draws into the same target are one pass. */
export function passesOf(draws: Draw[]): Pass[] {
  const out: Pass[] = [];
  for (const d of draws) {
    const last = out[out.length - 1];
    if (last && last.target === d.target) {
      last.draws++;
      if (!last.programs.includes(d.program)) last.programs.push(d.program);
      for (const i of d.inputs) if (!last.inputs.includes(i)) last.inputs.push(i);
    } else out.push({ index: out.length + 1, target: d.target, programs: [d.program], draws: 1, inputs: [...d.inputs] });
  }
  return out;
}
