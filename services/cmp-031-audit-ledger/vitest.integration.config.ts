import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: '../../evidence/SF-M01-003/junit/integration.xml' },
  },
});
