import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { ownDomain } from '../src/modules/company/tenant-host.js';
import { RuntimeConfigService } from '../src/platform/config/runtime-config.service.js';
import { DomainsService } from '../src/modules/domains/domains.service.js';
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

const fakeMail = {
  send: async () => undefined,
  sendVia: async () => undefined,
  canResend: async () => false,
  retry: async () => false,
};

let app: INestApplication;
let prisma: PrismaService;
let domains: DomainsService;
let adminA = '';
let empA = '';
let adminB = '';
let tenantA = '';

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  token: string,
) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('Authorization', `Bearer ${token}`);

async function tenant(slug: string) {
  await deleteTenantData(prisma, slug);
  const t = await runAsSystem(
    async () =>
      await prisma.db.tenant.create({
        data: { slug, name: slug.toUpperCase() },
      }),
  );
  await app.get(AccessService).provisionTenantRoles(t.id);
  return t.id;
}

async function userWithRole(tenantId: string, email: string, roleKey: string) {
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
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
      .useValue(fakeMail)
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  domains = app.get(DomainsService);
  await app.get(RedisService).client.flushdb();
  tenantA = await tenant('dom-a');
  const tenantB = await tenant('dom-b');
  adminA = await userWithRole(tenantA, 'admin@dom-a.test', 'tenant_admin');
  empA = await userWithRole(tenantA, 'emp@dom-a.test', 'employee');
  adminB = await userWithRole(tenantB, 'admin@dom-b.test', 'tenant_admin');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'dom-a');
  await deleteTenantData(prisma, 'dom-b');
  await app.close();
});

/** What the fake DNS answers for each name. */
const dns: Record<string, { cname?: string[]; txt?: string[] }> = {};
beforeAll(() => {
  domains.resolver = {
    cname: async (n) => {
      const r = dns[n]?.cname;
      if (!r) throw new Error('ENODATA');
      return r;
    },
    txt: async (n) => {
      const r = dns[n]?.txt;
      if (!r) throw new Error('ENODATA');
      return r;
    },
  };
});

describe('custom domains (D-69)', () => {
  it('is for people with domains.manage only', async () => {
    await call('get', '/domains', empA).expect(403);
  });

  it('refuses addresses on our own domain and things that are not addresses', async () => {
    const own = ownDomain(
      await app.get(RuntimeConfigService).require('TENANT_URL_TEMPLATE'),
    );
    await call('post', '/domains', adminA)
      .send({ hostname: `x.${own}` })
      .expect(400);
    await call('post', '/domains', adminA)
      .send({ hostname: '10.0.0.1' })
      .expect(400);
    await call('post', '/domains', adminA)
      .send({ hostname: 'localhost' })
      .expect(400);
  });

  let id = '';
  let token = '';
  it('adds an address, shows the two records, and gives it no certificate until verified', async () => {
    const r = await call('post', '/domains', adminA)
      .send({ hostname: 'https://HR.Dom-A.test/' })
      .expect(201);
    id = r.body.id;
    expect(r.body.hostname).toBe('hr.dom-a.test');
    expect(r.body.status).toBe('PENDING_DNS');
    token = r.body.records.find(
      (x: { type: string }) => x.type === 'TXT',
    ).value;
    expect(r.body.records[0].name).toBe('hr.dom-a.test');
    // Caddy's question: not verified, so no certificate.
    const ask = await request(app.getHttpServer())
      .get('/v1/internal/domains/allowed')
      .query({ domain: 'hr.dom-a.test' });
    expect(ask.status).toBe(403);
  });

  it('keeps one address to one company', async () => {
    await call('post', '/domains', adminB)
      .send({ hostname: 'hr.dom-a.test' })
      .expect(409);
  });

  it('says what is missing, then verifies once both records are seen', async () => {
    let r = await call('post', `/domains/${id}/check`, adminA).expect(200);
    expect(r.body.status).toBe('PENDING_DNS');
    expect(r.body.error).toMatch(/No CNAME/);
    const target = (await call('get', '/domains', adminA)).body
      .cnameTarget as string;
    dns['hr.dom-a.test'] = { cname: [`${target}.`] };
    r = await call('post', `/domains/${id}/check`, adminA).expect(200);
    expect(r.body.error).toMatch(/TXT/);
    dns['_flourishive.hr.dom-a.test'] = { txt: [token] };
    r = await call('post', `/domains/${id}/check`, adminA).expect(200);
    expect(r.body.status).toBe('VERIFIED');
    expect(r.body.error).toBeNull();
  });

  it('then allows the certificate, resolves the company, and becomes ACTIVE on the first visit', async () => {
    await request(app.getHttpServer())
      .get('/v1/internal/domains/allowed')
      .query({ domain: 'hr.dom-a.test' })
      .expect(200);
    const r = await request(app.getHttpServer())
      .get('/v1/public/host')
      .set('Host', 'hr.dom-a.test')
      .expect(200);
    expect(r.body.slug).toBe('dom-a');
    const row = await runAsSystem(async () =>
      prisma.db.tenantDomain.findUnique({
        where: { hostname: 'hr.dom-a.test' },
      }),
    );
    expect(row?.status).toBe('ACTIVE');
  });

  it('refuses the certificate check from outside the machine', async () => {
    await request(app.getHttpServer())
      .get('/v1/internal/domains/allowed')
      .set('X-Forwarded-For', '203.0.113.9')
      .query({ domain: 'hr.dom-a.test' })
      .expect(403);
  });

  it('lets the verified address sign in to its own company only', async () => {
    const bad = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Origin', 'https://hr.dom-a.test')
      .send({ tenant: 'dom-b', email: 'admin@dom-b.test', password: 'x' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/different company/);
  });

  it('uses the chosen address in email links, but only if it is verified', async () => {
    expect(await domains.baseUrl(tenantA, 'https://app.test')).toBe(
      'https://app.test',
    );
    await call('put', '/domains/primary', adminA)
      .send({ hostname: 'hr.dom-a.test' })
      .expect(200);
    expect(await domains.baseUrl(tenantA, 'https://app.test')).toBe(
      'https://hr.dom-a.test',
    );
    await call('put', '/domains/primary', adminA)
      .send({ hostname: 'nope.dom-a.test' })
      .expect(400);
  });

  it('stops serving an address when a record disappears, and when it is removed', async () => {
    delete dns['_flourishive.hr.dom-a.test'];
    const r = await call('post', `/domains/${id}/check`, adminA).expect(200);
    expect(r.body.status).toBe('PENDING_DNS');
    // Emails fall back to the normal address.
    expect(await domains.baseUrl(tenantA, 'https://app.test')).toBe(
      'https://app.test',
    );
    await request(app.getHttpServer())
      .get('/v1/public/host')
      .set('Host', 'hr.dom-a.test')
      .expect(403);
    await call('delete', `/domains/${id}`, adminA).expect(200);
    await request(app.getHttpServer())
      .get('/v1/internal/domains/allowed')
      .query({ domain: 'hr.dom-a.test' })
      .expect(403);
  });

  it("does not show one company's addresses to another", async () => {
    await call('post', '/domains', adminA)
      .send({ hostname: 'jobs.dom-a.test' })
      .expect(201);
    const r = await call('get', '/domains', adminB).expect(200);
    expect(r.body.domains).toEqual([]);
  });
});
