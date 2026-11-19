import type { PrismaService } from '../src/platform/database/prisma.service.js';
import { runAsSystem } from '../src/platform/database/tenant-context.js';

/** Deletes a test tenant and everything under it, children first. */
export async function deleteTenantData(
  prisma: PrismaService,
  slug: string,
): Promise<void> {
  await runAsSystem(async () => {
    const tenant = await prisma.db.tenant.findUnique({ where: { slug } });
    if (!tenant) return;
    const where = { tenantId: tenant.id };
    await prisma.db.refreshToken.deleteMany({ where });
    await prisma.db.session.deleteMany({ where });
    await prisma.db.recoveryCode.deleteMany({ where });
    await prisma.db.user.deleteMany({ where });
    await prisma.db.jobRecord.deleteMany({ where });
    await prisma.db.entity.deleteMany({ where });
    await prisma.db.tenant.delete({ where: { id: tenant.id } });
  });
}
