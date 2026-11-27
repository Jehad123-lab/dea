import { describe, expect, it } from 'vitest';
import { costMaterialGroups } from '../src/extract/index.ts';
import { LAYOUT_READ } from '../src/extract/preview.ts';
import type { StandInInfo } from '../src/replay/rebuild.ts';

const si = (material: number, buf: number, vertices = 100): StandInInfo => ({
  material,
  program: `#${material}`,
  mode: 4,
  instances: 0,
  vertices,
  standInVertices: 10,
  kept: [],
  dropped: [],
  buf,
});

describe('Round 53: cost material variants grouped by shared vertex buffers', () => {
  it('materials that share a buffer become one variant; a group of every stand-in is left out', () => {
    // lusion.co-like: 4, 6 and 5 all read the same buffers, so each alone was the real-meshes variant again
    expect(costMaterialGroups([si(4, 1), si(6, 1), si(5, 1)])).toEqual([]);
    // two independent meshes plus a shadow pass of the first
    const g = costMaterialGroups([si(0, 10, 500), si(2, 20, 900), si(3, 10, 500)]);
    expect(g).toHaveLength(2);
    expect(g[0].materials.sort()).toEqual([0, 3]);
    expect(g[0].n).toBe(2);
    expect(g[1].materials).toEqual([2]);
  });

  it('chains of sharing join transitively; without buffer ids every material stands alone', () => {
    const g = costMaterialGroups([si(1, 1), si(2, 1), si(2, 2), si(3, 2), si(4, 3)]);
    expect(g.map((x) => x.materials.sort())).toEqual([[1, 2, 3], [4]]);
    const loose = costMaterialGroups([
      { ...si(1, 0), buf: undefined },
      { ...si(2, 0), buf: undefined },
    ]);
    expect(loose.map((x) => x.materials)).toEqual([[1], [2]]);
  });

  it('keeps at most max groups, largest first', () => {
    const list = [si(1, 1), si(1, 1), si(1, 1), si(2, 2), si(3, 3), si(4, 4)];
    const g = costMaterialGroups(list, 2);
    expect(g.map((x) => x.materials)).toEqual([[1], [2]]);
  });

  it('a debug panel covers every visible box inside it, not only its root', () => {
    const js = LAYOUT_READ(null);
    expect(js).toContain("el.querySelectorAll('*')");
    expect(js).toContain('B = Math.max(B, q.bottom)');
    expect(() => new Function(js)).not.toThrow();
  });
});
