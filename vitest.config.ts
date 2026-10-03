import { defineConfig } from 'vitest/config';

// Unit and component tests for every TypeScript workspace. Database integration tests
// (*.int.test.ts) run separately via `pnpm db:test` because they need PostgreSQL.
export default defineConfig({
  test: {
    include: [
      'apps/*/test/**/*.test.{ts,tsx}',
      'packages/*/test/**/*.test.{ts,tsx}',
      'services/*/test/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/unit/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['apps/api/src/**', 'packages/*/src/**'],
      // Process entry point: exercised by the built-server smoke run, not unit tests.
      exclude: ['apps/api/src/server.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
