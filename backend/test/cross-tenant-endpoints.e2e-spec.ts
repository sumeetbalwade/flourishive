import { INestApplication } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
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

/**
 * Every HTTP endpoint, called as company B against company A's data.
 *
 * Two guarantees:
 *  1. Every route the app exposes is classified below. A new endpoint that nobody classified
 *     fails this file, so it cannot ship without a cross-tenant check (or a written reason).
 *  2. Each tenant-scoped route is called as B with A's ids. It must be refused or do nothing to A,
 *     must never put any of A's data into the answer, and A's data must be identical afterwards.
 */

const PASSWORD = 'correct horse battery';
const A_SECRETS = {
  dept: 'A-Dept-Secret',
  location: 'A-Loc-Secret',
  designation: 'A-Desig-Secret',
  first: 'Alphasecret',
  last: 'Secretperson',
  code: 'A-SECRET-1',
  email: 'secret@xa.test',
  file: 'a-secret.pdf',
  role: 'A Only Role',
  accent: '#aa0000',
  letterhead: 'A-Letterhead-Secret',
  template: 'A-Template-Secret',
  reference: 'ASECRET/',
};

let app: INestApplication;
let prisma: PrismaService;
let ip = 0;
const ids = {
  tenantA: '',
  tenantB: '',
  entityA: '',
  entityB: '',
  deptA: '',
  locA: '',
  desigA: '',
  engA: '',
  personA: '',
  userA: '',
  fileA: '',
  roleKeyA: '',
  fileB: '',
  deviceA: '',
  templateA: '',
  docA: '',
  bulkA: '',
};
const token: Record<'a' | 'b', string> = { a: '', b: '' };
let bSigned = '';

const call = (
  who: 'a' | 'b' | null,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
) => {
  const r = request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.6.0.${++ip}`);
  return who ? r.set('Authorization', `Bearer ${token[who]}`) : r;
};

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 1)]);

async function makeAdmin(tenantId: string, email: string) {
  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email, passwordHash },
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
  return (await app.get(SessionService).start(tenantId, user.id, {}))
    .accessToken;
}

/** Everything about A that a stranger must not be able to change, as one comparable string. */
async function snapshotA(): Promise<string> {
  const get = async (path: string) => (await call('a', 'get', path)).body;
  const counts = await runInTenant(ids.tenantA, async () => ({
    persons: await prisma.db.person.count(),
    engagements: await prisma.db.engagement.count(),
    departments: await prisma.db.department.count(),
    designations: await prisma.db.designation.count(),
    locations: await prisma.db.location.count(),
    files: await prisma.db.file.count(),
    roles: await prisma.db.role.count(),
    userRoles: await prisma.db.userRole.count(),
    users: await prisma.db.user.count(),
    settings: await prisma.db.settingValue.count(),
    audit: await prisma.db.auditLog.count(),
    notifications: await prisma.db.notification.count(),
    documents: await prisma.db.generatedDocument.count(),
    templates: await prisma.db.template.count(),
    letterheads: await prisma.db.letterhead.count(),
    schemes: await prisma.db.numberingScheme.count(),
    flows: await prisma.db.workflowInstance.count(),
    sigRequests: await prisma.db.signatureRequest.count(),
    devices: await prisma.db.desktopDevice.count(),
    flowActions: await prisma.db.workflowAction.count(),
    counters: await prisma.db.numberingCounter.count(),
  }));
  return JSON.stringify({
    counts,
    people: await get('/people?pageSize=100'),
    departments: await get('/org/departments'),
    locations: await get('/org/locations'),
    designations: await get('/org/designations'),
    roles: await get('/access/roles'),
    policies: await get('/access/policies'),
    userRoles: await get(`/access/users/${ids.userA}/roles`),
    settings: await get('/settings'),
    file: (await call('a', 'get', `/files/${ids.fileA}`)).body.id,
    devices: await get('/desktop/devices'),
    documents: await get('/documents?pageSize=100'),
    templates: await get('/documents/templates'),
    numbering: await get('/documents/numbering'),
    letterheads: await get('/documents/letterheads'),
  });
}

const markers = () =>
  [
    ...Object.values(A_SECRETS),
    ids.tenantA,
    ids.entityA,
    ids.deptA,
    ids.locA,
    ids.desigA,
    ids.engA,
    ids.personA,
    ids.userA,
    ids.fileA,
    ids.deviceA,
    ids.templateA,
    ids.docA,
    ids.bulkA,
  ].filter(Boolean);
const leaks = (res: { body: unknown; text: string }) => {
  const text = `${JSON.stringify(res.body ?? '')} ${res.text ?? ''}`;
  return markers().filter((m) => text.includes(m));
};

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
      .overrideProvider(MailService)
      .useValue({ send: async () => undefined })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await app.get(RedisService).client.flushdb();

  for (const key of ['a', 'b'] as const) {
    await deleteTenantData(prisma, `xt-${key}`);
    const made = await runAsSystem(async () => {
      const tenant = await prisma.db.tenant.create({
        data: { slug: `xt-${key}`, name: `XT ${key}` },
      });
      const entity = await prisma.db.entity.create({
        data: { tenantId: tenant.id, name: 'HQ', legalName: `HQ ${key} Ltd` },
      });
      return { tenant: tenant.id, entity: entity.id };
    });
    await app.get(AccessService).provisionTenantRoles(made.tenant);
    if (key === 'a') {
      ids.tenantA = made.tenant;
      ids.entityA = made.entity;
    } else {
      ids.tenantB = made.tenant;
      ids.entityB = made.entity;
    }
  }
  token.a = await makeAdmin(ids.tenantA, 'admin@xa.test');
  token.b = await makeAdmin(ids.tenantB, 'admin@xb.test');

  // Company A gets one of everything, all carrying recognisable "secret" values.
  const made = async (res: request.Response, status = 201) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  };
  ids.deptA = (
    await made(
      await call('a', 'post', '/org/departments').send({
        name: A_SECRETS.dept,
      }),
    )
  ).id;
  ids.locA = (
    await made(
      await call('a', 'post', '/org/locations').send({
        name: A_SECRETS.location,
        city: 'Pune',
        state: 'Maharashtra',
      }),
    )
  ).id;
  ids.desigA = (
    await made(
      await call('a', 'post', '/org/designations').send({
        name: A_SECRETS.designation,
      }),
    )
  ).id;
  const person = await made(
    await call('a', 'post', '/people').send({
      person: {
        firstName: A_SECRETS.first,
        lastName: A_SECRETS.last,
        workEmail: A_SECRETS.email,
      },
      engagement: {
        entityId: ids.entityA,
        type: 'EMPLOYEE',
        employeeCode: A_SECRETS.code,
        startDate: '2026-01-05',
        departmentId: ids.deptA,
        designationId: ids.desigA,
        locationId: ids.locA,
      },
    }),
  );
  ids.engA = person.id;
  ids.personA = person.person.id;
  await made(await call('a', 'post', `/people/${ids.engA}/invite`), 200);
  ids.userA = (
    await call('a', 'get', `/people/${ids.engA}`)
  ).body.person.userId;
  ids.fileA = (
    await made(
      await call('a', 'post', `/files?name=${A_SECRETS.file}`)
        .set('Content-Type', 'application/pdf')
        .send(pdf),
    )
  ).id;
  const lhPdf = await PDFDocument.create();
  lhPdf.addPage([595.28, 841.89]);
  await made(
    await call(
      'a',
      'post',
      `/documents/letterheads?entityId=${ids.entityA}&name=${A_SECRETS.letterhead}`,
    )
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from(await lhPdf.save())),
  );
  await made(
    await call('a', 'put', '/documents/numbering').send({
      entityId: ids.entityA,
      letterType: 'OFFER',
      format: `${A_SECRETS.reference}{SEQ:4}`,
    }),
    200,
  );
  ids.templateA = (
    await made(
      await call('a', 'post', '/documents/templates').send({
        name: A_SECRETS.template,
        letterType: 'OFFER',
        layoutKey: 'letter',
        content: { body: 'Hello' },
      }),
    )
  ).id;
  ids.docA = (
    await made(
      await call('a', 'post', '/documents/generate').send({
        templateId: ids.templateA,
        entityId: ids.entityA,
        fields: { recipientName: 'Asha' },
      }),
    )
  ).id;
  ids.bulkA = (
    await made(
      await call('a', 'post', '/documents/bulk').send({
        templateId: ids.templateA,
        entityId: ids.entityA,
        rows: [{ fields: { recipientName: 'Asha' } }],
      }),
    )
  ).id;
  const pairing = await made(await call('a', 'post', '/desktop/pairing-code'));
  const paired = await request(app.getHttpServer())
    .post('/v1/desktop/pair')
    .set('X-Forwarded-For', '10.6.9.9')
    .send({
      code: pairing.code,
      name: 'A-Secret-PC',
      platform: 'windows',
      appVersion: '1.0',
    })
    .expect(201);
  ids.deviceA = paired.body.deviceId;
  ids.roleKeyA = (
    await made(
      await call('a', 'post', '/access/roles').send({ name: A_SECRETS.role }),
    )
  ).key;
  await made(
    await call('a', 'put', '/settings/tenant/branding.accentColor').send({
      value: A_SECRETS.accent,
    }),
    204,
  );

  // Company B has its own data, so "only B's data comes back" is something we can see.
  await made(
    await call('b', 'post', '/org/departments').send({ name: 'B-Dept' }),
  );
  ids.fileB = (
    await made(
      await call('b', 'post', '/files?name=b.pdf')
        .set('Content-Type', 'application/pdf')
        .send(pdf),
    )
  ).id;
  const meta = (await call('b', 'get', `/files/${ids.fileB}`)).body;
  bSigned = new URL(meta.downloadUrl, 'http://x').search;
});

afterAll(async () => {
  for (const s of ['xt-a', 'xt-b']) await deleteTenantData(prisma, s);
  await app.close();
});

/** "METHOD /pattern" for every route the app registers, found from the controllers' metadata. */
function discoverRoutes(): string[] {
  const names = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  const out: string[] = [];
  for (const w of app.get(DiscoveryService).getControllers()) {
    const c = w.metatype as unknown as { prototype: Record<string, unknown> };
    const base = String(Reflect.getMetadata('path', c) ?? '');
    for (const name of Object.getOwnPropertyNames(c.prototype)) {
      // Read the descriptor: a getter (like canRestart) must not run on the bare prototype.
      const fn = Object.getOwnPropertyDescriptor(c.prototype, name)?.value;
      if (typeof fn !== 'function') continue;
      const method = Reflect.getMetadata('method', fn) as number | undefined;
      if (method === undefined) continue;
      const path = String(Reflect.getMetadata('path', fn) ?? '');
      const full = `/${base}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '');
      out.push(`${names[method]} ${full}`);
    }
  }
  return out.sort();
}

/**
 * Routes that need no cross-tenant probe, each with the reason. Anything else must have a probe below.
 */
const NO_TENANT_DATA: Record<string, string> = {
  'GET /health': 'public status, no data',
  'GET /public/delivery/:token':
    'the private emailed link token is the credential; it identifies one letter',
  'GET /public/delivery/:token/download':
    'the private emailed link token is the credential, and offers stay held until released',
  'POST /public/accept/:token/esign/start':
    'the private link token is the credential',
  'POST /public/accept/:token/esign/complete':
    'the private link token plus the provider trip it started',
  'GET /public/esign/mock/:id':
    'test provider page, only with ESIGN_PROVIDER=mock',
  'GET /public/esign/mock/:id/approve':
    'test provider page, only with ESIGN_PROVIDER=mock',
  'GET /public/esign/mock/:id/decline':
    'test provider page, only with ESIGN_PROVIDER=mock',
  'GET /public/accept/:token':
    'the private link token is the credential; it identifies one request',
  'GET /public/accept/:token/document':
    'the private link token is the credential',
  'POST /public/accept/:token/code': 'the private link token is the credential',
  'POST /public/accept/:token/confirm':
    'the private link token plus a one-time code',
  'POST /public/accept/:token/decline':
    'the private link token is the credential',
  'GET /public/verify/lookup':
    'public by design: confirms a document exists for a company and reference, no personal data',
  'GET /public/verify/:token':
    'public by design: the QR token identifies one issued document, no personal data',
  'POST /public/verify/:token/compare':
    'public by design: compares an uploaded file with one issued document',
  'POST /desktop/pair':
    'public by design: the one-time pairing code is the credential and names the tenant',
  'GET /desktop/update':
    'the paired device credential is the credential; the release is the same for every company',
  'GET /desktop/update/download':
    'the paired device credential is the credential; the release is the same for every company',
  'POST /desktop/jobs/:id/sign-electronically':
    "the paired device credential is the credential; it only reaches its own jobs, and the signatory's authenticator code is also required",
  'GET /desktop/me':
    'the paired device credential is the credential; it only reaches its own tenant',
  'GET /desktop/jobs':
    "the paired device credential is the credential; lists only that person's jobs",
  'POST /desktop/jobs/:id/claim':
    "device credential; the job must belong to the device's own user",
  'GET /desktop/jobs/:id/input':
    'device credential; only a job held by this device',
  'POST /desktop/jobs/:id/release':
    'device credential; only a job held by this device',
  'POST /desktop/jobs/:id/fail':
    'device credential; only a job held by this device',
  'PUT /desktop/jobs/:id/signed':
    'device credential; only a job held by this device',
  'GET /public/seal-certificate':
    'public certificate of the organisation seal, no tenant data',
  'GET /public/company/:slug':
    'public: name and colour of a company, by its address',
  'POST /public/find-company':
    'public: emails the sign-in link to the address owner, always 202',
  'POST /auth/login': 'pre-login',
  'POST /auth/google': 'pre-login',
  'POST /auth/refresh': 'own refresh token',
  'POST /auth/forgot-password': 'pre-login',
  'POST /auth/reset-password': 'own one-time token',
  'POST /auth/recovery/email': 'pre-login',
  'POST /auth/recovery/email/verify': 'pre-login',
  'POST /auth/mfa/verify': 'own challenge token',
  'GET /mail/sender': 'the signed-in company only (tenantId from the token)',
  'PUT /mail/sender': 'the signed-in company only (tenantId from the token)',
  'POST /mail/sender/verify/start': 'the signed-in company only',
  'POST /mail/sender/verify/confirm': 'the signed-in company only',
  'POST /mail/sender/test': 'the signed-in company only',
  'POST /mail/sender/dns': 'the signed-in company only',
  'POST /mail/sender/activate': 'the signed-in company only',
  'DELETE /mail/sender': 'the signed-in company only',
  'GET /mail/deliveries': 'the list is filtered to the signed-in company',
  'POST /mail/deliveries/:id/resend':
    'the lookup includes the signed-in company, so another company’s id is a 404',
  'GET /mail/templates': 'the signed-in company’s wording over the platform’s',
  'GET /mail/templates/:event':
    'the signed-in company only (tenantId from the token)',
  'PUT /mail/templates/:event':
    'the signed-in company only (tenantId from the token)',
  'DELETE /mail/templates/:event':
    'the signed-in company only (tenantId from the token)',
  'POST /mail/templates/:event/preview':
    'renders sample values only; no company data',
  'POST /mail/templates/:event/test':
    'sends to the signed-in admin’s own address',
  'POST /auth/mfa/passkey/options': 'own challenge token',
  'POST /auth/mfa/passkey/verify':
    'own challenge token; the passkey must belong to that person',
  'POST /auth/passkeys/login/options':
    'public; names a company, returns only a challenge',
  'POST /auth/passkeys/login/verify':
    'the passkey is looked up inside the named company only (tenant-scoped table)',
  'POST /auth/passkeys/register/options': 'the caller only',
  'POST /auth/passkeys/register/verify': 'the caller only',
  'DELETE /auth/passkeys/:id': 'deletes by id and the caller’s own user id',
  'DELETE /auth/trusted-devices/:id':
    'deletes by id and the caller’s own user id',
  'GET /auth/security': 'the caller only',
  'POST /auth/mfa/disable': 'the caller only',
  'POST /auth/mfa/email-code': 'own challenge token',
  'POST /auth/step-up': 'the caller only',
  'GET /users': 'tenant-scoped query; the signed-in company only',
  'GET /users/:id/account':
    'refuses a user from another company (tenantId check)',
  'POST /users/:id/actions/:action':
    'refuses a user from another company (tenantId check)',
  'GET /support/sessions': 'tenant-scoped table; the signed-in company only',
  'POST /support/sessions/:id/end':
    'tenant-scoped table; the signed-in company only',
  'POST /support/sessions/current/end': 'the caller’s own support session',
  'POST /auth/mfa/setup': 'own challenge token',
  'POST /auth/mfa/confirm': 'own challenge token',
  'POST /auth/mfa/recovery/email': 'own challenge token',
  'POST /auth/mfa/recovery/email/verify': 'own challenge token',
  'GET /auth/me': 'the caller only',
  'POST /auth/logout': "the caller's own session",
  'POST /auth/logout-all': 'the caller only',
  'PUT /settings/me/:key': "the caller's own preference",
};
const PLATFORM_PREFIX = '/platform';

type Probe = {
  /** Sends the request as company B, aimed at A's data. */
  send: () => request.Test;
  /** refuse: must fail with 400-404. contained: must not touch A or show A's data, any status below 500. */
  mode: 'refuse' | 'contained';
};
const as = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
) => call('b', method, path);

const PROBES = (): Record<string, Probe> => ({
  'GET /access/roles': {
    mode: 'contained',
    send: () => as('get', '/access/roles'),
  },
  'GET /access/policies': {
    mode: 'contained',
    send: () => as('get', '/access/policies'),
  },
  'GET /access/users/:userId/roles': {
    mode: 'contained',
    send: () => as('get', `/access/users/${ids.userA}/roles`),
  },
  'POST /access/roles': {
    mode: 'contained',
    send: () => as('post', '/access/roles').send({ name: 'Probe B Role' }),
  },
  'POST /access/user-roles': {
    mode: 'refuse',
    send: () =>
      as('post', '/access/user-roles').send({
        userId: ids.userA,
        roleKey: 'tenant_admin',
      }),
  },
  'DELETE /access/user-roles': {
    mode: 'contained',
    send: () =>
      as('delete', '/access/user-roles').send({
        userId: ids.userA,
        roleKey: 'employee',
      }),
  },
  'PUT /access/policies/:roleKey': {
    mode: 'contained',
    send: () =>
      as('put', `/access/policies/${ids.roleKeyA}`).send({
        mfaLevel: 'REQUIRED',
      }),
  },
  'GET /audit': {
    mode: 'contained',
    send: () => as('get', `/audit?entityId=${ids.engA}`),
  },
  'GET /audit/verify': {
    mode: 'contained',
    send: () => as('get', '/audit/verify'),
  },
  'GET /notifications': {
    mode: 'contained',
    send: () => as('get', '/notifications'),
  },
  'GET /settings': { mode: 'contained', send: () => as('get', '/settings') },
  'PUT /settings/tenant/:key': {
    mode: 'contained',
    send: () =>
      as('put', '/settings/tenant/branding.accentColor').send({
        value: '#00ff00',
      }),
  },
  'DELETE /settings/tenant/:key': {
    mode: 'contained',
    send: () => as('delete', '/settings/tenant/branding.accentColor'),
  },
  'PUT /settings/entity/:entityId/:key': {
    mode: 'refuse',
    send: () =>
      as('put', `/settings/entity/${ids.entityA}/branding.accentColor`).send({
        value: '#00ff00',
      }),
  },
  'GET /org/entities': {
    mode: 'contained',
    send: () => as('get', '/org/entities'),
  },
  'GET /org/:kind': {
    mode: 'contained',
    send: () => as('get', '/org/departments'),
  },
  'POST /org/:kind': {
    mode: 'contained',
    send: () => as('post', '/org/departments').send({ name: 'B-Dept-2' }),
  },
  'PATCH /org/:kind/:id': {
    mode: 'refuse',
    send: () =>
      as('patch', `/org/departments/${ids.deptA}`).send({ name: 'Hijacked' }),
  },
  'DELETE /org/:kind/:id': {
    mode: 'refuse',
    send: () => as('delete', `/org/locations/${ids.locA}`),
  },
  'GET /people': {
    mode: 'contained',
    send: () => as('get', '/people?pageSize=100'),
  },
  'GET /people/:id': {
    mode: 'refuse',
    send: () => as('get', `/people/${ids.engA}`),
  },
  'PATCH /people/:id': {
    mode: 'refuse',
    send: () =>
      as('patch', `/people/${ids.engA}`).send({
        person: { firstName: 'Hijacked' },
      }),
  },
  'POST /people/:id/invite': {
    mode: 'refuse',
    send: () => as('post', `/people/${ids.engA}/invite`),
  },
  'POST /people': {
    mode: 'refuse',
    send: () =>
      as('post', '/people').send({
        person: { firstName: 'Mallory', lastName: 'B' },
        engagement: {
          entityId: ids.entityA,
          type: 'EMPLOYEE',
          employeeCode: 'B-X-1',
          startDate: '2026-01-05',
        },
      }),
  },
  'POST /people/import': {
    mode: 'contained',
    send: () =>
      as('post', '/people/import?dryRun=false&createMissing=true')
        .set('Content-Type', 'text/csv')
        .send(
          `employee_code,first_name,last_name,type,start_date,work_email,department,designation,location,manager_code,college,course,graduation_year,entity\n${A_SECRETS.code},Hijacked,Person,employee,2026-01-05,,Finance,,,,,,,HQ`,
        ),
  },
  'GET /documents/layouts': {
    mode: 'contained',
    send: () => as('get', '/documents/layouts'),
  },
  'GET /documents/letterheads': {
    mode: 'contained',
    send: () => as('get', '/documents/letterheads'),
  },
  'POST /documents/letterheads': {
    mode: 'refuse',
    send: () =>
      as('post', `/documents/letterheads?entityId=${ids.entityA}&name=x`)
        .set('Content-Type', 'application/pdf')
        .send(pdf),
  },
  'GET /documents/numbering': {
    mode: 'contained',
    send: () => as('get', '/documents/numbering'),
  },
  'PUT /documents/numbering': {
    mode: 'refuse',
    send: () =>
      as('put', '/documents/numbering').send({
        entityId: ids.entityA,
        letterType: 'OFFER',
        format: 'HACK/{SEQ:4}',
      }),
  },
  'GET /documents/templates': {
    mode: 'contained',
    send: () => as('get', '/documents/templates'),
  },
  'POST /documents/templates': {
    mode: 'contained',
    send: () =>
      as('post', '/documents/templates').send({
        name: 'B-Template',
        letterType: 'OFFER',
        layoutKey: 'letter',
      }),
  },
  'POST /documents/templates/upload': {
    mode: 'contained',
    send: () =>
      as('post', '/documents/templates/upload?name=B-Upload&letterType=OFFER')
        .set('Content-Type', 'application/pdf')
        .send(Buffer.from('%PDF-1.4 not really')),
  },
  'POST /documents/templates/starters': {
    mode: 'contained',
    send: () => as('post', '/documents/templates/starters'),
  },
  'POST /documents/bulk': {
    mode: 'refuse',
    send: () =>
      as('post', '/documents/bulk').send({
        templateId: ids.templateA,
        entityId: ids.entityA,
        rows: [{ fields: { recipientName: 'Hijack' } }],
      }),
  },
  'GET /documents/bulk/:id': {
    mode: 'refuse',
    send: () => as('get', `/documents/bulk/${ids.bulkA}`),
  },
  'POST /documents/bulk/:id/deliver': {
    mode: 'refuse',
    send: () => as('post', `/documents/bulk/${ids.bulkA}/deliver`),
  },
  'GET /documents/:id/signature-requests/electronic': {
    mode: 'refuse',
    send: () =>
      as('get', `/documents/${ids.docA}/signature-requests/electronic`),
  },
  'POST /documents/:id/signature-requests/:requestId/sign-electronically': {
    mode: 'refuse',
    send: () =>
      as(
        'post',
        `/documents/${ids.docA}/signature-requests/${ids.docA}/sign-electronically`,
      ).send({ code: '123456' }),
  },
  'POST /documents/:id/revoke': {
    mode: 'refuse',
    send: () =>
      as('post', `/documents/${ids.docA}/revoke`).send({
        reason: 'Hijack attempt',
      }),
  },
  'POST /documents/:id/supersede': {
    mode: 'refuse',
    send: () =>
      as('post', `/documents/${ids.docA}/supersede`).send({
        newDocumentId: ids.docA,
        reason: 'Hijack attempt',
      }),
  },
  'POST /documents/:id/deliver': {
    mode: 'refuse',
    send: () =>
      as('post', `/documents/${ids.docA}/deliver`).send({ email: 'x@x.test' }),
  },
  'POST /documents/:id/release': {
    mode: 'refuse',
    send: () => as('post', `/documents/${ids.docA}/release`),
  },
  'POST /documents/:id/hold': {
    mode: 'refuse',
    send: () => as('post', `/documents/${ids.docA}/hold`),
  },
  'POST /documents/:id/delivery/revoke': {
    mode: 'refuse',
    send: () => as('post', `/documents/${ids.docA}/delivery/revoke`),
  },
  'GET /documents/:id/delivery': {
    mode: 'refuse',
    send: () => as('get', `/documents/${ids.docA}/delivery`),
  },
  'GET /documents/templates/:id': {
    mode: 'refuse',
    send: () => as('get', `/documents/templates/${ids.templateA}`),
  },
  'POST /documents/templates/:id/versions': {
    mode: 'refuse',
    send: () =>
      as('post', `/documents/templates/${ids.templateA}/versions`).send({}),
  },
  'POST /documents/templates/:id/archive': {
    mode: 'refuse',
    send: () => as('post', `/documents/templates/${ids.templateA}/archive`),
  },
  'POST /documents/generate': {
    mode: 'refuse',
    send: () =>
      as('post', '/documents/generate').send({
        templateId: ids.templateA,
        entityId: ids.entityA,
        fields: { recipientName: 'Hijack' },
      }),
  },
  'GET /documents': {
    mode: 'contained',
    send: () => as('get', '/documents?pageSize=100'),
  },
  'POST /documents/:id/signature-requests': {
    mode: 'refuse',
    send: () =>
      as('post', `/documents/${ids.docA}/signature-requests`).send({
        name: 'X',
        email: 'x@x.test',
      }),
  },
  'GET /documents/:id/signature-requests': {
    mode: 'refuse',
    send: () => as('get', `/documents/${ids.docA}/signature-requests`),
  },
  'POST /documents/:id/signature-requests/:requestId/cancel': {
    mode: 'refuse',
    send: () =>
      as(
        'post',
        `/documents/${ids.docA}/signature-requests/${ids.docA}/cancel`,
      ).send({
        reason: 'x',
      }),
  },
  'POST /desktop/pairing-code': {
    mode: 'contained',
    send: () => as('post', '/desktop/pairing-code'),
  },
  'GET /desktop/devices': {
    mode: 'contained',
    send: () => as('get', '/desktop/devices'),
  },
  'POST /desktop/devices/:id/revoke': {
    mode: 'refuse',
    send: () => as('post', `/desktop/devices/${ids.deviceA}/revoke`),
  },
  'POST /documents/:id/actions': {
    mode: 'refuse',
    send: () =>
      as('post', `/documents/${ids.docA}/actions`).send({ action: 'submit' }),
  },
  'POST /documents/:id/revise': {
    mode: 'refuse',
    send: () =>
      as('post', `/documents/${ids.docA}/revise`).send({
        fields: { recipientName: 'Hijack' },
      }),
  },
  'GET /documents/:id/history': {
    mode: 'refuse',
    send: () => as('get', `/documents/${ids.docA}/history`),
  },
  'GET /documents/:id': {
    mode: 'refuse',
    send: () => as('get', `/documents/${ids.docA}`),
  },
  'POST /files': {
    mode: 'refuse',
    send: () =>
      as('post', `/files?name=b2.pdf&ownerType=person&ownerId=${ids.personA}`)
        .set('Content-Type', 'application/pdf')
        .send(pdf),
  },
  'GET /files/:id': {
    mode: 'refuse',
    send: () => as('get', `/files/${ids.fileA}`),
  },
  'DELETE /files/:id': {
    mode: 'refuse',
    send: () => as('delete', `/files/${ids.fileA}`),
  },
  // Public by design (a signed link), so the check is that B's valid signature does not open A's file.
  'GET /files/:id/content': {
    mode: 'refuse',
    send: () => call(null, 'get', `/files/${ids.fileA}/content${bSigned}`),
  },
});

describe('every endpoint, as another company', () => {
  it('has a cross-tenant check or a written reason for each route', () => {
    const probes = PROBES();
    const unclassified = discoverRoutes().filter(
      (r) =>
        !(r in probes) &&
        !(r in NO_TENANT_DATA) &&
        !r.split(' ')[1]!.startsWith(PLATFORM_PREFIX),
    );
    expect(
      unclassified,
      'Add a probe to PROBES (or a reason to NO_TENANT_DATA) for these new routes',
    ).toEqual([]);
    // and nothing in the tables is stale
    const real = new Set(discoverRoutes());
    const stale = [
      ...Object.keys(probes),
      ...Object.keys(NO_TENANT_DATA),
    ].filter((r) => !real.has(r));
    expect(stale, 'These entries no longer match a route').toEqual([]);
  });

  it('refuses or ignores every tenant route aimed at company A, and shows B none of A', async () => {
    const before = await snapshotA();
    const failures: string[] = [];
    for (const [route, probe] of Object.entries(PROBES())) {
      const res = await probe.send();
      const leaked = leaks(res);
      if (res.status >= 500)
        failures.push(`${route}: server error ${res.status}`);
      if (probe.mode === 'refuse' && !(res.status >= 400 && res.status <= 404))
        failures.push(`${route}: expected a refusal, got ${res.status}`);
      if (leaked.length)
        failures.push(
          `${route}: answer contains A's data (${leaked.join(', ')})`,
        );
    }
    expect(failures).toEqual([]);
    expect(await snapshotA()).toBe(before);
  });

  it('attaches a file only to a record of its own company', async () => {
    const up = (q: string) =>
      call('a', 'post', `/files?name=o.pdf${q}`)
        .set('Content-Type', 'application/pdf')
        .send(pdf);
    await up(`&ownerType=person&ownerId=${ids.personA}`).expect(201);
    await up(`&ownerType=engagement&ownerId=${ids.engA}`).expect(201);
    await up('&ownerType=person&ownerId=does-not-exist').expect(400);
    await up(`&ownerType=letter&ownerId=${ids.personA}`).expect(400);
    await up(`&ownerId=${ids.personA}`).expect(400);
    await up(`&ownerType=person`).expect(400);
  });

  it('keeps every platform (super admin) route closed to a company token', async () => {
    const platform = discoverRoutes()
      .map((r) => r.split(' ') as [string, string])
      .filter(
        ([, p]) =>
          p.startsWith(PLATFORM_PREFIX) && !p.startsWith('/platform/auth'),
      );
    expect(platform.length).toBeGreaterThan(8);
    const wrong: string[] = [];
    for (const [method, pattern] of platform) {
      const path = pattern
        .replace(':id', ids.tenantA)
        .replace(':key', 'security.sessionDays')
        .replace(':roleKey', 'employee');
      const res = await call('b', method.toLowerCase() as 'get', path).send({});
      if (res.status !== 401 && res.status !== 403)
        wrong.push(`${method} ${pattern}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it('does not let A be read or changed with no token at all', async () => {
    for (const [method, path] of [
      ['get', `/people/${ids.engA}`],
      ['patch', `/people/${ids.engA}`],
      ['get', `/files/${ids.fileA}`],
      ['get', '/audit'],
      ['get', '/org/departments'],
    ] as const)
      expect(
        (await call(null, method, path).send({})).status,
        `${method} ${path}`,
      ).toBe(401);
  });
});
