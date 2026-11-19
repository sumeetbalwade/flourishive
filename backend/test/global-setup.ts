import { execFileSync } from 'node:child_process';

/** Applies migrations to the test database once before any test file runs. */
export default function setup(): void {
  const url =
    process.env.TEST_DATABASE_URL ??
    'mysql://flourishive:flourishive_dev@127.0.0.1:3306/flourishive_test';
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
