import { defineConfig } from 'vitest/config';

// Temporal SDK-backed suites: real Worker + workflow sandbox against the Temporal time-skipping
// test server (@temporalio/testing) and PostgreSQL (DATABASE_URL). Not part of the root unit run.
export default defineConfig({
  test: {
    include: ['test/temporal/**/*.int.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 300_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/junit/temporal.xml' },
  },
});
