import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { tenantScopingExtension } from './tenant-scoping.js';

export function createPrismaClient(databaseUrl: string) {
  const adapter = new PrismaMariaDb(databaseUrl);
  return new PrismaClient({ adapter }).$extends(tenantScopingExtension);
}

export type ScopedPrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * The only database handle the application uses. Queries on tenant-owned
 * models run inside runInTenant(); cross-tenant platform code uses runAsSystem().
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: ScopedPrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.db = createPrismaClient(config.DATABASE_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
  }
}
