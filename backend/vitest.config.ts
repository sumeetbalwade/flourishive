import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Database specs share one database, so files run one after another.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'mysql://flourishive:flourishive_dev@127.0.0.1:3306/flourishive_test',
    },
  },
});
