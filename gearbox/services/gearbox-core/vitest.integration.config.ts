import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    // Repository contract tests share one database; running files in parallel would
    // have them truncating each other's tables.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
