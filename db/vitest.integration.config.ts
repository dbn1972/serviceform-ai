import { defineConfig } from 'vitest/config';

// Database integration tests need DATABASE_URL (a disposable database; the suite drops and
// recreates its own schemas). They are excluded from the default unit run.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
