import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env on its own.
try {
  process.loadEnvFile('.env');
} catch {
  // CI and cPanel provide real environment variables instead.
}

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node dist/seed.js',
  },
  // `prisma generate` runs in CI without a database, so fall back to a placeholder.
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'mysql://placeholder:placeholder@127.0.0.1:3306/placeholder',
  },
});
