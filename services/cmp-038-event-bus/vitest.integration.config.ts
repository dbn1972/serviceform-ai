import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/integration-junit.xml' },
  },
});
