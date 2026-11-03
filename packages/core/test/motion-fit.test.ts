import { describe, expect, it } from 'vitest';
import { decomposeTransform, describeFit, fitSeries, gsapModule, type MotionDoc, nameEase, unwrapDegrees } from '../src/index.ts';

const ts = Array.from({ length: 120 }, (_, i) => i / 60);

describe('fitSeries', () => {
  it('finds a clock', () => {
    const f = fitSeries(
      ts,
      ts.map((t) => 3 + 0.5 * t),
    );
    expect(f.kind).toBe('linear');
    if (f.kind === 'linear') expect(f.ratePerSecond).toBeCloseTo(0.5, 3);
  });
  it('finds an oscillation and its period', () => {
    const long = Array.from({ length: 360 }, (_, i) => i / 60);
    const f = fitSeries(
      long,
      long.map((t) => Math.sin((2 * Math.PI * t) / 1.5) * 2),
    );
    expect(f.kind).toBe('oscillation');
    if (f.kind === 'oscillation') expect(f.period).toBeCloseTo(1.5, 1);
  });
  it('names the ease of a move', () => {
    const f = fitSeries(
      ts,
      ts.map((t) => 100 * (1 - (1 - Math.min(1, t / 1.2)) ** 4)),
    );
    expect(f.kind).toBe('eased');
    if (f.kind === 'eased') {
      expect(f.ease).toBe('power3.out');
      expect(f.duration).toBeGreaterThan(1);
    }
  });
  it('sees a spring overshoot', () => {
    const f = fitSeries(
      ts,
      ts.map((t) => 1 - Math.exp(-5 * t) * Math.cos(9 * t)),
    );
    expect(f.kind).toBe('spring');
  });
  it('links a value to scroll', () => {
    const scroll = ts.map((t) => t * 800 + Math.sin(t * 7) * 50);
    const f = fitSeries(
      ts,
      scroll.map((s) => s / 1000),
      { scroll },
    );
    expect(f.kind).toBe('scroll-linked');
    expect(describeFit(f)).toContain('scroll position');
  });
  it('says constant and irregular honestly', () => {
    expect(
      fitSeries(
        ts,
        ts.map(() => 2),
      ).kind,
    ).toBe('constant');
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    expect(
      fitSeries(
        ts,
        ts.map(() => rnd()),
      ).kind,
    ).toBe('irregular');
  });
});

describe('helpers', () => {
  it('names GSAP eases from samples', () => {
    expect(nameEase([0.19, 0.4375, 0.75, 0.9375, 0.99])).toBe('power1.out');
    expect(nameEase([0.1, 0.25, 0.5, 0.75, 0.9])).toBe('none');
    expect(nameEase([0.1, 0.3, 1.1, 1.05, 1])).toContain('overshoots');
  });
  it('unwraps angles and decomposes transforms', () => {
    expect(unwrapDegrees([170, 179, -178, -170])).toEqual([170, 179, 182, 190]);
    const d = decomposeTransform('matrix(0, 1, -1, 0, 10, 20)');
    expect(d?.rotate).toBeCloseTo(90);
    expect(d?.x).toBe(10);
    expect(decomposeTransform('none')).toEqual({ x: 0, y: 0, scale: 1, rotate: 0 });
  });
  it('writes a runnable GSAP module from a tree', () => {
    const doc = {
      gsap: {
        source: 'global',
        version: '3.12.5',
        nodes: 3,
        hookTweens: 2,
        hookTimelines: 1,
        scrollTriggers: [{ trigger: 'section.hero', start: 'top top', end: '+=1000', startPx: 0, endPx: 1000, scrub: 1, animation: 'timeline 2s' }],
        scrollTriggerPresent: true,
        split: { global: false, elements: 0, ariaSplit: 0 },
        tree: [
          {
            type: 'timeline',
            start: 0,
            duration: 2,
            labels: { intro: 0 },
            children: [
              { type: 'tween', start: 0, duration: 1, mode: 'from', ease: 'power3.out', targets: ['h1.title'], to: { y: 40, opacity: 0 } },
              { type: 'tween', start: 1, duration: 1, mode: 'fromTo', ease: 'none', targets: ['uniform {value}'], from: { value: 0 }, to: { value: 1 } },
            ],
          },
        ],
      },
      css: null,
      others: null,
      recorded: [],
      recording: { frames: 0, seconds: 0, idleFrames: 0, scrollFrames: 0, elements: [], uniforms: [] },
    } as unknown as MotionDoc;
    const js = gsapModule(doc, 'https://x.test');
    expect(js).toContain(`tl1.from(t("h1.title"), { y: 40, opacity: 0, duration: 1, ease: 'power3.out' }, 0);`);
    expect(js).toContain(`tl1.fromTo(t("uniform {value}"), { value: 0 }, { value: 1, duration: 1, ease: 'none' }, 1);`);
    expect(js).toContain(`ScrollTrigger.create({ trigger: "section.hero", start: "top top", end: "+=1000", scrub: 1 })`);
    expect(js).toContain("tl1.addLabel('intro', 0);");
  });
});
