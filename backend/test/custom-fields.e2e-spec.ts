import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

let app: INestApplication;
let prisma: PrismaService;
let tenantId = '';
let adminToken = '';
let hrToken = '';
let engagementId = '';
let personId = '';

const call = (m: 'get' | 'post' | 'put', path: string, token: string) =>
  request(app.getHttpServer())
    [m](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

async function userWithRole(email: string, roleKey: string) {
  const user = await runAsSystem(async () =>
    prisma.db.user.create({
      data: {
        tenantId,
        email,
        passwordHash: await app
          .get(PasswordService)
          .hash('correct horse battery'),
        status: 'ACTIVE',
      },
    }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: roleKey } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId: user.id, roleId: role!.id },
    });
  });
  return (await app.get(SessionService).start(tenantId, user.id, {}))
    .accessToken;
}

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async () => undefined })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await app.get(RedisService).client.flushdb();
  await deleteTenantData(prisma, 'cf-a');
  const t = await runAsSystem(async () =>
    prisma.db.tenant.create({ data: { slug: 'cf-a', name: 'CF A' } }),
  );
  tenantId = t.id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  adminToken = await userWithRole('admin@cf-a.test', 'tenant_admin');
  hrToken = await userWithRole('hr@cf-a.test', 'hr_lead');
  const entity = await runAsSystem(async () =>
    prisma.db.entity.create({
      data: { tenantId, name: 'Main', legalName: 'Main Pvt Ltd' },
    }),
  );
  const person = await runAsSystem(async () =>
    prisma.db.person.create({
      data: { tenantId, firstName: 'Asha', lastName: 'Rao' },
    }),
  );
  personId = person.id;
  const eng = await runAsSystem(async () =>
    prisma.db.engagement.create({
      data: {
        tenantId,
        personId,
        entityId: entity.id,
        type: 'EMPLOYEE',
        employeeCode: 'CF-1',
        startDate: new Date('2026-01-01'),
      },
    }),
  );
  engagementId = eng.id;
  // The hr lead needs the entity scope to see the record.
  await runInTenant(tenantId, async () => {
    const hr = await prisma.db.user.findFirst({
      where: { email: 'hr@cf-a.test' },
    });
    await prisma.db.userRole.updateMany({
      where: { userId: hr!.id },
      data: { entityId: null },
    });
  });
});

afterAll(async () => {
  await deleteTenantData(prisma, 'cf-a');
  await app.close();
});

const def = (extra: object) => ({
  entityType: 'PERSON',
  label: 'Blood group',
  type: 'SELECT',
  options: ['A+', 'B+', 'O+'],
  ...extra,
});

describe('custom fields (D-29)', () => {
  it('lets an admin define a field and refuses a person without the permission', async () => {
    await call('post', '/custom-fields/definitions', hrToken)
      .send(def({}))
      .expect(403);
    const r = await call('post', '/custom-fields/definitions', adminToken)
      .send(def({}))
      .expect(201);
    expect(r.body.key).toBe('blood_group');
    await call('post', '/custom-fields/definitions', adminToken)
      .send(def({}))
      .expect(409);
  });

  it('validates values by type and saves them', async () => {
    await call('put', `/custom-fields/values/PERSON/${personId}`, adminToken)
      .send({ values: { blood_group: 'Z-' } })
      .expect(400);
    const r = await call(
      'put',
      `/custom-fields/values/PERSON/${personId}`,
      adminToken,
    )
      .send({ values: { blood_group: 'O+' } })
      .expect(200);
    expect(r.body[0].value).toBe('O+');
  });

  it('hides a field from roles that are not listed, but not from admins', async () => {
    await call('post', '/custom-fields/definitions', adminToken)
      .send({
        entityType: 'ENGAGEMENT',
        label: 'Salary band',
        type: 'TEXT',
        visibleToRoles: ['tenant_admin'],
        editableByRoles: ['tenant_admin'],
      })
      .expect(201);
    await call(
      'put',
      `/custom-fields/values/ENGAGEMENT/${engagementId}`,
      adminToken,
    )
      .send({ values: { salary_band: 'L5' } })
      .expect(200);
    const admin = await call(
      'get',
      `/custom-fields/values/ENGAGEMENT/${engagementId}`,
      adminToken,
    ).expect(200);
    expect(
      admin.body.map((v: { field: { key: string } }) => v.field.key),
    ).toContain('salary_band');
    const hr = await call(
      'get',
      `/custom-fields/values/ENGAGEMENT/${engagementId}`,
      hrToken,
    ).expect(200);
    expect(
      hr.body.map((v: { field: { key: string } }) => v.field.key),
    ).not.toContain('salary_band');
    await call(
      'put',
      `/custom-fields/values/ENGAGEMENT/${engagementId}`,
      hrToken,
    )
      .send({ values: { salary_band: 'L9' } })
      .expect(400); // hidden fields do not even exist for them
  });

  it('keeps values when a field is archived and shows it again when restored', async () => {
    const defs = (
      await call(
        'get',
        '/custom-fields/definitions?entityType=PERSON',
        adminToken,
      )
    ).body;
    const id = defs[0].id;
    await call(
      'post',
      `/custom-fields/definitions/${id}/archive`,
      adminToken,
    ).expect(204);
    expect(
      (
        await call(
          'get',
          `/custom-fields/values/PERSON/${personId}`,
          adminToken,
        )
      ).body,
    ).toHaveLength(0);
    await call(
      'post',
      `/custom-fields/definitions/${id}/restore`,
      adminToken,
    ).expect(204);
    expect(
      (
        await call(
          'get',
          `/custom-fields/values/PERSON/${personId}`,
          adminToken,
        )
      ).body[0].value,
    ).toBe('O+');
  });
});
