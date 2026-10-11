import { defineConfig } from 'vitest/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Independent SF-M03-SEC probes. Not product runtime. Not CERTIFIED. */
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
      '@serviceform/cmp-002-tenant-organisation': join(
        ROOT,
        'services/cmp-002-tenant-organisation/src/index.ts',
      ),
      '@serviceform/cmp-003-jurisdiction': join(ROOT, 'services/cmp-003-jurisdiction/src/index.ts'),
      '@serviceform/cmp-030-consent-privacy': join(
        ROOT,
        'services/cmp-030-consent-privacy/src/index.ts',
      ),
      '@serviceform/cmp-031-audit-ledger': join(ROOT, 'services/cmp-031-audit-ledger/src/index.ts'),
      '@serviceform/cmp-032-storage': join(ROOT, 'services/cmp-032-storage/src/index.ts'),
      '@serviceform/cmp-037-integration-hub': join(
        ROOT,
        'services/cmp-037-integration-hub/src/index.ts',
      ),
      '@serviceform/cmp-048-security-platform': join(
        ROOT,
        'services/cmp-048-security-platform/src/index.ts',
      ),
      '@serviceform/cmp-001-catalogue': join(ROOT, 'services/cmp-001-catalogue/src/index.ts'),
      '@serviceform/cmp-033-metadata': join(ROOT, 'services/cmp-033-metadata/src/index.ts'),
      '@serviceform/cmp-034-master-data': join(ROOT, 'services/cmp-034-master-data/src/index.ts'),
      '@serviceform/cmp-051-maker-checker': join(
        ROOT,
        'services/cmp-051-maker-checker/src/index.ts',
      ),
      '@serviceform/cmp-052-versioning': join(ROOT, 'services/cmp-052-versioning/src/index.ts'),
      '@serviceform/cmp-053-localization': join(ROOT, 'services/cmp-053-localization/src/index.ts'),
    },
  },
  test: {
    include: ['tests/security/m03/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
});
