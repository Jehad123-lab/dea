// Builds the live demo (Vercel: buildCommand in vercel.json, output demo/dist): every --own-assets kit in demo/kits/<slug>
// is built with Vite under /<slug>/, and index.html lists them with their scores from demos.json.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const kits = join(here, 'kits');
const out = join(here, 'dist');
const { demos } = JSON.parse(readFileSync(join(here, 'demos.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// kits made before Round 44 load their files from the site root ('/rebuild/', '/scene/scene.glb'); under /<slug>/ they
// have to come from Vite's base instead
// the expression the kit evaluates at run time (written into its source, so it is assembled here, not interpolated)
const BASE = `$${'{'}import.meta.env?.BASE_URL ?? '/'}`;
const ROOTED = [
  [/\{ base: '\/rebuild\/' \}/g, `{ base: \`${BASE}rebuild/\` }`],
  [/\{ base: '\/replay\/' \}/g, `{ base: \`${BASE}replay/\` }`],
  [/'\/scene\/scene\.glb'/g, `\`${BASE}scene/scene.glb\``],
];
function rebase(dir) {
  for (const f of ['src/Scene.jsx', 'scene.js', 'scene/scene.js']) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    let s = readFileSync(p, 'utf8');
    for (const [re, to] of ROOTED) s = s.replace(re, to);
    writeFileSync(p, s);
  }
}

const built = new Set();
for (const d of demos) {
  const dir = join(kits, d.slug);
  if (!existsSync(join(dir, 'package.json'))) {
    console.log(`demo ${d.slug}: no kit in demo/kits/${d.slug} yet, listed as coming`);
    continue;
  }
  if (existsSync(join(dir, 'public', 'replay'))) {
    // a kit without --own-assets carries the site's own bytes: never published
    console.log(`demo ${d.slug}: public/replay/ is there (not an --own-assets kit), skipped`);
    continue;
  }
  console.log(`demo ${d.slug}: building`);
  rebase(dir);
  execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: dir, stdio: 'inherit' });
  execSync(`npx vite build --base /${d.slug}/ --outDir ${JSON.stringify(join(out, d.slug))} --emptyOutDir`, { cwd: dir, stdio: 'inherit' });
  const binOut = join(out, d.slug, 'rebuild', 'data.bin');
  if (existsSync(binOut)) {
    const raw = readFileSync(binOut);
    const gz = gzipSync(raw, { level: 9 });
    writeFileSync(`${binOut}.gz`, gz);
    rmSync(binOut);
    console.log(`demo ${d.slug}: compressed data.bin ${(raw.length / 1e6).toFixed(2)} MB -> ${(gz.length / 1e6).toFixed(2)} MB`);
  }
  const pipeOut = join(out, d.slug, 'rebuild', 'pipeline.json');
  if (existsSync(pipeOut)) {
    const raw = readFileSync(pipeOut);
    if (raw.length > 1_000_000) {
      const gz = gzipSync(raw, { level: 9 });
      writeFileSync(`${pipeOut}.gz`, gz);
      rmSync(pipeOut);
      console.log(`demo ${d.slug}: compressed pipeline.json ${(raw.length / 1e6).toFixed(2)} MB -> ${(gz.length / 1e6).toFixed(2)} MB`);
    }
  }
  if (existsSync(join(dir, 'preview'))) {
    mkdirSync(join(out, d.slug, 'preview'), { recursive: true });
    for (const f of readdirSync(join(dir, 'preview'))) if (f.endsWith('.png')) cpSync(join(dir, 'preview', f), join(out, d.slug, 'preview', f));
  }
  built.add(d.slug);
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const card = (d) => {
  const live = built.has(d.slug);
  const shot = live && existsSync(join(out, d.slug, 'preview', 'side-by-side-rebuild.png'));
  return `<article>
  ${shot ? `<img src="/${d.slug}/preview/side-by-side-rebuild.png" alt="${esc(d.title)}: original and rebuild side by side" loading="lazy" />` : ''}
  <h2>${esc(d.title)}</h2>
  <p class="score">canvas ${pct(d.canvas)} · page ${pct(d.page)} <span>Round ${d.round}</span></p>
  <p>${esc(d.note)}</p>
  <p class="links">${live ? `<a href="/${d.slug}/">Open the rebuild</a>` : '<span>Rebuild coming soon</span>'} <a href="${esc(d.original)}" rel="noopener">Original site</a></p>
</article>`;
};
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DEA live demos</title>
<link rel="preconnect" href="https://rsms.me/" />
<link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
<style>
  :root { color-scheme: dark; --bg: #0b0b0c; --card: #161618; --fg: #f2f2f2; --dim: #9a9aa0; --accent: #ffffff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 400 16px/1.5 Inter, system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 64px 24px; }
  h1 { font-weight: 600; font-size: 40px; letter-spacing: -0.02em; margin: 0 0 8px; }
  header p { color: var(--dim); margin: 0 0 40px; max-width: 640px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
  article { background: var(--card); border-radius: 16px; padding: 20px; }
  article img { width: 100%; border-radius: 10px; display: block; margin-bottom: 16px; }
  h2 { font-weight: 600; font-size: 20px; margin: 0 0 4px; }
  .score { font-weight: 500; margin: 0 0 8px; }
  .score span, article p { color: var(--dim); }
  .score { color: var(--fg); }
  .links { display: flex; gap: 16px; margin: 16px 0 0; }
  a { color: var(--accent); font-weight: 500; text-decoration: none; }
  a:hover { text-decoration: underline; }
  @media (prefers-reduced-motion: no-preference) { article { transition: transform 200ms ease; } article:hover { transform: translateY(-2px); } }
</style>
</head>
<body>
<main>
  <header>
    <h1>DEA live demos</h1>
    <p>Each demo is an editable three.js rebuild that DEA made from the site's render graph with <code>--own-assets</code>: the site's
    shaders and passes, with stand-in meshes and colour-grid images instead of its own models and images. Scores compare
    the rebuild with the original first screen.</p>
  </header>
  <section class="grid">
${demos.map(card).join('\n')}
  </section>
</main>
</body>
</html>
`,
);
console.log(`demo: ${built.size} of ${demos.length} rebuilds built into demo/dist`);
