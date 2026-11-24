import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { SettingsService } from '../settings/settings.service.js';
import { NotificationsService } from './notifications.service.js';
import { quietDelayMs, RULE_EVENTS, SUBJECT } from './notification-rules.js';

export interface RuleCell {
  event: string;
  roleKey: string;
  channel: 'EMAIL' | 'IN_APP';
  enabled: boolean;
}

/** Which roles are told about which events, and when mail that can wait goes out (D-69). */
@Injectable()
export class NotificationRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  private rows(tenantId: string) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.notificationRule.findMany(),
    );
  }

  /** Every event by every role, with the built-in default where the company has not chosen. */
  async matrix(tenantId: string) {
    const [rows, roles] = await Promise.all([
      this.rows(tenantId),
      runInTenant(tenantId, async () =>
        this.prisma.db.role.findMany({ orderBy: { name: 'asc' } }),
      ),
    ]);
    const chosen = new Map(
      rows.map((r) => [`${r.event}|${r.roleKey}|${r.channel}`, r.enabled]),
    );
    const roleList = roles.map((r) => ({ key: r.key, name: r.name }));
    return {
      events: RULE_EVENTS.map((e) => ({
        key: e.key,
        label: e.label,
        description: e.description,
        subject: e.subject,
      })),
      roles: roleList,
      cells: RULE_EVENTS.flatMap((e) =>
        [...roleList.map((r) => r.key), ...(e.subject ? [SUBJECT] : [])].map(
          (roleKey) => ({
            event: e.key,
            roleKey,
            channel: 'EMAIL' as const,
            enabled:
              chosen.get(`${e.key}|${roleKey}|EMAIL`) ??
              e.defaultRoles.includes(roleKey),
          }),
        ),
      ),
    };
  }

  async save(tenantId: string, userId: string, cells: RuleCell[]) {
    const known = new Set(RULE_EVENTS.map((e) => e.key));
    await runInTenant(tenantId, async () => {
      for (const c of cells) {
        if (!known.has(c.event)) continue;
        await this.prisma.db.notificationRule.upsert({
          where: {
            tenantId_event_roleKey_channel: {
              tenantId,
              event: c.event,
              roleKey: c.roleKey,
              channel: c.channel,
            },
          },
          update: { enabled: c.enabled, updatedBy: userId },
          create: {
            tenantId,
            event: c.event,
            roleKey: c.roleKey,
            channel: c.channel,
            enabled: c.enabled,
            updatedBy: userId,
          },
        });
      }
    });
    return this.matrix(tenantId);
  }

  /** The addresses an event goes to, by the company's rules. */
  async recipients(
    tenantId: string,
    event: string,
    subjectEmail?: string | null,
  ): Promise<string[]> {
    const def = RULE_EVENTS.find((e) => e.key === event);
    if (!def) return [];
    const m = await this.matrix(tenantId);
    const on = m.cells.filter(
      (c) => c.event === event && c.channel === 'EMAIL' && c.enabled,
    );
    const emails = new Set<string>();
    const roleKeys = on
      .filter((c) => c.roleKey !== SUBJECT)
      .map((c) => c.roleKey);
    if (roleKeys.length) {
      const users = await runInTenant(tenantId, async () =>
        this.prisma.db.user.findMany({
          where: {
            status: 'ACTIVE',
            userRoles: { some: { role: { key: { in: roleKeys } } } },
          },
          select: { email: true },
        }),
      );
      for (const u of users) emails.add(u.email);
    }
    if (subjectEmail && on.some((c) => c.roleKey === SUBJECT))
      emails.add(subjectEmail);
    return [...emails];
  }

  /**
   * Tells the people the rules choose. The mail can wait, so quiet hours hold it until they end.
   * Never throws: a missed notice must not undo the action that caused it.
   */
  async notify(
    tenantId: string,
    event: string,
    message: { subject: string; text: string },
    opts: { subjectEmail?: string | null; now?: Date } = {},
  ): Promise<number> {
    try {
      const to = await this.recipients(tenantId, event, opts.subjectEmail);
      if (to.length === 0) return 0;
      const [zone, quiet] = await Promise.all([
        this.settings.get('region.timeZone', { tenantId }),
        this.settings.get('notifications.quietHours', { tenantId }),
      ]);
      const delayMs = quietDelayMs(opts.now ?? new Date(), zone, quiet);
      for (const email of to)
        await this.notifications.enqueue(
          tenantId,
          'general.notice',
          email,
          message,
          {
            delayMs,
          },
        );
      return to.length;
    } catch {
      return 0;
    }
  }
}
