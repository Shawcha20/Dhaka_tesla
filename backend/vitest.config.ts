import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: false,
    restoreMocks: true,

    /**
     * Integration tests share one MySQL schema, so they must not run in parallel
     * with each other — a truncate in one file would pull rows out from under
     * another. Concurrency *within* a test (two simultaneous seat claims) is
     * unaffected: that happens inside a single process via Promise.all.
     */
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    testTimeout: 15_000,
    hookTimeout: 30_000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/types/**', '**/*.d.ts'],
    },
  },
});
