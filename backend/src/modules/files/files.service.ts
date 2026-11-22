import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../../platform/storage/storage.service.js';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Allowed types, and the leading bytes each must really start with (a renamed .exe is refused). */
const ALLOWED: Record<string, { magic: number[] }> = {
  'application/pdf': { magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  'image/png': { magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { magic: [0xff, 0xd8, 0xff] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
};
export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED);

/** Keeps only safe characters so a name can go into a header or a path unharmed. */
export function safeFileName(name: string): string {
  const base = name.replaceAll('\\', '/').split('/').pop() ?? 'file';
  const cleaned = base
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return cleaned || 'file';
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * A file may be attached to one record of this company (`ownerType` + `ownerId` together). The
   * record must exist in the caller's own company, so a file can never point at someone else's data.
   */
  private async assertOwner(
    tenantId: string,
    ownerType?: string,
    ownerId?: string,
  ): Promise<void> {
    if (!ownerType && !ownerId) return;
    if (!ownerType || !ownerId)
      throw new BadRequestException('Send ownerType and ownerId together');
    const found = await runInTenant(tenantId, async () => {
      if (ownerType === 'person')
        return await this.prisma.db.person.findUnique({
          where: { id: ownerId },
          select: { id: true },
        });
      if (ownerType === 'engagement')
        return await this.prisma.db.engagement.findUnique({
          where: { id: ownerId },
          select: { id: true },
        });
      throw new BadRequestException('ownerType must be person or engagement');
    });
    if (!found) throw new BadRequestException('That owner does not exist');
  }

  async upload(
    a: { tenantId: string; userId: string },
    input: {
      body: Buffer;
      mimeType: string;
      name: string;
      ownerType?: string;
      ownerId?: string;
    },
  ) {
    const rule = ALLOWED[input.mimeType];
    if (!rule)
      throw new UnsupportedMediaTypeException(
        `Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    if (!Buffer.isBuffer(input.body) || input.body.length === 0)
      throw new BadRequestException('The file is empty');
    const maxMb = Math.min(
      await this.settings.get('files.maxUploadMb', { tenantId: a.tenantId }),
      MAX_FILE_BYTES / 1024 / 1024,
    );
    if (input.body.length > maxMb * 1024 * 1024)
      throw new PayloadTooLargeException(`Files can be at most ${maxMb} MB`);
    if (!rule.magic.every((byte, i) => input.body[i] === byte)) {
      throw new UnsupportedMediaTypeException(
        'The file content does not match its type',
      );
    }
    await this.assertOwner(a.tenantId, input.ownerType, input.ownerId);
    const id = randomUUID();
    const year = new Date().getUTCFullYear();
    const storageKey = `${a.tenantId}/${year}/${id}`;
    await this.storage.save(storageKey, Readable.from(input.body));
    try {
      return await runInTenant(a.tenantId, async () =>
        this.prisma.db.file.create({
          data: {
            id,
            tenantId: a.tenantId,
            storageKey,
            originalName: safeFileName(input.name),
            mimeType: input.mimeType,
            sizeBytes: input.body.length,
            sha256: createHash('sha256').update(input.body).digest('hex'),
            uploadedBy: a.userId,
            ownerType: input.ownerType ?? null,
            ownerId: input.ownerId ?? null,
          },
        }),
      );
    } catch (e) {
      await this.storage.remove(storageKey); // no orphaned bytes if the row could not be written
      throw e;
    }
  }

  /**
   * Stores bytes the server itself produced or already validated (generated documents,
   * letterheads). Skips the upload size setting and owner check, but still records the hash.
   */
  async storeTrusted(
    a: { tenantId: string; userId?: string | null },
    input: {
      body: Buffer;
      mimeType: string;
      name: string;
      ownerType: string;
      ownerId?: string;
    },
  ) {
    const id = randomUUID();
    const storageKey = `${a.tenantId}/${new Date().getUTCFullYear()}/${id}`;
    await this.storage.save(storageKey, Readable.from(input.body));
    try {
      return await runInTenant(a.tenantId, async () =>
        this.prisma.db.file.create({
          data: {
            id,
            tenantId: a.tenantId,
            storageKey,
            originalName: safeFileName(input.name),
            mimeType: input.mimeType,
            sizeBytes: input.body.length,
            sha256: createHash('sha256').update(input.body).digest('hex'),
            uploadedBy: a.userId ?? null,
            ownerType: input.ownerType,
            ownerId: input.ownerId ?? null,
          },
        }),
      );
    } catch (e) {
      await this.storage.remove(storageKey);
      throw e;
    }
  }

  async get(tenantId: string, id: string) {
    const file = await runInTenant(
      tenantId,
      async () =>
        await this.prisma.db.file.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!file) throw new NotFoundException();
    return file;
  }

  /** Short-lived link that works without a bearer token (for <a href> and the desktop app). */
  async linkFor(tenantId: string, id: string) {
    const file = await this.get(tenantId, id);
    const { expires, sig } = this.storage.sign(file.storageKey, 300);
    return {
      file,
      url: `/v1/files/${file.id}/content?expires=${expires}&sig=${sig}`,
      expiresAt: new Date(expires * 1000),
    };
  }

  /** Resolves a signed link. The signature, not a login, is the credential. */
  async openSigned(id: string, expires: number, sig: string) {
    // Looked up across tenants by id: the HMAC below is what authorises the read.
    const file = await runAsSystem(
      async () =>
        await this.prisma.db.file.findFirst({ where: { id, deletedAt: null } }),
    );
    if (
      !file ||
      !Number.isFinite(expires) ||
      !this.storage.verify(file.storageKey, expires, sig)
    ) {
      throw new NotFoundException();
    }
    return {
      file,
      stream: this.storage.read(file.storageKey),
      url: await this.storage.downloadUrl(file.storageKey, {
        filename: file.originalName,
        mimeType: file.mimeType,
      }),
    };
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.get(tenantId, id);
    await runInTenant(tenantId, async () => {
      await this.prisma.db.file.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }
}
