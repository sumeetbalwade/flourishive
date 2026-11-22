import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const fixture = (n: string) =>
  readFileSync(`${import.meta.dirname}/test/fixtures/dsc/${n}`).toString(
    'base64',
  );

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
      ESIGN_PROVIDER: 'mock',
      JWT_SECRET: 'e2e-only-jwt-secret-00000000000000000',
      // Test-only certificate authorities (test/fixtures/dsc/generate.py) for the DSC checks.
      // The seal the DSC fixtures were made on top of.
      SEAL_KEY_BASE64: fixture('seal.key'),
      SEAL_CERT_BASE64: fixture('seal.pem'),
      TRUSTED_ROOTS_DIR: `${import.meta.dirname}/test/fixtures/dsc/trust`,
      TRUSTED_TSA_DIR: `${import.meta.dirname}/test/fixtures/dsc/trust`,
    },
  },
});
