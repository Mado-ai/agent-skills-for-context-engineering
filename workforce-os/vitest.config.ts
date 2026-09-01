import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Each suite provisions its own in-memory database; parallel forks are safe.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ['default'],
  },
});
