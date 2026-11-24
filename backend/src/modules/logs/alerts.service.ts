import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ALERT_INFO,
  alertEvents,
  type AlertDelivery,
  type AlertEvent,
  type AlertSubscriptionsResponse,
  type SaveAlertsBody,
} from '@flourishive/schemas';
import { statfs } from 'node:fs/promises';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import {
  buildDnsReport,
  type DnsReport,
} from '../../platform/mail/dns-report.js';
import { SettingsService } from '../settings/settings.service.js';

export type Subscriber =
  | { type: 'PLATFORM_USER'; id: string; tenantId: null }
  | { type: 'USER'; id: string; tenantId: string };

/** Something wrong right now: one event for one company (or the whole server). */
export interface Condition {
  event: AlertEvent;
  tenantId: string | null;
  /** One plain sentence for the email. */
  summary: string;
}

const TEN_MIN = 10 * 60_000;
/** Never more than one instant alert per event and place each hour (D-68). */
const DEDUP_SECONDS = 3600;
const DEFAULT_ZONE = 'Asia/Kolkata';

/** The hour (0 to 23) and calendar day in a time zone, so "08:00" means the subscriber's 08:00. */
export function localClock(
  now: Date,
  zone: string,
): { hour: number; day: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    }).formatToParts(now);
  } catch {
    return localClock(now, DEFAULT_ZONE);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    hour: Number(get('hour')),
    day: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

@Injectable()
export class AlertsService {
  private readonly log = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  // ------------------------------------------------------------ subscriptions

  async list(who: Subscriber): Promise<AlertSubscriptionsResponse> {
    const rows = await runAsSystem(
      async () =>
        await this.db.alertSubscription.findMany({
          where: { subscriberType: who.type, subscriberId: who.id },
        }),
    );
    const mine = new Map(rows.map((r) => [r.event, r.delivery]));
    return {
      items: alertEvents
        .filter((e) => who.type === 'PLATFORM_USER' || ALERT_INFO[e].tenant)
        .map((event) => ({
          event,
          label: ALERT_INFO[event].label,
          hint: ALERT_INFO[event].hint,
          delivery: mine.get(event) ?? 'OFF',
        })),
    };
  }

  async save(
    who: Subscriber,
    body: SaveAlertsBody,
  ): Promise<AlertSubscriptionsResponse> {
    for (const i of body.items)
      if (who.type === 'USER' && !ALERT_INFO[i.event].tenant)
        throw new BadRequestException(
          `${ALERT_INFO[i.event].label} is only for platform staff`,
        );
    await runAsSystem(async () => {
      for (const i of body.items) {
        // Opt-in: OFF is simply no row.
        if (i.delivery === 'OFF')
          await this.db.alertSubscription.deleteMany({
            where: {
              subscriberType: who.type,
              subscriberId: who.id,
              event: i.event,
            },
          });
        else
          await this.db.alertSubscription.upsert({
            where: {
              subscriberType_subscriberId_event: {
                subscriberType: who.type,
                subscriberId: who.id,
                event: i.event,
              },
            },
            update: { delivery: i.delivery, tenantId: who.tenantId },
            create: {
              subscriberType: who.type,
              subscriberId: who.id,
              tenantId: who.tenantId,
              event: i.event,
              delivery: i.delivery,
            },
          });
      }
    });
    return this.list(who);
  }

  // --------------------------------------------------------------- detection

  private async thresholds() {
    const [errors, jobs, mail, signins, disk] = await Promise.all([
      this.settings.getPlatform('alerts.errorSpikeCount'),
      this.settings.getPlatform('alerts.jobFailureCount'),
      this.settings.getPlatform('alerts.mailFailureCount'),
      this.settings.getPlatform('alerts.signinFailureCount'),
      this.settings.getPlatform('alerts.diskFreePercent'),
    ]);
    return { errors, jobs, mail, signins, disk };
  }

  private async tenantNames(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = await runAsSystem(
      async () =>
        await this.db.tenant.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true },
        }),
    );
    return new Map(rows.map((t) => [t.id, t.name]));
  }

  /** Free space on the disk holding the app, as a percentage. */
  async diskFreePercent(path = '/'): Promise<number | null> {
    try {
      const s = await statfs(path);
      return s.blocks === 0 ? null : (s.bavail / s.blocks) * 100;
    } catch {
      return null;
    }
  }

  /** What is wrong right now, from the last few minutes of logs. */
  async detect(now = new Date()): Promise<Condition[]> {
    const t = await this.thresholds();
    const since = new Date(now.getTime() - TEN_MIN);
    const jobsSince = new Date(now.getTime() - 3 * TEN_MIN);
    const out: Condition[] = [];
    const rows = await runAsSystem(async () => ({
      errors: await this.db.logRequest.groupBy({
        by: ['tenantId'],
        where: { status: { gte: 500 }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      mail: await this.db.mailDelivery.groupBy({
        by: ['tenantId'],
        where: { status: 'FAILED', createdAt: { gte: since } },
        _count: { _all: true },
      }),
      jobs: await this.db.jobRecord.groupBy({
        by: ['tenantId'],
        where: { status: 'FAILED', updatedAt: { gte: jobsSince } },
        _count: { _all: true },
      }),
      signins: await this.db.logSignin.groupBy({
        by: ['tenantId'],
        where: {
          outcome: { in: ['BAD_PASSWORD', 'LOCKED', 'MFA_FAILED'] },
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
    }));
    const names = await this.tenantNames([
      ...rows.errors.map((r) => r.tenantId),
      ...rows.mail.map((r) => r.tenantId),
      ...rows.jobs.map((r) => r.tenantId),
      ...rows.signins.map((r) => r.tenantId),
    ]);
    const where = (id: string | null) =>
      id ? `for ${names.get(id) ?? 'one company'}` : 'on the server';
    const add = (
      event: AlertEvent,
      list: Array<{ tenantId: string | null; _count: { _all: number } }>,
      limit: number,
      say: (n: number, where: string) => string,
    ) => {
      for (const r of list)
        if (r._count._all >= limit)
          out.push({
            event,
            tenantId: r.tenantId,
            summary: say(r._count._all, where(r.tenantId)),
          });
    };
    add(
      'ERROR_SPIKE',
      rows.errors,
      t.errors,
      (n, w) =>
        `${n} requests failed with a server error in the last 10 minutes ${w}.`,
    );
    add(
      'MAIL_FAILING',
      rows.mail,
      t.mail,
      (n, w) =>
        `${n} emails failed to send in the last 10 minutes ${w}. Check the email sender and the delivery log.`,
    );
    add(
      'JOB_FAILING',
      rows.jobs,
      t.jobs,
      (n, w) => `${n} background jobs failed in the last 30 minutes ${w}.`,
    );
    add(
      'SIGNIN_ATTACK',
      rows.signins,
      t.signins,
      (n, w) =>
        `${n} failed sign-in attempts in the last 10 minutes ${w}. Someone may be guessing passwords.`,
    );
    const free = await this.diskFreePercent();
    if (free !== null && free < t.disk)
      out.push({
        event: 'DISK_LOW',
        tenantId: null,
        summary: `The server disk has ${free.toFixed(0)}% free space left.`,
      });
    return out;
  }

  /** Re-checks each active company sender's DNS once a day and raises an alert when a pass turned into a warning. */
  async checkSenderDns(now = new Date()): Promise<Condition[]> {
    const out: Condition[] = [];
    const senders = await runAsSystem(
      async () =>
        await this.db.mailSender.findMany({
          where: { status: 'ACTIVE', kind: { not: 'PLATFORM_DEFAULT' } },
        }),
    );
    for (const s of senders) {
      const key = `alert:dns:${s.id}:${now.toISOString().slice(0, 10)}`;
      if ((await this.redis.client.set(key, '1', 'EX', 86_400, 'NX')) !== 'OK')
        continue;
      const domain = s.fromAddress.split('@')[1];
      if (!domain) continue;
      const previous = (s.dnsReport as DnsReport | null) ?? null;
      const report = await buildDnsReport(domain, {
        smtpHost: s.smtpHost,
      }).catch(() => null);
      if (!report) continue;
      await runAsSystem(
        async () =>
          await this.db.mailSender.update({
            where: { id: s.id },
            data: { dnsReport: report as never },
          }),
      );
      const broke = report.checks.filter(
        (c) =>
          c.state === 'warn' &&
          previous?.checks.find((p) => p.name === c.name)?.state === 'pass',
      );
      if (s.tenantId && broke.length)
        out.push({
          event: 'SENDER_DNS_BROKEN',
          tenantId: s.tenantId,
          summary: `${domain} no longer passes ${broke.map((b) => b.name).join(', ')}. Mail from this address may land in spam.`,
        });
    }
    return out;
  }

  // ---------------------------------------------------------------- sending

  private async recipients(
    event: AlertEvent,
    delivery: AlertDelivery,
    tenantId: string | null,
  ): Promise<string[]> {
    const subs = await runAsSystem(
      async () =>
        await this.db.alertSubscription.findMany({
          where: {
            event,
            delivery,
            // A company's people only hear about their own company; platform staff hear about all.
            OR: [{ tenantId: null }, ...(tenantId ? [{ tenantId }] : [])],
          },
        }),
    );
    const emails: string[] = [];
    for (const s of subs) {
      const email = await runAsSystem(async () =>
        s.subscriberType === 'PLATFORM_USER'
          ? (
              await this.db.platformUser.findFirst({
                where: { id: s.subscriberId, status: 'ACTIVE' },
                select: { email: true },
              })
            )?.email
          : (
              await this.db.user.findFirst({
                where: {
                  id: s.subscriberId,
                  tenantId: s.tenantId!,
                  status: 'ACTIVE',
                },
                select: { email: true },
              })
            )?.email,
      );
      if (email) emails.push(email);
    }
    return emails;
  }

  /** Sends one instant alert, at most once per event and place per hour. Returns whether it went out. */
  async raise(c: Condition): Promise<boolean> {
    const key = `alert:sent:${c.event}:${c.tenantId ?? 'all'}`;
    const to = await this.recipients(c.event, 'INSTANT', c.tenantId);
    if (to.length === 0) return false;
    if (
      (await this.redis.client.set(key, '1', 'EX', DEDUP_SECONDS, 'NX')) !==
      'OK'
    )
      return false;
    const info = ALERT_INFO[c.event];
    try {
      await this.mail.send({
        event: 'alert.instant',
        to,
        subject: `Alert: ${info.label}`,
        text: `${c.summary}\n\n${info.hint}.\n\nYou get this because you chose instant alerts for “${info.label}”. You will not get it again for an hour, even if it keeps happening. Change this under My account, Alerts.`,
        useDefault: true,
      });
      return true;
    } catch (e) {
      this.log.warn(
        `Could not send alert ${c.event}: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Allow another attempt on the next tick.
      await this.redis.client.del(key);
      return false;
    }
  }

  /** Run every minute by the worker. */
  async tick(now = new Date()): Promise<{ raised: number; digests: number }> {
    let raised = 0;
    for (const c of [
      ...(await this.detect(now)),
      ...(await this.checkSenderDns(now)),
    ])
      if (await this.raise(c)) raised++;
    return { raised, digests: await this.sendDigests(now) };
  }

  // ----------------------------------------------------------------- digest

  /** The subscriber's time zone: their company's, or India for platform staff. */
  private async zoneFor(tenantId: string | null): Promise<string> {
    try {
      return tenantId
        ? await this.settings.get('region.timeZone', { tenantId })
        : DEFAULT_ZONE;
    } catch {
      return DEFAULT_ZONE;
    }
  }

  /** Sends each digest subscriber one summary after 08:00 their time, once a day. */
  async sendDigests(now = new Date()): Promise<number> {
    const subs = await runAsSystem(
      async () =>
        await this.db.alertSubscription.findMany({
          where: { delivery: 'DIGEST' },
        }),
    );
    const bySubscriber = new Map<string, typeof subs>();
    for (const s of subs) {
      const k = `${s.subscriberType}:${s.subscriberId}`;
      bySubscriber.set(k, [...(bySubscriber.get(k) ?? []), s]);
    }
    let sent = 0;
    for (const [k, list] of bySubscriber) {
      const first = list[0]!;
      const { hour, day } = localClock(now, await this.zoneFor(first.tenantId));
      if (hour < 8) continue;
      const key = `alert:digest:${k}:${day}`;
      if ((await this.redis.client.set(key, '1', 'EX', 172_800, 'NX')) !== 'OK')
        continue;
      const lines = await this.digestLines(
        list.map((s) => s.event),
        first.tenantId,
        now,
      );
      const email = await this.addressOf(first);
      if (!email) continue;
      try {
        await this.mail.send({
          event: 'alert.digest',
          to: email,
          subject: 'Your daily summary',
          text: `Here is the last 24 hours.\n\n${lines.join('\n')}\n\nChange what you get under My account, Alerts.`,
          useDefault: true,
        });
        sent++;
      } catch {
        await this.redis.client.del(key);
      }
    }
    return sent;
  }

  private async addressOf(s: {
    subscriberType: string;
    subscriberId: string;
    tenantId: string | null;
  }): Promise<string | null> {
    return (
      (await runAsSystem(async () =>
        s.subscriberType === 'PLATFORM_USER'
          ? (
              await this.db.platformUser.findFirst({
                where: { id: s.subscriberId, status: 'ACTIVE' },
                select: { email: true },
              })
            )?.email
          : (
              await this.db.user.findFirst({
                where: {
                  id: s.subscriberId,
                  tenantId: s.tenantId!,
                  status: 'ACTIVE',
                },
                select: { email: true },
              })
            )?.email,
      )) ?? null
    );
  }

  async digestLines(
    events: AlertEvent[],
    tenantId: string | null,
    now = new Date(),
  ): Promise<string[]> {
    const since = new Date(now.getTime() - 86_400_000);
    const pin = tenantId ? { tenantId } : {};
    const lines: string[] = [];
    await runAsSystem(async () => {
      for (const e of events) {
        let n = 0;
        if (e === 'ERROR_SPIKE')
          n = await this.db.logRequest.count({
            where: { status: { gte: 500 }, createdAt: { gte: since }, ...pin },
          });
        else if (e === 'MAIL_FAILING')
          n = await this.db.mailDelivery.count({
            where: { status: 'FAILED', createdAt: { gte: since }, ...pin },
          });
        else if (e === 'JOB_FAILING')
          n = await this.db.jobRecord.count({
            where: { status: 'FAILED', updatedAt: { gte: since }, ...pin },
          });
        else if (e === 'SIGNIN_ATTACK')
          n = await this.db.logSignin.count({
            where: {
              outcome: { in: ['BAD_PASSWORD', 'LOCKED', 'MFA_FAILED'] },
              createdAt: { gte: since },
              ...pin,
            },
          });
        else continue;
        const what: Record<string, string> = {
          ERROR_SPIKE: 'requests failed with a server error',
          MAIL_FAILING: 'emails failed to send',
          JOB_FAILING: 'background jobs failed',
          SIGNIN_ATTACK: 'failed sign-in attempts',
        };
        lines.push(`- ${n} ${what[e]}`);
      }
    });
    return lines.length ? lines : ['- Nothing to report.'];
  }
}
