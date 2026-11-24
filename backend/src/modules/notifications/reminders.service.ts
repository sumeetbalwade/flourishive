import { Injectable } from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { SettingsService } from '../settings/settings.service.js';
import { NotificationRulesService } from './notification-rules.service.js';

/**
 * Reminds the people who can act on something that has waited too long (D-69). A state opts in with
 * `reminderAfterHours`; the hours that count come from the company's `notifications.reminderHours`.
 * Each mark is sent once per wait, never twice.
 */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
    private readonly rules: NotificationRulesService,
  ) {}

  async tick(now = new Date()): Promise<number> {
    const tenants = await runAsSystem(async () =>
      this.prisma.db.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      }),
    );
    let sent = 0;
    for (const t of tenants) sent += await this.forTenant(t.id, now);
    return sent;
  }

  async forTenant(tenantId: string, now: Date): Promise<number> {
    const marks = [
      ...(await this.settings.get('notifications.reminderHours', { tenantId })),
    ].sort((a, b) => a - b);
    if (marks.length === 0) return 0;
    const waiting = await runInTenant(tenantId, async () =>
      this.prisma.db.workflowInstance.findMany({
        where: { subjectType: 'document' },
        include: { definition: true },
      }),
    );
    let sent = 0;
    for (const inst of waiting) {
      const states = (inst.definition.states ?? []) as Array<{
        key: string;
        final?: boolean;
        reminderAfterHours?: number;
      }>;
      const state = states.find((s) => s.key === inst.state);
      if (!state || state.final || !state.reminderAfterHours) continue;
      const hours = (now.getTime() - inst.updatedAt.getTime()) / 3_600_000;
      const mark = [...marks].reverse().find((m) => m <= hours);
      if (!mark) continue;
      const key = `reminder:${inst.id}:${inst.updatedAt.getTime()}:${mark}`;
      if (
        (await this.redis.client.set(key, '1', 'EX', 60 * 86_400, 'NX')) !==
        'OK'
      )
        continue;
      const doc = await runInTenant(tenantId, async () =>
        this.prisma.db.generatedDocument.findUnique({
          where: { id: inst.subjectId },
          select: { reference: true },
        }),
      );
      sent += await this.rules.notify(
        tenantId,
        'approval.reminder',
        {
          subject: `Reminder: ${doc?.reference ?? 'a letter'} is waiting for approval`,
          text: `${doc?.reference ?? 'A letter'} has been waiting for approval for about ${Math.floor(hours)} hours.\n\nOpen Letters to approve it or ask for changes.`,
        },
        { now },
      );
    }
    return sent;
  }
}
