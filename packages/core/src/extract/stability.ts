// How repeatable is a number measured on this site? The scripted interaction is run on several fresh loads of the ORIGINAL, and each
// run is compared with the first by the same scorer the kit is compared with. That is the noise floor of the whole measurement: a kit
// cannot be expected to agree with the site more than the site agrees with itself. Two ways of starting each run are compared: the old
// one (wait as long as the first run took) and the phase-aligned one (wait until the scene is stable and shows the first run's picture).

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { NAME_SHIM } from '../browser/init.ts';
import { installObservers, launchBrowser, releaseBrowser } from '../browser/open.ts';
import { alignToReference, type PhaseInfo, phaseInfo } from '../browser/phase.ts';
import { type SettleResult, thumbOf } from '../browser/settle.ts';
import { assertNotBotWall } from '../browser/wall.ts';
import { REPLAY_CAPTURE_SCRIPT } from '../replay/capture.ts';
import { INTERACTION_SCRIPT, type InteractionScore, meanResponse, runInteraction, scoreInteraction } from './interaction.ts';

export interface StabilityOptions {
  runs?: number;
  mode?: 'aligned' | 'fixed' | 'both';
  viewport?: { width: number; height: number };
  browser?: 'auto' | 'chrome' | 'msedge' | 'chromium';
  headless?: boolean;
  /** longest wait for a scene to settle or reach the reference phase (ms, default 90 000) */
  capMs?: number;
  outDir?: string;
  onProgress?: (s: string) => void;
}

export interface StabilityPair {
  /** run index compared with run 0 */
  run: number;
  /** mean response over the moving steps (0..1), null when nothing moved in either */
  response: number | null;
  /** how alike the two frames at rest were before any input (1 − mean absolute difference): the start phase */
  startFrame: number;
  /** mean frame similarity after each move */
  frame: number;
  phase: PhaseInfo | null;
  steps: InteractionScore[];
}

export interface ModeStats {
  mode: 'aligned' | 'fixed';
  pairs: StabilityPair[];
  mean: number | null;
  min: number | null;
  max: number | null;
  /** standard deviation of the response over the runs */
  sd: number | null;
  /** runs that started in the reference's phase (aligned mode) */
  alignedRuns: number;
  meanStartFrame: number;
}

export interface StabilityResult {
  url: string;
  runs: number;
  made: string;
  modes: ModeStats[];
  /** the fixed wait the old method used (ms): the time run 0 took to settle */
  fixedWaitMs: number;
  script: string[];
  notes: string[];
}

const stat = (xs: number[]) => {
  if (!xs.length) return { mean: null, min: null, max: null, sd: null };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { mean: r(mean), min: r(Math.min(...xs)), max: r(Math.max(...xs)), sd: r(sd) };
};

async function freshLoad(browser: Browser, url: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  await installObservers(context, true);
  await context.addInitScript({ content: REPLAY_CAPTURE_SCRIPT });
  const page = await context.newPage();
  const resp = await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => null);
  await assertNotBotWall(page, resp);
  return { context, page };
}

export async function measureStability(url: string, o: StabilityOptions = {}): Promise<StabilityResult> {
  const say = (s: string) => o.onProgress?.(s);
  const runs = Math.max(2, o.runs ?? 3);
  const mode = o.mode ?? 'both';
  const viewport = o.viewport ?? { width: 1440, height: 900 };
  const cap = o.capMs ?? 90_000;
  const { browser } = await launchBrowser(o.browser ?? 'auto', o.headless ?? true);
  const notes: string[] = [];
  try {
    // run 0: the reference run (settle, take the thumbnail of its settled picture, run the script)
    say('run 0 (reference): loading, waiting for the scene to settle');
    const t0 = Date.now();
    const base = await freshLoad(browser, url, viewport);
    const al0 = await alignToReference(base.page, null, { capMs: cap });
    const refThumb: Uint8Array | null = (al0.settle as SettleResult).thumb ?? (await thumbOf(base.page));
    const fixedWaitMs = Date.now() - t0;
    say(`run 0: ${al0.note}`);
    if (al0.settle.timeDriven)
      notes.push('the scene kept moving after it loaded (time-driven): runs can only be aligned to the same picture, not the same internal moment');
    const frames0 = await runInteraction(base.page);
    await base.context.close().catch(() => {});
    const modes: ModeStats[] = [];
    const scratchCtx = await browser.newContext({ viewport });
    const scratch: Page = await scratchCtx.newPage();
    await scratch.evaluate(NAME_SHIM);
    for (const m of mode === 'both' ? (['fixed', 'aligned'] as const) : [mode]) {
      const pairs: StabilityPair[] = [];
      for (let i = 1; i < runs; i++) {
        say(`${m} run ${i}/${runs - 1}: fresh load`);
        const r = await freshLoad(browser, url, viewport);
        let ph: PhaseInfo | null = null;
        if (m === 'aligned') {
          const al = await alignToReference(r.page, refThumb, { capMs: cap });
          ph = phaseInfo(al);
          say(`${m} run ${i}: ${al.note}`);
        } else {
          // the old method: wait as long as the first run took to settle, and go
          await r.page.waitForTimeout(Math.min(fixedWaitMs, 150_000));
        }
        const frames = await runInteraction(r.page);
        await r.context.close().catch(() => {});
        const steps = await scoreInteraction(scratch, frames0, frames);
        const resp = meanResponse(steps);
        pairs.push({
          run: i,
          response: resp,
          startFrame: steps[0]?.frame ?? 0,
          frame: Math.round((steps.reduce((a, s) => a + s.frame, 0) / steps.length) * 1000) / 1000,
          phase: ph,
          steps,
        });
        say(
          `${m} run ${i}: start frames ${Math.round((steps[0]?.frame ?? 0) * 1000) / 10}% alike, interaction response ${resp != null ? `${Math.round(resp * 1000) / 10}%` : 'n/a'}`,
        );
      }
      const st = stat(pairs.map((p) => p.response).filter((v): v is number => v != null));
      modes.push({
        mode: m,
        pairs,
        ...st,
        alignedRuns: pairs.filter((p) => p.phase?.aligned).length,
        meanStartFrame: Math.round((pairs.reduce((a, p) => a + p.startFrame, 0) / Math.max(1, pairs.length)) * 1000) / 1000,
      });
    }
    await scratchCtx.close().catch(() => {});
    const res: StabilityResult = {
      url,
      runs,
      made: new Date().toISOString(),
      modes,
      fixedWaitMs,
      script: INTERACTION_SCRIPT.map((s) => s.name),
      notes,
    };
    if (o.outDir) {
      await mkdir(o.outDir, { recursive: true });
      await writeFile(join(o.outDir, 'stability.json'), `${JSON.stringify(res, null, 2)}\n`);
      await writeFile(join(o.outDir, 'stability.md'), stabilityMd(res));
    }
    return res;
  } finally {
    await releaseBrowser(browser);
  }
}

const pc = (x: number | null) => (x == null ? 'n/a' : `${Math.round(x * 1000) / 10}%`);

export function stabilityMd(r: StabilityResult): string {
  const lines = [
    `# Stability of the interaction measurement: ${r.url}`,
    '',
    `The scripted interaction (${r.script.join(', ')}) was run on ${r.runs} fresh loads of the ORIGINAL site. Each later run is compared with run 0 by the scorer the kit is compared with, so this is the noise floor: a kit cannot be expected to agree with the site more than the site agrees with itself.`,
    '',
    `| start | runs compared | start frames alike (mean) | interaction response: mean | min | max | sd | started in the reference phase |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  for (const m of r.modes)
    lines.push(
      `| ${m.mode === 'fixed' ? `fixed wait (${Math.round(r.fixedWaitMs / 1000)} s, the old way)` : "phase-aligned (wait for the scene to be stable and show run 0's picture)"} | ${m.pairs.length} | ${pc(m.meanStartFrame)} | ${pc(m.mean)} | ${pc(m.min)} | ${pc(m.max)} | ${pc(m.sd)} | ${m.mode === 'aligned' ? `${m.alignedRuns}/${m.pairs.length}` : 'not checked'} |`,
    );
  lines.push('');
  for (const m of r.modes) {
    lines.push(`## ${m.mode}`, '', '| run | start frames alike | response | notes |', '|---|---|---|---|');
    for (const p of m.pairs) lines.push(`| ${p.run} | ${pc(p.startFrame)} | ${pc(p.response)} | ${p.phase ? p.phase.note : ''} |`);
    lines.push('');
  }
  if (r.notes.length) lines.push(...r.notes.map((n) => `- ${n}`), '');
  lines.push(
    '"Start frames alike" is the similarity of the two pictures before any input: it measures whether both runs began in the same phase. Low means the numbers after it compare two different moments of the site.',
    '',
  );
  return lines.join('\n');
}
