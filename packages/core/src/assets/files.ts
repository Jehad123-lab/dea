// Recognise and read the visual files a page loads: images, compressed textures, environment maps, 3D models,
// video, Lottie, Rive, fonts. Small readers of our own (no dependencies) for the headers that matter.

export type AssetKind = 'image' | 'svg' | 'ktx2' | 'basis' | 'hdr' | 'exr' | 'glb' | 'gltf' | 'model-bin' | 'video' | 'lottie' | 'rive' | 'font' | 'other';

export function classify(url: string, mime: string, head?: Uint8Array): AssetKind | null {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  const ext = /\.([a-z0-9]+)$/.exec(path)?.[1] ?? '';
  const m = mime.toLowerCase();
  const magic = (s: string) => head && head.length >= s.length && [...s].every((c, i) => head[i] === c.charCodeAt(0));
  if (ext === 'ktx2' || (head && head[0] === 0xab && head[1] === 0x4b && head[2] === 0x54 && head[3] === 0x58)) return 'ktx2';
  if (ext === 'basis') return 'basis';
  if (ext === 'hdr' || magic('#?RADIANCE') || magic('#?RGBE')) return 'hdr';
  if (ext === 'exr' || (head && head[0] === 0x76 && head[1] === 0x2f && head[2] === 0x31 && head[3] === 0x01)) return 'exr';
  if (ext === 'glb' || magic('glTF')) return 'glb';
  if (ext === 'gltf' || m.includes('gltf+json')) return 'gltf';
  if (ext === 'riv' || magic('RIVE')) return 'rive';
  if (ext === 'lottie' || (ext === 'json' && /lottie|bodymovin|anim/i.test(path))) return 'lottie';
  if (/^font\/|woff|opentype|truetype/.test(m) || /^(woff2?|ttf|otf)$/.test(ext)) return 'font';
  if (m === 'image/svg+xml' || ext === 'svg') return 'svg';
  if (m.startsWith('image/') || /^(png|jpe?g|webp|avif|gif)$/.test(ext)) return 'image';
  if (m.startsWith('video/') || /^(mp4|webm|mov|m4v)$/.test(ext)) return 'video';
  if (ext === 'bin' && /model|gltf|mesh|draco|scene/i.test(path)) return 'model-bin';
  if (ext === 'drc') return 'model-bin';
  return null;
}

/** A JSON body that is a Lottie animation (bodymovin export): version, frame rate, in/out points, layers. */
export interface LottieSummary {
  version: string;
  fps: number;
  frames: number;
  seconds: number;
  width: number;
  height: number;
  layers: string[];
  assets: number;
  markers: string[];
}

export function lottieSummary(j: any): LottieSummary | null {
  if (!j || typeof j !== 'object' || typeof j.v !== 'string' || typeof j.fr !== 'number' || !Array.isArray(j.layers)) return null;
  const frames = Number(j.op ?? 0) - Number(j.ip ?? 0);
  return {
    version: j.v,
    fps: j.fr,
    frames,
    seconds: Math.round((frames / j.fr) * 100) / 100,
    width: Number(j.w ?? 0),
    height: Number(j.h ?? 0),
    layers: j.layers
      .slice(0, 40)
      .map(
        (l: any) =>
          `${l.nm ?? 'layer'} (${({ 0: 'precomp', 1: 'solid', 2: 'image', 3: 'null', 4: 'shape', 5: 'text' } as Record<number, string>)[l.ty] ?? `type ${l.ty}`})`,
      ),
    assets: Array.isArray(j.assets) ? j.assets.length : 0,
    markers: Array.isArray(j.markers) ? j.markers.map((m: any) => String(m.cm ?? '')).slice(0, 20) : [],
  };
}

export interface GlbSummary {
  generator: string | null;
  meshes: Array<{ name: string; primitives: number; vertices: number | null; material: string[] }>;
  materials: Array<{ name: string; slots: Record<string, string> }>;
  images: Array<{ name: string; mime: string | null; uri: string | null; bytes: number | null; width?: number; height?: number }>;
  animations: Array<{ name: string; channels: number; seconds: number | null; targets: string[] }>;
  nodes: number;
  extensions: string[];
}

/** Read the JSON of a glTF (from a .glb's first chunk or a .gltf file): meshes, materials and their texture slots, animations. */
export function gltfSummary(j: any, binBytes?: number): GlbSummary {
  const textures = (j.textures ?? []) as Array<{ source?: number; extensions?: Record<string, { source?: number }> }>;
  const images = (j.images ?? []) as Array<{ name?: string; mimeType?: string; uri?: string; bufferView?: number }>;
  const imgOf = (texIndex: number | undefined) => {
    if (texIndex == null) return '';
    const t = textures[texIndex];
    const src = t?.source ?? Object.values(t?.extensions ?? {})[0]?.source;
    const im = src != null ? images[src] : undefined;
    return im ? im.name || im.uri || `image ${src}` : `texture ${texIndex}`;
  };
  const accessors = (j.accessors ?? []) as Array<{ count?: number; max?: number[] }>;
  const materials = ((j.materials ?? []) as any[]).map((m, i) => {
    const slots: Record<string, string> = {};
    const p = m.pbrMetallicRoughness ?? {};
    if (p.baseColorTexture) slots.baseColor = imgOf(p.baseColorTexture.index);
    if (p.metallicRoughnessTexture) slots.metallicRoughness = imgOf(p.metallicRoughnessTexture.index);
    if (m.normalTexture) slots.normal = imgOf(m.normalTexture.index);
    if (m.occlusionTexture) slots.occlusion = imgOf(m.occlusionTexture.index);
    if (m.emissiveTexture) slots.emissive = imgOf(m.emissiveTexture.index);
    for (const [ext, v] of Object.entries((m.extensions ?? {}) as Record<string, any>))
      for (const [k, x] of Object.entries(v ?? {})) if (x && typeof x === 'object' && 'index' in (x as any)) slots[`${ext}.${k}`] = imgOf((x as any).index);
    return { name: m.name ?? `material ${i}`, slots };
  });
  const views = (j.bufferViews ?? []) as Array<{ byteLength?: number }>;
  const nodes = (j.nodes ?? []) as Array<{ name?: string }>;
  return {
    generator: j.asset?.generator ?? null,
    meshes: ((j.meshes ?? []) as any[]).slice(0, 80).map((m, i) => ({
      name: m.name ?? `mesh ${i}`,
      primitives: (m.primitives ?? []).length,
      vertices: (m.primitives ?? []).reduce((n: number, p: any) => n + (accessors[p.attributes?.POSITION]?.count ?? 0), 0) || null,
      material: (m.primitives ?? []).map((p: any) => materials[p.material]?.name).filter(Boolean),
    })),
    materials,
    images: images.map((im, i) => ({
      name: im.name ?? `image ${i}`,
      mime: im.mimeType ?? null,
      uri: im.uri && !im.uri.startsWith('data:') ? im.uri : im.uri ? 'embedded (data URI)' : 'embedded in the .glb',
      bytes: im.bufferView != null ? (views[im.bufferView]?.byteLength ?? null) : null,
    })),
    animations: ((j.animations ?? []) as any[]).map((a, i) => {
      const seconds = Math.max(0, ...(a.samplers ?? []).map((s: any) => accessors[s.input]?.max?.[0] ?? 0));
      return {
        name: a.name ?? `animation ${i}`,
        channels: (a.channels ?? []).length,
        seconds: seconds ? Math.round(seconds * 1000) / 1000 : null,
        targets: [...new Set((a.channels ?? []).map((c: any) => `${nodes[c.target?.node]?.name ?? `node ${c.target?.node}`}.${c.target?.path}`))].slice(
          0,
          12,
        ) as string[],
      };
    }),
    nodes: nodes.length,
    extensions: [...new Set([...(j.extensionsUsed ?? []), ...(j.extensionsRequired ?? [])])] as string[],
    ...(binBytes ? {} : {}),
  };
}

/** A .glb file: 12-byte header, then a JSON chunk and a BIN chunk. */
export function parseGlb(buf: Uint8Array): GlbSummary | { error: string } {
  if (buf.length < 20) return { error: 'too short' };
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) return { error: 'not a glb (no glTF magic)' };
  const len = dv.getUint32(12, true);
  const type = dv.getUint32(16, true);
  if (type !== 0x4e4f534a) return { error: 'first chunk is not JSON' };
  try {
    const j = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len)));
    const s = gltfSummary(j);
    // embedded images: read their pixel size from the BIN chunk, so textures can be matched to them
    const binAt = 20 + len;
    if (buf.length > binAt + 8 && dv.getUint32(binAt + 4, true) === 0x004e4942) {
      const bin = buf.subarray(binAt + 8, binAt + 8 + dv.getUint32(binAt, true));
      const views = (j.bufferViews ?? []) as Array<{ byteOffset?: number; byteLength?: number }>;
      ((j.images ?? []) as Array<{ bufferView?: number }>).forEach((im, i) => {
        const v = im.bufferView != null ? views[im.bufferView] : undefined;
        const out = s.images[i];
        if (!v || !out) return;
        const size = imageSize(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + (v.byteLength ?? 0)));
        if (size) Object.assign(out, size);
      });
    }
    return s;
  } catch (e) {
    return { error: `JSON chunk unreadable: ${(e as Error).message}` };
  }
}

/** KTX2 header: format, size, mip levels, supercompression (Basis/zstd). */
export function ktx2Summary(
  buf: Uint8Array,
): { vkFormat: number; width: number; height: number; levels: number; supercompression: string } | { error: string } {
  if (buf.length < 80) return { error: 'too short' };
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sc = dv.getUint32(44, true);
  return {
    vkFormat: dv.getUint32(12, true),
    width: dv.getUint32(20, true),
    height: dv.getUint32(24, true),
    levels: Math.max(1, dv.getUint32(40, true)),
    supercompression: ({ 0: 'none', 1: 'Basis Universal (ETC1S)', 2: 'zstd', 3: 'zlib' } as Record<number, string>)[sc] ?? `scheme ${sc}`,
  };
}

/** Rive .riv header: "RIVE", major, minor (varuint), file id. Artboards and state machines need the Rive runtime. */
export function riveSummary(buf: Uint8Array): { version: string } | { error: string } {
  if (buf.length < 6 || String.fromCharCode(...buf.subarray(0, 4)) !== 'RIVE') return { error: 'not a Rive file' };
  let i = 4;
  const vu = () => {
    let r = 0;
    let s = 0;
    for (;;) {
      const b = buf[i++] ?? 0;
      r |= (b & 0x7f) << s;
      if (!(b & 0x80) || s > 28) return r;
      s += 7;
    }
  };
  return { version: `${vu()}.${vu()}` };
}

/** Radiance .hdr size from its header ("-Y 1024 +X 2048"). */
export function hdrSize(buf: Uint8Array): { width: number; height: number } | null {
  const head = new TextDecoder('latin1').decode(buf.subarray(0, 2048));
  const m = /([-+])Y (\d+) ([-+])X (\d+)/.exec(head);
  return m ? { width: Number(m[4]), height: Number(m[2]) } : null;
}

/** PNG/JPEG/WebP/GIF pixel size from the header bytes. */
export function imageSize(buf: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (buf.length > 30 && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...buf.subarray(12, 16));
    if (kind === 'VP8X') return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    if (kind === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (kind === 'VP8L') {
      const b = dv.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** WebGL enum numbers → names people know. */
export const GL_NAMES: Record<number, string> = {
  6408: 'RGBA',
  6407: 'RGB',
  6403: 'RED',
  33319: 'RG',
  6409: 'LUMINANCE',
  6410: 'LUMINANCE_ALPHA',
  6406: 'ALPHA',
  5121: 'UNSIGNED_BYTE',
  5126: 'FLOAT',
  5131: 'HALF_FLOAT',
  36193: 'HALF_FLOAT_OES',
  32856: 'RGBA8',
  35907: 'SRGB8_ALPHA8',
  34842: 'RGBA16F',
  34836: 'RGBA32F',
  33326: 'R32F',
  33321: 'R8',
  33071: 'CLAMP_TO_EDGE',
  10497: 'REPEAT',
  33648: 'MIRRORED_REPEAT',
  9728: 'NEAREST',
  9729: 'LINEAR',
  9984: 'NEAREST_MIPMAP_NEAREST',
  9985: 'LINEAR_MIPMAP_NEAREST',
  9986: 'NEAREST_MIPMAP_LINEAR',
  9987: 'LINEAR_MIPMAP_LINEAR',
};
export const glName = (n: unknown) => (typeof n === 'number' ? (GL_NAMES[n] ?? `0x${n.toString(16)}`) : n == null ? '' : String(n));
