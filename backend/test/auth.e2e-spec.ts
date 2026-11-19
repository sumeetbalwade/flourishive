import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { deleteTenantData } from './helpers.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import { runAsSystem } from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { GoogleService } from '../src/modules/identity/google.service.js';
import { MfaService } from '../src/modules/identity/mfa.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';

const PASSWORD = 'correct horse battery';
const sent: { to: unknown; text: string }[] = [];
let googleEmail = 'google.user@a.test';

let app: INestApplication;
let prisma: PrismaService;
let mfa: MfaService;
let redis: RedisService;
let tenantA: string;
let ipCounter = 0;

/** Each test uses its own client IP so lockouts from one test cannot leak into another. */
const api = (ip = `10.0.0.${++ipCounter}`) => ({
  post: (path: string) =>
    request(app.getHttpServer()).post(`/v1${path}`).set('X-Forwarded-For', ip),
  get: (path: string) =>
    request(app.getHttpServer()).get(`/v1${path}`).set('X-Forwarded-For', ip),
});

async function makeUser(email: string, extra: Record<string, unknown> = {}) {
  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  return runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId: tenantA, email, passwordHash, ...extra },
      }),
  );
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({
      send: async (m: { to: unknown; text: string }) => void sent.push(m),
    })
    .overrideProvider(GoogleService)
    .useValue({ verify: async () => ({ sub: 'g-sub-1', email: googleEmail }) })
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  mfa = app.get(MfaService);
  redis = app.get(RedisService);

  await deleteTenantData(prisma, 'auth-a');
  await runAsSystem(async () => {
    tenantA = (
      await prisma.db.tenant.create({
        data: { slug: 'auth-a', name: 'Auth A' },
      })
    ).id;
  });
  await redis.client.flushdb();
});

afterAll(async () => {
  await deleteTenantData(prisma, 'auth-a');
  await app.close();
});

describe('login and sessions', () => {
  it('rejects unauthenticated access and serves /health publicly', async () => {
    await api().get('/auth/me').expect(401);
    await api().get('/health').expect(200);
  });

  it('logs in, sets an httpOnly refresh cookie, and returns the profile', async () => {
    await makeUser('basic@a.test');
    const res = await api()
      .post('/auth/login')
      .send({ tenant: 'auth-a', email: 'Basic@A.test', password: PASSWORD })
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.refreshToken).toBeUndefined();
    expect(String(res.headers['set-cookie'])).toMatch(/fh_refresh=.*HttpOnly/);
    const me = await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('basic@a.test');
  });

  it('gives the same error for a wrong password, unknown email and unknown tenant', async () => {
    const bodies = await Promise.all([
      api().post('/auth/login').send({
        tenant: 'auth-a',
        email: 'basic@a.test',
        password: 'wrong-password-123',
      }),
      api()
        .post('/auth/login')
        .send({ tenant: 'auth-a', email: 'nobody@a.test', password: PASSWORD }),
      api()
        .post('/auth/login')
        .send({ tenant: 'nope', email: 'basic@a.test', password: PASSWORD }),
    ]);
    for (const r of bodies) {
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Invalid credentials');
    }
  });

  it('locks an account out after repeated failures, even with the right password', async () => {
    await makeUser('lock@a.test');
    for (let i = 0; i < 5; i++) {
      await api()
        .post('/auth/login')
        .send({
          tenant: 'auth-a',
          email: 'lock@a.test',
          password: 'wrong-password-123',
        })
        .expect(401);
    }
    await api()
      .post('/auth/login')
      .send({ tenant: 'auth-a', email: 'lock@a.test', password: PASSWORD })
      .expect(429);
  });

  it('blocks disabled users', async () => {
    await makeUser('off@a.test', { status: 'DISABLED' });
    await api()
      .post('/auth/login')
      .send({ tenant: 'auth-a', email: 'off@a.test', password: PASSWORD })
      .expect(401);
  });

  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    await makeUser('rot@a.test');
    const login = await api()
      .post('/auth/login')
      .set('X-Client', 'native')
      .send({ tenant: 'auth-a', email: 'rot@a.test', password: PASSWORD })
      .expect(200);
    const first = login.body.refreshToken as string;
    const second = await api()
      .post('/auth/refresh')
      .set('X-Client', 'native')
      .send({ refreshToken: first })
      .expect(200);
    expect(second.body.refreshToken).not.toBe(first);
    await api()
      .post('/auth/refresh')
      .set('X-Client', 'native')
      .send({ refreshToken: first })
      .expect(401); // replay
    await api()
      .post('/auth/refresh')
      .set('X-Client', 'native')
      .send({ refreshToken: second.body.refreshToken })
      .expect(401); // family revoked
  });

  it('logout-all ends every session at once', async () => {
    await makeUser('all@a.test');
    const login = () =>
      api()
        .post('/auth/login')
        .send({ tenant: 'auth-a', email: 'all@a.test', password: PASSWORD });
    const [one, two] = [await login(), await login()];
    await api()
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${one.body.accessToken}`)
      .expect(200);
    await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${two.body.accessToken}`)
      .expect(401);
  });
});

describe('MFA', () => {
  it('forces enrolment, then requires a code (or a single-use recovery code) on later logins', async () => {
    await makeUser('hr@a.test', { mfaRequired: true });
    const creds = { tenant: 'auth-a', email: 'hr@a.test', password: PASSWORD };

    const first = await api().post('/auth/login').send(creds).expect(200);
    expect(first.body.status).toBe('mfa_setup_required');
    const setup = await api()
      .post('/auth/mfa/setup')
      .send({ mfaToken: first.body.mfaToken })
      .expect(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const row = await runAsSystem(
      async () =>
        await prisma.db.user.findFirst({ where: { email: 'hr@a.test' } }),
    );
    const code = await mfa.currentCode(row!.mfaSecretEnc!);
    await api()
      .post('/auth/mfa/confirm')
      .send({ mfaToken: first.body.mfaToken, code: '000000' })
      .expect(401);
    const confirmed = await api()
      .post('/auth/mfa/confirm')
      .send({ mfaToken: first.body.mfaToken, code })
      .expect(200);
    expect(confirmed.body.recoveryCodes).toHaveLength(10);
    expect(confirmed.body.accessToken).toBeTruthy();

    const second = await api().post('/auth/login').send(creds).expect(200);
    expect(second.body.status).toBe('mfa_required');
    await api()
      .post('/auth/mfa/verify')
      .send({ mfaToken: second.body.mfaToken, code: '000000' })
      .expect(401);
    const ok = await api()
      .post('/auth/mfa/verify')
      .send({
        mfaToken: second.body.mfaToken,
        code: await mfa.currentCode(row!.mfaSecretEnc!),
      })
      .expect(200);
    expect(ok.body.accessToken).toBeTruthy();

    // The same code cannot be replayed within its validity window.
    const replay = await api().post('/auth/login').send(creds).expect(200);
    await api()
      .post('/auth/mfa/verify')
      .send({
        mfaToken: replay.body.mfaToken,
        code: await mfa.currentCode(row!.mfaSecretEnc!),
      })
      .expect(401);

    const recovery = confirmed.body.recoveryCodes[0] as string;
    const third = await api().post('/auth/login').send(creds).expect(200);
    await api()
      .post('/auth/mfa/verify')
      .send({ mfaToken: third.body.mfaToken, recoveryCode: recovery })
      .expect(200);
    const fourth = await api().post('/auth/login').send(creds).expect(200);
    await api()
      .post('/auth/mfa/verify')
      .send({ mfaToken: fourth.body.mfaToken, recoveryCode: recovery })
      .expect(401); // used once only
  });

  it('does not accept a password-step token as an access token', async () => {
    await makeUser('tok@a.test', { mfaRequired: true });
    const r = await api()
      .post('/auth/login')
      .send({ tenant: 'auth-a', email: 'tok@a.test', password: PASSWORD })
      .expect(200);
    await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${r.body.mfaToken}`)
      .expect(401);
  });
});

describe('Google sign-in', () => {
  it('signs in a pre-created user and refuses unknown emails', async () => {
    await makeUser('google.user@a.test');
    googleEmail = 'google.user@a.test';
    const ok = await api()
      .post('/auth/google')
      .send({ tenant: 'auth-a', idToken: 'x' })
      .expect(200);
    expect(ok.body.status).toBe('ok');
    googleEmail = 'stranger@a.test';
    await api()
      .post('/auth/google')
      .send({ tenant: 'auth-a', idToken: 'x' })
      .expect(401);
  });
});

describe('password reset', () => {
  it('emails a single-use link, changes the password and ends old sessions', async () => {
    await makeUser('reset@a.test');
    const before = await api()
      .post('/auth/login')
      .send({ tenant: 'auth-a', email: 'reset@a.test', password: PASSWORD })
      .expect(200);

    sent.length = 0;
    await api()
      .post('/auth/forgot-password')
      .send({ tenant: 'auth-a', email: 'reset@a.test' })
      .expect(202);
    await api()
      .post('/auth/forgot-password')
      .send({ tenant: 'auth-a', email: 'ghost@a.test' })
      .expect(202); // no enumeration
    expect(sent).toHaveLength(1);
    const token = /token=([\w-]+)/.exec(sent[0]!.text)![1]!;

    await api()
      .post('/auth/reset-password')
      .send({ token, password: 'short' })
      .expect(400);
    await api()
      .post('/auth/reset-password')
      .send({ token, password: 'a brand new passphrase' })
      .expect(204);
    await api()
      .post('/auth/reset-password')
      .send({ token, password: 'another new passphrase' })
      .expect(400); // single use

    await api()
      .post('/auth/login')
      .send({ tenant: 'auth-a', email: 'reset@a.test', password: PASSWORD })
      .expect(401);
    await api()
      .post('/auth/login')
      .send({
        tenant: 'auth-a',
        email: 'reset@a.test',
        password: 'a brand new passphrase',
      })
      .expect(200);
    await api()
      .get('/auth/me')
      .set('Authorization', `Bearer ${before.body.accessToken}`)
      .expect(401);
  });
});
