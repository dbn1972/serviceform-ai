import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: '../../evidence/SF-M01-001/junit/integration.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: '../../evidence/SF-M01-001/coverage',
    },
  },
});
