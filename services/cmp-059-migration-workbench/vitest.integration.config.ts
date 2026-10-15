import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: '../../evidence/SF-M09-004/junit/integration.xml' },
  },
});
