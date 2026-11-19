import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry } from '../../platform/queue/job-handlers.js';
import { JobRecordsService } from '../../platform/queue/job-records.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  TEMPLATES,
  type NotificationEvent,
  type TemplateVars,
} from './templates.js';

export const SEND_JOB = 'notification.send';

/**
 * Email notifications per event. Every one is recorded, so HR can see what was sent
 * and what failed. Time-critical mail (password links) is sent inline; bulk or
 * deferrable mail goes through the queue and the cron-started worker.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly jobs: JobRecordsService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(SEND_JOB, async (p) => {
      await this.deliver(String(p.tenantId), String(p.notificationId));
    });
  }

  private async create<E extends NotificationEvent>(
    tenantId: string,
    event: E,
    toEmail: string,
    vars: TemplateVars<E>,
  ) {
    const email = (
      TEMPLATES[event] as (v: TemplateVars<E>) => {
        subject: string;
        text: string;
      }
    )(vars);
    return runInTenant(tenantId, async () =>
      this.prisma.db.notification.create({
        data: {
          tenantId,
          event,
          toEmail,
          subject: email.subject,
          body: email.text,
        },
      }),
    );
  }

  /** Sends now. A failure is recorded and also thrown so the caller knows. */
  async sendNow<E extends NotificationEvent>(
    tenantId: string,
    event: E,
    toEmail: string,
    vars: TemplateVars<E>,
  ): Promise<string> {
    const n = await this.create(tenantId, event, toEmail, vars);
    await this.deliver(tenantId, n.id);
    return n.id;
  }

  /** Queues for the worker; survives a Redis restart through job_records. */
  async enqueue<E extends NotificationEvent>(
    tenantId: string,
    event: E,
    toEmail: string,
    vars: TemplateVars<E>,
  ): Promise<string> {
    const n = await this.create(tenantId, event, toEmail, vars);
    await this.jobs.enqueue(tenantId, SEND_JOB, { notificationId: n.id });
    return n.id;
  }

  async deliver(tenantId: string, notificationId: string): Promise<void> {
    const n = await runInTenant(
      tenantId,
      async () =>
        await this.prisma.db.notification.findUnique({
          where: { id: notificationId },
        }),
    );
    if (!n || n.status === 'SENT') return;
    try {
      const fromName = await this.settings.get('branding.emailSenderName', {
        tenantId,
      });
      await this.mail.send({
        to: n.toEmail,
        subject: n.subject,
        text: n.body,
        fromName,
      });
      await runInTenant(tenantId, async () => {
        await this.prisma.db.notification.update({
          where: { id: n.id },
          data: { status: 'SENT', sentAt: new Date(), error: null },
        });
      });
    } catch (e) {
      await runInTenant(tenantId, async () => {
        await this.prisma.db.notification.update({
          where: { id: n.id },
          data: {
            status: 'FAILED',
            error: String((e as Error).message).slice(0, 500),
          },
        });
      });
      throw e;
    }
  }

  list(tenantId: string, take = 50) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          event: true,
          toEmail: true,
          subject: true,
          status: true,
          error: true,
          sentAt: true,
          createdAt: true,
        },
      }),
    );
  }
}
