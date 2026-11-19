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

const PASSWORD = 'correct horse battery';
const sent: { to: unknown; text: string }[] = [];
let app: INestApplication;
let prisma: PrismaService;
let sessions: SessionService;
let ip = 0;
const t = { a: '', b: '', hq: '', branch: '', hqB: '' };
const users: Record<string, { id: string; token: string }> = {};

const call = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  who?: string,
) => {
  const r = request(app.getHttpServer())
    [method](`/v1${path}`)
    .set('X-Forwarded-For', `10.2.0.${++ip}`);
  return who ? r.set('Authorization', `Bearer ${users[who]!.token}`) : r;
};
const importCsv = (who: string, csv: string, query = '') =>
  call('post', `/people/import${query}`, who)
    .set('Content-Type', 'text/csv')
    .send(csv);

async function makeUser(
  name: string,
  tenantId: string,
  roleKey: string,
  entityId?: string,
) {
  const passwordHash = await app.get(PasswordService).hash(PASSWORD);
  const user = await runAsSystem(
    async () =>
      await prisma.db.user.create({
        data: { tenantId, email: `${name}@ppl.test`, passwordHash },
      }),
  );
  await runInTenant(tenantId, async () => {
    const role = await prisma.db.role.findUnique({
      where: { tenantId_key: { tenantId, key: roleKey } },
    });
    await prisma.db.userRole.create({
      data: {
        tenantId,
        userId: user.id,
        roleId: role!.id,
        entityId: entityId ?? null,
      },
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
        send: async (m: { to: unknown; text: string }) => void sent.push(m),
      })
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  sessions = app.get(SessionService);
  await app.get(RedisService).client.flushdb();

  for (const k of ['a', 'b'] as const) {
    await deleteTenantData(prisma, `ppl-${k}`);
    await runAsSystem(async () => {
      const tenant = await prisma.db.tenant.create({
        data: { slug: `ppl-${k}`, name: `Ppl ${k}` },
      });
      t[k] = tenant.id;
      const hq = await prisma.db.entity.create({
        data: { tenantId: tenant.id, name: 'HQ', legalName: 'HQ Ltd' },
      });
      if (k === 'a') {
        t.hq = hq.id;
        t.branch = (
          await prisma.db.entity.create({
            data: {
              tenantId: tenant.id,
              name: 'Branch',
              legalName: 'Branch Ltd',
            },
          })
        ).id;
      } else t.hqB = hq.id;
    });
    await app.get(AccessService).provisionTenantRoles(t[k]);
  }
  await makeUser('admin', t.a, 'tenant_admin');
  await makeUser('hr', t.a, 'hr_lead');
  await makeUser('exec', t.a, 'hr_executive', t.branch);
  await makeUser('emp', t.a, 'employee');
  await makeUser('adminB', t.b, 'tenant_admin');
});

afterAll(async () => {
  await deleteTenantData(prisma, 'ppl-a');
  await deleteTenantData(prisma, 'ppl-b');
  await app.close();
});

const person = (
  over: Record<string, unknown> = {},
  eng: Record<string, unknown> = {},
) => ({
  person: {
    firstName: 'Asha',
    lastName: 'Patil',
    workEmail: 'asha@ppl.example',
    ...over,
  },
  engagement: {
    entityId: t.hq,
    type: 'EMPLOYEE',
    employeeCode: 'E001',
    startDate: '2026-01-05',
    ...eng,
  },
});

describe('org catalogues', () => {
  it('lets HR manage them, blocks others, and refuses duplicates and in-use deletes', async () => {
    const dept = await call('post', '/org/departments', 'hr')
      .send({ name: 'Engineering' })
      .expect(201);
    await call('post', '/org/departments', 'hr')
      .send({ name: 'Engineering' })
      .expect(409);
    await call('post', '/org/departments', 'emp')
      .send({ name: 'Nope' })
      .expect(403);
    await call('post', '/org/locations', 'hr')
      .send({ name: 'Pune', city: 'Pune', state: 'Maharashtra' })
      .expect(201);
    await call('post', '/org/widgets', 'hr').send({ name: 'x' }).expect(400);
    const list = await call('get', '/org/departments', 'hr').expect(200);
    expect(list.body.map((d: { name: string }) => d.name)).toContain(
      'Engineering',
    );
    await call('delete', `/org/departments/${dept.body.id}`, 'hr').expect(204);
  });
});

describe('people', () => {
  it('creates, lists, reads and edits a person', async () => {
    const dept = (
      await call('post', '/org/departments', 'hr')
        .send({ name: 'Design' })
        .expect(201)
    ).body;
    const created = await call('post', '/people', 'hr')
      .send(person({}, { departmentId: dept.id }))
      .expect(201);
    expect(created.body.department.name).toBe('Design');
    await call('post', '/people', 'hr')
      .send(person({ workEmail: 'other@ppl.example' }))
      .expect(409); // same code E001

    const list = await call('get', '/people?q=asha', 'hr').expect(200);
    expect(list.body.total).toBe(1);
    const patched = await call('patch', `/people/${created.body.id}`, 'hr')
      .send({
        person: { lastName: 'Deshmukh' },
        engagement: { employeeCode: 'E001' },
      })
      .expect(200);
    expect(patched.body.person.lastName).toBe('Deshmukh');
    await call('get', '/people', 'emp').expect(403);
  });

  it('rejects references from other tenants', async () => {
    const foreign = await call('post', '/org/departments', 'adminB')
      .send({ name: 'Foreign' })
      .expect(201);
    await call('post', '/people', 'hr')
      .send(
        person(
          { workEmail: 'x@ppl.example' },
          { employeeCode: 'E900', departmentId: foreign.body.id },
        ),
      )
      .expect(400);
  });

  it('limits an entity-scoped HR executive to their own company', async () => {
    await call('post', '/people', 'exec')
      .send(person({ workEmail: 'hq@ppl.example' }, { employeeCode: 'E100' }))
      .expect(403);
    const mine = await call('post', '/people', 'exec')
      .send(
        person(
          { workEmail: 'br@ppl.example' },
          { employeeCode: 'E101', entityId: t.branch },
        ),
      )
      .expect(201);
    const list = await call('get', '/people', 'exec').expect(200);
    expect(
      list.body.items.map((i: { employeeCode: string }) => i.employeeCode),
    ).toEqual(['E101']);
    const hqRow = (await call('get', '/people?q=E001', 'hr')).body.items[0];
    await call('get', `/people/${hqRow.id}`, 'exec').expect(404);
    await call('get', `/people/${mine.body.id}`, 'exec').expect(200);
  });

  it('never shows one tenant’s people to another', async () => {
    const hqRow = (await call('get', '/people?q=E001', 'hr')).body.items[0];
    await call('get', `/people/${hqRow.id}`, 'adminB').expect(404);
    await call('patch', `/people/${hqRow.id}`, 'adminB')
      .send({ person: { firstName: 'Hacked' } })
      .expect(404);
    expect((await call('get', '/people', 'adminB')).body.total).toBe(0);
  });
});

describe('CSV import', () => {
  const header =
    'employee_code,first_name,last_name,type,start_date,work_email,department,designation,location,manager_code,college,course,graduation_year,entity';
  const good = [
    header,
    'E200,Riya,Shah,employee,01/04/2025,riya@ppl.example,Finance,Manager,Mumbai,,,,,HQ',
    'I201,Karan,Mehta,intern,2026-06-01,karan@ppl.example,Finance,Intern,Mumbai,E200,COEP,B.Tech,2027,HQ',
  ].join('\n');

  it('reports row problems with line numbers and writes nothing', async () => {
    const bad = [
      header,
      'E300,Ok,Row,employee,2026-01-01,,,,,,,,,HQ',
      'E300,Dup,Code,employee,2026-01-01,,,,,E999,,,,HQ',
      'E301,,Shah,employee,2026-02-30,not-an-email,,,,,,,,HQ',
    ].join('\n');
    const res = await importCsv('hr', bad).expect(200);
    expect(res.body.valid).toBe(false);
    const where = res.body.errors.map(
      (e: { line: number; field: string }) => `${e.line}:${e.field}`,
    );
    expect(where).toEqual(
      expect.arrayContaining([
        '4:first_name',
        '4:start_date',
        '4:work_email',
        '3:employee_code',
        '3:manager_code',
      ]),
    );
    expect(
      await runAsSystem(
        async () =>
          await prisma.db.engagement.count({ where: { employeeCode: 'E300' } }),
      ),
    ).toBe(0);
  });

  it('refuses bad files outright', async () => {
    await importCsv('hr', 'employee_code,first_name\nE1,A').expect(400); // missing columns
    await importCsv(
      'hr',
      `${header},surprise\nE1,A,B,employee,2026-01-01,,,,,,,,,,x`,
    ).expect(400); // unknown column
    await call('post', '/people/import', 'hr').send({ not: 'csv' }).expect(400);
    await importCsv('emp', good).expect(403);
  });

  it('previews without writing, flags unknown catalogue names, then commits with createMissing', async () => {
    const strict = await importCsv('hr', good).expect(200);
    expect(strict.body.dryRun).toBe(true);
    expect(strict.body.valid).toBe(false); // Finance, Mumbai, Manager, Intern do not exist yet
    expect(
      strict.body.errors.some(
        (e: { field: string }) => e.field === 'department',
      ),
    ).toBe(true);

    const preview = await importCsv('hr', good, '?createMissing=true').expect(
      200,
    );
    expect(preview.body.valid).toBe(true);
    expect(preview.body.willCreate.people).toBe(2);
    expect(preview.body.willCreate.departments).toEqual(['Finance']);
    expect(preview.body.committed).toBe(false);
    expect((await call('get', '/people?q=riya', 'hr')).body.total).toBe(0);

    const done = await importCsv(
      'hr',
      good,
      '?dryRun=false&createMissing=true',
    ).expect(200);
    expect(done.body.committed).toBe(true);
    const intern = (await call('get', '/people?q=karan', 'hr')).body.items[0];
    expect(intern.type).toBe('INTERN');
    expect(intern.intern.college).toBe('COEP');
    expect(intern.manager.person.firstName).toBe('Riya');
    expect(
      new Date(
        (await call('get', '/people?q=riya', 'hr')).body.items[0].startDate,
      ).toISOString(),
    ).toBe('2025-04-01T00:00:00.000Z');
  });

  it('is repeatable: a second import updates instead of duplicating', async () => {
    const changed = good.replace('Riya,Shah', 'Riya,Shah-Rao');
    const res = await importCsv(
      'hr',
      changed,
      '?dryRun=false&createMissing=true',
    ).expect(200);
    expect(res.body.willUpdate.people).toBe(2);
    expect(res.body.willCreate.people).toBe(0);
    const rows = (await call('get', '/people?q=riya', 'hr')).body;
    expect(rows.total).toBe(1);
    expect(rows.items[0].person.lastName).toBe('Shah-Rao');
  });

  it('rolls back everything if the commit fails part-way', async () => {
    const clash = [
      header,
      'E400,Neha,Rao,employee,2026-01-01,riya@ppl.example,,,,,,,,HQ',
    ].join('\n'); // email already Riya's
    await importCsv('hr', clash, '?dryRun=false').expect(400);
    expect(
      await runAsSystem(
        async () =>
          await prisma.db.engagement.count({ where: { employeeCode: 'E400' } }),
      ),
    ).toBe(0);
  });
});

describe('invites and last admin', () => {
  it('creates an account, assigns the role and lets the person set a password', async () => {
    const row = (await call('get', '/people?q=riya', 'hr')).body.items[0];
    sent.length = 0;
    await call('post', `/people/${row.id}/invite`, 'emp').expect(403);
    await call('post', `/people/${row.id}/invite`, 'hr').expect(200);
    await call('post', `/people/${row.id}/invite`, 'hr').expect(409);
    expect(sent).toHaveLength(1);
    const token = /token=([\w-]+)/.exec(sent[0]!.text)![1]!;
    await call('post', '/auth/reset-password')
      .send({ token, password: 'a long new passphrase' })
      .expect(204);
    const login = await call('post', '/auth/login')
      .send({
        tenant: 'ppl-a',
        email: 'riya@ppl.example',
        password: 'a long new passphrase',
      })
      .expect(200);
    expect(login.body.status).toBe('ok'); // employee role does not need MFA
    const me = await call('get', '/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.permissions).toEqual(['self.read']);
  });

  it('needs a work email', async () => {
    const created = await call('post', '/people', 'hr')
      .send({
        person: { firstName: 'No', lastName: 'Email' },
        engagement: {
          entityId: t.hq,
          type: 'EMPLOYEE',
          employeeCode: 'E500',
          startDate: '2026-01-01',
        },
      })
      .expect(201);
    await call('post', `/people/${created.body.id}/invite`, 'hr').expect(400);
  });

  it('will not remove the last Tenant Admin', async () => {
    await call('delete', '/access/user-roles', 'admin')
      .send({ userId: users.admin!.id, roleKey: 'tenant_admin' })
      .expect(409);
  });
});
