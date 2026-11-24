import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/ux4g/forms/render-scenes.test.ts'],
    environment: 'node',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/ux4g/forms/render-junit.xml' },
  },
});
