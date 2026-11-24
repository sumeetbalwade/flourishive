import type {
  WebhookBody,
  WebhookCreated,
  WebhookDeliveryView,
  WebhookView,
} from '@flourishive/schemas';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Prisma } from '../../generated/prisma/client.js';
import { CryptoService } from '../../platform/crypto/crypto.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { isPrivateAddress } from '../../platform/mail/net-guard.js';

/** Waits before attempt 2, 3, 4, 5 and 6. After the sixth the delivery is marked failed. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const TIMEOUT_MS = 10_000;

/** The signature header: HMAC-SHA256 over "<timestamp>.<body>", so a captured delivery cannot be replayed later. */
export function sign(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

const asEvents = (v: unknown) =>
  Array.isArray(v) ? (v as WebhookView['events']) : [];

/** Outbound webhooks: subscriptions, signed deliveries, retries with backoff and a delivery log (D-20). */
@Injectable()
export class WebhooksService {
  private readonly log = new Logger('Webhooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // Subscriptions -------------------------------------------------------------------------------

  private async view(
    tenantId: string,
    s: {
      id: string;
      url: string;
      description: string;
      events: unknown;
      active: boolean;
      createdAt: Date;
    },
  ): Promise<WebhookView> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const failed = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookDelivery.count({
        where: {
          subscriptionId: s.id,
          status: 'FAILED',
          createdAt: { gte: since },
        },
      }),
    );
    return {
      id: s.id,
      url: s.url,
      description: s.description,
      events: asEvents(s.events),
      active: s.active,
      createdAt: s.createdAt.toISOString(),
      recentFailures: failed,
    };
  }

  async list(tenantId: string): Promise<WebhookView[]> {
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookSubscription.findMany({
        orderBy: { createdAt: 'desc' },
      }),
    );
    return Promise.all(rows.map((r) => this.view(tenantId, r)));
  }

  async create(
    tenantId: string,
    by: string,
    b: WebhookBody,
  ): Promise<WebhookCreated> {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookSubscription.create({
        data: {
          tenantId,
          url: b.url,
          description: b.description,
          secretEnc: this.crypto.encrypt(secret),
          events: b.events,
          active: b.active,
          createdBy: by,
        },
      }),
    );
    return { ...(await this.view(tenantId, row)), secret };
  }

  async update(
    tenantId: string,
    id: string,
    b: WebhookBody,
  ): Promise<WebhookView> {
    const r = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookSubscription.updateMany({
        where: { id },
        data: {
          url: b.url,
          description: b.description,
          events: b.events,
          active: b.active,
        },
      }),
    );
    if (r.count === 0) throw new NotFoundException();
    return this.view(
      tenantId,
      await runInTenant(tenantId, async () =>
        this.prisma.db.webhookSubscription.findFirstOrThrow({ where: { id } }),
      ),
    );
  }

  async rotate(tenantId: string, id: string): Promise<WebhookCreated> {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const r = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookSubscription.updateMany({
        where: { id },
        data: { secretEnc: this.crypto.encrypt(secret) },
      }),
    );
    if (r.count === 0) throw new NotFoundException();
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookSubscription.findFirstOrThrow({ where: { id } }),
    );
    return { ...(await this.view(tenantId, row)), secret };
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const r = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookSubscription.deleteMany({ where: { id } }),
    );
    if (r.count === 0) throw new NotFoundException();
  }

  async deliveries(
    tenantId: string,
    id: string,
  ): Promise<WebhookDeliveryView[]> {
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookDelivery.findMany({
        where: { subscriptionId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    return rows.map((d) => ({
      id: d.id,
      eventType: d.eventType,
      status: d.status,
      attempts: d.attempts,
      statusCode: d.lastStatusCode,
      error: d.lastError,
      at: (d.deliveredAt ?? d.createdAt).toISOString(),
      nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
    }));
  }

  // Sending -------------------------------------------------------------------------------------

  /** Queues the event for every subscription that wants it and tries each once straight away. */
  async emit(tenantId: string, type: string, data: unknown): Promise<void> {
    try {
      const subs = await runInTenant(tenantId, async () =>
        this.prisma.db.webhookSubscription.findMany({
          where: { active: true },
        }),
      );
      const eventId = randomUUID();
      const payload = {
        id: eventId,
        type,
        createdAt: new Date().toISOString(),
        data,
      };
      for (const s of subs.filter((x) =>
        asEvents(x.events).includes(type as never),
      )) {
        const d = await runInTenant(tenantId, async () =>
          this.prisma.db.webhookDelivery.create({
            data: {
              tenantId,
              subscriptionId: s.id,
              eventId,
              eventType: type,
              payload: payload as Prisma.InputJsonValue,
              nextAttemptAt: new Date(),
            },
          }),
        );
        void this.attempt(d.id).catch(() => undefined);
      }
    } catch (e) {
      // A webhook problem must never break the action that caused it.
      this.log.warn(`Could not queue ${type}: ${(e as Error).message}`);
    }
  }

  /** A signed test event, so a company can check its endpoint. */
  async ping(tenantId: string, id: string): Promise<void> {
    const sub = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookSubscription.findFirst({ where: { id } }),
    );
    if (!sub) throw new NotFoundException();
    const eventId = randomUUID();
    const d = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookDelivery.create({
        data: {
          tenantId,
          subscriptionId: id,
          eventId,
          eventType: 'ping',
          payload: {
            id: eventId,
            type: 'ping',
            createdAt: new Date().toISOString(),
            data: {},
          },
          nextAttemptAt: new Date(),
        },
      }),
    );
    await this.attempt(d.id);
  }

  async resend(tenantId: string, deliveryId: string): Promise<void> {
    const r = await runInTenant(tenantId, async () =>
      this.prisma.db.webhookDelivery.updateMany({
        where: { id: deliveryId },
        data: {
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: null,
        },
      }),
    );
    if (r.count === 0) throw new NotFoundException();
    await this.attempt(deliveryId);
  }

  private async assertPublic(url: URL): Promise<void> {
    if (
      url.protocol === 'http:' &&
      url.hostname === 'localhost' &&
      process.env.NODE_ENV !== 'production'
    )
      return;
    if (url.protocol !== 'https:')
      throw new BadRequestException('Only https addresses are allowed');
    const addrs = await lookup(url.hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address)))
      throw new BadRequestException(
        'That address is not reachable from the public internet',
      );
  }

  /** One attempt. Success marks it delivered; failure schedules the next try or gives up. */
  async attempt(deliveryId: string): Promise<void> {
    const d = await runAsSystem(async () =>
      this.prisma.db.webhookDelivery.findUnique({
        where: { id: deliveryId },
        include: { subscription: true },
      }),
    );
    if (!d || d.status === 'DELIVERED') return;
    const body = JSON.stringify(d.payload);
    let code: number | null = null;
    let error: string | null = null;
    try {
      const url = new URL(d.subscription.url);
      await this.assertPublic(url);
      const ts = Math.floor(Date.now() / 1000);
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Flourishive-Webhooks/1',
          'X-Flourishive-Event': d.eventType,
          'X-Flourishive-Delivery': d.id,
          'X-Flourishive-Signature': sign(
            this.crypto.decrypt(d.subscription.secretEnc),
            ts,
            body,
          ),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      code = res.status;
      if (res.status < 200 || res.status >= 300)
        error = `The endpoint answered ${res.status}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 280);
    }
    const attempts = d.attempts + 1;
    const done = error === null;
    const gaveUp = !done && attempts >= MAX_ATTEMPTS;
    await runAsSystem(async () =>
      this.prisma.db.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts,
          lastStatusCode: code,
          lastError: error,
          status: done ? 'DELIVERED' : gaveUp ? 'FAILED' : 'PENDING',
          deliveredAt: done ? new Date() : null,
          nextAttemptAt:
            done || gaveUp
              ? null
              : new Date(Date.now() + BACKOFF_MINUTES[attempts - 1]! * 60_000),
        },
      }),
    );
  }

  /** Worker: retries whatever is due. Returns how many were tried. */
  async tick(now = new Date()): Promise<number> {
    const due = await runAsSystem(async () =>
      this.prisma.db.webhookDelivery.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: 50,
        select: { id: true },
      }),
    );
    for (const d of due) await this.attempt(d.id).catch(() => undefined);
    return due.length;
  }
}
