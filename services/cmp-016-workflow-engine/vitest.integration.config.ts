import { defineConfig } from 'vitest/config';

// Needs DATABASE_URL (disposable database). Runs as real LOGIN roles (ADR-0006 condition 10).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/junit/integration.xml' },
  },
});
