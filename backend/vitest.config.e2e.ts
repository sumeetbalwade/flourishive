import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      DATABASE_URL:
        'mysql://flourishive:flourishive_dev@127.0.0.1:3306/flourishive_test',
      FIELD_ENCRYPTION_KEY: 'ab'.repeat(32),
      HMAC_SECRET: 'e2e-only-hmac-secret-0000000000000000',
    },
  },
});
