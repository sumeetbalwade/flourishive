import { describe, expect, it } from 'vitest';
import { CryptoService } from '../crypto/crypto.service.js';
import type { AppConfig } from './config.js';
import { RuntimeConfigService } from './runtime-config.service.js';

const env = {
  FIELD_ENCRYPTION_KEY: 'a'.repeat(64),
  HMAC_SECRET: 'h'.repeat(32),
  SMTP_HOST: 'env-host',
  SMTP_PORT: 1025,
  VERIFY_URL: 'http://localhost:5175',
} as unknown as AppConfig;

function make() {
  const rows = new Map<string, Record<string, unknown>>();
  const cache = new Map<string, string>();
  const prisma = {
    db: {
      platformConfig: {
        findMany: async () =>
          [...rows.values()].map((r) => ({ updatedAt: new Date(), ...r })),
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) =>
          rows.set(where.key, {
            ...(rows.get(where.key) ?? create),
            ...update,
          }),
        deleteMany: async ({ where }: { where: { key: string } }) =>
          rows.delete(where.key),
      },
    },
  };
  const redis = {
    getJson: async (k: string) =>
      cache.has(k) ? JSON.parse(cache.get(k)!) : null,
    setJson: async (k: string, v: unknown) =>
      void cache.set(k, JSON.stringify(v)),
    del: async (k: string) => void cache.delete(k),
  };
  const crypto = new CryptoService(env);
  const svc = new RuntimeConfigService(
    prisma as never,
    redis as never,
    crypto,
    env,
  );
  return { svc, rows };
}

describe('runtime config', () => {
  it('falls back to the environment, then uses what the console saved', async () => {
    const { svc } = make();
    expect(await svc.get('SMTP_HOST')).toBe('env-host');
    await svc.set('SMTP_HOST', 'smtp.example.com', 'staff-1');
    expect(await svc.get('SMTP_HOST')).toBe('smtp.example.com');
    await svc.clear('SMTP_HOST');
    expect(await svc.get('SMTP_HOST')).toBe('env-host');
  });

  it('rejects a value of the wrong shape and an unknown key', async () => {
    const { svc } = make();
    await expect(svc.set('SMTP_PORT', 'abc', 'x')).rejects.toThrow();
    await expect(svc.set('NOPE', 'x', 'x')).rejects.toThrow();
    await expect(
      svc.set('TENANT_URL_TEMPLATE', 'https://x.in', 'x'),
    ).rejects.toThrow();
  });

  it('stores a secret encrypted and never describes its value', async () => {
    const { svc, rows } = make();
    await svc.set('SMTP_PASS', 'hunter2-hunter2', 'staff-1');
    expect(JSON.stringify([...rows.values()])).not.toContain('hunter2');
    expect(await svc.get('SMTP_PASS')).toBe('hunter2-hunter2');
    const entry = (await svc.describe()).find((e) => e.key === 'SMTP_PASS')!;
    expect(entry).toMatchObject({
      isSet: true,
      source: 'console',
      updatedBy: 'staff-1',
    });
    expect(entry).not.toHaveProperty('value');
    expect(JSON.stringify(await svc.describe())).not.toContain('hunter2');
  });

  it('tells where each value comes from', async () => {
    const { svc } = make();
    const by = async () =>
      Object.fromEntries((await svc.describe()).map((e) => [e.key, e.source]));
    expect((await by()).SMTP_HOST).toBe('environment');
    expect((await by()).GOOGLE_CLIENT_ID).toBe('unset');
    await svc.set(
      'GOOGLE_CLIENT_ID',
      'abc-123.apps.googleusercontent.com',
      'x',
    );
    expect((await by()).GOOGLE_CLIENT_ID).toBe('console');
  });
});
