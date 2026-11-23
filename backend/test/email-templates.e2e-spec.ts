import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { EmailTemplatesService } from '../src/modules/notifications/email-templates.service.js';
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

const sent: { to: string; subject: string; text: string; html?: string }[] = [];
const fakeMail = {
  send: async (m: (typeof sent)[number]) => void sent.push(m),
  sendVia: async (_s: unknown, m: (typeof sent)[number]) => void sent.push(m),
  canResend: async () => false,
  retry: async () => false,
};

let app: INestApplication;
let prisma: PrismaService;
let tenantA = '';
let tenantB = '';
let adminA = '';
let empA = '';

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
  await app.get(RedisService).client.flushdb();
  tenantA = await tenant('tpl-a');
  tenantB = await tenant('tpl-b');
  adminA = await userWithRole(tenantA, 'admin@tpl-a.test', 'tenant_admin');
  empA = await userWithRole(tenantA, 'emp@tpl-a.test', 'employee');
});

afterAll(async () => {
  await runAsSystem(async () => {
    await prisma.db.emailTemplate.deleteMany({ where: { tenantId: null } });
  });
  await deleteTenantData(prisma, 'tpl-a');
  await deleteTenantData(prisma, 'tpl-b');
  await app.close();
});

describe('email templates (D-59)', () => {
  it('is for people with email.manage only', async () => {
    await call('get', '/mail/templates', empA).expect(403);
  });

  it('shows company emails only, never the platform-only ones', async () => {
    const r = await call('get', '/mail/templates', adminA).expect(200);
    const keys = r.body.items.map((i: { event: string }) => i.event);
    expect(keys).toContain('auth.invite');
    expect(keys).not.toContain('platform.signin_code');
    await call('get', '/mail/templates/platform.signin_code', adminA).expect(
      404,
    );
  });

  it('rejects an unknown placeholder with a clear message and keeps the old wording', async () => {
    const r = await call('put', '/mail/templates/auth.invite', adminA)
      .send({ subject: 'Welcome', body: 'Hi {{nope}} [[Go|{{link}}]]' })
      .expect(400);
    expect(JSON.stringify(r.body)).toContain('{{nope}}');
    const cur = await call('get', '/mail/templates/auth.invite', adminA).expect(
      200,
    );
    expect(cur.body.source).toBe('default');
  });

  it('saves wording, previews it, and sends exactly that wording', async () => {
    await call('put', '/mail/templates/auth.invite', adminA)
      .send({
        subject: 'Welcome to {{app}}!',
        body: 'Glad you are here.\n\n[[Get started|{{link}}]]',
      })
      .expect(200);
    const pv = await call('post', '/mail/templates/auth.invite/preview', adminA)
      .send({ scheme: 'dark' })
      .expect(200);
    expect(pv.body.subject).toMatch(/^Welcome to .+!$/);
    expect(pv.body.html).toContain('Glad you are here.');
    expect(pv.body.problems).toEqual([]);

    const out = await app
      .get(EmailTemplatesService)
      .render('auth.invite', tenantA, {
        link: 'https://x.test/a',
        expires: '7 days',
      });
    expect(out.text).toContain('Glad you are here.');
    expect(out.html).toContain('https://x.test/a');

    // Another company still gets the built-in wording.
    const other = await app
      .get(EmailTemplatesService)
      .render('auth.invite', tenantB, {
        link: 'https://x.test/b',
        expires: '7 days',
      });
    expect(other.text).not.toContain('Glad you are here.');
  });

  it('sends a test only to the admin who asked', async () => {
    sent.length = 0;
    await call('post', '/mail/templates/auth.invite/test', adminA)
      .send({})
      .expect(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('admin@tpl-a.test');
    expect(sent[0]!.subject.startsWith('[Test]')).toBe(true);
  });

  it('resets to the default', async () => {
    const r = await call(
      'delete',
      '/mail/templates/auth.invite',
      adminA,
    ).expect(200);
    expect(r.body.source).toBe('default');
  });

  it('lets the platform lock an email so a company cannot reword it', async () => {
    const svc = app.get(EmailTemplatesService);
    await svc.save('auth.password_reset', null, null, {
      subject: 'Reset: {{link}}',
      body: 'Platform wording [[Go|{{link}}]]',
      locked: true,
    });
    const view = await call(
      'get',
      '/mail/templates/auth.password_reset',
      adminA,
    ).expect(200);
    expect(view.body.readOnly).toBe(true);
    await call('put', '/mail/templates/auth.password_reset', adminA)
      .send({ subject: 'Mine', body: 'Mine [[Go|{{link}}]]' })
      .expect(403);
    const out = await svc.render('auth.password_reset', tenantA, {
      link: 'https://x.test/r',
      expires: 'one hour',
    });
    expect(out.text).toContain('Platform wording');
  });
});
