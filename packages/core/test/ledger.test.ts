import { describe, expect, it } from 'vitest';
import { bootInfo, buildFindings, buildLedger, buildUnknowns, type LedgerInput, queryLedger, renderLedgerMd } from '../src/evidence/ledger.ts';

const base = (over: Partial<LedgerInput> = {}): LedgerInput => ({
  url: 'https://example.test/',
  runId: 'run-1',
  quick: false,
  ownAssets: false,
  gaps: [],
  ...over,
});
const replay = (over = {}) => ({
  frames: 2,
  passes: 4,
  draws: 30,
  programs: 6,
  bytes: 3_000_000,
  canvas: 0.99,
  page: 0.98,
  shipped: true,
  errors: [] as string[],
  rebuild: { canvas: 0.97, page: 0.97, vsReplay: 0.99, errors: [] as string[] },
  ...over,
});

describe('evidence ledger', () => {
  it('labels a measured replay Verified and says what a held frame proves', () => {
    const f = buildFindings(base({ replay: replay() }));
    const s = f.find((x) => x.id === 'scene.replay');
    expect(s?.label).toBe('Verified');
    expect(s?.limitations.join(' ')).toMatch(/one held frame/);
    expect(s?.coverage).toBe('complete');
    expect(f.find((x) => x.id === 'scene.rebuild')?.label).toBe('Verified');
  });

  it('a quick run covers one frame: partial coverage, never complete', () => {
    const f = buildFindings(base({ quick: true, replay: replay({ frames: 1 }) }));
    expect(f.find((x) => x.id === 'scene.replay')?.coverage).toBe('partial');
  });

  it('a loader reference makes the doubt a finding', () => {
    const f = buildFindings(base({ diff: { start: 0.5, final: 0.9, referenceLoader: true, referenceAtMs: 20_000 } }));
    const r = f.find((x) => x.id === 'run.reference');
    expect(r?.label).toBe('Unknown');
    expect(r?.nextProbe).toMatch(/reference-ms/);
  });

  it('absence is not concluded from partial coverage: a frozen or unused input is not Verified', () => {
    const f = buildFindings(
      base({
        replay: replay(),
        interaction: {
          replay: { response: 0.1 },
          rebuild: { response: null },
          inputs: [
            { input: 'pointer', status: 'verified', replay: 'live', rebuild: 'live', uniforms: ['u_mouse'], evidence: 'r=0.98' },
            { input: 'scroll', status: 'frozen', replay: 'recorded', rebuild: 'recorded', uniforms: [], evidence: 'site changed, kit did not' },
            { input: 'viewport', status: 'not used', replay: 'recorded', rebuild: 'recorded', uniforms: [], evidence: 'nothing moved' },
          ],
        },
      }),
    );
    expect(f.find((x) => x.id === 'input.pointer')?.label).toBe('Verified');
    expect(f.find((x) => x.id === 'input.scroll')?.label).toBe('Unknown');
    expect(f.find((x) => x.id === 'input.scroll')?.nextProbe).toBeTruthy();
    const none = f.find((x) => x.id === 'input.viewport');
    expect(none?.label).toBe('Unknown');
    expect(none?.limitations.join(' ')).toMatch(/absence is only as strong as the probe/);
  });

  it('gaps become unknowns that follow the findings that are not verified', async () => {
    const gaps = [{ area: 'motion', topic: 'scroll scene', known: [], missing: 'the assembly', next: [{ why: 'record it', command: 'dea extract x' }] }];
    const l = await buildLedger(
      base({
        gaps,
        replay: replay(),
        interaction: {
          replay: { response: 0.1 },
          rebuild: { response: 0.1 },
          inputs: [{ input: 'scroll', status: 'frozen', replay: 'recorded', rebuild: 'recorded', uniforms: [], evidence: 'e' }],
        },
      }),
    );
    expect(l.unknowns[0].follows).toContain('input.scroll');
    expect(l.counts.total).toBe(l.findings.length);
    expect(l.counts.Verified + l.counts.Inferred + l.counts.Unknown).toBe(l.counts.total);
    expect(buildUnknowns([], l.findings)).toEqual([]);
  });

  it('answers summary first, one finding on request, a slice by label', async () => {
    const l = await buildLedger(base({ replay: replay(), diff: { start: 0.5, final: 0.9, referenceLoader: true } }));
    const sum = queryLedger(l) as { findings: Array<Record<string, unknown>>; hint?: string };
    expect(sum.findings[0]).not.toHaveProperty('measurement');
    expect(sum.hint).toMatch(/id/);
    const one = queryLedger(l, { id: 'scene.replay' }) as { findings: Array<{ measurement: string }> };
    expect(one.findings).toHaveLength(1);
    expect(one.findings[0].measurement).toMatch(/canvas 99%/);
    const unk = queryLedger(l, { label: 'Unknown' }) as { findings: Array<{ id: string }> };
    expect(unk.findings.map((x) => x.id)).toEqual(['run.reference', 'input.response']);
    expect((queryLedger(l, { id: 'nope' }) as { error: string }).error).toMatch(/no finding/);
    expect(renderLedgerMd(l)).toMatch(/### scene.replay · ✔ Verified/);
  });

  it('a scroll tape that moved the picture is a finding with its stops and its limits', () => {
    const f = buildFindings(
      base({
        replay: replay({
          scrollTape: {
            stops: 8,
            at: [0, 300, 600, 900, 1200, 1500, 1800, 2100],
            mechanism: 'virtual',
            changed: [0, 0.1, 0.3, 0.4, 0.4, 0.5, 0.5, 0.5],
            mode: 'frames',
            frames: 24,
            bytes: 4_000_000,
            uploadBuffers: 3,
            uploadFull: 2,
          },
        }),
      }),
    );
    const s = f.find((x) => x.id === 'scroll.tape');
    expect(s?.label).toBe('Verified');
    expect(s?.claim).toMatch(/virtual/);
    expect(s?.limitations.join(' ')).toMatch(/2 of 3 buffers/);
  });

  it('says what the kit does not contain when the page map found sections below the first screen', async () => {
    const l = await buildLedger(
      base({ map: { mechanism: 'native', extent: 3239, documentHeight: 6629, sections: 5, stops: 9, sceneChanges: 0, canvases: 2 } }),
    );
    const u = l.unknowns.find((x) => x.topic === 'The page below the first screen');
    expect(u?.missing).toMatch(/5 sections over 3239 px/);
    expect(u?.follows).toContain('page.map');
    const none = await buildLedger(
      base({ map: { mechanism: 'virtual', extent: 3240, documentHeight: 900, sections: 0, stops: 9, sceneChanges: 3, canvases: 1 } }),
    );
    expect(none.unknowns.some((x) => x.topic === 'The page below the first screen')).toBe(false);
  });

  it('the boot timeline says when shaders were still being linked before the reference', () => {
    const b = bootInfo({ canvas: 900, draw: 1500, links: [1200, 1300, 9000, 9800, 10100], armed: 10200 });
    expect(b).toMatchObject({ firstCanvasMs: 900, firstDrawMs: 1500, lastLinkMs: 10100, programs: 5, linkingNearReference: 3 });
    expect(bootInfo(null)).toBeNull();
    const f = buildFindings(base({ boot: b }));
    expect(f.find((x) => x.id === 'boot.timeline')?.claim).toMatch(/3 shader program/);
  });
});
