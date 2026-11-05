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

describe('evidence ledger: the whole page and the phase', () => {
  const pageStops = (over = {}) => ({
    views: { kit: 0.82 } as Record<string, number | null>,
    stops: [
      { y: 0, scores: { kit: 0.96 } },
      { y: 720, scores: { kit: 0.7 } },
      { y: 5040, scores: { kit: 0.24 } },
    ],
    extent: 5040,
    documentHeight: 6000,
    elements: 300,
    counts: { static: 290, fixed: 2, moving: 1 },
    limits: [] as string[],
    mechanism: 'native',
    ...over,
  });
  it('labels the whole-page read Verified, with the stops, the mean and what it does not cover', () => {
    const f = buildFindings(base({ pageStops: pageStops() }));
    const w = f.find((x) => x.id === 'page.whole');
    expect(w?.label).toBe('Verified');
    expect(w?.measurement).toMatch(/3 scroll stops/);
    expect(w?.measurement).toMatch(/kit 82%/);
    expect(w?.limitations.join(' ')).toMatch(/click, hover/);
    expect(w?.coverage).toBe('complete');
  });
  it('names the stops where the kit does not match as an Unknown finding', () => {
    const f = buildFindings(base({ pageStops: pageStops() }));
    const weak = f.find((x) => x.id === 'page.weak');
    expect(weak?.label).toBe('Unknown');
    expect(weak?.claim).toMatch(/5040px/);
    expect(weak?.claim).not.toMatch(/720px/);
  });
  it('a read cut short by its limits is partial coverage', () => {
    const f = buildFindings(base({ pageStops: pageStops({ limits: ['the read stopped at 40000 px'] }) }));
    expect(f.find((x) => x.id === 'page.whole')?.coverage).toBe('partial');
  });
  it('a phase that never matched is Unknown and says the numbers are not comparable', () => {
    const f = buildFindings(
      base({ phase: { aligned: false, refDiff: 40, bestDiff: 22, waitedMs: 90_000, note: 'never matched', stable: false, timeDriven: true } }),
    );
    const p = f.find((x) => x.id === 'input.phase');
    expect(p?.label).toBe('Unknown');
    expect(p?.claim).toMatch(/not comparable/);
    expect(p?.limitations.join(' ')).toMatch(/time-driven/);
  });
  it('a matched phase is Verified', () => {
    const f = buildFindings(base({ phase: { aligned: true, refDiff: 2, bestDiff: 2, waitedMs: 9000, note: 'matched', stable: true, timeDriven: false } }));
    expect(f.find((x) => x.id === 'input.phase')?.label).toBe('Verified');
  });
  it('the whole-page read replaces the "page below the first screen" unknown', async () => {
    const m = { mechanism: 'native', sections: 4, extent: 5000, stops: 9, canvases: 0, documentHeight: 6000, sceneChanges: 0 } as unknown as LedgerInput['map'];
    const without = await buildLedger(base({ map: m }));
    expect(without.unknowns.some((u) => /below the first screen/.test(u.topic))).toBe(true);
    const withPage = await buildLedger(base({ map: m, pageStops: pageStops() }));
    expect(withPage.unknowns.some((u) => /below the first screen/.test(u.topic))).toBe(false);
  });
});

describe('evidence ledger: a whole-page read photographed behind a loading screen', () => {
  it('is Unknown, not Verified', () => {
    const f = buildFindings(
      base({
        diff: { start: 0.3, final: 0.3, referenceLoader: true, referenceAtMs: 45_000 },
        pageStops: {
          views: { kit: 0.29 },
          stops: [
            { y: 0, scores: { kit: 0.3 } },
            { y: 720, scores: { kit: 0.28 } },
          ],
          extent: 720,
          documentHeight: 1600,
          elements: 40,
          counts: { static: 40, fixed: 0, moving: 0 },
          limits: [],
          mechanism: 'native',
        },
      }),
    );
    const w = f.find((x) => x.id === 'page.whole');
    expect(w?.label).toBe('Unknown');
    expect(w?.claim).toMatch(/loading screen/);
  });
});
