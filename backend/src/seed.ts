import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AccessService } from './modules/access/access.service.js';
import { PasswordService } from './modules/identity/password.service.js';
import { PrismaService } from './platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from './platform/database/tenant-context.js';

/** Idempotent seed: Flourisense is tenant #1 (D-01). Safe to re-run after adding permissions. */
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
const { db } = app.get(PrismaService);
const access = app.get(AccessService);
const passwords = app.get(PasswordService);
const dev = process.env.NODE_ENV !== 'production';

async function tenant(slug: string, name: string, legalName: string) {
  return await runAsSystem(async () => {
    const t = await db.tenant.upsert({
      where: { slug },
      update: {},
      create: { slug, name },
    });
    await db.entity.upsert({
      where: { tenantId_name: { tenantId: t.id, name } },
      update: {},
      create: { tenantId: t.id, name, legalName },
    });
    return t;
  });
}

async function devAdmin(tenantId: string, email: string) {
  const passwordHash = await passwords.hash('dev-password-change-me');
  const user = await runAsSystem(
    async () =>
      await db.user.upsert({
        where: { tenantId_email: { tenantId, email } },
        update: {},
        create: { tenantId, email, passwordHash },
      }),
  );
  // The very first admin is bootstrapped directly: assignRole() would refuse it,
  // because nobody holds the permissions yet.
  await runInTenant(tenantId, async () => {
    const role = await db.role.findUnique({
      where: { tenantId_key: { tenantId, key: 'tenant_admin' } },
    });
    const has = await db.userRole.findFirst({
      where: { userId: user.id, roleId: role!.id },
    });
    if (!has)
      await db.userRole.create({
        data: { tenantId, userId: user.id, roleId: role!.id },
      });
  });
}

const flourisense = await tenant('flourisense', 'Flourisense', 'Flourisense');
const demo = dev
  ? await tenant('demo-co', 'Demo Co (fake)', 'Demo Co Pvt Ltd')
  : null;

console.log(
  `Provisioned roles for ${await access.provisionAllTenants()} tenant(s)`,
);

if (dev) {
  await devAdmin(flourisense.id, 'admin@flourisense.test');
  await devAdmin(demo!.id, 'admin@demo-co.test');
  const platformEmail = 'super@flourishive.test';
  await runAsSystem(async () => {
    await db.platformUser.upsert({
      where: { email: platformEmail },
      update: {},
      create: {
        email: platformEmail,
        status: 'ACTIVE',
        passwordHash: await passwords.hash('dev-password-change-me'),
      },
    });
  });
  console.log(
    'Dev super admin: super@flourishive.test (same dev password; sets up MFA at first sign-in)',
  );
  console.log(
    'Dev admins: admin@flourisense.test / admin@demo-co.test, password "dev-password-change-me" (local only)',
  );
}
await app.close();
