import type { Page } from 'playwright';

/**
 * Make a page do its thing: wait for intros, one real wheel and pointer move, then a bounded in-page run of wheel
 * events and scrolls (works for native scroll and for sites that drive their own scroll from wheel events), then back
 * to the top. Optional per-step callback for sampling while it scrolls.
 */
export async function exercisePage(page: Page, o: { steps?: number; waitMs?: number; budgetMs?: number } = {}): Promise<void> {
  await page.waitForTimeout(o.waitMs ?? 2500);
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  await page.mouse.move(vp.width / 2, vp.height / 2).catch(() => {});
  await page.mouse.wheel(0, 300).catch(() => {});
  await page
    .evaluate(
      async ({ steps, budget }) => {
        const step = Math.max(300, innerHeight * 0.6);
        const target = () => document.elementFromPoint(innerWidth / 2, innerHeight / 2) ?? document.body;
        const t0 = performance.now();
        for (let i = 0; i < steps; i++) {
          if (performance.now() - t0 > budget) break;
          const t = target();
          t.dispatchEvent(
            new WheelEvent('wheel', { deltaY: step * 0.6, deltaMode: 0, bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }),
          );
          t.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: innerWidth * (0.3 + (i % 10) / 25), clientY: innerHeight * 0.45 }));
          window.scrollBy(0, step);
          await new Promise((r) => setTimeout(r, 180));
        }
        await new Promise((r) => setTimeout(r, 600));
        window.scrollTo(0, 0);
      },
      { steps: o.steps ?? 20, budget: o.budgetMs ?? 25_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(800);
}
