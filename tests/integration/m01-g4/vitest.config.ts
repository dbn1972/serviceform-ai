import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/m01-g4/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
