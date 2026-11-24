import {
  Inject,
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { LimitsService } from '../billing/limits.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { PDFDocument } from 'pdf-lib';
import { RedisService } from '../../platform/cache/redis.service.js';
import { MfaService } from '../identity/mfa.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SealService } from './seal/seal.service.js';
import { drawElectronicStamp } from './electronic-stamp.js';
import { StorageService } from '../../platform/storage/storage.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FilesService } from '../files/files.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import {
  DscRejected,
  DscValidator,
  RevocationUnavailable,
} from './dsc/dsc-validator.js';
import { SigningService, type Actor } from './signing.service.js';
import { signatureBox } from './appearance.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';

export interface DeviceCtx {
  tenantId: string;
  userId: string;
  deviceId: string;
}

const LEASE_MS = 10 * 60_000;
const MAX_SIGNED_BYTES = 20 * 1024 * 1024;
const sha256 = (v: string | Buffer) =>
  createHash('sha256').update(v).digest('hex');

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

/** Digital-signature jobs: HR asks the signatory to sign, the desktop app does it, the server checks it. */
@Injectable()
export class DscJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: SigningService,
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly access: AccessService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
    private readonly validator: DscValidator,
    private readonly seal: SealService,
    private readonly mfa: MfaService,
    private readonly limits: LimitsService,
    private readonly settings: SettingsService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runtime: RuntimeConfigService,
  ) {}

  /** HR asks a named signatory to sign with their certificate. Moves the document to "signing". */
  async request(
    a: Actor,
    documentId: string,
    b: { signatoryUserId: string; expiresInDays: number },
  ) {
    const { doc, file } = await this.signing.beginRequest(a, documentId);
    // The signatory must hold the signing permission for this company (D-35).
    if (
      !(await this.access.can(
        a.tenantId,
        b.signatoryUserId,
        'documents.sign',
        doc.entityId,
      ))
    )
      throw new BadRequestException(
        'That person is not allowed to sign for this company',
      );
    const who = await runInTenant(a.tenantId, async () =>
      this.prisma.db.user.findUnique({
        where: { id: b.signatoryUserId },
        select: {
          email: true,
          person: { select: { firstName: true, lastName: true } },
        },
      }),
    );
    if (!who) throw new BadRequestException('That person does not exist');
    const name = who.person
      ? `${who.person.firstName} ${who.person.lastName}`.trim()
      : who.email;
    await this.limits.assert(a.tenantId, 'signatures_month');
    const req = await runInTenant(a.tenantId, async () =>
      this.prisma.db.signatureRequest.create({
        data: {
          tenantId: a.tenantId,
          documentId,
          method: 'DSC',
          finalStep: true, // the certificate signature is always the last step
          expiresAt: new Date(Date.now() + b.expiresInDays * 86_400_000),
          documentSha256: file.sha256,
          inputFileId: file.id,
          createdBy: a.userId,
          parties: {
            create: {
              tenantId: a.tenantId,
              userId: b.signatoryUserId,
              name,
              email: who.email,
              tokenHash: sha256(randomBytes(32)), // never sent; the person signs through their device
            },
          },
        },
        include: { parties: true },
      }),
    );
    await this.signing.record(
      a.tenantId,
      req.id,
      'requested',
      {},
      req.parties[0]!.id,
      { by: a.userId, method: 'DSC' },
    );
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: 'signature.request',
      entityType: 'document',
      entityId: documentId,
      meta: {
        reference: doc.reference,
        method: 'DSC',
        signatory: b.signatoryUserId,
      },
    });
    return {
      id: req.id,
      status: req.status,
      expiresAt: req.expiresAt,
      signatoryName: name,
    };
  }

  // ------------------------------------------------------------ desktop side

  /** Jobs waiting for this person to sign (not held by another device). */
  async list(d: DeviceCtx) {
    const now = new Date();
    const rows = await runInTenant(d.tenantId, async () =>
      this.prisma.db.signatureRequest.findMany({
        where: {
          method: 'DSC',
          status: 'PENDING',
          expiresAt: { gt: now },
          parties: { some: { userId: d.userId } },
          OR: [
            { claimedByDeviceId: null },
            { claimExpiresAt: { lt: now } },
            { claimedByDeviceId: d.deviceId },
          ],
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const docs = await runInTenant(d.tenantId, async () =>
      this.prisma.db.generatedDocument.findMany({
        where: { id: { in: rows.map((r) => r.documentId) } },
        select: { id: true, reference: true, letterType: true, entityId: true },
      }),
    );
    const entities = await runInTenant(d.tenantId, async () =>
      this.prisma.db.entity.findMany({
        where: { id: { in: docs.map((x) => x.entityId) } },
        select: { id: true, legalName: true },
      }),
    );
    const byDoc = new Map(docs.map((x) => [x.id, x]));
    const byEnt = new Map(entities.map((x) => [x.id, x.legalName]));
    const electronicAllowed = await this.settings.get(
      'signing.allowWithoutDsc',
      {
        tenantId: d.tenantId,
      },
    );
    return rows.map((r) => {
      const doc = byDoc.get(r.documentId)!;
      return {
        id: r.id,
        reference: doc.reference,
        letterType: doc.letterType,
        issuedBy: byEnt.get(doc.entityId) ?? '',
        sha256: r.documentSha256,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        claimedByThisDevice: r.claimedByDeviceId === d.deviceId,
        electronicAllowed,
      };
    });
  }

  private async mine(d: DeviceCtx, id: string) {
    const r = await runInTenant(d.tenantId, async () =>
      this.prisma.db.signatureRequest.findFirst({
        where: { id, method: 'DSC', parties: { some: { userId: d.userId } } },
      }),
    );
    if (!r) throw new NotFoundException();
    return r;
  }

  /** Takes the job for ten minutes so two computers do not both sign it. */
  async claim(d: DeviceCtx, id: string) {
    const r = await this.mine(d, id);
    if (r.status !== 'PENDING' || r.expiresAt < new Date())
      throw new ConflictException('This job is closed');
    const now = new Date();
    const won = await runInTenant(d.tenantId, async () =>
      this.prisma.db.signatureRequest.updateMany({
        where: {
          id,
          status: 'PENDING',
          OR: [
            { claimedByDeviceId: null },
            { claimExpiresAt: { lt: now } },
            { claimedByDeviceId: d.deviceId },
          ],
        },
        data: {
          claimedByDeviceId: d.deviceId,
          claimExpiresAt: new Date(now.getTime() + LEASE_MS),
        },
      }),
    );
    if (won.count !== 1)
      throw new ConflictException('Another computer is signing this');
    await this.signing.record(d.tenantId, id, 'claimed', {}, undefined, {
      deviceId: d.deviceId,
    });
    const doc = await runInTenant(d.tenantId, async () =>
      this.prisma.db.generatedDocument.findUniqueOrThrow({
        where: { id: r.documentId },
      }),
    );
    const letterhead = await runInTenant(d.tenantId, async () =>
      this.prisma.db.letterhead.findUniqueOrThrow({
        where: { id: doc.letterheadId },
      }),
    );
    return {
      id,
      reference: doc.reference,
      sha256: r.documentSha256,
      // the document is fetched with the device credential, never from a link
      inputPath: `/v1/desktop/jobs/${id}/input`,
      leaseSeconds: LEASE_MS / 1000,
      signature: {
        reason: `Issued by ${doc.reference}`,
        digest: 'sha256',
        timestampRequired: true,
        timestampUrl: await this.runtime.require('DSC_TSA_URL'),
        // where the visible stamp goes, taken from the letterhead so it stays clear of the artwork
        appearance: signatureBox(letterhead),
      },
    };
  }

  private async held(d: DeviceCtx, id: string) {
    const r = await this.mine(d, id);
    if (r.status !== 'PENDING' || r.claimedByDeviceId !== d.deviceId)
      throw new ConflictException('This job is not held by this computer');
    return r;
  }

  async input(d: DeviceCtx, id: string) {
    const r = await this.held(d, id);
    const file = await this.files.get(d.tenantId, r.inputFileId!);
    return {
      file,
      stream: this.storage.read(file.storageKey),
      url: await this.storage.downloadUrl(file.storageKey, {
        filename: file.originalName,
        mimeType: 'application/pdf',
      }),
    };
  }

  async release(d: DeviceCtx, id: string) {
    await this.held(d, id);
    await runInTenant(d.tenantId, async () =>
      this.prisma.db.signatureRequest.updateMany({
        where: { id, claimedByDeviceId: d.deviceId },
        data: { claimedByDeviceId: null, claimExpiresAt: null },
      }),
    );
  }

  /** The app could not sign (token missing, PIN cancelled...). Frees the job and records why, never a PIN. */
  async fail(d: DeviceCtx, id: string, reason: string) {
    await this.held(d, id);
    await runInTenant(d.tenantId, async () =>
      this.prisma.db.signatureRequest.updateMany({
        where: { id, claimedByDeviceId: d.deviceId },
        data: { claimedByDeviceId: null, claimExpiresAt: null },
      }),
    );
    await this.signing.record(d.tenantId, id, 'sign_failed', {}, undefined, {
      deviceId: d.deviceId,
      reason: reason.slice(0, 300),
    });
  }

  /** The signed file comes back. It is accepted only if it passes every check in D-48. */
  async submit(d: DeviceCtx, id: string, signed: Buffer) {
    if (signed.length > MAX_SIGNED_BYTES)
      throw new PayloadTooLargeException('The signed file is too large');
    const r = await this.held(d, id);
    const input = await this.files.get(d.tenantId, r.inputFileId!);
    const sent = await readAll(this.storage.read(input.storageKey));
    if (sha256(sent) !== r.documentSha256)
      throw new ConflictException(
        'The document changed after the request was made',
      );
    let result;
    try {
      result = await this.validator.validate({ sent, signed });
    } catch (e) {
      if (e instanceof DscRejected) {
        await this.signing.record(
          d.tenantId,
          id,
          'sign_rejected',
          {},
          undefined,
          { deviceId: d.deviceId, code: e.code },
        );
        throw new UnprocessableEntityException({
          code: e.code,
          message: e.message,
        });
      }
      if (e instanceof RevocationUnavailable) {
        await this.signing.record(d.tenantId, id, 'sign_held', {}, undefined, {
          deviceId: d.deviceId,
          reason: e.message,
        });
        // the app keeps the signed file and sends it again shortly
        throw new ServiceUnavailableException({
          code: 'revocation-unavailable',
          message: e.message,
          retryAfterSeconds: 60,
        });
      }
      throw e;
    }
    const doc = await runInTenant(d.tenantId, async () =>
      this.prisma.db.generatedDocument.findUniqueOrThrow({
        where: { id: r.documentId },
      }),
    );
    const file = await this.files.storeTrusted(
      { tenantId: d.tenantId, userId: d.userId },
      {
        body: signed,
        mimeType: 'application/pdf',
        name: `${doc.reference.replaceAll('/', '-')}-signed.pdf`,
        ownerType: 'document',
      },
    );
    const at = new Date();
    await runInTenant(d.tenantId, async () =>
      this.prisma.db.$transaction(async (tx) => {
        const won = await tx.signatureRequest.updateMany({
          where: { id, status: 'PENDING', claimedByDeviceId: d.deviceId },
          data: {
            status: 'COMPLETED',
            completedAt: at,
            signedFileId: file.id,
            testSignature: result.test,
            claimedByDeviceId: null,
            claimExpiresAt: null,
          },
        });
        if (won.count !== 1)
          throw new ConflictException('This job is no longer open');
        await tx.signatureParty.updateMany({
          where: { requestId: id },
          data: { status: 'ACCEPTED', respondedAt: at },
        });
        await tx.signatureEvent.create({
          data: {
            tenantId: d.tenantId,
            requestId: id,
            type: 'signed',
            meta: {
              deviceId: d.deviceId,
              signer: result.signer.commonName,
              organisation: result.signer.organisation,
              issuer: result.signer.issuer,
              serial: result.signer.serialHex,
              signedAt: result.signedAt.toISOString(),
              test: result.test,
              warnings: result.warnings,
              signedSha256: file.sha256,
            },
          },
        });
      }),
    );
    await this.workflow.act(
      { tenantId: d.tenantId, userId: null },
      { type: 'document', id: doc.id },
      'issue',
      { asSystem: true },
    );
    await this.audit.recordSafely({
      tenantId: d.tenantId,
      actorType: 'USER',
      actorId: d.userId,
      action: 'signature.signed',
      entityType: 'document',
      entityId: doc.id,
      meta: { reference: doc.reference, method: 'DSC', test: result.test },
    });
    return {
      signed: true,
      reference: doc.reference,
      test: result.test,
      warnings: result.warnings,
    };
  }

  // ------------------------------------------------- signing without a token

  /** Whether this company lets signatories sign without the USB token, and the open request for this person. */
  async electronicOptions(
    a: { tenantId: string; userId: string },
    documentId: string,
  ) {
    const doc = await runInTenant(a.tenantId, async () =>
      this.prisma.db.generatedDocument.findUnique({
        where: { id: documentId },
        select: { id: true },
      }),
    );
    if (!doc) throw new NotFoundException();
    const allowed = await this.settings.get('signing.allowWithoutDsc', {
      tenantId: a.tenantId,
    });
    const r = await runInTenant(a.tenantId, async () =>
      this.prisma.db.signatureRequest.findFirst({
        where: {
          documentId,
          method: 'DSC',
          status: 'PENDING',
          expiresAt: { gt: new Date() },
          parties: { some: { userId: a.userId } },
        },
      }),
    );
    return { allowed, requestId: allowed && r ? r.id : null };
  }

  /**
   * The signatory signs without the token (setting `signing.allowWithoutDsc`). They confirm with their
   * authenticator code; the letter gets a visible stamp and the organisation seal and is labelled
   * "Signed electronically (no DSC)". The file is rebuilt from the original so the seal is the only
   * signature on it.
   */
  async signElectronically(
    who: { tenantId: string; userId: string; deviceId?: string },
    requestId: string,
    code: string,
    c: { ip?: string; userAgent?: string } = {},
  ) {
    if (
      !(await this.settings.get('signing.allowWithoutDsc', {
        tenantId: who.tenantId,
      }))
    )
      throw new ForbiddenException(
        'Signing without a DSC token is not switched on for this company',
      );
    const r = await runInTenant(who.tenantId, async () =>
      this.prisma.db.signatureRequest.findFirst({
        where: {
          id: requestId,
          method: { in: ['DSC', 'SEAL'] },
          parties: { some: { userId: who.userId } },
        },
        include: { parties: true },
      }),
    );
    if (!r) throw new NotFoundException();
    if (r.status !== 'PENDING' || r.expiresAt < new Date())
      throw new ConflictException('This request is closed');
    if (
      who.deviceId &&
      r.claimedByDeviceId &&
      r.claimedByDeviceId !== who.deviceId &&
      r.claimExpiresAt &&
      r.claimExpiresAt > new Date()
    )
      throw new ConflictException('Another computer is signing this');

    // A fresh authenticator code proves it is really the signatory at the keyboard.
    const user = await runInTenant(who.tenantId, async () =>
      this.prisma.db.user.findUnique({
        where: { id: who.userId },
        select: {
          mfaSecretEnc: true,
          mfaEnabledAt: true,
          person: { select: { firstName: true, lastName: true } },
          email: true,
        },
      }),
    );
    if (!user?.mfaSecretEnc || !user.mfaEnabledAt)
      throw new BadRequestException(
        'Turn on your authenticator app first; it is needed to sign without a token',
      );
    const limit = await this.redis.rateLimit(
      `esign-self:${who.userId}`,
      8,
      600,
    );
    if (!limit.allowed)
      throw new BadRequestException('Too many tries. Wait a few minutes.');
    if (!(await this.mfa.verifyCode(user.mfaSecretEnc, code))) {
      await this.signing.record(who.tenantId, r.id, 'seal_code_failed', c);
      throw new BadRequestException(
        'That code is not right. Try the next one.',
      );
    }

    const doc = await runInTenant(who.tenantId, async () =>
      this.prisma.db.generatedDocument.findUniqueOrThrow({
        where: { id: r.documentId },
      }),
    );
    const original = await readAll(
      this.storage.read(
        (await this.files.get(who.tenantId, doc.fileId)).storageKey,
      ),
    );
    if (sha256(original) !== doc.sha256)
      throw new ConflictException('The document changed after it was approved');
    const letterhead = await runInTenant(who.tenantId, async () =>
      this.prisma.db.letterhead.findUniqueOrThrow({
        where: { id: doc.letterheadId },
      }),
    );
    const name = user.person
      ? `${user.person.firstName} ${user.person.lastName}`.trim()
      : user.email;
    const at = new Date();
    const pdf = await PDFDocument.load(original);
    for (const page of await this.signing.acceptanceRecordPages(
      who.tenantId,
      doc.id,
    )) {
      const rec = await PDFDocument.load(page);
      for (const p of await pdf.copyPages(rec, rec.getPageIndices()))
        pdf.addPage(p);
    }
    const box = signatureBox(letterhead);
    await drawElectronicStamp(pdf, {
      page: box.page,
      box: box.box,
      signer: name,
      at,
    });
    const sealed = await this.seal.seal(
      Buffer.from(await pdf.save({ useObjectStreams: false })),
      { reason: `Signed electronically by ${name} (no DSC)` },
    );
    const file = await this.files.storeTrusted(
      { tenantId: who.tenantId, userId: who.userId },
      {
        body: sealed,
        mimeType: 'application/pdf',
        name: `${doc.reference.replaceAll('/', '-')}-signed.pdf`,
        ownerType: 'document',
      },
    );
    await runInTenant(who.tenantId, async () =>
      this.prisma.db.$transaction(async (tx) => {
        const won = await tx.signatureRequest.updateMany({
          where: { id: r.id, status: 'PENDING' },
          data: {
            status: 'COMPLETED',
            method: 'SEAL',
            completedAt: at,
            signedFileId: file.id,
            claimedByDeviceId: null,
            claimExpiresAt: null,
          },
        });
        if (won.count !== 1)
          throw new ConflictException('This request is no longer open');
        await tx.signatureParty.updateMany({
          where: { requestId: r.id },
          data: { status: 'ACCEPTED', respondedAt: at },
        });
        await tx.signatureEvent.create({
          data: {
            tenantId: who.tenantId,
            requestId: r.id,
            type: 'signed',
            ip: c.ip?.slice(0, 64) ?? null,
            userAgent: c.userAgent?.slice(0, 255) ?? null,
            meta: {
              kind: 'seal',
              deviceId: who.deviceId ?? null,
              signer: name,
              organisation: null,
              issuer: 'Organisation seal (no digital signature certificate)',
              signedAt: at.toISOString(),
              signedSha256: file.sha256,
            },
          },
        });
      }),
    );
    await this.workflow.act(
      { tenantId: who.tenantId, userId: null },
      { type: 'document', id: doc.id },
      'issue',
      { asSystem: true },
    );
    await this.audit.recordSafely({
      tenantId: who.tenantId,
      actorType: 'USER',
      actorId: who.userId,
      action: 'signature.signed',
      entityType: 'document',
      entityId: doc.id,
      meta: { reference: doc.reference, method: 'SEAL' },
    });
    return { signed: true, reference: doc.reference, electronic: true };
  }
}
