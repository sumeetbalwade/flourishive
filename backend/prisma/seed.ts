import { createPrismaClient } from '../src/platform/database/prisma.service.js';
import { runAsSystem } from '../src/platform/database/tenant-context.js';

/** Idempotent seed: Flourisense is tenant #1 (D-01). */
const db = createPrismaClient(process.env.DATABASE_URL!);

await runAsSystem(async () => {
  const tenant = await db.tenant.upsert({
    where: { slug: 'flourisense' },
    update: {},
    create: { slug: 'flourisense', name: 'Flourisense' },
  });
  await db.entity.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Flourisense' } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Flourisense',
      legalName: 'Flourisense',
    },
  });
  console.log(`Seeded tenant ${tenant.slug} (${tenant.id})`);

  // Fake second tenant for local development of cross-tenant behaviour.
  if (process.env.NODE_ENV !== 'production') {
    const demo = await db.tenant.upsert({
      where: { slug: 'demo-co' },
      update: {},
      create: { slug: 'demo-co', name: 'Demo Co (fake)' },
    });
    await db.entity.upsert({
      where: { tenantId_name: { tenantId: demo.id, name: 'Demo Co' } },
      update: {},
      create: {
        tenantId: demo.id,
        name: 'Demo Co',
        legalName: 'Demo Co Pvt Ltd',
      },
    });
    console.log(`Seeded tenant ${demo.slug} (${demo.id})`);
  }
});
await db.$disconnect();
