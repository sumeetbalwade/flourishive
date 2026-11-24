import type { BillingProfileBody, InvoiceView } from '@flourishive/schemas';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { FilesService } from '../files/files.service.js';
import { formatReference } from '../documents/numbering.js';
import { EmailTemplatesService } from '../notifications/email-templates.service.js';
import { financialYear, splitGst } from './gst.js';
import { invoiceDocument, type Party } from './invoice.js';

const money = (p: number) =>
  `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

/** GST invoices (D-21): numbered per financial year, rendered with the document engine's PDF stack. */
@Injectable()
export class InvoiceService {
  private readonly log = new Logger('Invoices');

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfigService,
    private readonly files: FilesService,
    private readonly mail: MailService,
    private readonly templates: EmailTemplatesService,
  ) {}

  // Profile -------------------------------------------------------------------------------------

  profile(tenantId: string) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.billingProfile.findUnique({ where: { tenantId } }),
    );
  }

  async saveProfile(tenantId: string, b: BillingProfileBody) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.billingProfile.upsert({
        where: { tenantId },
        update: b,
        create: { tenantId, ...b },
      }),
    );
  }

  // Issuing -------------------------------------------------------------------------------------

  private async seller(): Promise<
    Party & { prefix: string; sac: string; rate: number }
  > {
    const [name, gstin, address, stateCode, prefix, sac, rate] =
      await Promise.all([
        this.runtime.get('BILLING_SELLER_NAME'),
        this.runtime.get('BILLING_SELLER_GSTIN'),
        this.runtime.get('BILLING_SELLER_ADDRESS'),
        this.runtime.get('BILLING_SELLER_STATE_CODE'),
        this.runtime.get('BILLING_INVOICE_PREFIX'),
        this.runtime.get('BILLING_SAC_CODE'),
        this.runtime.get('BILLING_GST_RATE'),
      ]);
    return {
      name: name ?? '',
      gstin: gstin ?? null,
      address: address ?? '',
      stateCode: stateCode ?? '',
      prefix: prefix ?? 'FH',
      sac: sac ?? '998314',
      rate: rate ?? 18,
    };
  }

  /**
   * Makes the invoice for a captured payment, once. The number is taken in the same transaction as
   * the row, so a failure never leaves a gap in the series.
   */
  async issueForPayment(paymentId: string): Promise<void> {
    const existing = await runAsSystem(async () =>
      this.prisma.db.invoice.findUnique({ where: { paymentId } }),
    );
    if (existing) return;
    const pay = await runAsSystem(async () =>
      this.prisma.db.payment.findUnique({ where: { id: paymentId } }),
    );
    if (!pay || pay.status !== 'CAPTURED') return;
    const [profile, sub, seller] = await Promise.all([
      this.profile(pay.tenantId),
      runInTenant(pay.tenantId, async () =>
        this.prisma.db.subscription.findUnique({
          where: { tenantId: pay.tenantId },
          include: { plan: true },
        }),
      ),
      this.seller(),
    ]);
    const tenant = await runAsSystem(async () =>
      this.prisma.db.tenant.findUnique({ where: { id: pay.tenantId } }),
    );
    const buyer: Party = {
      name: profile?.legalName ?? tenant?.name ?? 'Customer',
      gstin: profile?.gstin ?? null,
      address: profile?.address ?? '',
      // Unknown buyer state is treated as the seller's own, so the tax still adds up.
      stateCode: profile?.stateCode ?? seller.stateCode,
    };
    const tax = splitGst(
      pay.amount,
      seller.rate,
      seller.stateCode,
      buyer.stateCode,
    );
    const when = pay.paidAt ?? pay.createdAt;
    const fy = financialYear(when);
    const description = `${sub?.plan.name ?? 'Flourishive'} plan subscription${
      sub?.billingInterval === 'YEARLY' ? ' (yearly)' : ' (monthly)'
    }`;
    const invoice = await runAsSystem(async () =>
      this.prisma.db.$transaction(async (tx) => {
        const c = await tx.invoiceCounter.upsert({
          where: { fy },
          update: { lastSeq: { increment: 1 } },
          create: { fy, lastSeq: 1 },
        });
        return tx.invoice.create({
          data: {
            tenantId: pay.tenantId,
            paymentId: pay.id,
            number: formatReference(
              `${seller.prefix}/${fy}/{SEQ:5}`,
              0,
              c.lastSeq,
            ),
            description,
            periodStart: sub?.currentPeriodStart ?? null,
            periodEnd: sub?.currentPeriodEnd ?? null,
            sacCode: seller.sac,
            gstRate: seller.rate,
            taxableValue: tax.taxable,
            cgst: tax.cgst,
            sgst: tax.sgst,
            igst: tax.igst,
            total: pay.amount,
            seller: {
              name: seller.name,
              gstin: seller.gstin,
              address: seller.address,
              stateCode: seller.stateCode,
            },
            buyer: { ...buyer },
            issuedAt: when,
          },
        });
      }),
    );
    await this.render(invoice.id).catch((e) =>
      this.log.error(
        `Could not draw invoice ${invoice.number}: ${(e as Error).message}`,
      ),
    );
    await this.notify(pay.tenantId, invoice.number, pay.amount).catch(
      () => undefined,
    );
  }

  /** Draws the PDF and stores it as a file of the company. Safe to run again. */
  async render(invoiceId: string): Promise<void> {
    const inv = await runAsSystem(async () =>
      this.prisma.db.invoice.findUnique({ where: { id: invoiceId } }),
    );
    if (!inv || inv.fileId) return;
    const fmt = (d: Date | null) => d?.toISOString().slice(0, 10);
    const bytes = await renderToBuffer(
      invoiceDocument({
        number: inv.number,
        issuedAt: inv.issuedAt,
        description: inv.description,
        period:
          inv.periodStart && inv.periodEnd
            ? `Service period ${fmt(inv.periodStart)} to ${fmt(inv.periodEnd)}`
            : null,
        sacCode: inv.sacCode,
        gstRate: inv.gstRate,
        taxableValue: inv.taxableValue,
        cgst: inv.cgst,
        sgst: inv.sgst,
        igst: inv.igst,
        total: inv.total,
        seller: inv.seller as unknown as Party,
        buyer: inv.buyer as unknown as Party,
      }),
    );
    const file = await this.files.storeTrusted(
      { tenantId: inv.tenantId },
      {
        body: bytes,
        mimeType: 'application/pdf',
        name: `${inv.number.replaceAll('/', '-')}.pdf`,
        ownerType: 'invoice',
        ownerId: inv.id,
        skipLimit: true,
      },
    );
    await runAsSystem(async () =>
      this.prisma.db.invoice.update({
        where: { id: inv.id },
        data: { fileId: file.id },
      }),
    );
  }

  private async notify(
    tenantId: string,
    number: string,
    amount: number,
  ): Promise<void> {
    const to = await this.billingEmail(tenantId);
    if (!to) return;
    const tenant = await runAsSystem(async () =>
      this.prisma.db.tenant.findUnique({ where: { id: tenantId } }),
    );
    await this.mail.send({
      event: 'billing.invoice',
      to,
      useDefault: true,
      ...(await this.templates.render('billing.invoice', null, {
        company: tenant?.name ?? '',
        number,
        amount: money(amount),
        link: `${(await this.runtime.get('WEB_URL')) ?? ''}/#/app/plan`,
      })),
    });
  }

  /** The billing contact, else the first company admin. */
  async billingEmail(tenantId: string): Promise<string | null> {
    const p = await this.profile(tenantId);
    if (p) return p.billingEmail;
    const admin = await runInTenant(tenantId, async () =>
      this.prisma.db.user.findFirst({
        where: {
          status: 'ACTIVE',
          userRoles: { some: { role: { key: 'tenant_admin' } } },
        },
        select: { email: true },
      }),
    );
    return admin?.email ?? null;
  }

  // Reading -------------------------------------------------------------------------------------

  private view = (i: {
    id: string;
    number: string;
    description: string;
    issuedAt: Date;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
  }): InvoiceView => ({
    id: i.id,
    number: i.number,
    description: i.description,
    issuedAt: i.issuedAt.toISOString(),
    taxableValue: i.taxableValue,
    cgst: i.cgst,
    sgst: i.sgst,
    igst: i.igst,
    total: i.total,
  });

  async list(tenantId: string): Promise<InvoiceView[]> {
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.invoice.findMany({
        orderBy: { issuedAt: 'desc' },
        take: 60,
      }),
    );
    return rows.map(this.view);
  }

  /** A short-lived download link for one invoice PDF. Draws it first if that was missed. */
  async link(tenantId: string, id: string) {
    let inv = await runInTenant(tenantId, async () =>
      this.prisma.db.invoice.findFirst({ where: { id } }),
    );
    if (!inv) throw new NotFoundException();
    if (!inv.fileId) {
      await this.render(inv.id);
      inv = await runInTenant(tenantId, async () =>
        this.prisma.db.invoice.findFirst({ where: { id } }),
      );
    }
    if (!inv?.fileId)
      throw new NotFoundException('The invoice is not ready yet');
    const { url, expiresAt } = await this.files.linkFor(tenantId, inv.fileId);
    return { url, expiresAt: expiresAt.toISOString() };
  }
}
