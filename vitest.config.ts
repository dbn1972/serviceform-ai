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
      include: ['apps/api/src/**', 'packages/*/src/**', 'services/*/src/**'],
      // Process entry point: exercised by the built-server smoke run, not unit tests.
      // Wave 2 Fastify route/repo/db/service graphs are gated by component coverage configs
      // + *.int.test.ts (Postgres). They are excluded from the global unit threshold so the
      // root job does not double-count int-only surfaces (SF-M01-W2-STITCH).
      exclude: [
        'apps/api/src/server.ts',
        'services/cmp-003-jurisdiction/src/routes/**',
        'services/cmp-003-jurisdiction/src/repositories/**',
        'services/cmp-003-jurisdiction/src/db/**',
        'services/cmp-030-consent-privacy/src/routes/**',
        'services/cmp-030-consent-privacy/src/repositories/**',
        'services/cmp-030-consent-privacy/src/db/**',
        'services/cmp-032-storage/src/routes/**',
        'services/cmp-032-storage/src/repo/**',
        'services/cmp-032-storage/src/db/**',
        'services/cmp-032-storage/src/service/**',
        'services/cmp-055-developer-platform/src/cli/**',
      ],
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
