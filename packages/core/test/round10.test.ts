import { homedir, hostname, userInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { type BenchResult, benchMd, classifyRenderer, doctorMd, machineInfo, parseAngle, SOFTWARE_LABEL, softwareWarning } from '../src/browser/gpu.ts';
import { nextScrollStep } from '../src/replay/capture.ts';

describe('the renderer string says hardware or software', () => {
  it('knows the software renderers', () => {
    for (const r of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'llvmpipe (LLVM 15.0.6, 256 bits)',
      'Mesa OffScreen',
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Google SwiftShader',
    ])
      expect(classifyRenderer(r), r).toBe('software');
  });
  it('knows graphics cards', () => {
    for (const r of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      'Mali-G78',
    ])
      expect(classifyRenderer(r), r).toBe('hardware');
  });
  it('no renderer means no WebGL, and the browser’s own word for software wins', () => {
    expect(classifyRenderer(null)).toBe('none');
    expect(classifyRenderer('')).toBe('none');
    expect(classifyRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11, D3D11)', 'unavailable_software')).toBe('software');
  });
  it('reads the ANGLE string', () => {
    expect(parseAngle('ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)')).toEqual({
      vendor: 'NVIDIA',
      device: 'NVIDIA GeForce RTX 4060 Laptop GPU',
      backend: 'D3D11',
    });
    expect(parseAngle('Mali-G78')).toEqual({ vendor: null, device: 'Mali-G78', backend: null });
  });
});

const machine = machineInfo();
const sw: BenchResult = {
  schema: 'dea.bench/1',
  result: {
    gpu: { renderer: 'x', device: 'SwiftShader', backend: null, kind: 'software', webgl2: true, browser: 'chromium 1', headless: true },
    machine,
    timingsNote: SOFTWARE_LABEL,
    drew: true,
  },
  meta: { at: '2026-11-07T00:00:00.000Z', dea: '0.1.0', timings: null, site: null, label: SOFTWARE_LABEL },
};
const hw: BenchResult = {
  ...sw,
  result: { ...sw.result, gpu: { ...sw.result.gpu, device: 'NVIDIA GeForce RTX 4060', kind: 'hardware' }, timingsNote: null },
  meta: {
    at: '2026-11-07T00:00:00.000Z',
    dea: '0.1.0',
    timings: { fillMedianMs: 1.23, fillP90Ms: 2.5, fillFrames: 120, drawsMsPer1000: 3.2, uploadMs: 4.4, rafFps: 60 },
    site: { url: 'https://example.com/', idleFps: 59.9, scrollFps: 48.2 },
    label: 'hardware GPU: numbers are from this machine and this run',
  },
};

describe('the bench report', () => {
  it('software: the label and the warning, no speed numbers', () => {
    const md = benchMd(sw);
    expect(md).toContain(SOFTWARE_LABEL);
    expect(md).toContain('SOFTWARE');
    expect(md).not.toMatch(/\| full-window shader/);
    expect(md).not.toMatch(/ fps/);
  });
  it('hardware: the numbers and the page frame rate', () => {
    const md = benchMd(hw);
    expect(md).toContain('| full-window shader');
    expect(md).toContain('median 1.23 ms');
    expect(md).toContain('59.9 fps idle, 48.2 fps while scrolled');
    expect(md).not.toContain('WebGL is running in SOFTWARE');
  });
  it('holds nothing personal: no host name, user name, home folder', () => {
    const text = (JSON.stringify(hw) + benchMd(hw) + JSON.stringify(sw)).replace(/It holds no host name[^\n]*/g, '');
    for (const secret of [hostname(), userInfo().username, homedir()]) if (secret.length > 5) expect(text).not.toContain(secret);
    expect(Object.keys(machine).sort()).toEqual(['arch', 'cpuCount', 'cpuModel', 'memoryGb', 'node', 'os', 'osRelease']);
  });
  it('the doctor prints the software warning', () => {
    const md = doctorMd({
      schema: 'dea.doctor/1',
      checks: [{ id: 'webgl', title: 'WebGL', status: 'limited', note: 'SOFTWARE renderer' }],
      gpu: null,
      machine,
      warnings: softwareWarning(),
    });
    expect(md).toContain('WARNING');
    expect(md).toContain('not a speed measure');
  });
  it('the doctor says how to fix a browser that will not start', () => {
    const md = doctorMd({
      schema: 'dea.doctor/1',
      checks: [
        {
          id: 'browser',
          title: 'browser',
          status: 'no',
          note: 'browserType.launch: Target page, context or browser has been closed',
          fix: 'The browser is installed but this system is missing libraries it needs (libnss3.so).\nInstall them with: npx playwright install-deps chromium',
        },
      ],
      gpu: null,
      machine,
      warnings: [],
    });
    expect(md).toContain('NO      browser:');
    expect(md).toContain('          The browser is installed but this system is missing libraries it needs (libnss3.so).');
    expect(md).toContain('          Install them with: npx playwright install-deps chromium');
  });
});

describe('where the scroll tape stops after its first stops', () => {
  // the tape's loop, with the page replaced by arithmetic: a page that moves `1 / ratio` page px per wheel px
  const walk = (o: { extent: number; ratio: number; minStep: number; budget: number; bytesPerStop?: number; maxBytes?: number; start?: number }) => {
    let pos = o.start ?? 0;
    const stops: number[] = [];
    for (;;) {
      const byBytes = o.bytesPerStop ? Math.floor(((o.maxBytes ?? 0) - stops.length * o.bytesPerStop) / o.bytesPerStop) : Number.POSITIVE_INFINITY;
      const n = nextScrollStep({ left: o.extent - pos, stopsLeft: Math.min(o.budget - stops.length, byBytes), minStep: o.minStep, ratio: o.ratio });
      if (!n) break;
      pos += n.wheel / o.ratio;
      stops.push(Math.round(pos));
    }
    return { stops, pos };
  };
  it('reaches the end of a long page with the stops the budget allows', () => {
    const r = walk({ extent: 55000, ratio: 2, minStep: 200, budget: 30, start: 1000 });
    expect(r.stops).toHaveLength(30);
    expect(55000 - r.pos).toBeLessThan(30);
  });
  it('a smaller budget gives wider stops and still reaches the end', () => {
    const r = walk({ extent: 55000, ratio: 2, minStep: 200, budget: 10, start: 1000 });
    expect(r.stops).toHaveLength(10);
    expect(55000 - r.pos).toBeLessThan(10);
    expect(r.stops[1] - r.stops[0]).toBeGreaterThan(5000);
  });
  it('a size budget spreads the stops the same way', () => {
    const r = walk({ extent: 50000, ratio: 1, minStep: 300, budget: 100, bytesPerStop: 5, maxBytes: 100, start: 0 });
    expect(r.stops.length).toBeLessThanOrEqual(20);
    expect(50000 - r.pos).toBeLessThan(20);
  });
  it('uses fewer, not wider, stops when the page is short', () => {
    const r = walk({ extent: 1000, ratio: 1, minStep: 405, budget: 30 });
    // the last 190 px are less than half a stop: the tape ends there instead of taking a stop for them
    expect(r.stops).toEqual([405, 810]);
  });
  it('plans nothing when nothing is left, or no stop is left', () => {
    expect(nextScrollStep({ left: 100, stopsLeft: 10, minStep: 405, ratio: 1 })).toBeNull();
    expect(nextScrollStep({ left: 5000, stopsLeft: 0, minStep: 405, ratio: 1 })).toBeNull();
  });
  it('is a function of its inputs, and the wheel is the page distance times the ratio', () => {
    const a = nextScrollStep({ left: 12345, stopsLeft: 17, minStep: 300, ratio: 1.7 });
    expect(nextScrollStep({ left: 12345, stopsLeft: 17, minStep: 300, ratio: 1.7 })).toEqual(a);
    expect(a?.wheel).toBe(Math.round((a?.page ?? 0) * 1.7));
  });
});
