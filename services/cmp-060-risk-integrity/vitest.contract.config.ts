import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/contract/**/*.test.ts'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/junit/contract.xml' },
  },
});
