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
let redis: RedisService;
let tenantId = '';
let adminToken = '';
let employeeId = '';

const http = () => request(app.getHttpServer());

async function user(
  email: string,
  roleKey: string,
  password = 'correct horse battery',
) {
  const u = await runAsSystem(async () =>
    prisma.db.user.create({
      data: {
        tenantId,
        email,
        passwordHash: await app.get(PasswordService).hash(password),
        status: 'ACTIVE',
      },
    }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: roleKey } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId: u.id, roleId: role!.id },
    });
  });
  return u.id;
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
  redis = app.get(RedisService);
  await redis.client.flushdb();
  await deleteTenantData(prisma, 'sso-a');
  const t = await runAsSystem(async () =>
    prisma.db.tenant.create({ data: { slug: 'sso-a', name: 'SSO A' } }),
  );
  tenantId = t.id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const adminId = await user('admin@sso-a.test', 'tenant_admin');
  adminToken = (await app.get(SessionService).start(tenantId, adminId, {}))
    .accessToken;
  employeeId = await user('emp@sso-a.test', 'employee');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'sso-a');
  await app.close();
});

const body = {
  provider: 'GOOGLE',
  clientId: 'abc123.apps.googleusercontent.com',
  clientSecret: 'super-secret-value',
  enabled: true,
  enforce: false,
};

describe('single sign-on (D-16)', () => {
  it('saves the connection, never returns the secret, and shows the redirect address', async () => {
    const r = await http()
      .put('/v1/sso/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(200);
    expect(r.body.hasSecret).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('super-secret-value');
    expect(r.body.redirectUri).toContain('/v1/auth/sso/callback');
    const row = await runInTenant(tenantId, async () =>
      prisma.db.ssoConnection.findFirst(),
    );
    expect(row!.clientSecretEnc).not.toContain('super-secret-value');
  });

  it('tells the sign-in page whether to show the button, without logging in', async () => {
    const r = await http().get('/v1/auth/sso/options?tenant=sso-a').expect(200);
    expect(r.body).toEqual({
      enabled: true,
      provider: 'GOOGLE',
      enforce: false,
    });
    const none = await http()
      .get('/v1/auth/sso/options?tenant=nope')
      .expect(200);
    expect(none.body.enabled).toBe(false);
  });

  it('starts a sign-in with PKCE and a stored state', async () => {
    const r = await http()
      .post('/v1/auth/sso/start')
      .send({ tenant: 'sso-a' })
      .expect(200);
    const url = new URL(r.body.url);
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(
      await redis.client.exists(`sso:state:${url.searchParams.get('state')}`),
    ).toBe(1);
  });

  it('sends a bad or reused state back to sign-in with a message, not a session', async () => {
    const r = await http()
      .get('/v1/auth/sso/callback?code=x&state=unknown')
      .expect(302);
    expect(r.headers.location).toContain('sso_error');
  });

  it('refuses a password sign-in for non-admins once single sign-on is required', async () => {
    await http()
      .put('/v1/sso/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...body, clientSecret: undefined, enforce: true })
      .expect(200);
    const emp = await http().post('/v1/auth/login').send({
      tenant: 'sso-a',
      email: 'emp@sso-a.test',
      password: 'correct horse battery',
    });
    expect(emp.status).toBe(403);
    expect(emp.body.code).toBe('SSO_REQUIRED');
    expect(employeeId).toBeTruthy();
  });

  it('redeems a ticket once', async () => {
    await redis.client.set(
      'sso:ticket:t-once-t-once-1',
      JSON.stringify({ tenantId, userId: employeeId }),
      'EX',
      60,
    );
    await http()
      .post('/v1/auth/sso/exchange')
      .send({ ticket: 't-once-t-once-1' })
      .expect(200);
    await http()
      .post('/v1/auth/sso/exchange')
      .send({ ticket: 't-once-t-once-1' })
      .expect(401);
  });
});
