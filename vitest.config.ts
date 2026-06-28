import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.ts', 'packages/**/*.spec.ts'],
    // Integration tests need a live service + Docker DB; run them via
    // vitest.integration.config.ts (pnpm test:integration), not the unit run.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    // otpauth is an ESM-only dep whose on-the-fly transform stalls test loads.
    // Pre-bundle it once with the SSR optimizer so imports resolve quickly.
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['otpauth'],
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts', '**/__tests__/**', '**/coverage/**'],
    },
    testTimeout: 10000,
  },
});
