import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
import { createApiClient } from '@flourishive/api-client';
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
 * Runs the web app's own API client against the real server, so a screen and the API can never
 * disagree about the shape of a response without this test failing.
 */
let app: INestApplication;
let prisma: PrismaService;
let api: ReturnType<typeof createApiClient>;
let approver: ReturnType<typeof createApiClient>;
let entityId = '';
let engagementId = '';
let personId = '';

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async () => undefined })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.listen(0);
  prisma = app.get(PrismaService);
  await app.get(RedisService).client.flushdb();
  await deleteTenantData(prisma, 'web-doc');
  const tenant = await runAsSystem(
    async () =>
      await prisma.db.tenant.create({
        data: { slug: 'web-doc', name: 'Web Doc' },
      }),
  );
  const tenantId = tenant.id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const entity = await runAsSystem(
    async () =>
      await prisma.db.entity.create({
        data: { tenantId, name: 'HQ', legalName: 'HQ Pvt Ltd' },
      }),
  );
  entityId = entity.id;
  const person = await runAsSystem(
    async () =>
      await prisma.db.person.create({
        data: {
          tenantId,
          firstName: 'Asha',
          lastName: 'Patil',
          personalEmail: 'asha@example.test',
        },
      }),
  );
  personId = person.id;
  const eng = await runAsSystem(
    async () =>
      await prisma.db.engagement.create({
        data: {
          tenantId,
          personId,
          entityId,
          type: 'EMPLOYEE',
          employeeCode: 'E1',
          startDate: new Date('2026-12-01'),
        },
      }),
  );
  engagementId = eng.id;
  const passwordHash = await app
    .get(PasswordService)
    .hash('correct horse battery');
  const u = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: 'hr@web-doc.test', passwordHash },
      }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: 'hr_lead' } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId: u.id, roleId: role!.id },
    });
  });
  const second = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: 'boss@web-doc.test', passwordHash },
      }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: 'hr_lead' } },
    });
    await prisma.db.userRole.create({
      data: { tenantId, userId: second.id, roleId: role!.id },
    });
  });
  const port = (app.getHttpServer().address() as { port: number }).port;
  const client = async (userId: string) => {
    const c = createApiClient({ baseUrl: `http://127.0.0.1:${port}` });
    c.http.setAccessToken(
      (await app.get(SessionService).start(tenantId, userId, {})).accessToken,
    );
    return c;
  };
  api = await client(u.id);
  approver = await client(second.id);
});

afterAll(async () => {
  await deleteTenantData(prisma, 'web-doc');
  await app.close();
});

describe('the web app client against the real API', () => {
  it('sets up stationery and numbering, makes a template and a letter, and walks it to approval', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595.28, 841.89]);
    const head = await api.documents.uploadLetterhead(
      new Blob([Buffer.from(await pdf.save())], { type: 'application/pdf' }),
      { entityId, name: 'Letterhead', orientation: 'PORTRAIT' },
    );
    expect(head.version).toBe(1);
    expect((await api.documents.letterheads())[0]!.name).toBe('Letterhead');

    await api.documents.saveNumbering({
      entityId,
      letterType: 'OFFER',
      format: 'T/OFR/{YYYY}/{SEQ:4}',
    });
    expect((await api.documents.numbering())[0]!.format).toContain('{SEQ:4}');

    const layouts = await api.documents.layouts();
    expect(layouts.map((l) => l.key)).toContain('letter');
    const tpl = await api.documents.createTemplate({
      name: 'Offer',
      letterType: 'OFFER',
      layoutKey: 'letter',
    });
    expect((await api.documents.templates())[0]!.id).toBe(tpl.id);

    const made = await api.documents.generate({
      templateId: tpl.id,
      entityId,
      personId,
      engagementId,
      fields: { recipientName: 'Asha Patil' },
    });
    expect(made.reference).toMatch(/^T\/OFR\//);

    const list = await api.documents.list({ page: 1, pageSize: 25 });
    expect(list.items[0]).toMatchObject({
      personName: 'Asha Patil',
      state: 'draft',
    });

    const doc = await api.documents.get(made.id);
    expect(doc.personEmail).toBe('asha@example.test');
    expect(doc.workflow.actions.map((a) => a.action)).toContain('submit');
    // the preview link is a path on the API and serves the PDF
    const file = await fetch(`${api.http['opts'].baseUrl}${doc.downloadUrl}`);
    expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(500);

    await api.documents.act(made.id, 'submit');
    expect((await api.documents.history(made.id)).state).toBe('submitted');
    expect(await api.documents.signatureRequests(made.id)).toEqual([]);

    // a second person approves (four eyes), then HR sends it to the candidate
    await approver.documents.act(made.id, 'approve');
    await api.documents.requestAcceptance(made.id, {
      name: 'Asha Patil',
      email: 'asha@example.test',
    });
    const requests = await api.documents.signatureRequests(made.id);
    expect(requests[0]).toMatchObject({ status: 'PENDING' });
    expect(requests[0]!.parties[0]!.name).toBe('Asha Patil');
    expect(requests[0]!.events.length).toBeGreaterThan(0);
    await api.documents.cancelRequest(made.id, requests[0]!.id, 'test');
    expect((await api.documents.signatureRequests(made.id))[0]!.status).toBe(
      'CANCELLED',
    );
  });
});
