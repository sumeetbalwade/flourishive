import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { BulkService } from '../src/modules/documents/bulk.service.js';
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
let ip = 0;
let tenantId = '';
let userId = '';
let entityId = '';
let token = '';

const call = (method: 'get' | 'post' | 'put', path: string) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.8.0.${++ip}`)
    .set('Authorization', `Bearer ${token}`);

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
  await deleteTenantData(prisma, 'bulk-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({
          data: { slug: 'bulk-a', name: 'Bulk A' },
        }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  entityId = (
    await runAsSystem(
      async () =>
        await prisma.db.entity.create({
          data: { tenantId, name: 'HQ', legalName: 'HQ Pvt Ltd' },
        }),
    )
  ).id;
  const passwordHash = await app.get(PasswordService).hash('correct horse');
  const u = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: 'hr@bulk.test', passwordHash },
      }),
  );
  userId = u.id;
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: 'hr_lead' } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId, roleId: role!.id },
    });
  });
  token = (await app.get(SessionService).start(tenantId, userId, {}))
    .accessToken;
  const d = await PDFDocument.create();
  d.addPage([841.89, 595.28]);
  await call(
    'post',
    `/documents/letterheads?entityId=${entityId}&name=L&orientation=LANDSCAPE`,
  )
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from(await d.save()))
    .expect(201);
  await call('put', '/documents/numbering')
    .send({ entityId, letterType: 'CERTIFICATE', format: 'B/C/{YYYY}/{SEQ:3}' })
    .expect(200);
});

afterAll(async () => {
  await deleteTenantData(prisma, 'bulk-a');
  await app.close();
});

describe('starter letters and bulk issue', () => {
  let certificateId = '';
  const shared = {
    role: 'Engineering intern',
    startDate: '2026-06-01',
    endDate: '2026-08-31',
  };

  it('installs the four starter letters once', async () => {
    const first = await call('post', '/documents/templates/starters').expect(
      201,
    );
    expect(first.body.added).toHaveLength(4);
    const again = await call('post', '/documents/templates/starters').expect(
      201,
    );
    expect(again.body.added).toEqual([]);
    const list = await call('get', '/documents/templates').expect(200);
    const types = list.body.map((t: { letterType: string }) => t.letterType);
    expect(types.sort()).toEqual([
      'CERTIFICATE',
      'EXPERIENCE',
      'OFFER',
      'REFERENCE',
    ]);
    certificateId = list.body.find(
      (t: { letterType: string }) => t.letterType === 'CERTIFICATE',
    ).id;
  });

  it('refuses the whole batch, naming the rows, and uses no numbers', async () => {
    const res = await call('post', '/documents/bulk')
      .send({
        templateId: certificateId,
        entityId,
        shared: { role: 'Engineering intern', startDate: '2026-06-01' },
        rows: [
          { fields: { recipientName: 'Asha Rao', endDate: '2026-08-31' } },
          { fields: { recipientName: 'Ravi Iyer' } },
        ],
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('Row 2: End date is required');
    const used = await runInTenant(tenantId, async () =>
      prisma.db.generatedDocument.count(),
    );
    expect(used).toBe(0);
  });

  it('queues a valid batch, then issues each row once and in order', async () => {
    const res = await call('post', '/documents/bulk')
      .send({
        templateId: certificateId,
        entityId,
        shared,
        rows: ['Asha Rao', 'Ravi Iyer', 'Meera Nair'].map((n) => ({
          fields: { recipientName: n },
        })),
      })
      .expect(201);
    expect(res.body).toMatchObject({ total: 3, pending: 3, finished: false });

    const bulk = app.get(BulkService);
    await bulk.run(tenantId, res.body.id, userId);
    await bulk.run(tenantId, res.body.id, userId); // a repeat run changes nothing

    const done = await call('get', `/documents/bulk/${res.body.id}`).expect(
      200,
    );
    expect(done.body).toMatchObject({ done: 3, failed: 0, finished: true });
    const year = new Date().getUTCFullYear();
    const refs = done.body.rows.map((r: { reference: string }) => r.reference);
    expect(refs).toEqual([1, 2, 3].map((n) => `B/C/${year}/00${n}`));
  });

  it('keeps going when a row fails, and reports why', async () => {
    const res = await call('post', '/documents/bulk')
      .send({
        templateId: certificateId,
        entityId,
        shared,
        rows: [{ fields: { recipientName: 'Okay Person' } }],
      })
      .expect(201);
    await runInTenant(tenantId, async () =>
      prisma.db.template.update({
        where: { id: certificateId },
        data: { archivedAt: new Date() },
      }),
    );
    await app.get(BulkService).run(tenantId, res.body.id, userId);
    const out = await call('get', `/documents/bulk/${res.body.id}`).expect(200);
    expect(out.body).toMatchObject({ done: 0, failed: 1, finished: true });
    expect(out.body.rows[0].error).toContain('Template not found');
  });
});
