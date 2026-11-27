import { describe, expect, it } from 'vitest';
import { overlayNote, panelColumns } from '../src/extract/preview.ts';

describe('Round 55: panel columns and the text-layout tie', () => {
  it('names a panel box that was extended down its column', () => {
    expect(overlayNote([{ kind: 'lil-gui', x: 1115, y: 0, w: 310, h: 900, column: true }])).toContain('lil-gui 310x900 at 1115,0 (with its column below)');
    expect(overlayNote([{ kind: 'Stats.js', x: 0, y: 0, w: 80, h: 48 }])).not.toContain('column');
  });
  it('leaves no panels as they are without opening the page', async () => {
    const page = {
      evaluate: () => {
        throw new Error('should not run');
      },
    };
    expect(await panelColumns(page as any, '', [], { width: 1440, height: 900 })).toEqual([]);
  });
  it('panelColumns runs its scan in the page with the screenshot, the panels and the viewport', async () => {
    const calls: unknown[][] = [];
    const page = {
      evaluate: async (_fn: unknown, arg?: unknown) => {
        if (arg !== undefined) calls.push(arg as unknown[]);
        return arg === undefined ? undefined : [{ kind: 'lil-gui', x: 1115, y: 0, w: 310, h: 900, column: true }];
      },
    };
    const ui = [{ kind: 'lil-gui', x: 1115, y: 0, w: 310, h: 607 }];
    const out = await panelColumns(page as any, 'data:image/png;base64,AA', ui, { width: 1440, height: 900 });
    expect(calls[0]).toEqual(['data:image/png;base64,AA', ui, 1440, 900]);
    expect(out[0].h).toBe(900);
  });
  it('the extract ties a site layout within 0.2 points of the plain heading to the site', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/extract/index.ts', import.meta.url), 'utf8');
    expect(src).toContain('bestScore >= headingScore - 0.002');
    expect(src).toContain('uiOverlays = await panelColumns(pc, original, uiOverlays, vp)');
  });
});
