import { defineConfig } from 'vitest/config';

// `pnpm test:e2e` runs with --mode e2e, which turns on the real-browser tests on every OS (no shell env syntax needed).
export default defineConfig(({ mode }) => ({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: mode === 'e2e' ? { DEA_E2E: '1' } : {},
  },
}));
