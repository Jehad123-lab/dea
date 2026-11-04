import { describe, expect, it } from 'vitest';
import { classifyInputs, type InteractionScore } from '../src/extract/interaction.ts';
import { fitInputs, inferInputs, type ProbeData } from '../src/replay/inputs.ts';

/** a probe of 120 frames: pointer sweeps x then y, then a scroll, then a resize */
function probe(): ProbeData {
  const env: ProbeData['env'] = [];
  const series: ProbeData['series'] = { '7|uMouse': [], '7|uScroll': [], '7|uRes': [], '7|uTime': [], '9|uNoise': [] };
  let ex = 0.2; // the eased pointer starts where the pointer is
  for (let i = 0; i < 120; i++) {
    const t = i * 33;
    const tri = (k: number, n: number) => 1 - Math.abs(1 - (2 * k) / n);
    const x = i < 30 ? 0.2 + 0.6 * tri(i, 29) : 0.5;
    const y = i >= 30 && i < 60 ? 0.2 + 0.6 * tri(i - 30, 29) : 0.5;
    const scroll = i >= 60 && i < 90 ? 300 * tri(i - 60, 29) : 0;
    const w = i >= 95 && i < 110 ? 1080 : 1440;
    const h = i >= 102 && i < 110 ? 630 : 900;
    env.push([t, scroll, x * w, y * h, w, h]);
    ex += 0.2 * (x - ex); // the site eases the pointer
    series['7|uMouse'].push([t, ex * 2 - 1, 1 - 2 * y]);
    series['7|uScroll'].push([t, scroll / 900]);
    series['7|uRes'].push([t, w, h]);
    series['7|uTime'].push([t, 1 + t / 1000]);
    series['9|uNoise'].push([t, Math.sin(i * 1.7) * Math.cos(i * 0.31)]);
  }
  return { env, series };
}

describe('input probe fit', () => {
  const rep = fitInputs(probe());
  const find = (u: string, c: number) => rep.inputs.find((m) => m.uniform === u && m.component === c);

  it('finds the eased pointer, with its easing and its mapping', () => {
    const mx = find('uMouse', 0);
    expect(mx?.kind).toBe('pointer');
    expect(mx?.axis).toBe('x');
    expect(mx?.k).toBeCloseTo(0.2, 5);
    expect(mx?.scale).toBeCloseTo(2, 2);
    expect(mx?.offset).toBeCloseTo(-1, 2);
    const my = find('uMouse', 1);
    expect(my?.axis).toBe('y');
    expect(my?.scale).toBeCloseTo(-2, 2);
  });

  it('finds scroll and window size, and tells a clock from an input', () => {
    expect(find('uScroll', 0)?.kind).toBe('scroll');
    expect(find('uScroll', 0)?.scale).toBeCloseTo(1 / 900, 5);
    expect(find('uRes', 0)).toMatchObject({ kind: 'viewport', axis: 'width' });
    expect(find('uRes', 1)).toMatchObject({ kind: 'viewport', axis: 'height' });
    expect(find('uTime', 0)?.kind).toBe('clock');
    expect(rep.exercised).toEqual({ pointer: true, scroll: true, resize: true });
  });

  it('leaves a value that follows nothing it can drive as unexplained', () => {
    expect(find('uNoise', 0)).toBeUndefined();
    expect(rep.unexplained.some((u) => u.startsWith('uNoise'))).toBe(true);
  });

  it('reads pointer, scroll and resolution uniforms from their names when the probe saw nothing', () => {
    const named = inferInputs(
      [
        { program: 3, name: 'uPointer', value: [0.5, 0.5] },
        { program: 3, name: 'u_scrollOffset', value: [0] },
        { program: 3, name: 'iResolution', value: [1440, 900] },
        { program: 3, name: 'uColor', value: [1, 0, 0] },
      ],
      { w: 1440, h: 900 },
      [],
    );
    expect(named.map((m) => `${m.uniform}:${m.kind}:${m.axis ?? ''}`).sort()).toEqual([
      'iResolution:viewport:height',
      'iResolution:viewport:width',
      'uPointer:pointer:x',
      'uPointer:pointer:y',
      'u_scrollOffset:scroll:',
    ]);
    expect(named.every((m) => m.source === 'name')).toBe(true);
  });
});

describe('input verdicts', () => {
  const step = (input: InteractionScore['input'], changeOriginal: number | null): InteractionScore => ({
    step: input,
    input,
    response: null,
    changeOriginal,
    changeKit: null,
    frame: 1,
  });

  it('verified when measured, frozen when the site moved but nothing could be mapped, not used when nothing moved', () => {
    const rep = fitInputs(probe());
    const v = classifyInputs(rep.inputs, rep, 1, [step('rest', null), step('pointer', 9), step('scroll', 0.2)]);
    expect(v.find((x) => x.input === 'pointer')?.status).toBe('verified');
    expect(v.find((x) => x.input === 'viewport')).toMatchObject({ status: 'verified', replay: 'recorded', rebuild: 'live' });
    expect(v.find((x) => x.input === 'time')?.status).toBe('verified');
    const none = classifyInputs([], { ...rep, inputs: [] }, 0, [step('rest', null), step('pointer', 9), step('scroll', 0.2)]);
    expect(none.find((x) => x.input === 'pointer')?.status).toBe('frozen');
    expect(none.find((x) => x.input === 'scroll')?.status).toBe('not used');
    expect(none.find((x) => x.input === 'time')?.status).toBe('not used');
  });
});

describe('matrix inputs (a camera or model that follows the pointer)', () => {
  it('fits each matrix component to the eased pointer, x and y together', () => {
    const env: ProbeData['env'] = [];
    const rows: number[][] = [];
    const tri = (k: number, n: number) => 1 - Math.abs(1 - (2 * k) / n);
    let ex = 0.5;
    let ey = 0.5;
    for (let i = 0; i < 100; i++) {
      const x = i < 30 ? 0.2 + 0.6 * tri(i, 29) : 0.5;
      const y = i >= 30 && i < 60 ? 0.2 + 0.6 * tri(i - 30, 29) : 0.5;
      env.push([i * 33, 0, x * 1440, y * 900, 1440, 900]);
      ex += 0.14 * (x - ex);
      ey += 0.14 * (y - ey);
      const m = new Array(16).fill(0);
      m[0] = 1;
      m[5] = 1;
      m[12] = 4 * ex - 2; // follows x
      m[13] = -3 * ey + 1.5 + 0.5 * ex; // follows y and a little x
      m[14] = 7; // constant
      rows.push([i * 33, ...m]);
    }
    const r = fitInputs({ series: { '3|modelMatrix#5': rows }, env });
    const at = (c: number) => r.inputs.find((m) => m.uniform === 'modelMatrix#5' && m.component === c);
    expect(at(12)?.axis).toBe('x');
    expect(at(12)?.scale).toBeCloseTo(4, 1);
    expect(at(13)?.scale2 ?? at(13)?.scale).toBeDefined();
    expect(at(13)?.axis2).toBe('y');
    expect(at(14)).toBeUndefined();
    expect(at(0)).toBeUndefined();
    expect(at(12)?.r).toBeGreaterThan(0.99);
  });
});
