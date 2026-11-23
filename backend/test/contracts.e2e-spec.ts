import { OWNER_ROLE_ID } from '../src/modules/platform-admin/platform-permissions.js';
import {
  auditListResponse,
  chainCheck,
  engagementResponse,
  entityItem,
  fileResponse,
  importResult,
  loginResponse,
  meResponse,
  notificationItem,
  orgItem,
  peopleListResponse,
  platformMe,
  platformSettingItem,
  roleResponse,
  settingsResponse,
  staffItem,
  tenantDetail,
  tenantListItem,
} from '@flourishive/schemas';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { TokenService } from '../src/modules/identity/token.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { deleteTenantData } from './helpers.js';

/**
 * The shared schemas are what the frontends trust. This suite parses real API answers
 * with them, so a change to either side that breaks the other fails here, in CI.
 */
let app: INestApplication;
let prisma: PrismaService;
let ip = 0;
let adminToken = '';
let platformToken = '';
let tenantId = '';
let entityId = '';

const call = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  token?: string,
) => {
  const r = request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.5.0.${++ip}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const parse = <T>(schema: z.ZodType<T>, body: unknown): T =>
  schema.parse(JSON.parse(JSON.stringify(body)));

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

  await deleteTenantData(prisma, 'contract-a');
  tenantId = await runAsSystem(
    async () =>
      (
        await prisma.db.tenant.create({
          data: { slug: 'contract-a', name: 'Contract A' },
        })
      ).id,
  );
  entityId = await runAsSystem(
    async () =>
      (
        await prisma.db.entity.create({
          data: { tenantId, name: 'HQ', legalName: 'HQ Ltd' },
        })
      ).id,
  );
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const passwordHash = await app
    .get(PasswordService)
    .hash('correct horse battery');
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: 'admin@contract.test', passwordHash },
      }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: 'tenant_admin' } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId: user.id, roleId: role!.id },
    });
  });
  adminToken = (await app.get(SessionService).start(tenantId, user.id, {}))
    .accessToken;

  await runAsSystem(async () => {
    await prisma.db.platformRefreshToken.deleteMany();
    await prisma.db.platformSession.deleteMany();
    await prisma.db.platformRecoveryCode.deleteMany();
    await prisma.db.platformUser.deleteMany();
  });
  const staff = await runAsSystem(
    async () =>
      await prisma.db.platformUser.create({
        data: {
          email: 'root@contract.test',
          status: 'ACTIVE',
          roleId: OWNER_ROLE_ID,
        },
      }),
  );
  platformToken = await app.get(TokenService).signPlatformAccess({
    platformUserId: staff.id,
    sessionId: crypto.randomUUID(),
  });
});

afterAll(async () => {
  await deleteTenantData(prisma, 'contract-a');
  await runAsSystem(async () => {
    await prisma.db.platformUser.deleteMany();
  });
  await app.close();
});

describe('tenant API matches @flourishive/schemas', () => {
  it('sign-in, profile and settings', async () => {
    const login = await call('post', '/auth/login')
      .send({
        tenant: 'contract-a',
        email: 'admin@contract.test',
        password: 'correct horse battery',
      })
      .expect(200);
    expect(parse(loginResponse, login.body).status).toBe('mfa_setup_required');
    const me = parse(
      meResponse,
      (await call('get', '/auth/me', adminToken).expect(200)).body,
    );
    expect(me.permissions).toContain('people.read');
    parse(
      settingsResponse,
      (await call('get', '/settings', adminToken).expect(200)).body,
    );
  });

  it('org, roles, people, import, audit, files and notifications', async () => {
    for (const kind of ['departments', 'locations', 'designations']) {
      await call('post', `/org/${kind}`, adminToken)
        .send({ name: `${kind}-x` })
        .expect(201);
      parse(
        z.array(orgItem),
        (await call('get', `/org/${kind}`, adminToken).expect(200)).body,
      );
    }
    expect(
      parse(
        z.array(entityItem),
        (await call('get', '/org/entities', adminToken).expect(200)).body,
      ),
    ).toHaveLength(1);
    parse(
      z.array(roleResponse),
      (await call('get', '/access/roles', adminToken).expect(200)).body,
    );

    const created = await call('post', '/people', adminToken)
      .send({
        person: {
          firstName: 'Asha',
          lastName: 'Patil',
          workEmail: 'asha@contract.test',
        },
        engagement: {
          entityId,
          type: 'INTERN',
          employeeCode: 'C1',
          startDate: '2026-01-05',
        },
        intern: { college: 'COEP', graduationYear: 2027 },
      })
      .expect(201);
    parse(engagementResponse, created.body);
    parse(
      engagementResponse,
      (await call('get', `/people/${created.body.id}`, adminToken).expect(200))
        .body,
    );
    parse(
      peopleListResponse,
      (await call('get', '/people?q=asha', adminToken).expect(200)).body,
    );

    const csv =
      'employee_code,first_name,last_name,type,start_date\nC2,Ravi,Kale,employee,2026-02-01';
    const imp = await call('post', '/people/import', adminToken)
      .set('Content-Type', 'text/csv')
      .send(csv)
      .expect(200);
    expect(parse(importResult, imp.body).valid).toBe(true);
    const bad = await call('post', '/people/import', adminToken)
      .set('Content-Type', 'text/csv')
      .send(
        'employee_code,first_name,last_name,type,start_date\nC3,,Kale,employee,nope',
      )
      .expect(200);
    expect(parse(importResult, bad.body).errors.length).toBeGreaterThan(0);

    parse(
      auditListResponse,
      (await call('get', '/audit', adminToken).expect(200)).body,
    );
    parse(
      chainCheck,
      (await call('get', '/audit/verify', adminToken).expect(200)).body,
    );
    parse(
      z.array(notificationItem),
      (await call('get', '/notifications', adminToken).expect(200)).body,
    );

    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const up = await call('post', '/files?name=a.pdf', adminToken)
      .set('Content-Type', 'application/pdf')
      .send(pdf)
      .expect(201);
    parse(fileResponse, up.body);
    parse(
      fileResponse,
      (await call('get', `/files/${up.body.id}`, adminToken).expect(200)).body,
    );
  });
});

describe('platform API matches @flourishive/schemas', () => {
  it('tenants, staff, settings and profile', async () => {
    parse(
      platformMe,
      (await call('get', '/platform/auth/me', platformToken).expect(200)).body,
    );
    const list = parse(
      z.array(tenantListItem),
      (await call('get', '/platform/tenants', platformToken).expect(200)).body,
    );
    expect(list.some((t) => t.slug === 'contract-a')).toBe(true);
    parse(
      tenantDetail,
      (
        await call(
          'get',
          `/platform/tenants/${tenantId}`,
          platformToken,
        ).expect(200)
      ).body,
    );
    parse(
      z.array(staffItem),
      (await call('get', '/platform/users', platformToken).expect(200)).body,
    );
    parse(
      z.array(platformSettingItem),
      (await call('get', '/platform/settings', platformToken).expect(200)).body,
    );
  });
});
