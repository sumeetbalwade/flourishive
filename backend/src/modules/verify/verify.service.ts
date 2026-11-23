import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { FilesService } from '../files/files.service.js';
import { SealService } from '../signing/seal/seal.service.js';

/** Only documents that were approved or later can be vouched for; drafts do not exist to the public. */
const VERIFIABLE = new Set(['approved', 'signing', 'issued']);

@Injectable()
export class VerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
    private readonly seal: SealService,
  ) {}

  private async limit(ip: string | undefined, name: string, max: number) {
    const r = await this.redis.rateLimit(
      `verify:${name}:${ip ?? 'unknown'}`,
      max,
      600,
    );
    if (!r.allowed)
      throw new BadRequestException(
        'Too many checks. Please wait a few minutes.',
      );
  }

  private async describe(doc: {
    id: string;
    tenantId: string;
    entityId: string;
    reference: string;
    letterType: string;
    status: string;
    createdAt: Date;
    fileId: string;
  }) {
    const state = (
      await runInTenant(doc.tenantId, async () =>
        this.prisma.db.workflowInstance.findUnique({
          where: {
            tenantId_subjectType_subjectId: {
              tenantId: doc.tenantId,
              subjectType: 'document',
              subjectId: doc.id,
            },
          },
          select: { state: true },
        }),
      )
    )?.state;
    if (!state || !VERIFIABLE.has(state))
      throw new NotFoundException('No issued document matches');
    const entity = await runInTenant(doc.tenantId, async () =>
      this.prisma.db.entity.findUniqueOrThrow({
        where: { id: doc.entityId },
        select: { legalName: true },
      }),
    );
    const done = await runInTenant(doc.tenantId, async () =>
      this.prisma.db.signatureRequest.findMany({
        where: { documentId: doc.id, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      }),
    );
    const accepted = done.find((r) => r.method === 'OTP');
    const signedReq = done.find(
      (r) => r.method === 'DSC' || r.method === 'SEAL',
    );
    const signedEvent = signedReq
      ? await runInTenant(doc.tenantId, async () =>
          this.prisma.db.signatureEvent.findFirst({
            where: { requestId: signedReq.id, type: 'signed' },
          }),
        )
      : null;
    const m = (signedEvent?.meta ?? {}) as {
      signer?: string;
      organisation?: string | null;
      issuer?: string;
    };
    const result =
      doc.status === 'REVOKED'
        ? 'revoked'
        : doc.status === 'SUPERSEDED'
          ? 'superseded'
          : state === 'issued' && !signedReq?.testSignature
            ? 'valid'
            : 'pending';
    return {
      result,
      reference: doc.reference,
      letterType: doc.letterType,
      issuedBy: entity.legalName,
      issuedOn: doc.createdAt,
      stage: state,
      acceptance: accepted?.completedAt
        ? {
            method: accepted.method,
            at: accepted.completedAt,
            sealed: !!accepted.sealedFileId,
          }
        : null,
      signature:
        signedReq?.completedAt && signedEvent
          ? {
              kind:
                signedReq.method === 'SEAL'
                  ? ('electronic' as const)
                  : ('dsc' as const),
              signer: m.signer ?? 'Unknown',
              organisation: m.organisation ?? null,
              issuer: m.issuer ?? '',
              at: signedReq.completedAt,
            }
          : null,
      // A document signed with the relaxed development check is never presented as genuine.
      test: !!signedReq?.testSignature,
    };
  }

  async byToken(token: string, ip?: string) {
    await this.limit(ip, 'lookup', 60);
    if (!/^[0-9a-f]{32}$/.test(token))
      throw new NotFoundException('No issued document matches');
    const doc = await runAsSystem(async () =>
      this.prisma.db.generatedDocument.findUnique({
        where: { verifyToken: token },
      }),
    );
    if (!doc) throw new NotFoundException('No issued document matches');
    return this.describe(doc);
  }

  /** Look up by company short name and reference, for someone holding only the printed number. */
  async byReference(company: string, reference: string, ip?: string) {
    await this.limit(ip, 'lookup', 60);
    const doc = await runAsSystem(async () => {
      const tenant = await this.prisma.db.tenant.findUnique({
        where: { slug: company.toLowerCase() },
      });
      if (!tenant || tenant.status !== 'ACTIVE') return null;
      return runInTenant(tenant.id, async () =>
        this.prisma.db.generatedDocument.findUnique({
          where: { tenantId_reference: { tenantId: tenant.id, reference } },
        }),
      );
    });
    if (!doc) throw new NotFoundException('No issued document matches');
    const d = await this.describe(doc);
    // The QR token is what lets someone compare a file; hand it back so the page can offer that.
    return { ...d, token: doc.verifyToken };
  }

  /** Compares an uploaded copy with the issued file by fingerprint, and reports on any seal in it. */
  async compare(token: string, pdf: Buffer, ip?: string) {
    await this.limit(ip, 'compare', 20);
    const info = await this.byToken(token, ip);
    const doc = await runAsSystem(async () =>
      this.prisma.db.generatedDocument.findUniqueOrThrow({
        where: { verifyToken: token },
      }),
    );
    const sha = createHash('sha256').update(pdf).digest('hex');
    const original = await this.files.get(doc.tenantId, doc.fileId);
    const sealedReq = await runInTenant(doc.tenantId, async () =>
      this.prisma.db.signatureRequest.findFirst({
        where: {
          documentId: doc.id,
          status: 'COMPLETED',
          sealedFileId: { not: null },
        },
        orderBy: { completedAt: 'desc' },
      }),
    );
    const signedReq = await runInTenant(doc.tenantId, async () =>
      this.prisma.db.signatureRequest.findFirst({
        where: {
          documentId: doc.id,
          status: 'COMPLETED',
          signedFileId: { not: null },
        },
        orderBy: { completedAt: 'desc' },
      }),
    );
    const signedFile = signedReq?.signedFileId
      ? await this.files.get(doc.tenantId, signedReq.signedFileId)
      : null;
    const sealed = sealedReq?.sealedFileId
      ? await this.files.get(doc.tenantId, sealedReq.sealedFileId)
      : null;
    const matches =
      sha === signedFile?.sha256
        ? 'signed-copy'
        : sha === sealed?.sha256
          ? 'accepted-copy'
          : sha === original.sha256
            ? 'original'
            : 'different';
    const hasSignature = pdf.includes(Buffer.from('/ByteRange'));
    return {
      matches,
      fingerprint: sha,
      reference: info.reference,
      seal: hasSignature ? this.seal.verify(pdf) : null,
    };
  }
}
