import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/performance/m10/**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'evidence/SF-M10-G6-PREREQ/junit/g5-hold.xml',
    },
  },
});
