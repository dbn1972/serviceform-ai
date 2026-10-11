import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Independent M05 INT PostgreSQL suites. Requires DATABASE_URL. */
export default defineConfig({
  resolve: {
    alias: {
      '@serviceform/contracts': join(root, 'packages/contracts/src/index.ts'),
      '@serviceform/observability': join(root, 'packages/observability/src/index.ts'),
      '@serviceform/storage': join(root, 'packages/storage/src/index.ts'),
      fastify: join(root, 'apps/api/node_modules/fastify'),
      pg: join(root, 'db/node_modules/pg'),
    },
  },
  test: {
    include: ['tests/integration/m05/**/*.int.test.ts'],
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 120_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/m05-int/junit/independent-int.xml' },
  },
});
