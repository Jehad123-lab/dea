import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
export async function inspectSite(url: string) {
  const runId = randomUUID();
  const dir = join('.dea', 'runs', runId);
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordHar: { path: join(dir, 'network.har') },
  });
  // Runs before the site's own code: saves every WebGL shader it compiles.
  await context.addInitScript(() => {
    const shaders: string[] = [];
    (window as any).__DEA_SHADERS__ = shaders;
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext] as any[]) {
      const original = C.prototype.shaderSource;
      C.prototype.shaderSource = function (this: unknown, shader: WebGLShader, source: string) {
        shaders.push(source);
        return original.call(this, shader, source);
      };
    }
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3000); // let WebGL and animations start
  const facts = await page.evaluate(() => ({
    title: document.title,
    three: (window as any).__THREE__ ?? null,   // three.js revision
    gsap: (window as any).gsap?.version ?? null, // GSAP version, if it's global
    fonts: [...document.fonts].map(f => `${f.family} ${f.weight} ${f.style}`),
    scripts: [...document.scripts].map(s => s.src).filter(Boolean),
    shaderCount: ((window as any).__DEA_SHADERS__ ?? []).length,
  }));
  const shaders = await page.evaluate(() => (window as any).__DEA_SHADERS__ ?? []);
  const tree = await page.ariaSnapshot({ mode: 'ai' });
  await writeFile(join(dir, 'facts.json'), JSON.stringify(facts, null, 2));
  await writeFile(join(dir, 'shaders.json'), JSON.stringify(shaders, null, 2));
  await writeFile(join(dir, 'page.aria.yaml'), tree);
  await context.close(); // this writes network.har
  await browser.close();
  return { runId, dir, facts };
}
