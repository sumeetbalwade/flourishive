import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PasswordService } from '../src/modules/identity/password.service.js';
import { SessionService } from '../src/modules/identity/session.service.js';
import { WorkflowService } from '../src/modules/workflow/workflow.service.js';
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
let entityId = '';
let templateId = '';
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};

const call = (method: 'get' | 'post' | 'put', path: string, who: string) =>
  request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.8.0.${++ip}`)
    .set('Authorization', `Bearer ${tok[who]}`);

async function user(name: string, roleKey: string) {
  const passwordHash = await app
    .get(PasswordService)
    .hash('correct horse battery');
  const u = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: `${name}@wf.test`, passwordHash },
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
  uid[name] = u.id;
  tok[name] = (
    await app.get(SessionService).start(tenantId, u.id, {})
  ).accessToken;
}

const newDoc = async (who = 'exec') =>
  (
    await call('post', '/documents/generate', who)
      .send({ templateId, entityId, fields: { recipientName: 'Asha' } })
      .expect(201)
  ).body.id as string;
const act = (id: string, who: string, action: string, comment?: string) =>
  call('post', `/documents/${id}/actions`, who).send({ action, comment });

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
  await deleteTenantData(prisma, 'wf-a');
  tenantId = (
    await runAsSystem(
      async () =>
        await prisma.db.tenant.create({ data: { slug: 'wf-a', name: 'WF A' } }),
    )
  ).id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  entityId = (
    await runAsSystem(
      async () =>
        await prisma.db.entity.create({
          data: { tenantId, name: 'HQ', legalName: 'HQ Ltd' },
        }),
    )
  ).id;
  await user('exec', 'hr_executive');
  await user('lead', 'hr_lead');
  await user('admin', 'tenant_admin');
  await user('emp', 'employee');
  const d = await PDFDocument.create();
  d.addPage([595.28, 841.89]);
  await call(
    'post',
    `/documents/letterheads?entityId=${entityId}&name=L`,
    'lead',
  )
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from(await d.save()))
    .expect(201);
  await call('put', '/documents/numbering', 'lead')
    .send({ entityId, letterType: 'OFFER', format: 'WF/{SEQ:4}' })
    .expect(200);
  templateId = (
    await call('post', '/documents/templates', 'lead')
      .send({
        name: 'Offer',
        letterType: 'OFFER',
        layoutKey: 'letter',
        content: { body: 'Hello {{recipientName}}' },
      })
      .expect(201)
  ).body.id;
});

afterAll(async () => {
  await deleteTenantData(prisma, 'wf-a');
  await app.close();
});

describe('letters workflow', () => {
  it('starts every generated document as a draft and tells each person what they can do', async () => {
    const id = await newDoc();
    const asExec = (await call('get', `/documents/${id}`, 'exec').expect(200))
      .body.workflow;
    expect(asExec.state).toBe('draft');
    expect(
      asExec.actions
        .map((x: { action: string }) => x.action)
        .sort((x: string, y: string) => x.localeCompare(y)),
    ).toEqual(['cancel', 'submit']);
    const list = await call('get', '/documents', 'exec').expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === id).state).toBe(
      'draft',
    );
  });

  it('needs a second person to approve, and the right permission', async () => {
    const id = await newDoc('exec');
    await act(id, 'exec', 'approve').expect(409); // not submitted yet
    await act(id, 'exec', 'submit').expect(201);
    await act(id, 'exec', 'approve').expect(403); // no approve permission
    await act(id, 'emp', 'approve').expect(403); // employees have no document access
    const lead = await act(id, 'lead', 'approve').expect(201);
    expect(lead.body).toEqual({ from: 'submitted', to: 'approved' });

    const own = await newDoc('lead');
    await act(own, 'lead', 'submit').expect(201);
    await act(own, 'lead', 'approve').expect(403); // submitted by the same person
    // the screen must not offer a step the person is not allowed to take
    const mine = await call('get', `/documents/${own}`, 'lead').expect(200);
    expect(
      mine.body.workflow.actions.map((x: { action: string }) => x.action),
    ).not.toContain('approve');
    const theirs = await call('get', `/documents/${own}`, 'admin').expect(200);
    expect(
      theirs.body.workflow.actions.map((x: { action: string }) => x.action),
    ).toContain('approve');
    await act(own, 'admin', 'approve').expect(201);
  });

  it('asks for changes with a reason, allows a revise, then a resubmit', async () => {
    const id = await newDoc('exec');
    await act(id, 'exec', 'submit').expect(201);
    await act(id, 'lead', 'request_changes').expect(400); // reason required
    await act(id, 'lead', 'request_changes', 'Fix the name').expect(201);
    const before = (await call('get', `/documents/${id}`, 'exec')).body;
    const rev = await call('post', `/documents/${id}/revise`, 'exec')
      .send({ fields: { recipientName: 'Asha Patil' } })
      .expect(201);
    expect(rev.body.reference).toBe(before.reference);
    expect(rev.body.fileId).not.toBe(before.fileId);
    expect(rev.body.verifyToken).toBe(before.verifyToken);
    await act(id, 'exec', 'submit').expect(201);
    await call('post', `/documents/${id}/revise`, 'exec')
      .send({ fields: { recipientName: 'X' } })
      .expect(409); // waiting for approval: frozen
    await act(id, 'lead', 'approve').expect(201);
    await call('post', `/documents/${id}/revise`, 'exec')
      .send({ fields: { recipientName: 'X' } })
      .expect(409); // approved: frozen

    const h = (
      await call('get', `/documents/${id}/history`, 'lead').expect(200)
    ).body;
    expect(h.state).toBe('approved');
    expect(h.actions.map((x: { action: string }) => x.action)).toEqual([
      'submit',
      'request_changes',
      'revise',
      'submit',
      'approve',
    ]);
    expect(h.actions[1].comment).toBe('Fix the name');
  });

  it('keeps signing steps for the system and refuses unknown actions', async () => {
    const id = await newDoc();
    await act(id, 'admin', 'start_signing').expect(403);
    await act(id, 'admin', 'issue').expect(403);
    await act(id, 'admin', 'fly').expect(400);
    await act(id, 'exec', 'cancel').expect(400); // reason required
    await act(id, 'exec', 'cancel', 'Wrong person').expect(201);
    await act(id, 'exec', 'submit').expect(409); // cancelled is final
    // code that owns the signing steps can take them
    const approved = await newDoc();
    await act(approved, 'exec', 'submit').expect(201);
    await act(approved, 'lead', 'approve').expect(201);
    const r = await app
      .get(WorkflowService)
      .act(
        { tenantId, userId: null },
        { type: 'document', id: approved },
        'start_signing',
        { asSystem: true },
      );
    expect(r.to).toBe('signing');
  });

  it('lets only one of two simultaneous approvals win', async () => {
    const id = await newDoc('exec');
    await act(id, 'exec', 'submit').expect(201);
    const [a, b] = await Promise.all([
      act(id, 'lead', 'approve'),
      act(id, 'admin', 'approve'),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    const h = (await call('get', `/documents/${id}/history`, 'lead')).body;
    expect(
      h.actions.filter((x: { action: string }) => x.action === 'approve'),
    ).toHaveLength(1);
  });
});
