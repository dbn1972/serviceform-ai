import { defineConfig } from 'vitest/config';

// Needs DATABASE_URL (disposable database; the harness applies db/migrations and creates
// throwaway LOGIN roles). Not part of the root unit run.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
