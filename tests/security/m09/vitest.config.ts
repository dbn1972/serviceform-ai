import { defineConfig } from 'vitest/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Independent SF-M09-SEC probes. Not product runtime. Not CERTIFIED. */
export default defineConfig({
  root: ROOT,
  resolve: {
    alias: {
      '@serviceform/contracts': join(ROOT, 'packages/contracts/src/index.ts'),
      '@serviceform/observability': join(ROOT, 'packages/observability/src/index.ts'),
      '@serviceform/security': join(ROOT, 'packages/security/src/index.ts'),
      '@serviceform/cmp-036-api-gateway': join(ROOT, 'services/cmp-036-api-gateway/src/index.ts'),
      '@serviceform/cmp-047-observability': join(
        ROOT,
        'services/cmp-047-observability/src/index.ts',
      ),
    },
  },
  test: {
    include: ['tests/security/m09/**/*.test.ts'],
    // Live Postgres probe kept in tree; run with DATABASE_URL + explicit path. FINDINGS recorded in evidence.
    exclude: ['tests/security/m09/db-rls-live.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/SF-M09-SEC/junit/security.xml' },
  },
});
