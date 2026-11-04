// The interaction check: the same scripted pointer and scroll, in a real browser, on the live site and on the kit
// (capture replay and editable rebuild), with a frame after each move. Two numbers per move:
//   response: where the picture changed after the move, original vs kit (correlation of the change maps, 0..1);
//             a kit that ignores the pointer changes nothing where the site's trail appears and scores near 0
//   frame:    how alike the frames after the move are (1 − mean absolute difference, on a small grey image)
// Both are rough on a machine without a GPU: the site and the kit run at different frame rates, so a trail that eases
// in over 20 frames on the site may be at a different point in the kit when the frame is taken.

import type { Page } from 'playwright';

export interface InteractionStep {
  name: string;
  /** what the step does, in words */
  does: string;
  input: 'rest' | 'pointer' | 'scroll';
  run: (page: Page, vp: { width: number; height: number }) => Promise<void>;
}

const glide = async (page: Page, from: [number, number], to: [number, number], steps = 8, ms = 40) => {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    await page.waitForTimeout(ms);
  }
};

export const INTERACTION_SCRIPT: InteractionStep[] = [
  {
    name: 'rest',
    does: 'pointer at the centre, still',
    input: 'rest',
    run: async (page, vp) => {
      await page.mouse.move(vp.width * 0.5, vp.height * 0.5);
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'pointer → upper right',
    does: 'pointer glides from the centre to 75% across, 35% down',
    input: 'pointer',
    run: async (page, vp) => {
      await glide(page, [vp.width * 0.5, vp.height * 0.5], [vp.width * 0.75, vp.height * 0.35]);
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'pointer → lower left',
    does: 'pointer glides to 25% across, 70% down',
    input: 'pointer',
    run: async (page, vp) => {
      await glide(page, [vp.width * 0.75, vp.height * 0.35], [vp.width * 0.25, vp.height * 0.7]);
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'scroll down',
    does: 'mouse wheel down 400 px',
    input: 'scroll',
    run: async (page) => {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(900);
    },
  },
];

/** Run the script on a page that is already showing the thing to test; a PNG after each step. */
export async function runInteraction(page: Page): Promise<Buffer[]> {
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const out: Buffer[] = [];
  for (const step of INTERACTION_SCRIPT) {
    await step.run(page, vp);
    out.push(await page.screenshot({ type: 'png', timeout: 60_000 }));
  }
  return out;
}

export interface InteractionScore {
  step: string;
  input: InteractionStep['input'];
  /** correlation of where the picture changed, original vs kit, 0..1 (null at rest) */
  response: number | null;
  /** how much the original changed (mean of the change map, 0..255) and how much the kit did */
  changeOriginal: number | null;
  changeKit: number | null;
  /** 1 − mean absolute difference of the frames after the step */
  frame: number;
}

/** Score kit frames against the original's, step by step (decoded in a scratch tab). */
export async function scoreInteraction(scratch: Page, original: Buffer[], kit: Buffer[]): Promise<InteractionScore[]> {
  const toUrl = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  const res = (await scratch.evaluate(
    async ([o, k]) => {
      const W = 96;
      const H = 60;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      const grey = async (u: string) => {
        const img = await createImageBitmap(await (await fetch(u)).blob());
        x.drawImage(img, 0, 0, W, H);
        const d = x.getImageData(0, 0, W, H).data;
        const g = new Float32Array(W * H);
        for (let i = 0; i < g.length; i++) g[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
        return g;
      };
      const O = await Promise.all(o.map(grey));
      const K = await Promise.all(k.map(grey));
      const out = [];
      for (let i = 0; i < O.length; i++) {
        let f = 0;
        for (let j = 0; j < O[i].length; j++) f += Math.abs(O[i][j] - K[i][j]);
        const frame = 1 - f / O[i].length / 255;
        if (!i) {
          out.push({ response: null, changeOriginal: null, changeKit: null, frame });
          continue;
        }
        const dO = O[i].map((v, j) => Math.abs(v - O[i - 1][j]));
        const dK = K[i].map((v, j) => Math.abs(v - K[i - 1][j]));
        const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
        const mo = mean(dO);
        const mk = mean(dK);
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        for (let j = 0; j < dO.length; j++) {
          const a = dO[j] - mo;
          const b = dK[j] - mk;
          sxy += a * b;
          sxx += a * a;
          syy += b * b;
        }
        // both still: they agree; one still and the other not: they do not
        const still = (m: number) => m < 0.5;
        const r = still(mo) && still(mk) ? 1 : sxx > 0 && syy > 0 ? Math.max(0, sxy / Math.sqrt(sxx * syy)) : 0;
        out.push({ response: r, changeOriginal: mo, changeKit: mk, frame });
      }
      return out;
    },
    [original.map(toUrl), kit.map(toUrl)] as const,
  )) as Array<Omit<InteractionScore, 'step' | 'input'>>;
  const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  return res.map((s, i) => ({
    step: INTERACTION_SCRIPT[i].name,
    input: INTERACTION_SCRIPT[i].input,
    response: r3(s.response),
    changeOriginal: s.changeOriginal == null ? null : Math.round(s.changeOriginal * 10) / 10,
    changeKit: s.changeKit == null ? null : Math.round(s.changeKit * 10) / 10,
    frame: r3(s.frame) as number,
  }));
}

/** A strip of frames as one JPG: a row per source (original, replay, rebuild), a column per step, labelled. */
export async function framesStrip(scratch: Page, rows: Array<{ label: string; frames: Buffer[] }>, maxBytes = 950_000): Promise<Buffer> {
  const steps = INTERACTION_SCRIPT.map((s) => s.name);
  let quality = 0.82;
  for (let tries = 0; tries < 6; tries++) {
    const url = (await scratch.evaluate(
      async ([rws, names, q]) => {
        const cw = 400;
        const pad = 6;
        const head = 22;
        const imgs = await Promise.all(rws.map((r) => Promise.all(r.frames.map(async (u) => createImageBitmap(await (await fetch(u)).blob())))));
        const ch = Math.round((imgs[0][0].height / imgs[0][0].width) * cw);
        const left = 92;
        const c = document.createElement('canvas');
        c.width = left + names.length * (cw + pad);
        c.height = head + rws.length * (ch + pad);
        const x = c.getContext('2d') as CanvasRenderingContext2D;
        x.fillStyle = '#111';
        x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = '#eee';
        x.font = '13px sans-serif';
        for (const [i, n] of names.entries()) x.fillText(n, left + i * (cw + pad) + 4, 15);
        for (const [j, r] of rws.entries()) {
          x.fillText(r.label, 6, head + j * (ch + pad) + ch / 2);
          for (const [i, im] of imgs[j].entries()) x.drawImage(im, left + i * (cw + pad), head + j * (ch + pad), cw, ch);
        }
        return c.toDataURL('image/jpeg', q);
      },
      [rows.map((r) => ({ label: r.label, frames: r.frames.map((b) => `data:image/png;base64,${b.toString('base64')}`) })), steps, quality] as const,
    )) as string;
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    if (buf.length <= maxBytes || quality < 0.3) return buf;
    quality -= 0.12;
  }
  throw new Error('unreachable');
}

export type InputStatus = 'verified' | 'inferred' | 'frozen' | 'not used';

export interface InputVerdict {
  input: 'pointer' | 'scroll' | 'viewport' | 'time';
  /** verified: measured on the site and driven live; inferred: driven live from the uniform's name, not measured;
   *  frozen: the site answers this input but the kit plays it as recorded; not used: the site's WebGL does not answer it */
  status: InputStatus;
  replay: 'live' | 'recorded';
  rebuild: 'live' | 'recorded';
  uniforms: string[];
  evidence: string;
}

export interface KitInteraction {
  steps: InteractionScore[];
  response: number | null;
  /** 8 consecutive live frames: the kit as shipped (the scored frame's camera held) ... */
  steady?: import('./preview.ts').Steadiness | null;
  /** ... and alternating the two recorded frames, as round 4 did */
  alternating?: import('./preview.ts').Steadiness | null;
  error?: string;
}

export interface InteractionResult {
  script: Array<{ name: string; does: string }>;
  replay: KitInteraction | null;
  rebuild: KitInteraction | null;
  inputs: InputVerdict[];
  /** uniforms the probe saw change that follow no input DEA can drive */
  unexplained: string[];
}

/** Mean response over the steps that move an input. */
export const meanResponse = (steps: InteractionScore[], input?: InteractionStep['input']): number | null => {
  const r = steps.filter((s) => s.response != null && (!input || s.input === input)).map((s) => s.response as number);
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 1000) / 1000 : null;
};

/** Per input: what the kit does with it, and on what evidence. */
export function classifyInputs(
  inputs: Array<import('../replay/inputs.ts').InputMap>,
  probe: import('../replay/inputs.ts').ProbeReport | null,
  clocks: number,
  original: InteractionScore[] | null,
): InputVerdict[] {
  const out: InputVerdict[] = [];
  const names = (ms: typeof inputs) => [...new Set(ms.map((m) => m.uniform))];
  // how much the site's own picture changed when the script moved this input (mean of the change map, 0..255)
  const siteChange = (input: 'pointer' | 'scroll') => {
    const c = (original ?? []).filter((s) => s.input === input && s.changeOriginal != null).map((s) => s.changeOriginal as number);
    return c.length ? Math.max(...c) : null;
  };
  for (const input of ['pointer', 'scroll', 'viewport'] as const) {
    const ms = inputs.filter((m) => (input === 'pointer' ? m.kind === 'pointer' || m.kind === 'pointer-velocity' : m.kind === input));
    const meas = ms.filter((m) => m.source === 'measured');
    const exercised = probe ? (input === 'pointer' ? probe.exercised.pointer : input === 'scroll' ? probe.exercised.scroll : probe.exercised.resize) : false;
    const change = input === 'viewport' ? null : siteChange(input);
    const replayLive = input !== 'viewport' && ms.length > 0;
    const rebuildLive = ms.length > 0;
    if (meas.length) {
      const best = meas.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
      out.push({
        input,
        status: 'verified',
        replay: input === 'viewport' ? 'recorded' : 'live',
        rebuild: 'live',
        uniforms: names(ms),
        evidence: `measured on the site: ${meas.length} uniform component(s) follow it (best r = ${Math.abs(best.r).toFixed(3)}${meas.some((m) => m.k < 1) ? `, eased k = ${[...new Set(meas.map((m) => m.k))].join('/')}` : ''})${input === 'viewport' ? '; the replay keeps the recorded drawing-buffer size (stretched), the rebuild resizes its render targets' : ''}`,
      });
    } else if (ms.length) {
      out.push({
        input,
        status: 'inferred',
        replay: replayLive ? 'live' : 'recorded',
        rebuild: rebuildLive ? 'live' : 'recorded',
        uniforms: names(ms),
        evidence: `${exercised ? 'the probe moved it but the value did not follow; ' : 'not measured; '}driven from the uniform's name and recorded value (direction and easing are guesses)`,
      });
    } else if (input === 'viewport') {
      out.push({
        input,
        status: exercised ? 'frozen' : 'not used',
        replay: 'recorded',
        rebuild: 'live',
        uniforms: [],
        evidence: exercised
          ? 'no uniform follows the window size; the rebuild still resizes its drawing buffer, full/half/quarter-size render targets and the camera aspect'
          : 'the probe did not resize the window',
      });
    } else {
      const answers = change != null && change >= 2;
      out.push({
        input,
        status: answers ? 'frozen' : 'not used',
        replay: 'recorded',
        rebuild: 'recorded',
        uniforms: [],
        evidence: answers
          ? `the site's picture changed (mean ${change?.toFixed(1)} of 255) but no float uniform followed it: it may move a camera matrix, the DOM or CSS, which DEA does not map yet`
          : `${exercised ? 'the probe moved it' : 'the probe could not move it'}; no uniform followed and the site's picture barely changed`,
      });
    }
  }
  out.push({
    input: 'time',
    status: clocks ? 'verified' : 'not used',
    replay: clocks ? 'live' : 'recorded',
    rebuild: clocks ? 'live' : 'recorded',
    uniforms: [],
    evidence: clocks
      ? `${clocks} clock uniform(s) read from the two recorded frames advance with real time`
      : 'no uniform advanced between the recorded frames',
  });
  return out;
}

/** The "Live interaction" section of extract.md. */
export function interactionMd(r: InteractionResult): string {
  const pc = (x: number | null) => (x == null ? 'n/a' : `${Math.round(x * 1000) / 10}%`);
  const rows = r.script.map((st, i) => {
    const a = r.replay?.steps[i];
    const b = r.rebuild?.steps[i];
    return `| ${st.name} | ${st.does} | ${a?.changeOriginal ?? b?.changeOriginal ?? '–'} | ${a ? `${pc(a.response)} / ${pc(a.frame)}` : '–'} | ${b ? `${pc(b.response)} / ${pc(b.frame)}` : '–'} |`;
  });
  const mark = (s: InputStatus) => (s === 'verified' ? '✔ Verified' : s === 'inferred' ? '≈ Inferred' : s === 'frozen' ? '✖ Frozen' : '– not used');
  return [
    '## Live interaction',
    '',
    'The same pointer and scroll script ran on the live site and on the kit running live (preview/interaction.jpg: one row each). "Response" is how well the places where the picture changed after each move match the site (correlation of the change maps); "frame" is how alike the frames are. Both are rough without a GPU: the site and the kit run at different frame rates.',
    '',
    '| step | what moves | site change (0–255) | (a) replay: response / frame | (b) rebuild: response / frame |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Mean response: replay ${pc(r.replay?.response ?? null)}, rebuild ${pc(r.rebuild?.response ?? null)}.`,
    '',
    'Steadiness, 8 consecutive live frames (change between neighbours / change two apart; above 1.5 with real change means the picture flips back and forth):',
    '',
    ...(['replay', 'rebuild'] as const).flatMap((k) => {
      const x = r[k];
      if (!x?.steady) return [];
      const f = (s: import('./preview.ts').Steadiness | null | undefined) =>
        s ? `${s.step} / ${s.skip} (flip ${s.flip}${s.shaking ? ', shaking' : ''})` : 'n/a';
      return [`- ${k}: held (shipped) ${f(x.steady)}; alternating the two recorded frames ${f(x.alternating)}`];
    }),
    '',
    '| input | status | replay | rebuild | uniforms | evidence |',
    '| --- | --- | --- | --- | --- | --- |',
    ...r.inputs.map(
      (v) =>
        `| ${v.input} | ${mark(v.status)} | ${v.replay} | ${v.rebuild} | ${v.uniforms.slice(0, 6).join(', ') || '–'}${v.uniforms.length > 6 ? ` +${v.uniforms.length - 6}` : ''} | ${v.evidence} |`,
    ),
    ...(r.unexplained.length
      ? [
          '',
          `Uniforms that changed during the probe and follow no input DEA can drive (they play as recorded): ${r.unexplained.slice(0, 12).join(', ')}${r.unexplained.length > 12 ? ` +${r.unexplained.length - 12}` : ''}.`,
        ]
      : []),
  ].join('\n');
}
