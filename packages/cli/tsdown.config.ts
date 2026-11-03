import { defineConfig } from 'tsdown';

// One self-contained build: DEA's own packages (@dea/core and the MCP server) are bundled in; npm dependencies stay external.
export default defineConfig({
  entry: { index: 'src/index.ts', mcp: 'src/mcp-stdio.ts', 'session-daemon': 'src/session-daemon.ts' },
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
