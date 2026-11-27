import { describe, expect, it } from 'vitest';
import { LAYOUT_READ, withoutUi } from '../src/extract/preview.ts';

describe('Round 54: debug panels left out of the layout', () => {
  const ui = [{ kind: 'lil-gui', x: 1115, y: 0, w: 310, h: 607, k: 'html:1>body:2>div:5' }];
  it('drops the panel rows by element key, keeps the info line', () => {
    const l = {
      boxes: [
        { k: 'html:1>body:2>div:2', x: 0, y: 0, w: 1440, h: 68 },
        { k: 'html:1>body:2>div:5>div:1>div:2', x: 1120, y: 40, w: 100, h: 20 },
        { k: 'html:1>body:2>div:50', x: 1120, y: 700, w: 100, h: 20 },
      ],
      shapes: [{ k: 'html:1>body:2>div:5::before', x: 0, y: 0, w: 1, h: 1 }],
      graphics: [],
    };
    const out = withoutUi(l, ui);
    expect(out.boxes.map((b) => b.k)).toEqual(['html:1>body:2>div:2', 'html:1>body:2>div:50']);
    expect(out.shapes).toEqual([]);
  });
  it('falls back to geometry when the panel has no key (a cached read)', () => {
    const l = {
      boxes: [
        { k: 'a', x: 1130, y: 100, w: 200, h: 20 },
        { k: 'b', x: 1000, y: 100, w: 200, h: 20 },
        { k: 'c', x: 0, y: 0, w: 1440, h: 68 },
      ],
    };
    const out = withoutUi(l, [{ kind: 'lil-gui', x: 1115, y: 0, w: 310, h: 607 }]);
    // 'b' is under half inside the panel (85 of 200 px wide): it stays
    expect(out.boxes.map((b) => b.k)).toEqual(['b', 'c']);
  });
  it('leaves a layout without panels as it is', () => {
    const l = { boxes: [{ k: 'a', x: 0, y: 0, w: 10, h: 10 }] };
    expect(withoutUi(l, [])).toBe(l);
    expect(withoutUi(l, null)).toBe(l);
  });
  it('the layout read probes below the panel, keys it and filters its items', () => {
    const src = LAYOUT_READ(null);
    expect(src).toContain('document.elementFromPoint(mx, yy)');
    expect(src).toContain('k: keyOf(el) });');
    expect(src).toContain('boxes: keep(boxes)');
    expect(() => new Function(`return ${src}`)).not.toThrow();
  });
});
