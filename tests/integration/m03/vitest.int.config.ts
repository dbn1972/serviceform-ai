import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Independent M03 INT PostgreSQL suites. Requires DATABASE_URL. */
export default defineConfig({
  resolve: {
    alias: {
      '@serviceform/contracts': join(root, 'packages/contracts/src/index.ts'),
      '@serviceform/observability': join(root, 'packages/observability/src/index.ts'),
      fastify: join(root, 'apps/api/node_modules/fastify'),
      pg: join(root, 'db/node_modules/pg'),
    },
  },
  test: {
    include: ['tests/integration/m03/**/*.int.test.ts'],
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 120_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/m03-int/junit/independent-int.xml' },
  },
});
