import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createTransport, type Transporter } from 'nodemailer';
import { currentRequestId } from '../http/request-id.js';
import { RedisService } from '../cache/redis.service.js';
import { RuntimeConfigService } from '../config/runtime-config.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { currentScope, runAsSystem } from '../database/tenant-context.js';
import { JobHandlerRegistry } from '../queue/job-handlers.js';
import { QueueService } from '../queue/queue.service.js';
import { explainMailError, maskAddress } from './mail-errors.js';
import { resolvePublicSmtpHost } from './net-guard.js';

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  /** Display name for the From header (the tenant's branding.emailSenderName). */
  fromName?: string;
  /** Whose mail this is. Defaults to the company in scope, if any. Picks the company's own sender. */
  tenantId?: string;
  /** What this mail is for ("auth.otp", "invite", ...). Shown in the delivery log. */
  event?: string;
  /** Always use the platform's default sender (the code that proves a sender address is theirs). */
  useDefault?: boolean;
}

/** The parts of a company's sender that sending needs. */
export interface SenderRow {
  id: string;
  kind: 'PLATFORM_DEFAULT' | 'VERIFIED_FROM' | 'OWN_SMTP';
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPassEnc: string | null;
  updatedAt: Date;
}

const RETRY_JOB = 'mail.retry';
const RETRY_KEEP_SECONDS = 3600;
const retryKey = (id: string) => `mail:retry:${id}`;

interface Stash {
  message: MailMessage;
  senderId?: string;
}

/**
 * Transactional email (D-17, D-58, D-60). Mail leaves through the company's own sender when it has an
 * ACTIVE one, else through the platform's default. Every attempt is logged (address masked, never the
 * message); a failure is retried by the queue worker and is visible in the delivery log.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly log = new Logger(MailService.name);
  private transport?: { signature: string; transporter: Transporter };
  private readonly own = new Map<string, Transporter>();

  constructor(
    private readonly runtime: RuntimeConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(RETRY_JOB, async (p) => {
      await this.retry(String(p.deliveryId));
    });
  }

  private async platformTransporter(): Promise<Transporter> {
    const [host, port, secure, user, pass] = await Promise.all([
      this.runtime.get('SMTP_HOST'),
      this.runtime.get('SMTP_PORT'),
      this.runtime.get('SMTP_SECURE'),
      this.runtime.get('SMTP_USER'),
      this.runtime.get('SMTP_PASS'),
    ]);
    const signature = JSON.stringify([host, port, secure, user, pass]);
    if (this.transport?.signature !== signature) {
      this.transport = {
        signature,
        transporter: createTransport({
          host,
          port,
          secure,
          auth: user ? { user, pass } : undefined,
        }),
      };
    }
    return this.transport.transporter;
  }

  /** A company's own mail server. The host is checked, then we connect to the address we checked. */
  async ownTransporter(
    s: Pick<
      SenderRow,
      | 'id'
      | 'updatedAt'
      | 'smtpHost'
      | 'smtpPort'
      | 'smtpSecure'
      | 'smtpUser'
      | 'smtpPassEnc'
    >,
  ): Promise<Transporter> {
    const key = `${s.id}:${s.updatedAt.getTime()}`;
    const cached = this.own.get(key);
    if (cached) return cached;
    const host = s.smtpHost ?? '';
    const port = s.smtpPort ?? 587;
    const ip = await resolvePublicSmtpHost(host, port);
    const t = createTransport({
      host: ip,
      port,
      secure: s.smtpSecure,
      requireTLS: !s.smtpSecure && port !== 25,
      tls: { servername: host },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: s.smtpUser
        ? {
            user: s.smtpUser,
            pass: s.smtpPassEnc ? this.crypto.decrypt(s.smtpPassEnc) : '',
          }
        : undefined,
    });
    for (const k of this.own.keys())
      if (k.startsWith(`${s.id}:`)) this.own.delete(k);
    this.own.set(key, t);
    return t;
  }

  /** The From address of the platform default always comes from settings; only the display name can vary. */
  private async defaultFrom(fromName?: string): Promise<string> {
    const configured = (await this.runtime.get('MAIL_FROM')) ?? '';
    if (!fromName) return configured;
    const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured;
    const name = fromName.replace(/["<>\r\n]/g, '').trim();
    return name ? `"${name}" <${address}>` : configured;
  }

  private async activeSender(tenantId: string): Promise<SenderRow | null> {
    return runAsSystem(
      async () =>
        await this.prisma.db.mailSender.findFirst({
          where: {
            tenantId,
            status: 'ACTIVE',
            kind: { not: 'PLATFORM_DEFAULT' },
          },
        }),
    );
  }

  /** Sends through a given sender (or the default when null). No logging: callers do that. */
  async deliver(
    message: MailMessage,
    sender: SenderRow | null,
  ): Promise<string | undefined> {
    const {
      fromName,
      tenantId: _t,
      event: _e,
      useDefault: _u,
      ...rest
    } = message;
    let transporter: Transporter;
    let from: string;
    let replyTo: string | undefined;
    if (!sender) {
      transporter = await this.platformTransporter();
      from = await this.defaultFrom(fromName);
    } else {
      transporter =
        sender.kind === 'OWN_SMTP'
          ? await this.ownTransporter(sender)
          : await this.platformTransporter();
      const name = sender.fromName.replace(/["<>\r\n]/g, '').trim();
      from = name ? `"${name}" <${sender.fromAddress}>` : sender.fromAddress;
      replyTo = sender.replyTo ?? undefined;
    }
    const info = (await transporter.sendMail({
      from,
      ...(replyTo ? { replyTo } : {}),
      ...rest,
    })) as { messageId?: string };
    return info.messageId;
  }

  private static firstTo(to: string | string[]) {
    const list = Array.isArray(to) ? to : [to];
    return { first: list[0] ?? '', extra: list.length - 1 };
  }

  async send(message: MailMessage): Promise<void> {
    const scope = currentScope();
    const tenantId =
      message.tenantId ??
      (scope?.kind === 'tenant' ? scope.tenantId : undefined);
    const sender =
      tenantId && !message.useDefault
        ? await this.activeSender(tenantId)
        : null;
    await this.sendAndLog(message, sender, tenantId);
  }

  /** Sends through a specific sender and logs it (the sender's test send). */
  async sendVia(
    sender: SenderRow,
    message: MailMessage,
    tenantId: string,
  ): Promise<void> {
    await this.sendAndLog(message, sender, tenantId);
  }

  private async sendAndLog(
    message: MailMessage,
    sender: SenderRow | null,
    tenantId: string | undefined,
  ): Promise<void> {
    const { first, extra } = MailService.firstTo(message.to);
    const id = await this.record(message, first, extra, sender, tenantId);
    try {
      const providerId = await this.deliver(message, sender);
      await this.mark(id, {
        status: 'SENT',
        attempts: 1,
        sentAt: new Date(),
        providerMessageId: providerId?.slice(0, 255) ?? null,
        error: null,
      });
    } catch (err) {
      await this.mark(id, {
        status: 'FAILED',
        attempts: 1,
        error: explainMailError(err),
      });
      await this.scheduleRetry(id, tenantId, { message, senderId: sender?.id });
      throw err;
    }
  }

  private async record(
    message: MailMessage,
    first: string,
    extra: number,
    sender: SenderRow | null,
    tenantId: string | undefined,
  ): Promise<string | null> {
    try {
      const row = await runAsSystem(
        async () =>
          await this.prisma.db.mailDelivery.create({
            data: {
              tenantId: tenantId ?? null,
              event: (message.event ?? 'other').slice(0, 60),
              toMasked: maskAddress(first) + (extra > 0 ? ` (+${extra})` : ''),
              toHash: createHash('sha256')
                .update(first.trim().toLowerCase())
                .digest('hex'),
              senderId: sender?.id ?? null,
              requestId: currentRequestId()?.slice(0, 64) ?? null,
            },
          }),
      );
      return row.id;
    } catch (e) {
      // The log must never stop mail from going out.
      this.log.warn(`could not log a delivery: ${String(e)}`);
      return null;
    }
  }

  private async mark(
    id: string | null,
    data: {
      status: 'SENT' | 'FAILED';
      attempts: number;
      error?: string | null;
      sentAt?: Date;
      providerMessageId?: string | null;
    },
  ): Promise<void> {
    if (!id) return;
    try {
      await runAsSystem(
        async () =>
          await this.prisma.db.mailDelivery.update({ where: { id }, data }),
      );
    } catch (e) {
      this.log.warn(`could not update a delivery: ${String(e)}`);
    }
  }

  private async scheduleRetry(
    id: string | null,
    tenantId: string | undefined,
    stash: Stash,
  ): Promise<void> {
    if (!id) return;
    try {
      await this.redis.setJson(retryKey(id), stash, RETRY_KEEP_SECONDS);
      // Three more tries with backoff (D-60). The job dispatcher wants a tenant id, so platform mail uses "platform".
      await this.queue.enqueue(
        RETRY_JOB,
        { tenantId: tenantId ?? 'platform', deliveryId: id },
        { attempts: 3, jobId: `mail-retry-${id}` },
      );
    } catch (e) {
      this.log.warn(`could not schedule a mail retry: ${String(e)}`);
    }
  }

  private async senderById(id: string | undefined): Promise<SenderRow | null> {
    if (!id) return null;
    return runAsSystem(
      async () => await this.prisma.db.mailSender.findUnique({ where: { id } }),
    );
  }

  /**
   * Tries a failed delivery again from the copy held for an hour. Used by the queue worker and by
   * Resend. Returns false when the copy is gone (the person has to repeat the action that sent it).
   */
  async retry(deliveryId: string): Promise<boolean> {
    const stash = await this.redis.getJson<Stash>(retryKey(deliveryId));
    if (!stash) return false;
    const row = await runAsSystem(
      async () =>
        await this.prisma.db.mailDelivery.findUnique({
          where: { id: deliveryId },
        }),
    );
    if (!row || row.status === 'SENT') return false;
    // A sender that was switched off since then no longer applies: fall back to the default.
    const sender = await this.senderById(stash.senderId);
    const usable = sender && sender.kind !== 'PLATFORM_DEFAULT' ? sender : null;
    try {
      const providerId = await this.deliver(stash.message, usable);
      await this.mark(deliveryId, {
        status: 'SENT',
        attempts: row.attempts + 1,
        sentAt: new Date(),
        providerMessageId: providerId?.slice(0, 255) ?? null,
        error: null,
      });
      await this.redis.del(retryKey(deliveryId));
      return true;
    } catch (err) {
      await this.mark(deliveryId, {
        status: 'FAILED',
        attempts: row.attempts + 1,
        error: explainMailError(err),
      });
      throw err;
    }
  }

  /** Is a copy still held for this delivery (so Resend can work)? */
  async canResend(deliveryId: string): Promise<boolean> {
    return (await this.redis.client.exists(retryKey(deliveryId))) === 1;
  }

  /** Connects and says hello without sending anything (used by the console's Test button). */
  async verifyConnection(): Promise<void> {
    await (await this.platformTransporter()).verify();
  }
}
