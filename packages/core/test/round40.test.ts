import { describe, expect, it } from 'vitest';
import { costMaterials } from '../src/extract/index.ts';
import { readAttrComponent, type StandInInfo, standInTable } from '../src/replay/rebuild.ts';

const info = (material: number, vertices: number, extra: Partial<StandInInfo> = {}): StandInInfo => ({
  material,
  program: `prog${material}`,
  mode: 4,
  instances: 0,
  vertices,
  standInVertices: 10,
  kept: ['normal'],
  dropped: [],
  ...extra,
});

describe('Round 40: stand-ins read compressed vertex inputs', () => {
  it('reads normalized and plain integers, half floats and floats as the shader sees them', () => {
    const dv = new DataView(new ArrayBuffer(16));
    dv.setInt8(0, -128);
    expect(readAttrComponent(dv, 0, 0x1400, true)).toBe(-1);
    dv.setInt8(0, 127);
    expect(readAttrComponent(dv, 0, 0x1400, true)).toBe(1);
    dv.setUint8(0, 255);
    expect(readAttrComponent(dv, 0, 0x1401, true)).toBe(1);
    dv.setInt16(0, -16384, true);
    expect(readAttrComponent(dv, 0, 0x1402, true)).toBeCloseTo(-0.5, 3);
    expect(readAttrComponent(dv, 0, 0x1402, false)).toBe(-16384);
    dv.setUint16(0, 65535, true);
    expect(readAttrComponent(dv, 0, 0x1403, true)).toBe(1);
    dv.setUint16(0, 0x3c00, true); // 1.0 as a half float
    expect(readAttrComponent(dv, 0, 0x140b, false)).toBe(1);
    dv.setUint16(0, 0xc000, true); // -2.0
    expect(readAttrComponent(dv, 0, 0x140b, false)).toBe(-2);
    dv.setFloat32(4, 0.25, true);
    expect(readAttrComponent(dv, 4, 0x1406, false)).toBe(0.25);
  });
});

describe('Round 40: the stand-in table and the per-material cost', () => {
  it('lists the stand-ins, most vertices first, with what each lost', () => {
    const md = standInTable([info(1, 50), info(2, 900, { dropped: ['aId'], mode: 0, box: 'mode 0', standInVertices: 0 })]).join('\n');
    expect(md).toContain('### Stand-ins (2');
    expect(md.indexOf('| 2 |')).toBeLessThan(md.indexOf('| 1 |'));
    expect(md).toContain('900 → box (mode 0)');
    expect(md).toContain('inputs lost, by name: aId 1×');
  });
  it('picks the materials with the most stand-ins (ties: most vertices), at most 6', () => {
    const list = [info(3, 10), info(3, 10), info(5, 100), info(7, 500), ...Array.from({ length: 6 }, (_, i) => info(10 + i, 1))];
    const m = costMaterials(list);
    expect(m.length).toBe(6);
    expect(m[0]).toMatchObject({ material: 3, n: 2, vertices: 20 });
    expect(m[1].material).toBe(7);
    expect(m[2].material).toBe(5);
  });
});
