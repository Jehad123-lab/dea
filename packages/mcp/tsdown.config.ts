import { defineConfig } from 'tsdown';

// One self-contained build: DEA's own packages (@dea/core) are bundled in; npm dependencies stay external.
export default defineConfig({
  entry: { stdio: 'src/stdio.ts', index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  fixedExtension: true,
  deps: { alwaysBundle: [/^@dea\//] },
});
