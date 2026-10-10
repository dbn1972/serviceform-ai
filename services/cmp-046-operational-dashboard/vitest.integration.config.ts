import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: '../../evidence/SF-M08-004/junit/integration.xml' },
  },
});
