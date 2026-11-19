import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    env: {
      // Own Redis database: the suite flushes it.
      REDIS_URL: 'redis://127.0.0.1:6379/15',
      DATABASE_URL:
        'mysql://flourishive:flourishive_dev@127.0.0.1:3306/flourishive_test',
      FIELD_ENCRYPTION_KEY: 'ab'.repeat(32),
      HMAC_SECRET: 'e2e-only-hmac-secret-0000000000000000',
      JWT_SECRET: 'e2e-only-jwt-secret-00000000000000000',
    },
  },
});
