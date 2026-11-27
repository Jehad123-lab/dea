import { describe, expect, it } from 'vitest';
import { LAYOUT_READ, overlayMask, overlayNote } from '../src/extract/preview.ts';

describe('Round 51: debug UI overlays left out of the scores', () => {
  it('overlayMask turns viewport pixels into fractions and drops empty boxes', () => {
    const m = overlayMask(
      [
        { kind: 'lil-gui', x: 1195, y: 0, w: 245, h: 300 },
        { kind: 'Stats.js', x: 0, y: 0, w: 80, h: 48 },
        { kind: 'empty', x: 10, y: 10, w: 0, h: 20 },
      ],
      { width: 1440, height: 900 },
    );
    expect(m).toHaveLength(2);
    expect(m[0].x).toBeCloseTo(1195 / 1440);
    expect(m[0].h).toBeCloseTo(300 / 900);
    expect(m[1]).toEqual({ x: 0, y: 0, w: 80 / 1440, h: 48 / 900 });
    expect(overlayMask(null, { width: 1, height: 1 })).toEqual([]);
  });

  it('overlayNote names each panel, or says nothing', () => {
    expect(overlayNote([])).toBeNull();
    expect(overlayNote(undefined)).toBeNull();
    const note = overlayNote([
      { kind: 'lil-gui', x: 1195.4, y: 0, w: 245, h: 300.2 },
      { kind: 'Stats.js', x: 0, y: 0, w: 80, h: 48 },
    ]);
    expect(note).toContain('lil-gui 245x300 at 1195,0');
    expect(note).toContain('Stats.js 80x48 at 0,0');
  });

  it('the layout read looks for lil-gui, dat.gui, Tweakpane, Leva and Stats.js and returns them as overlays', () => {
    const src = LAYOUT_READ(null);
    for (const sel of ['.lil-gui.root', '.dg.main', '.tp-dfwv', '#leva__root', '#stats']) expect(src).toContain(sel);
    expect(src).toContain('graphics: keep(graphics), overlays }');
    // a full-screen element is never treated as a panel
    expect(src).toContain('W * H * 0.5');
    // still a plain script: no template holes left from the new code
    expect(() => new Function(src)).not.toThrow();
  });
});
