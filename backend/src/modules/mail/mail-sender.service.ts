import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  DnsReportView,
  SaveSenderBody,
  SenderState,
  SenderView,
} from '@flourishive/schemas';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { CryptoService } from '../../platform/crypto/crypto.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { explainMailError } from '../../platform/mail/mail-errors.js';
import { buildDnsReport } from '../../platform/mail/dns-report.js';
import {
  MailService,
  type SenderRow,
} from '../../platform/mail/mail.service.js';
import { resolvePublicSmtpHost } from '../../platform/mail/net-guard.js';
import { OtpService } from '../identity/otp.service.js';
import { EmailTemplatesService } from '../notifications/email-templates.service.js';
import { ThrottleService } from '../identity/throttle.service.js';

type Row = NonNullable<Awaited<ReturnType<MailSenderService['find']>>>;

const CODE_SECONDS = 600;

/**
 * A company's own email sender (D-58, D-60): save it, prove the address is theirs with an emailed code,
 * send a test through the sender itself, read the SPF/DKIM/DMARC report, then activate. Anything the
 * admin edits afterwards puts it back to DRAFT, so unverified settings never send real mail.
 */
@Injectable()
export class MailSenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly templates: EmailTemplatesService,
    private readonly otp: OtpService,
    private readonly throttle: ThrottleService,
    private readonly runtime: RuntimeConfigService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  /** The signed-in admin's own address: where the test email goes. */
  async emailOf(tenantId: string, userId: string): Promise<string> {
    const u = await runInTenant(
      tenantId,
      async () => await this.db.user.findUnique({ where: { id: userId } }),
    );
    if (!u) throw new NotFoundException('No such account');
    return u.email;
  }

  find(tenantId: string) {
    return runAsSystem(
      async () => await this.db.mailSender.findUnique({ where: { tenantId } }),
    );
  }

  private async require(tenantId: string): Promise<Row> {
    const row = await this.find(tenantId);
    if (!row) throw new NotFoundException('No email sender is set up yet');
    return row;
  }

  private view(r: Row): SenderView {
    return {
      id: r.id,
      kind: r.kind,
      fromName: r.fromName,
      fromAddress: r.fromAddress,
      replyTo: r.replyTo,
      smtp:
        r.kind === 'OWN_SMTP' && r.smtpHost
          ? {
              host: r.smtpHost,
              port: r.smtpPort ?? 587,
              secure: r.smtpSecure,
              user: r.smtpUser ?? '',
              passwordSet: Boolean(r.smtpPassEnc),
            }
          : null,
      status: r.status,
      codeConfirmed: Boolean(r.codeConfirmedAt),
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      lastTestAt: r.lastTestAt?.toISOString() ?? null,
      lastTestResult: r.lastTestResult,
      dnsReport: (r.dnsReport as DnsReportView | null) ?? null,
    };
  }

  async state(tenantId: string): Promise<SenderState> {
    const row = await this.find(tenantId);
    return {
      defaultFrom: (await this.runtime.get('MAIL_FROM')) ?? '',
      sender: row ? this.view(row) : null,
    };
  }

  /** Saves the draft. A changed address needs the code again; any change needs a fresh test. */
  async save(tenantId: string, input: SaveSenderBody): Promise<SenderView> {
    const existing = await this.find(tenantId);
    let smtp: {
      smtpHost: string | null;
      smtpPort: number | null;
      smtpSecure: boolean;
      smtpUser: string | null;
      smtpPassEnc: string | null;
    } = {
      smtpHost: null,
      smtpPort: null,
      smtpSecure: false,
      smtpUser: null,
      smtpPassEnc: null,
    };
    if (input.kind === 'OWN_SMTP' && input.smtp) {
      // Early, clear errors; the same check runs again at every connection.
      await resolvePublicSmtpHost(input.smtp.host, input.smtp.port);
      const pass = input.smtp.pass
        ? this.crypto.encrypt(input.smtp.pass)
        : existing?.smtpPassEnc;
      if (!pass)
        throw new BadRequestException('Enter the mail account password');
      smtp = {
        smtpHost: input.smtp.host,
        smtpPort: input.smtp.port,
        smtpSecure: input.smtp.secure,
        smtpUser: input.smtp.user,
        smtpPassEnc: pass,
      };
    }
    const sameAddress =
      existing?.fromAddress === input.fromAddress &&
      existing.kind === input.kind;
    const data = {
      kind: input.kind,
      fromName: input.fromName,
      fromAddress: input.fromAddress,
      replyTo: input.replyTo ?? null,
      ...smtp,
      status: 'DRAFT' as const,
      ...(sameAddress ? {} : { codeConfirmedAt: null, verifiedAt: null }),
      lastTestAt: null,
      lastTestResult: null,
    };
    const row = await runAsSystem(
      async () =>
        await this.db.mailSender.upsert({
          where: { tenantId },
          create: { tenantId, ...data },
          update: data,
        }),
    );
    return this.view(row);
  }

  /** Emails a 6-digit code to the address, through the platform's own sender. */
  async startVerify(tenantId: string): Promise<void> {
    const s = await this.require(tenantId);
    const key = `mailsender:${s.id}`;
    await this.throttle.assertNotLocked('reset', key);
    await this.throttle.recordFailure('reset', key);
    const code = await this.otp.issue('mail-sender', s.id, CODE_SECONDS);
    await this.mail.send({
      to: s.fromAddress,
      tenantId,
      event: 'sender.verify',
      useDefault: true,
      ...(await this.templates.render('sender.verify', null, {
        code,
        address: s.fromAddress,
      })),
    });
    await runAsSystem(
      async () =>
        await this.db.mailSender.update({
          where: { id: s.id },
          data: { status: 'VERIFYING' },
        }),
    );
  }

  async confirmCode(tenantId: string, code: string): Promise<SenderView> {
    const s = await this.require(tenantId);
    const key = `mailsender-confirm:${s.id}`;
    await this.throttle.assertNotLocked('mfa', key);
    if (!(await this.otp.verify('mail-sender', s.id, code))) {
      await this.throttle.recordFailure('mfa', key);
      throw new BadRequestException(
        'That code is not right, or it has expired.',
      );
    }
    await this.throttle.clear('mfa', key);
    const row = await runAsSystem(
      async () =>
        await this.db.mailSender.update({
          where: { id: s.id },
          data: { codeConfirmedAt: new Date() },
        }),
    );
    return this.view(row);
  }

  /** Sends one message through the sender itself, to the admin who asked. Never throws for a mail problem. */
  async test(
    tenantId: string,
    toEmail: string,
  ): Promise<{ ok: boolean; message: string; sender: SenderView }> {
    const s = await this.require(tenantId);
    if (!s.codeConfirmedAt)
      throw new ConflictException('Confirm the code we emailed first');
    let ok = true;
    let message = 'The test email was sent. Check your inbox.';
    try {
      await this.mail.sendVia(
        s as SenderRow,
        {
          to: toEmail,
          subject: 'Test email from your new sender',
          text: `This is a test. If you can read it, ${s.fromAddress} can send email for your company.`,
          event: 'sender.test',
        },
        tenantId,
      );
    } catch (err) {
      ok = false;
      message =
        err instanceof BadRequestException
          ? String(
              (err.getResponse() as { message?: string }).message ??
                err.message,
            )
          : explainMailError(err);
    }
    const row = await runAsSystem(
      async () =>
        await this.db.mailSender.update({
          where: { id: s.id },
          data: {
            lastTestAt: new Date(),
            lastTestResult: ok ? 'OK' : message.slice(0, 500),
            status: ok ? s.status : 'FAILED',
          },
        }),
    );
    return { ok, message, sender: this.view(row) };
  }

  async dns(tenantId: string, dkimSelector?: string): Promise<SenderView> {
    const s = await this.require(tenantId);
    const domain = s.fromAddress.split('@')[1] ?? '';
    const report = await buildDnsReport(domain, {
      smtpHost: s.smtpHost,
      dkimSelector,
    });
    const row = await runAsSystem(
      async () =>
        await this.db.mailSender.update({
          where: { id: s.id },
          data: { dnsReport: report as never },
        }),
    );
    return this.view(row);
  }

  /** Only after the code and a good test. DNS warnings do not block: they explain what to improve. */
  async activate(tenantId: string): Promise<SenderView> {
    const s = await this.require(tenantId);
    if (!s.codeConfirmedAt)
      throw new ConflictException('Confirm the code we emailed first');
    if (s.lastTestResult !== 'OK')
      throw new ConflictException('Send a test email that arrives first');
    const row = await runAsSystem(
      async () =>
        await this.db.mailSender.update({
          where: { id: s.id },
          data: { status: 'ACTIVE', verifiedAt: new Date() },
        }),
    );
    return this.view(row);
  }

  /** "Switch back to default". */
  async remove(tenantId: string): Promise<void> {
    await runAsSystem(
      async () => await this.db.mailSender.deleteMany({ where: { tenantId } }),
    );
  }
}
