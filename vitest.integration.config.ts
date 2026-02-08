import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['packages/**/*.integration.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        testTimeout: 30000,
        hookTimeout: 30000,
        setupFiles: ['./packages/auth-service/src/__tests__/setup.integration.ts'],
    },
});
