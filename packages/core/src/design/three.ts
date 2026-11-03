import type { Page } from 'playwright';

export interface ThreeScene {
  renderers: Array<{
    kind: string;
    pixelRatio: number | null;
    size: string | null;
    toneMapping: string | null;
    exposure: number | null;
    colorSpace: string | null;
    shadows: string | null;
    calls: number | null;
    triangles: number | null;
    points: number | null;
    geometries: number | null;
    textures: number | null;
    programs: number | null;
    antialias: boolean | null;
  }>;
  scenes: Array<{
    objects: number;
    types: Record<string, number>;
    materials: Record<string, number>;
    lights: Array<{ type: string; color: string | null; intensity: number | null }>;
    cameras: Array<{ type: string; fov: number | null }>;
    background: string | null;
    environment: boolean;
    fog: string | null;
    vertices: number;
    instances: number;
    names: string[];
  }>;
}

/** Read the live three.js renderers and scenes that three itself announced to its devtools hook. */
export async function readThree(page: Page): Promise<ThreeScene> {
  return page.evaluate(() => {
    const D = (window as any).__DEA__?.three ?? { renderers: [], scenes: [] };
    const TONE: Record<number, string> = { 0: 'none', 1: 'Linear', 2: 'Reinhard', 3: 'Cineon', 4: 'ACES Filmic', 5: 'Custom', 6: 'AgX', 7: 'Neutral' };
    const SHADOW: Record<number, string> = { 0: 'Basic', 1: 'PCF', 2: 'PCF soft', 3: 'VSM' };
    const hex = (c: any) => (c?.isColor ? `#${c.getHexString()}` : null);
    const safe = <T>(f: () => T): T | null => {
      try {
        const v = f();
        return v === undefined ? null : v;
      } catch {
        return null;
      }
    };
    const renderers = D.renderers.slice(0, 6).map((r: any) => ({
      kind: r.isWebGPURenderer ? 'WebGPURenderer' : r.isWebGLRenderer ? 'WebGLRenderer' : (r.constructor?.name ?? 'renderer'),
      pixelRatio: safe(() => r.getPixelRatio()),
      size: safe(() => `${r.domElement.width}×${r.domElement.height}`),
      toneMapping: safe(() => TONE[r.toneMapping] ?? String(r.toneMapping)),
      exposure: safe(() => Math.round(r.toneMappingExposure * 100) / 100),
      colorSpace: safe(() => r.outputColorSpace ?? (r.outputEncoding === 3001 ? 'sRGB (legacy)' : null)),
      shadows: safe(() => (r.shadowMap?.enabled ? (SHADOW[r.shadowMap.type] ?? 'on') : 'off')),
      calls: safe(() => r.info.render.calls),
      triangles: safe(() => r.info.render.triangles),
      points: safe(() => r.info.render.points),
      geometries: safe(() => r.info.memory.geometries),
      textures: safe(() => r.info.memory.textures),
      programs: safe(() => r.info.programs?.length ?? null),
      antialias: safe(() => r.getContext?.().getContextAttributes?.().antialias ?? null),
    }));
    const scenes = D.scenes.slice(0, 6).map((s: any) => {
      const types: Record<string, number> = {};
      const materials: Record<string, number> = {};
      const lights: any[] = [];
      const cameras: any[] = [];
      const names = new Set<string>();
      let objects = 0;
      let vertices = 0;
      let instances = 0;
      const seenMat = new Set();
      try {
        s.traverse((o: any) => {
          objects++;
          types[o.type] = (types[o.type] ?? 0) + 1;
          if (o.name && names.size < 40 && !/^(Scene|Object3D|Group|mesh_\d+|node_\d+)$/i.test(o.name)) names.add(o.name);
          if (o.isLight) lights.push({ type: o.type, color: hex(o.color), intensity: Math.round((o.intensity ?? 0) * 100) / 100 });
          if (o.isCamera) cameras.push({ type: o.type, fov: o.fov ?? null });
          if (o.isInstancedMesh) instances += o.count ?? 0;
          const pos = o.geometry?.attributes?.position;
          if (pos) vertices += pos.count * (o.isInstancedMesh ? (o.count ?? 1) : 1);
          for (const m of [].concat(o.material ?? [])) {
            if (!m || seenMat.has(m)) continue;
            seenMat.add(m);
            materials[(m as any).type] = (materials[(m as any).type] ?? 0) + 1;
          }
        });
      } catch {
        /* scene changed while reading */
      }
      return {
        objects,
        types,
        materials,
        lights: lights.slice(0, 20),
        cameras: cameras.slice(0, 6),
        background: safe(() => (s.background?.isColor ? hex(s.background) : s.background?.isTexture ? 'texture' : null)),
        environment: !!s.environment,
        fog: safe(() => (s.fog ? `${s.fog.isFogExp2 ? 'exp2' : 'linear'} ${hex(s.fog.color)}` : null)),
        vertices,
        instances,
        names: [...names],
      };
    });
    return { renderers, scenes };
  });
}
