import { defineConfig } from 'vitest/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Independent SF-M07-SEC probes. Not product runtime. Not CERTIFIED. */
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
      '@serviceform/cmp-022-credential-engine': join(
        ROOT,
        'services/cmp-022-credential-engine/src/index.ts',
      ),
      '@serviceform/cmp-023-qr-verification': join(
        ROOT,
        'services/cmp-023-qr-verification/src/index.ts',
      ),
      '@serviceform/cmp-024-credential-registry': join(
        ROOT,
        'services/cmp-024-credential-registry/src/index.ts',
      ),
      '@serviceform/cmp-012-digilocker': join(ROOT, 'services/cmp-012-digilocker/src/index.ts'),
    },
  },
  test: {
    include: ['tests/security/m07/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/SF-M07-SEC/junit/security.xml' },
  },
});
