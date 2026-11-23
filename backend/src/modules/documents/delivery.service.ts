import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../../platform/cache/redis.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
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
import { SettingsService } from '../settings/settings.service.js';
import { DocAccess, type Actor } from './doc-access.service.js';

const LINK_DAYS = 30;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Emails an issued letter to its recipient as a private link, and decides when the file may be taken. */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly docAccess: DocAccess,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runtime: RuntimeConfigService,
  ) {}

  private async load(tenantId: string, id: string) {
    const doc = await runInTenant(tenantId, async () =>
      this.prisma.db.generatedDocument.findUnique({ where: { id } }),
    );
    if (!doc) throw new NotFoundException();
    return doc;
  }

  private async isIssued(tenantId: string, id: string) {
    const wf = await runInTenant(tenantId, async () =>
      this.prisma.db.workflowInstance.findUnique({
        where: {
          tenantId_subjectType_subjectId: {
            tenantId,
            subjectType: 'document',
            subjectId: id,
          },
        },
        select: { state: true },
      }),
    );
    return wf?.state === 'issued';
  }

  /** The newest finished copy: DSC-signed, else accepted and sealed, else the original. */
  private async finalFileId(
    tenantId: string,
    doc: { id: string; fileId: string },
  ) {
    const done = await runInTenant(tenantId, async () =>
      this.prisma.db.signatureRequest.findMany({
        where: { documentId: doc.id, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      }),
    );
    for (const r of done) {
      const id = r.signedFileId ?? r.sealedFileId;
      if (id) return id;
    }
    return doc.fileId;
  }

  /** Held means: an offer letter, the company holds offers, and nobody has released it. */
  private async held(
    tenantId: string,
    doc: { letterType: string; downloadReleasedAt: Date | null },
  ) {
    if (doc.letterType !== 'OFFER' || doc.downloadReleasedAt) return false;
    return this.settings.get('documents.holdOfferDownloads', { tenantId });
  }

  private recipientEmail(
    p: { personalEmail: string | null; workEmail: string | null } | null,
  ) {
    return p?.personalEmail ?? p?.workEmail ?? null;
  }

  async deliver(a: Actor, documentId: string, email?: string) {
    const doc = await this.load(a.tenantId, documentId);
    await this.docAccess.assert(a, 'documents.generate', doc.entityId);
    if (
      doc.status !== 'GENERATED' ||
      !(await this.isIssued(a.tenantId, doc.id))
    )
      throw new ConflictException('Only an issued letter can be emailed');
    const person = doc.personId
      ? await runInTenant(a.tenantId, async () =>
          this.prisma.db.person.findUnique({ where: { id: doc.personId! } }),
        )
      : null;
    const to = (email ?? this.recipientEmail(person))?.trim();
    if (!to)
      throw new BadRequestException(
        'There is no email address for this person. Enter one.',
      );
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000);
    await runInTenant(a.tenantId, async () =>
      this.prisma.db.deliveryLink.create({
        data: {
          tenantId: a.tenantId,
          documentId: doc.id,
          tokenHash: sha256(token),
          sentTo: to,
          expiresAt,
          createdBy: a.userId,
        },
      }),
    );
    const link = `${(await this.runtime.require('VERIFY_URL')).replace(/\/$/, '')}/letter/${token}`;
    const held = await this.held(a.tenantId, doc);
    const name = person ? `${person.firstName} ${person.lastName}` : 'there';
    await this.mail.send({
      to,
      subject: `Your letter: ${doc.reference}`,
      text: `Hello ${name},\n\nYour letter (${doc.reference}) is ready. Open this private link to see it${
        held ? '' : ' and download it'
      }:\n${link}\n${
        held
          ? '\nThe download opens once you have joined the organisation.\n'
          : ''
      }\nThe link works until ${expiresAt.toDateString()}. Do not forward it.`,
      fromName: await this.settings.get('branding.emailSenderName', {
        tenantId: a.tenantId,
      }),
    });
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: 'document.deliver',
      entityType: 'document',
      entityId: doc.id,
      meta: { reference: doc.reference },
    });
    return { sent: true, to, expiresAt, held };
  }

  /** Emails every issued letter in a bulk batch; reports the ones it could not send. */
  async deliverBatch(a: Actor, batchId: string) {
    const batch = await runInTenant(a.tenantId, async () =>
      this.prisma.db.bulkBatch.findUnique({
        where: { id: batchId },
        include: { rows: { orderBy: { position: 'asc' } } },
      }),
    );
    if (!batch) throw new NotFoundException();
    await this.docAccess.assert(a, 'documents.generate', batch.entityId);
    const results: { position: number; sent: boolean; reason?: string }[] = [];
    for (const row of batch.rows) {
      if (!row.documentId) {
        results.push({
          position: row.position,
          sent: false,
          reason: 'Not issued',
        });
        continue;
      }
      try {
        await this.deliver(a, row.documentId);
        results.push({ position: row.position, sent: true });
      } catch (e) {
        results.push({
          position: row.position,
          sent: false,
          reason: (e as Error).message.slice(0, 200),
        });
      }
    }
    return { results, sent: results.filter((r) => r.sent).length };
  }

  private async assertRelease(a: Actor, entityId: string) {
    if (
      !(await this.access.can(
        a.tenantId,
        a.userId,
        'documents.release',
        entityId,
      ))
    )
      throw new ForbiddenException(
        'Only an admin can release or hold downloads',
      );
  }

  async setRelease(a: Actor, documentId: string, released: boolean) {
    const doc = await this.load(a.tenantId, documentId);
    await this.assertRelease(a, doc.entityId);
    await runInTenant(a.tenantId, async () =>
      this.prisma.db.generatedDocument.update({
        where: { id: doc.id },
        data: released
          ? { downloadReleasedAt: new Date(), downloadReleasedBy: a.userId }
          : { downloadReleasedAt: null, downloadReleasedBy: null },
      }),
    );
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: released ? 'document.release' : 'document.hold',
      entityType: 'document',
      entityId: doc.id,
      meta: { reference: doc.reference },
    });
    return { released };
  }

  async revoke(a: Actor, documentId: string) {
    const doc = await this.load(a.tenantId, documentId);
    await this.docAccess.assert(a, 'documents.generate', doc.entityId);
    const r = await runInTenant(a.tenantId, async () =>
      this.prisma.db.deliveryLink.updateMany({
        where: { documentId: doc.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
    return { revoked: r.count };
  }

  /** What HR sees on a letter: whether it is held and how many links are live. */
  async status(a: Actor, documentId: string) {
    const doc = await this.load(a.tenantId, documentId);
    await this.docAccess.assert(a, 'documents.read', doc.entityId);
    const links = await runInTenant(a.tenantId, async () =>
      this.prisma.db.deliveryLink.findMany({
        where: { documentId: doc.id },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const now = new Date();
    return {
      held: await this.held(a.tenantId, doc),
      releasedAt: doc.downloadReleasedAt,
      links: links.map((l) => ({
        sentTo: l.sentTo,
        sentAt: l.createdAt,
        expiresAt: l.expiresAt,
        active: !l.revokedAt && l.expiresAt > now,
      })),
    };
  }

  // ---- public side: the private link is the credential ----

  private async resolve(token: string, ip: string | undefined) {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new NotFoundException();
    const r = await this.redis.rateLimit(
      `delivery:${ip ?? 'unknown'}`,
      60,
      600,
    );
    if (!r.allowed)
      throw new BadRequestException(
        'Too many tries. Please wait a few minutes.',
      );
    const link = await runAsSystem(async () =>
      this.prisma.db.deliveryLink.findUnique({
        where: { tokenHash: sha256(token) },
      }),
    );
    if (!link || link.revokedAt || link.expiresAt < new Date())
      throw new NotFoundException('This link is no longer valid');
    const doc = await this.load(link.tenantId, link.documentId);
    return { link, doc };
  }

  async describe(token: string, ip: string | undefined) {
    const { link, doc } = await this.resolve(token, ip);
    const entity = await runInTenant(link.tenantId, async () =>
      this.prisma.db.entity.findUniqueOrThrow({
        where: { id: doc.entityId },
        select: { legalName: true },
      }),
    );
    const held = await this.held(link.tenantId, doc);
    return {
      reference: doc.reference,
      letterType: doc.letterType,
      issuer: entity.legalName,
      issuedAt: doc.createdAt,
      downloadAllowed: !held,
      message: held
        ? 'You can download this letter once you have joined the organisation.'
        : null,
    };
  }

  async download(token: string, ip: string | undefined) {
    const { link, doc } = await this.resolve(token, ip);
    if (await this.held(link.tenantId, doc))
      throw new ForbiddenException(
        'You can download this letter once you have joined the organisation.',
      );
    const file = await this.files.get(
      link.tenantId,
      await this.finalFileId(link.tenantId, doc),
    );
    return {
      file,
      stream: this.storage.read(file.storageKey),
      url: await this.storage.downloadUrl(file.storageKey, {
        filename: `${doc.reference.replace(/[^\w.-]+/g, '_')}.pdf`,
        mimeType: 'application/pdf',
      }),
    };
  }
}
