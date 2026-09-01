import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Each suite provisions its own isolated database file; parallel forks are safe.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ['default'],
  },
});
