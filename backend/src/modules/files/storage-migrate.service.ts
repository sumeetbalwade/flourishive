import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { StorageService } from '../../platform/storage/storage.service.js';

export interface MigrationSummary {
  copied: number;
  alreadyPresent: number;
  mismatched: string[];
  missingLocally: string[];
  deletedLocal: number;
}

/** Copies stored files from local disk to R2 and proves each copy by its sha256 (D-74). Safe to re-run. */
@Injectable()
export class StorageMigrateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async hashOf(stream: AsyncIterable<Buffer | Uint8Array>) {
    const h = createHash('sha256');
    for await (const c of stream) h.update(c);
    return h.digest('hex');
  }

  async run(opts: {
    dryRun?: boolean;
    deleteLocal?: boolean;
  }): Promise<MigrationSummary> {
    const r2 = this.storage.r2;
    if (!r2)
      throw new Error('Set STORAGE_DRIVER=r2 and the R2_* settings first');
    const files = await runAsSystem(
      async () =>
        await this.prisma.db.file.findMany({
          select: { storageKey: true, sha256: true },
        }),
    );
    const out: MigrationSummary = {
      copied: 0,
      alreadyPresent: 0,
      mismatched: [],
      missingLocally: [],
      deletedLocal: 0,
    };
    for (const f of files) {
      const inR2 = await r2.has(f.storageKey);
      const onDisk = await this.storage.local.exists(f.storageKey);
      if (!inR2) {
        if (!onDisk) {
          out.missingLocally.push(f.storageKey);
          continue;
        }
        if (opts.dryRun) {
          out.copied++;
          continue;
        }
        await r2.save(f.storageKey, this.storage.local.read(f.storageKey));
        out.copied++;
      } else out.alreadyPresent++;
      if (opts.dryRun) continue;
      // Re-read from R2 itself and compare with the hash recorded when the file was stored.
      const sum = await this.hashOf(await r2.readR2Only(f.storageKey));
      if (sum !== f.sha256) {
        out.mismatched.push(f.storageKey);
        continue;
      }
      if (opts.deleteLocal && onDisk) {
        await this.storage.local.remove(f.storageKey);
        out.deletedLocal++;
      }
    }
    return out;
  }
}
