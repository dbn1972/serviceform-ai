import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * M10 integration harness — Golden IND-SOC-002 E2E + tenant isolation seams.
 * No PostgreSQL required. Not CERTIFIED. Owner policy inputs are placeholders
 * (POLICY_INPUT_REQUIRED per Finding M-04); harness fails closed when missing.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@serviceform/contracts': join(root, 'packages/contracts/src/index.ts'),
      '@serviceform/observability': join(root, 'packages/observability/src/index.ts'),
    },
  },
  test: {
    include: ['tests/integration/m10/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', '**/node_modules/**'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/SF-M10-003/junit/m10-int.xml' },
  },
});
