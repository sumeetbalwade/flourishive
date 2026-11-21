import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import {
  NotificationsService,
  SEND_JOB,
} from '../src/modules/notifications/notifications.service.js';
import { RedisService } from '../src/platform/cache/redis.service.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../src/platform/database/tenant-context.js';
import { MailService } from '../src/platform/mail/mail.service.js';
import { JobHandlerRegistry } from '../src/platform/queue/job-handlers.js';
import { deleteTenantData } from './helpers.js';

const PASSWORD = 'correct horse battery';
const mails: { to: unknown; text: string; fromName?: string }[] = [];
let failMail = false;
let app: INestApplication;
let prisma: PrismaService;
let audit: AuditService;
let sessions: SessionService;
let ip = 0;
const t = { a: '', b: '' };
const users: Record<string, { id: string; token: string }> = {};

const call = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  who?: string,
) => {
  const r = request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.3.0.${++ip}`);
  return who ? r.set('Authorization', `Bearer ${users[who]!.token}`) : r;
};

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

async function makeUser(name: string, tenantId: string, roleKey: string) {
  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: `${name}@afn.test`, passwordHash },
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
  users[name] = {
    id: user.id,
    token: (await sessions.start(tenantId, user.id, {})).accessToken,
  };
}

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({
        send: async (m: { to: unknown; text: string; fromName?: string }) => {
          if (failMail) throw new Error('smtp down');
          mails.push(m);
        },
      })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  audit = app.get(AuditService);
  sessions = app.get(SessionService);
  await app.get(RedisService).client.flushdb();
  for (const k of ['a', 'b'] as const) {
    await deleteTenantData(prisma, `afn-${k}`);
    t[k] = await runAsSystem(
      async () =>
        (
          await prisma.db.tenant.create({
            data: { slug: `afn-${k}`, name: `Afn ${k}` },
          })
        ).id,
    );
    await app.get(AccessService).provisionTenantRoles(t[k]);
  }
  await makeUser('admin', t.a, 'tenant_admin');
  await makeUser('hr', t.a, 'hr_lead');
  await makeUser('emp', t.a, 'employee');
  await makeUser('adminB', t.b, 'tenant_admin');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'afn-a');
  await deleteTenantData(prisma, 'afn-b');
  await app.close();
});

describe('audit log', () => {
  it('records changes automatically, with the actor, and not reads or previews', async () => {
    await call('get', '/org/departments', 'hr').expect(200);
    const dept = await call('post', '/org/departments', 'hr')
      .send({ name: 'Audited' })
      .expect(201);
    await call('post', '/people/import', 'hr')
      .set('Content-Type', 'text/csv')
      .send(
        'employee_code,first_name,last_name,type,start_date\nX1,A,B,employee,2026-01-01',
      )
      .expect(200); // dry run
    const log = await call('get', '/audit', 'hr').expect(200);
    const actions = log.body.items.map((i: { action: string }) => i.action);
    expect(
      actions.some(
        (a: string) => a.startsWith('POST') && a.includes('/org/:kind'),
      ),
    ).toBe(true);
    expect(actions.some((a: string) => a.includes('people/import'))).toBe(
      false,
    );
    expect(actions.some((a: string) => a.startsWith('GET'))).toBe(false);
    const row = log.body.items.find((i: { action: string }) =>
      i.action.includes('/org/:kind'),
    );
    expect(row.actorId).toBe(users.hr!.id);
    expect(row.entityType).toBe('org');
    expect(dept.body.id).toBeTruthy();
    await call('get', '/audit', 'emp').expect(403);
  });

  it('records sign-ins, failed sign-ins and password changes', async () => {
    await call('post', '/auth/login')
      .send({
        tenant: 'afn-a',
        email: 'emp@afn.test',
        password: 'wrong-password-123',
      })
      .expect(401);
    await call('post', '/auth/login')
      .send({ tenant: 'afn-a', email: 'emp@afn.test', password: PASSWORD })
      .expect(200);
    const log = await call('get', '/audit?pageSize=100', 'hr').expect(200);
    const actions = log.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(
      expect.arrayContaining(['auth.login_failed', 'auth.login']),
    );
    const failed = log.body.items.find(
      (i: { action: string }) => i.action === 'auth.login_failed',
    );
    expect(JSON.stringify(failed)).not.toContain('wrong-password');
  });

  it('keeps a valid hash chain, even with many writers at once', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        audit.record({
          tenantId: t.a,
          actorType: 'SYSTEM',
          action: `test.parallel.${i}`,
        }),
      ),
    );
    const res = await call('get', '/audit/verify', 'hr').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.checked).toBeGreaterThanOrEqual(20);
  });

  it('detects an edited row, a removed row and a truncated tail', async () => {
    const rows = await runAsSystem(
      async () =>
        await prisma.db.auditLog.findMany({
          where: { tenantId: t.a },
          orderBy: { seq: 'asc' },
        }),
    );
    const middle = rows[Math.floor(rows.length / 2)]!;

    // 1. edit content
    await runAsSystem(async () => {
      await prisma.db.auditLog.update({
        where: { seq: middle.seq },
        data: { action: 'tampered' },
      });
    });
    let res = await audit.verifyChain(t.a);
    expect(res.ok).toBe(false);
    expect(res.brokenAtSeq).toBe(middle.seq.toString());
    await runAsSystem(async () => {
      await prisma.db.auditLog.update({
        where: { seq: middle.seq },
        data: { action: middle.action },
      });
    });
    expect((await audit.verifyChain(t.a)).ok).toBe(true);

    // 2. remove a row from the middle
    await runAsSystem(async () => {
      await prisma.db.auditLog.delete({ where: { seq: middle.seq } });
    });
    res = await audit.verifyChain(t.a);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/link is broken/);

    // 3. remove the newest row (a gap at the end only the chain head can reveal)
    await runAsSystem(async () => {
      await prisma.db.auditLog.create({
        data: { ...middle, meta: middle.meta ?? undefined },
      });
    });
    expect((await audit.verifyChain(t.a)).ok).toBe(true);
    const last = rows[rows.length - 1]!;
    await runAsSystem(async () => {
      await prisma.db.auditLog.delete({ where: { seq: last.seq } });
    });
    res = await audit.verifyChain(t.a);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/tip/);
  });

  it('keeps each tenant’s trail separate', async () => {
    const log = await call('get', '/audit', 'adminB').expect(200);
    expect(
      log.body.items.every((i: { tenantId: string }) => i.tenantId === t.b),
    ).toBe(true);
    expect(
      (await call('get', '/audit/verify', 'adminB').expect(200)).body.ok,
    ).toBe(true);
  });
});

describe('files', () => {
  const upload = (
    who: string,
    body: Buffer,
    type = 'application/pdf',
    name = 'offer letter.pdf',
  ) =>
    call('post', `/files?name=${encodeURIComponent(name)}`, who)
      .set('Content-Type', type)
      .send(body);

  it('stores a PDF and serves it through a short-lived signed link', async () => {
    const up = await upload('hr', PDF).expect(201);
    expect(up.body.sizeBytes).toBe(PDF.length);
    expect(up.body.sha256).toHaveLength(64);

    const meta = await call('get', `/files/${up.body.id}`, 'hr').expect(200);
    const dl = await request(app.getHttpServer())
      .get(meta.body.downloadUrl)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
    expect(dl.headers['content-disposition']).toContain('offer letter.pdf');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses tampered or expired links and other tenants', async () => {
    const up = await upload('hr', PDF).expect(201);
    const meta = await call('get', `/files/${up.body.id}`, 'hr').expect(200);
    await request(app.getHttpServer())
      .get(
        meta.body.downloadUrl.replace(
          /sig=(.)/,
          (_m: string, c: string) => `sig=${c === '0' ? '1' : '0'}`,
        ),
      )
      .expect(404);
    await request(app.getHttpServer())
      .get(meta.body.downloadUrl.replace(/expires=\d+/, 'expires=1'))
      .expect(404);
    await call('get', `/files/${up.body.id}`, 'adminB').expect(404);
  });

  it('checks type, content, size and permission', async () => {
    await upload('hr', Buffer.from('MZ not a pdf at all')).expect(415); // wrong magic bytes
    await upload('hr', PDF, 'text/html').expect(415);
    await upload('emp', PDF).expect(403);
    await call('post', '/files?name=x.pdf', 'hr')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.alloc(0))
      .expect(400);
  });

  it('cleans file names and supports delete', async () => {
    const up = await upload(
      'hr',
      PDF,
      'application/pdf',
      '../../etc/pass"wd\r\n.pdf',
    ).expect(201);
    expect(up.body.originalName).not.toMatch(/[/\\"\r\n]/);
    await call('delete', `/files/${up.body.id}`, 'hr').expect(204);
    await call('get', `/files/${up.body.id}`, 'hr').expect(404);
  });
});

describe('notifications', () => {
  it('sends password emails through a recorded notification with the tenant’s sender name', async () => {
    await call('put', '/settings/tenant/branding.emailSenderName', 'admin')
      .send({ value: 'Afn People Team' })
      .expect(204);
    mails.length = 0;
    await call('post', '/auth/forgot-password')
      .send({ tenant: 'afn-a', email: 'emp@afn.test' })
      .expect(202);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.fromName).toBe('Afn People Team');
    const list = await call('get', '/notifications', 'hr').expect(200);
    const n = list.body.find(
      (x: { event: string }) => x.event === 'auth.password_reset',
    );
    expect(n.status).toBe('SENT');
    expect(JSON.stringify(list.body)).not.toContain('token='); // the secret link is not exposed through the list
  });

  it('queued mail is delivered by the worker handler and retried after a failure', async () => {
    const svc = app.get(NotificationsService);
    const registry = app.get(JobHandlerRegistry);
    const id = await svc.enqueue(t.a, 'general.notice', 'new@afn.test', {
      subject: 'Hello',
      text: 'Plain message',
    });
    const status = async () =>
      (await call('get', '/notifications', 'hr')).body.find(
        (x: { id: string }) => x.id === id,
      ).status;
    expect(await status()).toBe('QUEUED');

    failMail = true;
    await expect(
      registry.dispatch({
        name: SEND_JOB,
        data: { tenantId: t.a, notificationId: id },
      }),
    ).rejects.toThrow('smtp down');
    expect(await status()).toBe('FAILED');

    failMail = false;
    mails.length = 0;
    await registry.dispatch({
      name: SEND_JOB,
      data: { tenantId: t.a, notificationId: id },
    });
    expect(await status()).toBe('SENT');
    expect(mails).toHaveLength(1);
    await registry.dispatch({
      name: SEND_JOB,
      data: { tenantId: t.a, notificationId: id },
    }); // already sent: no duplicate
    expect(mails).toHaveLength(1);
  });

  it('refuses jobs that have no handler or no tenant', async () => {
    const registry = app.get(JobHandlerRegistry);
    await expect(
      registry.dispatch({ name: 'nope', data: { tenantId: t.a } }),
    ).rejects.toThrow('No handler');
    await expect(
      registry.dispatch({ name: SEND_JOB, data: {} }),
    ).rejects.toThrow('no tenantId');
  });
});
