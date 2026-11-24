import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { EmailTemplatesService } from '../notifications/email-templates.service.js';
import { InvoiceService } from './invoice.service.js';
import { LimitsService } from './limits.service.js';

const DAY = 86_400_000;
const REMIND_EVERY_DAYS = 2;

/**
 * What happens when a payment keeps failing (D-21): reminders during the grace period, then
 * read-only mode, then suspension. A successful payment undoes all of it (see CheckoutService).
 * Run by the worker every minute; each step is guarded so it happens once.
 */
@Injectable()
export class DunningService {
  private readonly log = new Logger('Dunning');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfigService,
    private readonly invoices: InvoiceService,
    private readonly limits: LimitsService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly templates: EmailTemplatesService,
  ) {}

  async tick(now = new Date()): Promise<number> {
    // Cheap guard: the worker runs every minute, the work only needs doing a few times an hour.
    const gate = `billing:dunning:${now.toISOString().slice(0, 15)}`;
    if ((await this.redis.client.set(gate, '1', 'EX', 700, 'NX')) !== 'OK')
      return 0;
    const [grace, suspend] = await Promise.all([
      this.runtime.get('BILLING_GRACE_DAYS'),
      this.runtime.get('BILLING_SUSPEND_DAYS'),
    ]);
    const rows = await runAsSystem(async () =>
      this.prisma.db.subscription.findMany({
        where: { status: { in: ['PAST_DUE', 'READ_ONLY'] } },
        include: { tenant: true },
      }),
    );
    let acted = 0;
    for (const s of rows) {
      const since = s.pastDueSince ?? now;
      const days = (now.getTime() - since.getTime()) / DAY;
      if (!s.pastDueSince) await this.update(s.id, { pastDueSince: now });
      if (days >= (suspend ?? 30)) {
        await this.suspend(s.id, s.tenantId);
        acted++;
      } else if (s.status === 'PAST_DUE' && days >= (grace ?? 7)) {
        await this.update(s.id, { status: 'READ_ONLY' });
        await this.limits.clear(s.tenantId);
        await this.tell('billing.read_only', s.tenantId, {});
        acted++;
      } else if (
        s.status === 'PAST_DUE' &&
        (!s.lastReminderAt ||
          now.getTime() - s.lastReminderAt.getTime() >= REMIND_EVERY_DAYS * DAY)
      ) {
        const ends = new Date(since.getTime() + (grace ?? 7) * DAY);
        await this.update(s.id, {
          lastReminderAt: now,
          reminderCount: { increment: 1 },
        });
        await this.tell('billing.payment_failed', s.tenantId, {
          date: ends.toDateString(),
        });
        acted++;
      }
    }
    return acted;
  }

  private update(id: string, data: Record<string, unknown>) {
    return runAsSystem(async () =>
      this.prisma.db.subscription.update({ where: { id }, data }),
    );
  }

  private async suspend(id: string, tenantId: string): Promise<void> {
    await this.update(id, { status: 'SUSPENDED' });
    await runAsSystem(async () =>
      this.prisma.db.tenant.update({
        where: { id: tenantId },
        data: { status: 'SUSPENDED' },
      }),
    );
    await this.redis.client.set(`tenant:suspended:${tenantId}`, '1');
    await this.limits.clear(tenantId);
    await this.tell('billing.suspended', tenantId, {});
  }

  private async tell(
    event: string,
    tenantId: string,
    vars: Record<string, string>,
  ): Promise<void> {
    try {
      const to = await this.invoices.billingEmail(tenantId);
      if (!to) return;
      const tenant = await runAsSystem(async () =>
        this.prisma.db.tenant.findUnique({ where: { id: tenantId } }),
      );
      await this.mail.send({
        event,
        to,
        useDefault: true,
        ...(await this.templates.render(event, null, {
          company: tenant?.name ?? '',
          link: `${(await this.runtime.get('WEB_URL')) ?? ''}/#/app/plan`,
          ...vars,
        })),
      });
    } catch (e) {
      this.log.warn(`Could not send ${event}: ${(e as Error).message}`);
    }
  }
}
