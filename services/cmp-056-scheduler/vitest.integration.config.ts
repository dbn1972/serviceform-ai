import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: '../../evidence/SF-M09-001/junit/integration.xml' },
    fileParallelism: false,
  },
});
