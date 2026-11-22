import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { StorageMigrateService } from './storage-migrate.service.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function setup(rows: { storageKey: string; sha256: string }[]) {
  const local = new Map<string, string>();
  const bucket = new Map<string, string>();
  const storage = {
    local: {
      exists: async (k: string) => local.has(k),
      read: (k: string) => Readable.from([local.get(k)!]),
      remove: async (k: string) => void local.delete(k),
    },
    r2: {
      has: async (k: string) => bucket.has(k),
      save: async (k: string, d: Readable) => {
        let t = '';
        for await (const c of d) t += c;
        bucket.set(k, t);
      },
      readR2Only: async (k: string) => Readable.from([bucket.get(k)!]),
    },
  };
  const prisma = { db: { file: { findMany: async () => rows } } };
  const svc = new StorageMigrateService(prisma as never, storage as never);
  return { svc, local, bucket };
}

describe('StorageMigrateService', () => {
  it('copies, verifies the checksum and is safe to re-run', async () => {
    const { svc, local, bucket } = setup([
      { storageKey: 't/a', sha256: sha('aaa') },
    ]);
    local.set('t/a', 'aaa');
    expect(await svc.run({ dryRun: true })).toMatchObject({ copied: 1 });
    expect(bucket.size).toBe(0);
    expect(await svc.run({})).toMatchObject({ copied: 1, mismatched: [] });
    expect(await svc.run({})).toMatchObject({ copied: 0, alreadyPresent: 1 });
    expect(local.has('t/a')).toBe(true);
  });

  it('reports a mismatch and keeps that local copy', async () => {
    const { svc, local } = setup([
      { storageKey: 't/b', sha256: sha('expected') },
    ]);
    local.set('t/b', 'different');
    const r = await svc.run({ deleteLocal: true });
    expect(r.mismatched).toEqual(['t/b']);
    expect(r.deletedLocal).toBe(0);
    expect(local.has('t/b')).toBe(true);
  });

  it('deletes local copies only when verified in R2, and reports files missing everywhere', async () => {
    const { svc, local } = setup([
      { storageKey: 't/c', sha256: sha('ccc') },
      { storageKey: 't/gone', sha256: sha('x') },
    ]);
    local.set('t/c', 'ccc');
    const r = await svc.run({ deleteLocal: true });
    expect(r).toMatchObject({ deletedLocal: 1, missingLocally: ['t/gone'] });
    expect(local.has('t/c')).toBe(false);
  });
});
