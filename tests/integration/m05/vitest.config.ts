import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Independent M05 INT unit/host checks (no PostgreSQL). tests/ is outside workspace packages. */
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
    include: ['tests/integration/m05/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', '**/node_modules/**'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/m05-int/junit/independent-unit.xml' },
  },
});
