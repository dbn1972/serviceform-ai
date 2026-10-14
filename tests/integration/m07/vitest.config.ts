import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Independent M07 INT unit/host checks (no PostgreSQL). Not CERTIFIED. */
export default defineConfig({
  resolve: {
    alias: {
      '@serviceform/contracts': join(root, 'packages/contracts/src/index.ts'),
      '@serviceform/observability': join(root, 'packages/observability/src/index.ts'),
      fastify: join(root, 'apps/api/node_modules/fastify'),
    },
  },
  test: {
    include: ['tests/integration/m07/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', '**/node_modules/**'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/SF-M07-INT/junit/independent-int.xml' },
  },
});
