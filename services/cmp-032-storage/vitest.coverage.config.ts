import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/*.int.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../evidence/SF-M01-W2-003/coverage',
      reporter: ['text', 'json-summary', 'lcov'],
    },
  },
});
