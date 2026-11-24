import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  SLOT_OF,
  type BrandAssetKind,
  type BrandPatch,
} from '@flourishive/schemas';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { StorageService } from '../../platform/storage/storage.service.js';
import { processImage, toIco } from './image-process.js';

export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
/**
 * Logos, the favicon and the sign-in picture (D-61). Files are checked by their bytes (PNG, JPEG or WebP
 * only), capped at 2 MB and a largest side, stored privately and served by id. A level's brand can only point
 * at that level's own images.
 */
@Injectable()
export class BrandAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  async upload(
    tenantId: string | null,
    by: string | null,
    kind: BrandAssetKind,
    body: unknown,
  ) {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestException('Send the picture as the request body');
    if (body.length > MAX_ASSET_BYTES)
      throw new PayloadTooLargeException('Pictures can be at most 2 MB');
    const out = await processImage(kind, body);
    const id = randomUUID();
    const storageKey = `brand/${tenantId ?? 'platform'}/${id}`;
    await this.storage.save(storageKey, Readable.from(out.body));
    try {
      const row = await runAsSystem(
        async () =>
          await this.db.brandAsset.create({
            data: {
              id,
              scope: tenantId ? 'TENANT' : 'PLATFORM',
              tenantId,
              kind,
              mimeType: out.mime,
              sizeBytes: out.body.length,
              width: out.width,
              height: out.height,
              sha256: createHash('sha256').update(out.body).digest('hex'),
              storageKey,
              uploadedBy: by,
            },
          }),
      );
      return { id: row.id, kind, width: row.width, height: row.height };
    } catch (e) {
      await this.storage.remove(storageKey);
      throw e;
    }
  }

  /** Every image a patch points at must be this level's own, in the slot it was uploaded for. */
  async assertPatchAssets(
    tenantId: string | null,
    patch: BrandPatch,
  ): Promise<void> {
    if (!patch.assets) return;
    for (const [kind, slot] of Object.entries(SLOT_OF) as [
      BrandAssetKind,
      keyof NonNullable<BrandPatch['assets']>,
    ][]) {
      const id = patch.assets[slot];
      if (!id) continue;
      const row = await runAsSystem(
        async () =>
          await this.db.brandAsset.findFirst({
            where: tenantId
              ? { id, tenantId, scope: 'TENANT' }
              : { id, tenantId: null, scope: 'PLATFORM' },
          }),
      );
      if (!row || row.kind !== kind)
        throw new BadRequestException(
          `assets.${slot}: that picture is not available here`,
        );
    }
  }

  /** The favicon as an .ico, made from the stored picture. */
  async ico(id: string): Promise<Buffer> {
    const { row, stream } = await this.open(id);
    if (row.kind !== 'FAVICON' || row.mimeType === 'image/svg+xml') {
      stream.destroy();
      throw new NotFoundException();
    }
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
    return toIco(Buffer.concat(chunks));
  }

  /** For the public image route. Null when it does not exist. */
  async open(id: string) {
    const row = await runAsSystem(
      async () => await this.db.brandAsset.findUnique({ where: { id } }),
    );
    if (!row) throw new NotFoundException();
    return { row, stream: this.storage.read(row.storageKey) };
  }
}
