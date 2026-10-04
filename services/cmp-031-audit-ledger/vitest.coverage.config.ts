import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/**/*.test.ts',
      'test/**/*.int.test.ts',
      '../../packages/audit-client/test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
    coverage: {
      provider: 'v8',
      include: ['src/**', '../../packages/audit-client/src/**'],
      exclude: ['src/cli/**'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: '../../evidence/SF-M01-003/coverage',
      thresholds: { lines: 80, functions: 70, branches: 50, statements: 75 },
    },
  },
});
