import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Wave 1 consumer-driven contract suite (F-V1-CDC).
 * Runs separately from unit coverage so thresholds stay component-local.
 * Aliases map workspace packages because tests/ is outside pnpm-workspace packages.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@serviceform/contracts': join(root, 'packages/contracts/src/index.ts'),
      '@serviceform/audit-client': join(root, 'packages/audit-client/src/index.ts'),
    },
  },
  test: {
    include: ['tests/cdc/**/*.cdc.test.ts'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/cdc/junit.xml' },
  },
});
