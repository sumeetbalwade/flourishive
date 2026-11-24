import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessService } from '../src/modules/access/access.service.js';
import { PAYMENT_GATEWAY } from '../src/modules/billing/gateway/payment-gateway.js';
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

const GOOD = 'good-signature';
const fakeGateway = {
  name: 'fake',
  configured: async () => true,
  publicKey: async () => 'rzp_test_fake',
  createPlan: async () => 'plan_fake',
  createSubscription: async () => ({ id: 'sub_fake_1' }),
  cancelSubscription: async () => undefined,
  verifyCheckout: async (p: { signature: string }) => p.signature === GOOD,
  verifyWebhook: async (_raw: Buffer, sig: string) => sig === GOOD,
};

let app: INestApplication;
let prisma: PrismaService;
let tenantId = '';
let token = '';
let starterId = '';

const post = (path: string, tok: string) =>
  request(app.getHttpServer())
    .post(`/v1${path}`)
    .set('Authorization', `Bearer ${tok}`);

const hook = (event: unknown, id: string, sig = GOOD) =>
  request(app.getHttpServer())
    .post('/v1/webhooks/razorpay')
    .set('x-razorpay-signature', sig)
    .set('x-razorpay-event-id', id)
    .send(event as object);

beforeAll(async () => {
  app = (
    await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async () => undefined })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(fakeGateway)
      .compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  await app.get(RedisService).client.flushdb();
  await deleteTenantData(prisma, 'rzp-a');
  const t = await runAsSystem(async () =>
    prisma.db.tenant.create({ data: { slug: 'rzp-a', name: 'RZP A' } }),
  );
  tenantId = t.id;
  await app.get(AccessService).provisionTenantRoles(tenantId);
  const user = await runAsSystem(async () =>
    prisma.db.user.create({
      data: {
        tenantId,
        email: 'admin@rzp-a.test',
        passwordHash: await app
          .get(PasswordService)
          .hash('correct horse battery'),
        status: 'ACTIVE',
      },
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
  token = (await app.get(SessionService).start(tenantId, user.id, {}))
    .accessToken;
  const free = await runAsSystem(async () =>
    prisma.db.plan.findFirst({ where: { isDefault: true } }),
  );
  const starter = await runAsSystem(async () =>
    prisma.db.plan.findUnique({ where: { key: 'starter' } }),
  );
  starterId = starter!.id;
  await runAsSystem(async () =>
    prisma.db.subscription.create({ data: { tenantId, planId: free!.id } }),
  );
});

afterAll(async () => {
  await runAsSystem(async () =>
    prisma.db.billingEvent.deleteMany({
      where: { gatewayEventId: { startsWith: 'evt_rzp_' } },
    }),
  );
  await deleteTenantData(prisma, 'rzp-a');
  await app.close();
});

const activated = {
  event: 'subscription.charged',
  payload: {
    subscription: {
      entity: {
        id: 'sub_fake_1',
        current_start: 1_780_000_000,
        current_end: 1_782_600_000,
      },
    },
    payment: {
      entity: {
        id: 'pay_fake_1',
        amount: 99900,
        currency: 'INR',
        method: 'upi',
      },
    },
  },
};

describe('Razorpay subscriptions (D-21)', () => {
  it('starts a checkout and refuses a free plan', async () => {
    const r = await post('/billing/checkout', token)
      .send({ planId: starterId, interval: 'MONTHLY' })
      .expect(201);
    expect(r.body).toMatchObject({
      subscriptionId: 'sub_fake_1',
      keyId: 'rzp_test_fake',
    });
    const free = await runAsSystem(async () =>
      prisma.db.plan.findFirst({ where: { isDefault: true } }),
    );
    await post('/billing/checkout', token)
      .send({ planId: free!.id, interval: 'MONTHLY' })
      .expect(400);
  });

  it('refuses a checkout confirmation with a bad signature, keeping the old plan', async () => {
    await post('/billing/confirm', token)
      .send({
        razorpay_payment_id: 'pay_x',
        razorpay_subscription_id: 'sub_fake_1',
        razorpay_signature: 'nope',
      })
      .expect(400);
    const plan = (
      await request(app.getHttpServer())
        .get('/v1/billing/plan')
        .set('Authorization', `Bearer ${token}`)
    ).body;
    expect(plan.plan.key).toBe('free');
  });

  it('rejects a webhook with a bad signature', async () => {
    await hook(activated, 'evt_rzp_bad', 'forged').expect(400);
  });

  it('moves the company to the paid plan on a signed webhook and records the payment', async () => {
    await hook(activated, 'evt_rzp_1').expect(200);
    const plan = (
      await request(app.getHttpServer())
        .get('/v1/billing/plan')
        .set('Authorization', `Bearer ${token}`)
    ).body;
    expect(plan.plan.key).toBe('starter');
    const state = (
      await request(app.getHttpServer())
        .get('/v1/billing/state')
        .set('Authorization', `Bearer ${token}`)
    ).body;
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0].amount).toBe(99900);
    expect(state.hasSubscription).toBe(true);
  });

  it('handles a repeated webhook once', async () => {
    const r = await hook(activated, 'evt_rzp_1').expect(200);
    expect(r.body.duplicate).toBe(true);
    const n = await runInTenant(tenantId, async () =>
      prisma.db.payment.count(),
    );
    expect(n).toBe(1);
  });

  it('marks a missed charge past due, then falls back to the default plan when it ends', async () => {
    await hook(
      {
        event: 'subscription.pending',
        payload: { subscription: { entity: { id: 'sub_fake_1' } } },
      },
      'evt_rzp_2',
    ).expect(200);
    let plan = (
      await request(app.getHttpServer())
        .get('/v1/billing/plan')
        .set('Authorization', `Bearer ${token}`)
    ).body;
    expect(plan.status).toBe('PAST_DUE');
    await hook(
      {
        event: 'subscription.cancelled',
        payload: { subscription: { entity: { id: 'sub_fake_1' } } },
      },
      'evt_rzp_3',
    ).expect(200);
    plan = (
      await request(app.getHttpServer())
        .get('/v1/billing/plan')
        .set('Authorization', `Bearer ${token}`)
    ).body;
    expect(plan.plan.key).toBe('free');
    expect(plan.status).toBe('ACTIVE');
  });
});
