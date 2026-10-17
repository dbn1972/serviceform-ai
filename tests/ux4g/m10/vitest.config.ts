import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/ux4g/m10/**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'evidence/SF-M10-G6-PREREQ/junit/ux4g-hold.xml',
    },
  },
});
