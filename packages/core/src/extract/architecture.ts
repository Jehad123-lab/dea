// Site architecture breakdown and online technique research:
// 1. Maps the ordered render & post-processing chain, groups shaders by owner/role, and summarizes DOM-to-WebGL sync,
//    scroll physics, and motion systems from decoded runtime data.
// 2. When custom/minified techniques need external explanation, queries online sources (Codrops, GitHub, Shadertoy, docs)
//    via DEA's web/research module and records source URLs + synthesis notes for building a cleaner, scalable version.

import type { NetworkSummary } from '../see/network.ts';
import { type Passage, type ResearchOptions, research as researchWeb } from '../web/research.ts';
import type { PipelinePass, ProgramSource, ShaderModule } from './generate.ts';
import type { PageLayer } from './pagelayer.ts';

export type PassRole = 'scene' | 'bloom' | 'grade' | 'dom-sync' | 'distortion' | 'antialias' | 'upscale' | 'blur' | 'post';

export interface OrderedPass {
  index: number;
  target: string;
  programs: string[];
  programNames: string[];
  draws: number;
  inputs: string[];
  role: PassRole;
}

export interface ShaderGroup {
  owner: string;
  role: PassRole;
  fullscreen: boolean;
  points: boolean;
  uniforms: string[];
  drivers: string[];
  samplers: string[];
}

export interface ScrollArchitecture {
  mechanism: 'native' | 'wheel' | 'unknown';
  wheelRatio: number | null;
  documentHeight: number | null;
  fixedCount: number;
  movingCount: number;
  staticCount: number;
  hasBackgroundTransitions: boolean;
}

export interface TechniqueSignal {
  id: string;
  label: string;
  evidence: string;
  query: string;
  passages: Passage[];
}

export interface ArchitectureReport {
  site: string;
  stack: string[];
  postChain: OrderedPass[];
  shaderGroups: ShaderGroup[];
  domSyncDetected: boolean;
  scroll: ScrollArchitecture;
  network: {
    requests: number;
    models: number;
    textures: number;
    fonts: number;
  } | null;
  techniques: TechniqueSignal[];
  synthesisNotes: string[];
}

export function classifyPassRole(names: string[], target: string, draws: number): PassRole {
  const joined = names.join(' ').toLowerCase();
  if (/smaa|fxaa|msaa|antialias/.test(joined)) return 'antialias';
  if (/fsr|upscal|cas|sharpen/.test(joined)) return 'upscale';
  if (/bloom|glow|luminance|threshold/.test(joined)) return 'bloom';
  if (/ufx|dom|quad|text|plane/.test(joined) && draws <= 4) return 'dom-sync';
  if (/screenpaint|paint|distort|warp|fluid|ripple|velocity/.test(joined)) return 'distortion';
  if (/grade|tone|lut|color|final|aces|filmic/.test(joined)) return 'grade';
  if (/blur|kawase|gaussian|bokeh|dof/.test(joined)) return 'blur';
  if (draws > 2 || target !== 'screen') return 'scene';
  return 'post';
}

export function analyzeArchitecture(input: {
  site: string;
  stack?: string[];
  passes?: PipelinePass[];
  programs?: ProgramSource[];
  mods?: ShaderModule[];
  pageLayer?: PageLayer | null;
  network?: NetworkSummary | null;
}): ArchitectureReport {
  const passes = input.passes ?? [];
  const mods = input.mods ?? [];
  const stack = [...new Set((input.stack ?? []).filter(Boolean))];

  const postChain: OrderedPass[] = passes.map((p) => ({
    ...p,
    role: classifyPassRole(p.programNames, p.target, p.draws),
  }));

  const shaderGroups: ShaderGroup[] = mods.map((m) => {
    const role = classifyPassRole([m.name], m.fullscreen ? 'screen' : 'rt', 1);
    return {
      owner: m.name,
      role,
      fullscreen: m.fullscreen,
      points: m.points,
      uniforms: m.uniforms.map((u) => u.name),
      drivers: [...new Set(m.uniforms.map((u) => (u.driver ? String(u.driver.kind) : '')).filter(Boolean))],
      samplers: m.textures.map((t) => t.sampler),
    };
  });

  const domSyncDetected =
    postChain.some((p) => p.role === 'dom-sync') || shaderGroups.some((g) => g.role === 'dom-sync' || g.samplers.some((s) => /dom|text|ufx/i.test(s)));

  const pl = input.pageLayer ?? null;
  const scroll: ScrollArchitecture = {
    mechanism: pl ? pl.mechanism : 'unknown',
    wheelRatio: pl?.wheelRatio ?? null,
    documentHeight: pl?.documentHeight ?? null,
    fixedCount: pl?.counts.fixed ?? 0,
    movingCount: pl?.counts.moving ?? 0,
    staticCount: pl?.counts.static ?? 0,
    hasBackgroundTransitions: (pl?.backgrounds.length ?? 0) > 1,
  };

  const techniques: TechniqueSignal[] = [];
  if (postChain.length >= 3) {
    const chainSummary = postChain
      .slice(0, 8)
      .map((p) => `${p.programNames[0] ?? p.role} (${p.role})`)
      .join(' → ');
    techniques.push({
      id: 'post-chain',
      label: 'Ordered WebGL post-processing pipeline',
      evidence: `${postChain.length} passes detected: ${chainSummary}`,
      query: 'three.js custom postprocessing EffectComposer multi pass bloom tone mapping SMAA',
      passages: [],
    });
  }
  if (domSyncDetected) {
    techniques.push({
      id: 'dom-webgl-sync',
      label: 'DOM-to-WebGL quad synchronization',
      evidence: 'Full-screen / quad shaders sampling DOM or UFX textures',
      query: 'sync DOM elements with WebGL Three.js quads scroll shader Codrops',
      passages: [],
    });
  }
  if (scroll.mechanism === 'wheel' || (scroll.wheelRatio !== null && Math.abs(scroll.wheelRatio - 1) > 0.1)) {
    techniques.push({
      id: 'virtual-scroll',
      label: 'Virtual / damped scroll physics',
      evidence: `mechanism=${scroll.mechanism}, wheelRatio=${scroll.wheelRatio ?? 'n/a'}, moving=${scroll.movingCount}`,
      query: 'Lenis smooth scroll React Three Fiber useScroll motion/react architecture',
      passages: [],
    });
  }
  if (shaderGroups.some((g) => g.points)) {
    techniques.push({
      id: 'gpu-particles',
      label: 'GPU particle / point-cloud simulation',
      evidence: `Point-cloud shader(s): ${shaderGroups
        .filter((g) => g.points)
        .map((g) => g.owner)
        .join(', ')}`,
      query: 'Three.js FBO GPGPU particles ping pong render target tutorial',
      passages: [],
    });
  }
  if (shaderGroups.some((g) => g.role === 'distortion')) {
    techniques.push({
      id: 'screen-distortion',
      label: 'Pointer / fluid screen distortion pass',
      evidence: `Distortion shader(s): ${shaderGroups
        .filter((g) => g.role === 'distortion')
        .map((g) => g.owner)
        .join(', ')}`,
      query: 'WebGL screen paint fluid velocity pointer distortion shader Three.js',
      passages: [],
    });
  }

  const synthesisNotes: string[] = [];
  if (scroll.mechanism === 'wheel' || scroll.movingCount > 0) {
    synthesisNotes.push('Use Lenis for smooth wheel damping paired with motion/react useScroll + useTransform instead of fixed-pixel absolute positioning.');
  }
  if (postChain.length > 0) {
    synthesisNotes.push(
      `Preserve pass order (${postChain
        .slice(0, 6)
        .map((p) => p.role)
        .join(' → ')}) in modular R3F / Three.js render targets.`,
    );
  }
  if (domSyncDetected) {
    synthesisNotes.push(
      'Keep text/layout semantic in React/Next.js HTML for accessibility and responsiveness, and bind WebGL planes via ResizeObserver/getBoundingClientRect.',
    );
  }

  return {
    site: input.site,
    stack,
    postChain,
    shaderGroups,
    domSyncDetected,
    scroll,
    network: input.network
      ? {
          requests: input.network.requests,
          models: input.network.models.length,
          textures: input.network.byKind.texture?.count ?? 0,
          fonts: input.network.fonts.length,
        }
      : null,
    techniques,
    synthesisNotes,
  };
}

/**
 * Enrich an ArchitectureReport by searching online for how each detected technique is built.
 * Returns a new report with top passages attached to each technique.
 */
export async function researchArchitecture(
  report: ArchitectureReport,
  options: Omit<ResearchOptions, 'urls'> & { maxTechniques?: number } = {},
): Promise<ArchitectureReport> {
  const limit = options.maxTechniques ?? 3;
  const enriched: TechniqueSignal[] = [];
  for (let i = 0; i < report.techniques.length; i++) {
    const t = report.techniques[i];
    if (i >= limit) {
      enriched.push(t);
      continue;
    }
    try {
      const res = await researchWeb(t.query, {
        ...options,
        pages: options.pages ?? 2,
        passages: options.passages ?? 3,
        timeoutMs: options.timeoutMs ?? 20_000,
      });
      enriched.push({ ...t, passages: res.passages });
    } catch {
      enriched.push(t);
    }
  }
  return { ...report, techniques: enriched };
}

export function renderArchitectureMd(report: ArchitectureReport): string {
  const L: string[] = [
    `# Architecture & Technique Breakdown: ${report.site}`,
    '',
    `- **Stack**: ${report.stack.length ? report.stack.join(', ') : 'none detected'}`,
    `- **DOM-to-WebGL sync**: ${report.domSyncDetected ? 'yes' : 'no'}`,
    `- **Scroll**: ${report.scroll.mechanism}${report.scroll.wheelRatio ? ` (wheelRatio ${report.scroll.wheelRatio})` : ''} · static ${report.scroll.staticCount}, moving ${report.scroll.movingCount}, fixed ${report.scroll.fixedCount}`,
  ];
  if (report.network) {
    L.push(
      `- **Network**: ${report.network.requests} requests · ${report.network.models} 3D models · ${report.network.textures} textures · ${report.network.fonts} fonts`,
    );
  }
  L.push('', '## Ordered Render & Post-Processing Chain', '');
  if (report.postChain.length === 0) {
    L.push('_No multi-pass render graph recorded._', '');
  } else {
    for (const p of report.postChain.slice(0, 30)) {
      L.push(`${p.index + 1}. **${p.role}** → \`${p.target}\` (${p.draws} draw${p.draws === 1 ? '' : 's'}): ${p.programNames.join(', ') || 'program'}`);
    }
    L.push('');
  }
  L.push('## Shaders by Owner / Pass', '');
  if (report.shaderGroups.length === 0) {
    L.push('_No custom shader modules extracted._', '');
  } else {
    for (const g of report.shaderGroups) {
      L.push(
        `- **${g.owner}** (${g.role}${g.fullscreen ? ', fullscreen' : ''}${g.points ? ', points' : ''}): drivers=[${g.drivers.join(', ') || 'none'}], samplers=[${g.samplers.join(', ') || 'none'}]`,
      );
    }
    L.push('');
  }
  L.push('## Techniques & Online Research', '');
  if (report.techniques.length === 0) {
    L.push('_No advanced techniques flagged._', '');
  } else {
    for (const t of report.techniques) {
      L.push(`### ${t.label}`, `- **Evidence**: ${t.evidence}`, `- **Search query**: \`${t.query}\``);
      if (t.passages.length) {
        L.push('- **References**:');
        for (const p of t.passages) L.push(`  - [${p.title || p.url}](${p.url}): ${p.text.slice(0, 200).replace(/\s+/g, ' ')}...`);
      }
      L.push('');
    }
  }
  if (report.synthesisNotes.length) {
    L.push('## Scalable Synthesis Notes', '');
    for (const n of report.synthesisNotes) L.push(`- ${n}`);
    L.push('');
  }
  return L.join('\n');
}
