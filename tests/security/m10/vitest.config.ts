import { defineConfig } from 'vitest/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Independent SF-M10-B-SEC probes against a running SAMPLE_LAB platform host and portal BFFs.
 * Not product runtime. Not CERTIFIED. Files run in order: the OPA fail-closed probe stops OPA.
 */
export default defineConfig({
  root: ROOT,
  resolve: {
    alias: {
      '@serviceform/contracts': join(ROOT, 'packages/contracts/src/index.ts'),
      '@serviceform/observability': join(ROOT, 'packages/observability/src/index.ts'),
      '@serviceform/security': join(ROOT, 'packages/security/src/index.ts'),
    },
  },
  test: {
    include: ['tests/security/m10/**/*.sec.test.ts'],
    environment: 'node',
    fileParallelism: false,
    sequence: { shuffle: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/SF-M10-B-SEC/junit/security.xml' },
  },
});
