import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * SF-M10-B-INT: independent integration checks against live SAMPLE_LAB platform hosts
 * (two tenants, one PostgreSQL, real OPA). Run through `run.sh`; never part of `pnpm test`.
 */
export default defineConfig({
  resolve: {
    alias: {
      pg: join(root, 'db/node_modules/pg'),
    },
  },
  test: {
    root,
    include: ['tests/integration/m10-platform/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/SF-M10-B-INT/junit/m10-platform-int.xml' },
  },
});
