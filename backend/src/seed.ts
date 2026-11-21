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

/**
 * Fake people for the demo company only (never for Flourisense, which gets its real list by CSV).
 * Names and addresses are invented, and every email uses the reserved .test domain.
 */
async function demoPeople(tenantId: string) {
  const entity = await runAsSystem(
    async () =>
      await db.entity.findFirstOrThrow({
        where: { tenantId },
        select: { id: true },
      }),
  );
  const named = async (
    kind: 'department' | 'designation' | 'location',
    names: string[],
  ) => {
    const out: Record<string, string> = {};
    for (const name of names) {
      const row = await runInTenant(tenantId, async () => {
        const where = { tenantId_name: { tenantId, name } };
        const data = { tenantId, name };
        if (kind === 'department')
          return db.department.upsert({ where, update: {}, create: data });
        if (kind === 'designation')
          return db.designation.upsert({ where, update: {}, create: data });
        return db.location.upsert({
          where,
          update: {},
          create: { ...data, city: name, state: 'Maharashtra' },
        });
      });
      out[name] = row.id;
    }
    return out;
  };
  const dept = await named('department', [
    'Engineering',
    'Finance',
    'People',
    'Sales',
  ]);
  const desig = await named('designation', [
    'Manager',
    'Engineer',
    'Accountant',
    'Executive',
    'Intern',
  ]);
  const loc = await named('location', ['Pune', 'Mumbai', 'Nagpur']);

  const people: [
    string,
    string,
    string,
    'EMPLOYEE' | 'INTERN',
    string,
    string,
    string,
    string?,
  ][] = [
    // code, first, last, type, department, designation, location, manager code
    ['D001', 'Anil', 'Kadam', 'EMPLOYEE', 'Engineering', 'Manager', 'Pune'],
    [
      'D002',
      'Bhavna',
      'Rane',
      'EMPLOYEE',
      'Engineering',
      'Engineer',
      'Pune',
      'D001',
    ],
    [
      'D003',
      'Chetan',
      'Joshi',
      'EMPLOYEE',
      'Engineering',
      'Engineer',
      'Pune',
      'D001',
    ],
    ['D004', 'Deepa', 'Nair', 'EMPLOYEE', 'Finance', 'Manager', 'Mumbai'],
    [
      'D005',
      'Esha',
      'Patil',
      'EMPLOYEE',
      'Finance',
      'Accountant',
      'Mumbai',
      'D004',
    ],
    ['D006', 'Farhan', 'Sheikh', 'EMPLOYEE', 'People', 'Manager', 'Pune'],
    ['D007', 'Gauri', 'More', 'EMPLOYEE', 'Sales', 'Executive', 'Nagpur'],
    ['D008', 'Harsh', 'Gawande', 'EMPLOYEE', 'Sales', 'Executive', 'Nagpur'],
    [
      'I001',
      'Ishaan',
      'Kulkarni',
      'INTERN',
      'Engineering',
      'Intern',
      'Pune',
      'D001',
    ],
    [
      'I002',
      'Janhavi',
      'Desai',
      'INTERN',
      'Engineering',
      'Intern',
      'Pune',
      'D001',
    ],
    [
      'I003',
      'Kunal',
      'Bhosale',
      'INTERN',
      'Finance',
      'Intern',
      'Mumbai',
      'D004',
    ],
    ['I004', 'Lata', 'Mishra', 'INTERN', 'People', 'Intern', 'Pune', 'D006'],
  ];
  const ids: Record<string, string> = {};
  for (const [code, first, last, type, d, g, l, mgr] of people) {
    const email = `${first}.${last}@demo-co.test`.toLowerCase();
    const row = await runInTenant(tenantId, async () => {
      const person = await db.person.upsert({
        where: { tenantId_workEmail: { tenantId, workEmail: email } },
        update: {},
        create: {
          tenantId,
          firstName: first,
          lastName: last,
          workEmail: email,
        },
      });
      const eng = await db.engagement.upsert({
        where: { tenantId_employeeCode: { tenantId, employeeCode: code } },
        update: {},
        create: {
          tenantId,
          personId: person.id,
          entityId: entity.id,
          type,
          employeeCode: code,
          departmentId: dept[d]!,
          designationId: desig[g]!,
          locationId: loc[l]!,
          managerId: mgr ? (ids[mgr] ?? null) : null,
          startDate: new Date(type === 'INTERN' ? '2026-06-01' : '2024-04-01'),
        },
      });
      if (type === 'INTERN')
        await db.internDetail.upsert({
          where: { engagementId: eng.id },
          update: {},
          create: {
            tenantId,
            engagementId: eng.id,
            college: 'Fake Institute of Technology',
            course: 'B.Tech',
            graduationYear: 2027,
          },
        });
      return eng;
    });
    ids[code] = row.id;
  }
  console.log(
    `Demo Co: ${people.length} fake people (4 interns), 4 departments, 3 locations`,
  );
}

if (dev) {
  await demoPeople(demo!.id);
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
