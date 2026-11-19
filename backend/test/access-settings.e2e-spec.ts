import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { SettingsService } from '../src/modules/settings/settings.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { deleteTenantData } from './helpers.js';

const PASSWORD = 'correct horse battery';
let app: INestApplication;
let prisma: PrismaService;
let access: AccessService;
let settings: SettingsService;
let sessions: SessionService;
let ipCounter = 0;

const tenants: Record<'a' | 'b', { id: string; entityId: string }> = {
  a: { id: '', entityId: '' },
  b: { id: '', entityId: '' },
};
const users: Record<string, { id: string; token: string }> = {};

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  who?: string,
) => {
  const r = request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.1.0.${++ipCounter}`);
  return who ? r.set('Authorization', `Bearer ${users[who]!.token}`) : r;
};

async function makeUser(name: string, tenant: 'a' | 'b', roleKey: string) {
  const tenantId = tenants[tenant].id;
  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: `${name}@${tenant}.test`, passwordHash },
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
  const issued = await sessions.start(tenantId, user.id, {});
  users[name] = { id: user.id, token: issued.accessToken };
}

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  access = app.get(AccessService);
  settings = app.get(SettingsService);
  sessions = app.get(SessionService);
  await app.get(RedisService).client.flushdb();

  for (const key of ['a', 'b'] as const) {
    await deleteTenantData(prisma, `acc-${key}`);
    const t = await runAsSystem(async () => {
      const tenant = await prisma.db.tenant.create({
        data: { slug: `acc-${key}`, name: `Acc ${key}` },
      });
      const entity = await prisma.db.entity.create({
        data: { tenantId: tenant.id, name: 'HQ', legalName: 'HQ Ltd' },
      });
      return { id: tenant.id, entityId: entity.id };
    });
    tenants[key] = t;
    await access.provisionTenantRoles(t.id);
  }
  await runAsSystem(async () => {
    await prisma.db.platformSetting.deleteMany();
  });
  await makeUser('admin', 'a', 'tenant_admin');
  await makeUser('hr', 'a', 'hr_lead');
  await makeUser('emp', 'a', 'employee');
  await makeUser('adminB', 'b', 'tenant_admin');
});

afterAll(async () => {
  await runAsSystem(async () => {
    await prisma.db.platformSetting.deleteMany();
  });
  await deleteTenantData(prisma, 'acc-a');
  await deleteTenantData(prisma, 'acc-b');
  await app.close();
});

describe('roles and permissions', () => {
  it('seeds the six roles with the right MFA flags', async () => {
    const res = await call('get', '/access/roles', 'hr').expect(200);
    const byKey = Object.fromEntries(
      res.body.map((r: { key: string }) => [r.key, r]),
    );
    expect(Object.keys(byKey).sort()).toEqual([
      'employee',
      'hr_executive',
      'hr_lead',
      'intern',
      'manager',
      'tenant_admin',
    ]);
    expect(byKey.hr_lead.mfaRequired).toBe(true);
    expect(byKey.employee.mfaRequired).toBe(false);
  });

  it('requires a token, and the right permission', async () => {
    await call('get', '/access/roles').expect(401);
    await call('get', '/access/roles', 'emp').expect(403);
  });

  it('lets HR assign a lower role but not one with more power than they hold', async () => {
    await call('post', '/access/user-roles', 'hr')
      .send({ userId: users.emp!.id, roleKey: 'tenant_admin' })
      .expect(403);
    await call('post', '/access/user-roles', 'hr')
      .send({ userId: users.emp!.id, roleKey: 'manager' })
      .expect(204);
    const me = await call('get', '/auth/me', 'emp').expect(200);
    expect(me.body.permissions).toContain('people.read'); // cache was invalidated
    await call('delete', '/access/user-roles', 'hr')
      .send({ userId: users.emp!.id, roleKey: 'manager' })
      .expect(204);
    const after = await call('get', '/auth/me', 'emp').expect(200);
    expect(after.body.permissions).not.toContain('people.read');
  });

  it('cannot reach another tenant’s users', async () => {
    await call('post', '/access/user-roles', 'adminB')
      .send({ userId: users.emp!.id, roleKey: 'manager' })
      .expect(404);
  });

  it('makes roles that require MFA force enrolment at login', async () => {
    const res = await call('post', '/auth/login')
      .send({ tenant: 'acc-a', email: 'hr@a.test', password: PASSWORD })
      .expect(200);
    expect(res.body.status).toBe('mfa_setup_required');
    const emp = await call('post', '/auth/login')
      .send({ tenant: 'acc-a', email: 'emp@a.test', password: PASSWORD })
      .expect(200);
    expect(emp.body.status).toBe('ok');
  });
});

describe('settings', () => {
  it('returns defaults, then a tenant override that only that tenant sees', async () => {
    const before = await call('get', '/settings', 'emp').expect(200);
    expect(before.body.values['branding.accentColor']).toBe('#c4914f');

    await call('put', '/settings/tenant/branding.accentColor', 'admin')
      .send({ value: '#112233' })
      .expect(204);
    expect(
      (await call('get', '/settings', 'emp')).body.values[
        'branding.accentColor'
      ],
    ).toBe('#112233');
    expect(
      (await call('get', '/settings', 'adminB')).body.values[
        'branding.accentColor'
      ],
    ).toBe('#c4914f');
  });

  it('validates values, levels, keys and permission', async () => {
    await call('put', '/settings/tenant/branding.accentColor', 'admin')
      .send({ value: 'red' })
      .expect(400);
    await call('put', '/settings/tenant/security.passwordMinLength', 'admin')
      .send({ value: 3 })
      .expect(400);
    await call('put', '/settings/tenant/nope.nothing', 'admin')
      .send({ value: 1 })
      .expect(404);
    await call('put', '/settings/me/security.sessionDays', 'emp')
      .send({ value: 3 })
      .expect(400); // tenant-only
    await call('put', '/settings/tenant/branding.accentColor', 'hr')
      .send({ value: '#000000' })
      .expect(403);
  });

  it('resolves user → entity → tenant → platform → default', async () => {
    const ctx = { tenantId: tenants.a.id };
    await settings.setPlatform('security.sessionDays', 7);
    expect(await settings.get('security.sessionDays', ctx)).toBe(7); // platform beats built-in default
    await call('put', '/settings/tenant/security.sessionDays', 'admin')
      .send({ value: 3 })
      .expect(204);
    expect(await settings.get('security.sessionDays', ctx)).toBe(3); // tenant beats platform
    expect(
      await settings.get('security.sessionDays', { tenantId: tenants.b.id }),
    ).toBe(7); // other tenant keeps platform

    await call(
      'put',
      `/settings/entity/${tenants.a.entityId}/branding.emailSenderName`,
      'admin',
    )
      .send({ value: 'HQ Mail' })
      .expect(204);
    expect(
      await settings.get('branding.emailSenderName', {
        ...ctx,
        entityId: tenants.a.entityId,
      }),
    ).toBe('HQ Mail');
    expect(await settings.get('branding.emailSenderName', ctx)).toBe(
      'Flourishive',
    );

    await call('put', '/settings/me/branding.defaultTheme', 'emp')
      .send({ value: 'light' })
      .expect(204);
    expect(
      await settings.get('branding.defaultTheme', {
        ...ctx,
        userId: users.emp!.id,
      }),
    ).toBe('light');
    expect(
      await settings.get('branding.defaultTheme', {
        ...ctx,
        userId: users.hr!.id,
      }),
    ).toBe('dark');
  });

  it('applies the tenant MFA policy and session length to login', async () => {
    await call('put', '/settings/tenant/security.mfaPolicy', 'admin')
      .send({ value: 'everyone' })
      .expect(204);
    const res = await call('post', '/auth/login')
      .send({ tenant: 'acc-a', email: 'emp@a.test', password: PASSWORD })
      .expect(200);
    expect(res.body.status).toBe('mfa_setup_required');
  });
});
