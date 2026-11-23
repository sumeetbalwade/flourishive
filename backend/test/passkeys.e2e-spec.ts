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
import { VirtualAuthenticator } from './virtual-authenticator.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'correct horse battery';
let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let tenantId = '';
let userId = '';
let token = '';

const api = (method: 'get' | 'post' | 'delete', path: string) =>
  request(app.getHttpServer())[method](`/v1${path}`).set('Origin', ORIGIN);
const authed = (method: 'get' | 'post' | 'delete', path: string) =>
  api(method, path).set('Authorization', `Bearer ${token}`);

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
  await deleteTenantData(prisma, 'pk-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'pk-a', name: 'Passkey A' },
        }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: {
          tenantId,
          email: 'p@pk.test',
          passwordHash: await app.get(PasswordService).hash(PASSWORD),
          status: 'ACTIVE',
        },
      }),
  );
  userId = user.id;
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: 'employee' } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId, roleId: role!.id },
    });
  });
  const s = await app.get(SessionService).start(tenantId, userId, {});
  token = s.accessToken;
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1]!, 'base64url').toString(),
  );
  await redis.client.set(`stepup:${claims.sessionId}`, '1', 'EX', 300);
});

afterAll(async () => {
  await deleteTenantData(prisma, 'pk-a');
  await app.close();
});

describe('passkeys (D-64)', () => {
  const device = new VirtualAuthenticator('localhost', ORIGIN);

  it('registers a passkey, then signs in with it alone', async () => {
    const opts = await authed('post', '/auth/passkeys/register/options').expect(
      200,
    );
    await authed('post', '/auth/passkeys/register/verify')
      .send({
        response: device.register(opts.body.challenge),
        label: 'Test Mac',
      })
      .expect(200);
    const sec = await authed('get', '/auth/security').expect(200);
    expect(sec.body.passkeys).toHaveLength(1);

    const lo = await api('post', '/auth/passkeys/login/options')
      .send({ tenant: 'pk-a' })
      .expect(200);
    const res = await api('post', '/auth/passkeys/login/verify')
      .send({ tenant: 'pk-a', response: device.sign(lo.body.challenge) })
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.accessToken).toBeTruthy();
  });

  it('refuses a replayed answer and an old counter', async () => {
    const lo = await api('post', '/auth/passkeys/login/options')
      .send({ tenant: 'pk-a' })
      .expect(200);
    const answer = device.sign(lo.body.challenge);
    await api('post', '/auth/passkeys/login/verify')
      .send({ tenant: 'pk-a', response: answer })
      .expect(200);
    // The same answer again: the challenge is spent.
    await api('post', '/auth/passkeys/login/verify')
      .send({ tenant: 'pk-a', response: answer })
      .expect(401);
    // A fresh challenge answered with a counter that went backwards (a cloned key).
    const lo2 = await api('post', '/auth/passkeys/login/options')
      .send({ tenant: 'pk-a' })
      .expect(200);
    await api('post', '/auth/passkeys/login/verify')
      .send({ tenant: 'pk-a', response: device.sign(lo2.body.challenge, 1) })
      .expect(401);
  });

  it('refuses another site’s origin', async () => {
    const lo = await api('post', '/auth/passkeys/login/options')
      .send({ tenant: 'pk-a' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/passkeys/login/verify')
      .set('Origin', 'http://evil.test')
      .send({ tenant: 'pk-a', response: device.sign(lo.body.challenge) })
      .expect(401);
  });

  it('counts as the second step after the password, and satisfies it', async () => {
    const login = await api('post', '/auth/login')
      .send({ tenant: 'pk-a', email: 'p@pk.test', password: PASSWORD })
      .expect(200);
    expect(login.body.status).toBe('mfa_required');
    expect(login.body.methods).toEqual({ code: false, passkey: true });
    const o = await api('post', '/auth/mfa/passkey/options')
      .send({ mfaToken: login.body.mfaToken })
      .expect(200);
    const res = await api('post', '/auth/mfa/passkey/verify')
      .send({
        mfaToken: login.body.mfaToken,
        response: device.sign(o.body.challenge),
      })
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('removing it returns sign-in to password only', async () => {
    const sec = await authed('get', '/auth/security').expect(200);
    await authed('delete', `/auth/passkeys/${sec.body.passkeys[0].id}`).expect(
      204,
    );
    const login = await api('post', '/auth/login')
      .send({ tenant: 'pk-a', email: 'p@pk.test', password: PASSWORD })
      .expect(200);
    expect(login.body.status).toBe('ok');
  });
});
