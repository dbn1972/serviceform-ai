import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/security/**/*.test.ts'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'evidence/junit/security.xml' },
  },
});
