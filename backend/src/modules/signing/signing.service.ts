import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { StorageService } from '../../platform/storage/storage.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService } from '../files/files.service.js';
import { OtpService } from '../identity/otp.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { renderAcceptancePage } from './acceptance-page.js';
import { EsignGateway } from './esign/gateway.js';
import { SealService } from './seal/seal.service.js';

const sha256 = (v: string | Buffer) =>
  createHash('sha256').update(v).digest('hex');
const STATEMENT =
  'The person named below confirmed, using a one-time code sent to their email address, that they have read this document and accept it.';
const ESIGN_STATEMENT =
  'The person named below confirmed, through an Aadhaar eSign provider, that they have read this document and accept it.';

export interface Actor {
  tenantId: string;
  userId: string;
}
export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

const maskEmail = (e: string) => {
  const [u, d] = e.split('@');
  return `${u!.slice(0, 1)}${'*'.repeat(Math.max(2, u!.length - 1))}@${d}`;
};

@Injectable()
export class SigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly otp: OtpService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly workflow: WorkflowService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seal: SealService,
    private readonly esign: EsignGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private from(tenantId: string) {
    return this.settings.get('branding.emailSenderName', { tenantId });
  }

  async record(
    tenantId: string,
    requestId: string,
    type: string,
    c: ClientInfo = {},
    partyId?: string,
    meta?: object,
  ) {
    return this.event(tenantId, requestId, type, c, partyId, meta);
  }

  private async event(
    tenantId: string,
    requestId: string,
    type: string,
    c: ClientInfo = {},
    partyId?: string,
    meta?: object,
  ) {
    await runInTenant(tenantId, async () =>
      this.prisma.db.signatureEvent.create({
        data: {
          tenantId,
          requestId,
          partyId: partyId ?? null,
          type,
          ip: c.ip?.slice(0, 64) ?? null,
          userAgent: c.userAgent?.slice(0, 255) ?? null,
          meta: meta ?? undefined,
        },
      }),
    );
  }

  // ---------------------------------------------------------------- staff side

  private async docFor(
    a: Actor,
    id: string,
    code: 'documents.read' | 'documents.generate',
  ) {
    const doc = await runInTenant(a.tenantId, async () =>
      this.prisma.db.generatedDocument.findUnique({ where: { id } }),
    );
    if (
      !doc ||
      !(await this.access.can(
        a.tenantId,
        a.userId,
        'documents.read',
        doc.entityId,
      ))
    )
      throw new NotFoundException();
    if (
      code === 'documents.generate' &&
      !(await this.access.can(a.tenantId, a.userId, code, doc.entityId))
    )
      throw new NotFoundException();
    return doc;
  }

  /**
   * Starts any new request: one open request at a time, and only an approved document (moves it
   * to "signing" and freezes it) or one already in "signing" between steps. Returns the document
   * and the newest file, which is the one the next person must see or sign: the sealed accepted
   * copy once someone has accepted, otherwise the generated file.
   */
  async beginRequest(a: Actor, documentId: string) {
    const doc = await this.docFor(a, documentId, 'documents.generate');
    const open = await runInTenant(a.tenantId, async () =>
      this.prisma.db.signatureRequest.count({
        where: { documentId, status: 'PENDING' },
      }),
    );
    if (open)
      throw new ConflictException(
        'There is already an open request for this document',
      );
    const { state } = await this.workflow.history(a.tenantId, {
      type: 'document',
      id: documentId,
    });
    if (state === 'approved')
      await this.workflow.act(
        a,
        { type: 'document', id: documentId },
        'start_signing',
        { asSystem: true },
      );
    else if (state !== 'signing')
      throw new ConflictException('The document must be approved first');
    const last = await runInTenant(a.tenantId, async () =>
      this.prisma.db.signatureRequest.findFirst({
        where: { documentId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      }),
    );
    const fileId = last?.signedFileId ?? last?.sealedFileId ?? doc.fileId;
    return { doc, file: await this.files.get(a.tenantId, fileId) };
  }

  /** Asks a person to accept an approved document by email code. Moves the document to "signing". */
  async requestOtp(
    a: Actor,
    documentId: string,
    b: {
      name: string;
      email: string;
      expiresInDays: number;
      finalStep: boolean;
      method?: 'OTP' | 'AADHAAR';
    },
  ) {
    const method = b.method ?? 'OTP';
    if (method === 'AADHAAR' && !this.esign.enabled)
      throw new BadRequestException('Aadhaar eSign is not switched on');
    const { doc, file } = await this.beginRequest(a, documentId);
    const accepted = await runInTenant(a.tenantId, async () =>
      this.prisma.db.signatureRequest.count({
        where: { documentId, method, status: 'COMPLETED' },
      }),
    );
    if (accepted)
      throw new ConflictException('This document was already accepted');
    const token = randomBytes(32).toString('base64url');
    const req = await runInTenant(a.tenantId, async () =>
      this.prisma.db.signatureRequest.create({
        data: {
          tenantId: a.tenantId,
          documentId,
          method,
          finalStep: b.finalStep,
          expiresAt: new Date(Date.now() + b.expiresInDays * 86_400_000),
          documentSha256: file.sha256,
          inputFileId: file.id,
          createdBy: a.userId,
          parties: {
            create: {
              tenantId: a.tenantId,
              name: b.name,
              email: b.email,
              tokenHash: sha256(token),
            },
          },
        },
        include: { parties: true },
      }),
    );
    await this.event(a.tenantId, req.id, 'requested', {}, req.parties[0]!.id, {
      by: a.userId,
    });
    const link = `${this.config.VERIFY_URL.replace(/\/$/, '')}/accept/${token}`;
    await this.mail.send({
      to: b.email,
      subject: `Please review and accept: ${doc.reference}`,
      text: `Hello ${b.name},\n\nYou have a document to review and accept: ${doc.reference}.\n\nOpen this private link, read the document and ${
        method === 'AADHAAR'
          ? 'sign it with your Aadhaar'
          : 'confirm with a code we email you'
      }:\n${link}\n\nThe link works until ${req.expiresAt.toDateString()}. Do not forward it.`,
      fromName: await this.from(a.tenantId),
    });
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: 'signature.request',
      entityType: 'document',
      entityId: documentId,
      meta: { reference: doc.reference, method },
    });
    return {
      id: req.id,
      status: req.status,
      expiresAt: req.expiresAt,
      partyId: req.parties[0]!.id,
    };
  }

  async list(a: Actor, documentId: string) {
    await this.docFor(a, documentId, 'documents.read');
    return runInTenant(a.tenantId, async () =>
      this.prisma.db.signatureRequest.findMany({
        where: { documentId },
        orderBy: { createdAt: 'desc' },
        include: {
          parties: {
            select: {
              id: true,
              name: true,
              email: true,
              status: true,
              respondedAt: true,
            },
          },
          events: { orderBy: { createdAt: 'asc' } },
        },
      }),
    );
  }

  async cancel(
    a: Actor,
    documentId: string,
    requestId: string,
    reason: string,
  ) {
    await this.docFor(a, documentId, 'documents.generate');
    await this.close(
      a.tenantId,
      documentId,
      requestId,
      'CANCELLED',
      'cancelled',
      {},
      { by: a.userId, reason },
    );
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: 'signature.cancel',
      entityType: 'document',
      entityId: documentId,
      meta: { reason },
    });
  }

  /** Ends an open request without acceptance and puts the document back to "approved". */
  private async close(
    tenantId: string,
    documentId: string,
    requestId: string,
    status: 'CANCELLED' | 'DECLINED' | 'EXPIRED',
    eventType: string,
    c: ClientInfo,
    meta?: object,
    partyId?: string,
  ) {
    const done = await runInTenant(tenantId, async () =>
      this.prisma.db.signatureRequest.updateMany({
        where: { id: requestId, documentId, status: 'PENDING' },
        data: { status },
      }),
    );
    if (done.count !== 1)
      throw new ConflictException('This request is already closed');
    await this.event(tenantId, requestId, eventType, c, partyId, meta);
    await this.workflow.act(
      { tenantId, userId: null },
      { type: 'document', id: documentId },
      'signing_failed',
      { asSystem: true },
    );
  }

  // --------------------------------------------------------------- person side

  private async resolve(token: string) {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new NotFoundException();
    const party = await runAsSystem(async () =>
      this.prisma.db.signatureParty.findUnique({
        where: { tokenHash: sha256(token) },
        include: { request: true },
      }),
    );
    if (!party) throw new NotFoundException();
    const { request } = party;
    if (request.status === 'PENDING' && request.expiresAt < new Date()) {
      await this.close(
        party.tenantId,
        request.documentId,
        request.id,
        'EXPIRED',
        'expired',
        {},
      ).catch(() => undefined);
      request.status = 'EXPIRED';
    }
    return { party, request, tenantId: party.tenantId };
  }

  private async limit(
    c: ClientInfo,
    name: string,
    max: number,
    windowSeconds: number,
  ) {
    const r = await this.redis.rateLimit(
      `accept:${name}:${c.ip ?? 'unknown'}`,
      max,
      windowSeconds,
    );
    if (!r.allowed)
      throw new BadRequestException(
        'Too many attempts. Please wait and try again.',
      );
  }

  async describe(token: string, c: ClientInfo) {
    await this.limit(c, 'view', 120, 600);
    const { party, request, tenantId } = await this.resolve(token);
    const doc = await runInTenant(tenantId, async () =>
      this.prisma.db.generatedDocument.findUniqueOrThrow({
        where: { id: request.documentId },
      }),
    );
    const entity = await runInTenant(tenantId, async () =>
      this.prisma.db.entity.findUniqueOrThrow({
        where: { id: doc.entityId },
        select: { legalName: true },
      }),
    );
    if (
      !(await runInTenant(tenantId, async () =>
        this.prisma.db.signatureEvent.findFirst({
          where: { requestId: request.id, partyId: party.id, type: 'viewed' },
        }),
      ))
    )
      await this.event(tenantId, request.id, 'viewed', c, party.id);
    return {
      reference: doc.reference,
      letterType: doc.letterType,
      issuedBy: entity.legalName,
      name: party.name,
      emailHint: maskEmail(party.email),
      method: request.method === 'AADHAAR' ? 'AADHAAR' : 'OTP',
      status: request.status,
      expiresAt: request.expiresAt,
      canAccept: request.status === 'PENDING' && party.status === 'PENDING',
    };
  }

  /** The file the person is accepting (or, once accepted, the sealed copy). */
  async document(token: string, c: ClientInfo) {
    await this.limit(c, 'download', 60, 600);
    const { request, tenantId } = await this.resolve(token);
    const doc = await runInTenant(tenantId, async () =>
      this.prisma.db.generatedDocument.findUniqueOrThrow({
        where: { id: request.documentId },
      }),
    );
    const file = await this.files.get(
      tenantId,
      request.sealedFileId ?? request.inputFileId ?? doc.fileId,
    );
    return {
      file,
      stream: this.storage.read(file.storageKey),
      url: await this.storage.downloadUrl(file.storageKey, {
        filename: file.originalName,
        mimeType: 'application/pdf',
        disposition: 'inline',
      }),
    };
  }

  async sendCode(token: string, c: ClientInfo) {
    await this.limit(c, 'code-ip', 20, 3600);
    const { party, request, tenantId } = await this.resolve(token);
    if (request.status !== 'PENDING' || party.status !== 'PENDING')
      throw new ConflictException('This request is no longer open');
    if (
      !(await this.redis.client.set(
        `accept:cool:${party.id}`,
        '1',
        'EX',
        60,
        'NX',
      ))
    )
      throw new BadRequestException(
        'A code was just sent. Please wait a minute before asking again.',
      );
    if (
      !(await this.redis.rateLimit(`accept:code:${party.id}`, 5, 3600)).allowed
    )
      throw new BadRequestException(
        'Too many codes requested. Try again in an hour.',
      );
    const minutes = await this.settings.get('security.otpExpiryMinutes', {
      tenantId,
    });
    const code = await this.otp.issue('accept', party.id, minutes * 60);
    await this.mail.send({
      to: party.email,
      subject: `Your ${this.config.APP_NAME} code: ${code}`,
      text: `Your one-time code to accept the document is ${code}. It works once and expires in ${minutes} minutes.\n\nIf you did not ask for it, ignore this email.`,
      fromName: await this.from(tenantId),
    });
    await this.event(tenantId, request.id, 'code_sent', c, party.id);
    return {
      sent: true,
      expiresInMinutes: minutes,
      emailHint: maskEmail(party.email),
    };
  }

  async confirm(
    token: string,
    input: { code: string; consent: boolean },
    c: ClientInfo,
  ) {
    await this.limit(c, 'confirm', 30, 3600);
    if (!input.consent)
      throw new BadRequestException(
        'Please tick the box to confirm you accept',
      );
    const { party, request, tenantId } = await this.resolve(token);
    if (request.status !== 'PENDING' || party.status !== 'PENDING')
      throw new ConflictException('This request is no longer open');
    if (!(await this.otp.verify('accept', party.id, input.code))) {
      await this.event(tenantId, request.id, 'code_failed', c, party.id);
      throw new BadRequestException(
        'That code is not right or has expired. Ask for a new one.',
      );
    }
    const doc = await runInTenant(tenantId, async () =>
      this.prisma.db.generatedDocument.findUniqueOrThrow({
        where: { id: request.documentId },
      }),
    );
    const orig = await this.files.get(
      tenantId,
      request.inputFileId ?? doc.fileId,
    );
    const original = await readAll(this.storage.read(orig.storageKey));
    if (sha256(original) !== request.documentSha256)
      throw new ConflictException(
        'The document changed after it was sent. Ask HR to send it again.',
      );

    return this.finishAcceptance({
      tenantId,
      party,
      request,
      doc,
      original,
      c,
      methodLabel: 'Email one-time code',
      statement: STATEMENT,
      reason: `Accepted by ${party.name} using an email code`,
      test: false,
    });
  }

  /** Seals the accepted document with its record page, stores it and issues it if this was the last step. */
  private async finishAcceptance(p: {
    tenantId: string;
    party: { id: string; name: string; email: string };
    request: {
      id: string;
      documentSha256: string;
      finalStep: boolean;
      documentId: string;
    };
    doc: { id: string; reference: string; letterType: string };
    original: Buffer;
    c: ClientInfo;
    methodLabel: string;
    statement: string;
    reason: string;
    test: boolean;
  }) {
    const { tenantId, party, request, doc, original, c } = p;
    const acceptedAt = new Date();
    const record = await renderAcceptancePage({
      reference: doc.reference,
      letterType: doc.letterType,
      documentSha256: request.documentSha256,
      partyName: party.name,
      partyEmail: party.email,
      method: p.methodLabel,
      acceptedAt,
      ip: c.ip ?? 'unknown',
      userAgent: c.userAgent ?? 'unknown',
      requestId: request.id,
      statement: p.statement,
    });
    const merged = await PDFDocument.load(original);
    const rec = await PDFDocument.load(record);
    for (const p of await merged.copyPages(rec, rec.getPageIndices()))
      merged.addPage(p);
    const sealed = await this.seal.seal(
      Buffer.from(await merged.save({ useObjectStreams: false })),
      { reason: p.reason },
    );
    const file = await this.files.storeTrusted(
      { tenantId, userId: null },
      {
        body: sealed,
        mimeType: 'application/pdf',
        name: `${doc.reference.replaceAll('/', '-')}-accepted.pdf`,
        ownerType: 'document',
      },
    );
    await runInTenant(tenantId, async () =>
      this.prisma.db.$transaction(async (tx) => {
        const won = await tx.signatureRequest.updateMany({
          where: { id: request.id, status: 'PENDING' },
          data: {
            status: 'COMPLETED',
            completedAt: acceptedAt,
            sealedFileId: file.id,
            testSignature: p.test,
          },
        });
        if (won.count !== 1)
          throw new ConflictException('This request is no longer open');
        await tx.signatureParty.update({
          where: { id: party.id },
          data: { status: 'ACCEPTED', respondedAt: acceptedAt },
        });
        await tx.signatureEvent.create({
          data: {
            tenantId,
            requestId: request.id,
            partyId: party.id,
            type: 'accepted',
            ip: c.ip?.slice(0, 64) ?? null,
            userAgent: c.userAgent?.slice(0, 255) ?? null,
            meta: {
              documentSha256: request.documentSha256,
              sealedSha256: file.sha256,
            },
          },
        });
      }),
    );
    if (request.finalStep)
      await this.workflow.act(
        { tenantId, userId: null },
        { type: 'document', id: doc.id },
        'issue',
        { asSystem: true },
      );
    await this.audit.recordSafely({
      tenantId,
      actorType: 'SYSTEM',
      action: 'signature.accepted',
      entityType: 'document',
      entityId: doc.id,
      meta: { reference: doc.reference, partyId: party.id },
    });
    await this.mail
      .send({
        to: party.email,
        subject: `Accepted: ${doc.reference}`,
        text: `Thank you, ${party.name}. Your acceptance of ${doc.reference} was recorded on ${acceptedAt.toUTCString()}.\n\nYou can download the sealed copy from your private link while it remains valid.`,
        fromName: await this.from(tenantId),
      })
      .catch(() => undefined);
    return { accepted: true, reference: doc.reference, acceptedAt };
  }

  /** Aadhaar eSign step 1: sends the person to the provider. */
  async startEsign(token: string, c: ClientInfo) {
    await this.limit(c, 'esign', 20, 3600);
    const provider = this.esign.provider();
    if (!provider)
      throw new BadRequestException('Aadhaar eSign is not available');
    const { party, request, tenantId } = await this.resolve(token);
    if (
      request.method !== 'AADHAAR' ||
      request.status !== 'PENDING' ||
      party.status !== 'PENDING'
    )
      throw new ConflictException('This request is no longer open');
    const { doc, original } = await this.originalOf(tenantId, request);
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.esignTransaction.create({
        data: {
          tenantId,
          requestId: request.id,
          provider: provider.key,
          providerTxnId: 'starting',
        },
      }),
    );
    const started = await provider.start({
      reference: row.id,
      documentName: doc.reference,
      documentSha256: request.documentSha256,
      document: original,
      signerName: party.name,
      returnUrl: `${this.config.VERIFY_URL.replace(/\/$/, '')}/accept/${token}?esign=${row.id}`,
    });
    await runInTenant(tenantId, async () =>
      this.prisma.db.esignTransaction.update({
        where: { id: row.id },
        data: { providerTxnId: started.providerTxnId },
      }),
    );
    await this.event(tenantId, request.id, 'esign_started', c, party.id, {
      provider: provider.key,
    });
    return { redirectUrl: started.redirectUrl };
  }

  /** Aadhaar eSign step 2: the person is back; ask the provider how it ended and finish. */
  async completeEsign(token: string, txnId: string, c: ClientInfo) {
    await this.limit(c, 'esign', 40, 3600);
    const provider = this.esign.provider();
    if (!provider)
      throw new BadRequestException('Aadhaar eSign is not available');
    const { party, request, tenantId } = await this.resolve(token);
    const txn = await runInTenant(tenantId, async () =>
      this.prisma.db.esignTransaction.findFirst({
        where: { id: txnId, requestId: request.id },
      }),
    );
    if (!txn) throw new NotFoundException();
    if (
      txn.status !== 'PENDING' ||
      request.status !== 'PENDING' ||
      party.status !== 'PENDING'
    )
      throw new ConflictException('This request is no longer open');
    const outcome = await provider.finish(txn.providerTxnId);
    const settle = (status: 'SIGNED' | 'DECLINED' | 'FAILED') =>
      runInTenant(tenantId, async () =>
        this.prisma.db.esignTransaction.update({
          where: { id: txn.id },
          data: { status, completedAt: new Date() },
        }),
      );
    if (outcome.status === 'FAILED') {
      await settle('FAILED');
      await this.event(tenantId, request.id, 'esign_failed', c, party.id, {
        reason: outcome.reason,
      });
      return { accepted: false as const, message: outcome.reason };
    }
    if (outcome.status === 'DECLINED') {
      await settle('DECLINED');
      await runInTenant(tenantId, async () =>
        this.prisma.db.signatureParty.update({
          where: { id: party.id },
          data: { status: 'DECLINED', respondedAt: new Date() },
        }),
      );
      await this.close(
        tenantId,
        request.documentId,
        request.id,
        'DECLINED',
        'declined',
        c,
        { via: 'esign' },
        party.id,
      );
      return { accepted: false as const, message: 'You declined to sign.' };
    }
    const { doc, original } = await this.originalOf(tenantId, request);
    await settle('SIGNED');
    return this.finishAcceptance({
      tenantId,
      party,
      request,
      doc,
      original: outcome.signedPdf ?? original,
      c,
      methodLabel: outcome.methodLabel,
      statement: ESIGN_STATEMENT,
      reason: `Signed by ${party.name} with Aadhaar eSign`,
      test: outcome.test,
    });
  }

  /** The document the person was shown, checked against the hash fixed when the request was made. */
  private async originalOf(
    tenantId: string,
    request: {
      documentId: string;
      inputFileId: string | null;
      documentSha256: string;
    },
  ) {
    const doc = await runInTenant(tenantId, async () =>
      this.prisma.db.generatedDocument.findUniqueOrThrow({
        where: { id: request.documentId },
      }),
    );
    const orig = await this.files.get(
      tenantId,
      request.inputFileId ?? doc.fileId,
    );
    const original = await readAll(this.storage.read(orig.storageKey));
    if (sha256(original) !== request.documentSha256)
      throw new ConflictException(
        'The document changed after it was sent. Ask HR to send it again.',
      );
    return { doc, original };
  }

  async decline(token: string, input: { reason?: string }, c: ClientInfo) {
    await this.limit(c, 'decline', 20, 3600);
    const { party, request, tenantId } = await this.resolve(token);
    if (request.status !== 'PENDING' || party.status !== 'PENDING')
      throw new ConflictException('This request is no longer open');
    await runInTenant(tenantId, async () =>
      this.prisma.db.signatureParty.update({
        where: { id: party.id },
        data: { status: 'DECLINED', respondedAt: new Date() },
      }),
    );
    await this.close(
      tenantId,
      request.documentId,
      request.id,
      'DECLINED',
      'declined',
      c,
      { reason: input.reason ?? null },
      party.id,
    );
    return { declined: true };
  }

  certificatePem() {
    return this.seal.certificatePem();
  }
  verifySeal(pdf: Buffer) {
    return this.seal.verify(pdf);
  }
}
