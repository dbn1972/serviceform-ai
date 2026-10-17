import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/resilience/m10/**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'evidence/SF-M10-G6-PREREQ/junit/resilience-hold.xml',
    },
  },
});
