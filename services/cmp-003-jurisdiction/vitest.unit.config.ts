import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/*.int.test.ts'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: '../../evidence/SF-M01-W2-001/junit/unit.xml' },
  },
});
