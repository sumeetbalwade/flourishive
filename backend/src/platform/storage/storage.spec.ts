import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { loadConfig } from '../config/config.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { StorageService } from './storage.service.js';

let dir: string;
let storage: StorageService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fh-storage-'));
  const config = loadConfig({
    DATABASE_URL: 'x',
    FIELD_ENCRYPTION_KEY: 'ab'.repeat(32),
    HMAC_SECRET: 'x'.repeat(32),
    JWT_SECRET: 'j'.repeat(32),
    STORAGE_DIR: dir,
  });
  storage = new StorageService(config, new CryptoService(config));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('StorageService', () => {
  it('saves, reads and removes a file', async () => {
    await storage.save('t1/a.txt', Readable.from(['hello']));
    expect(await storage.exists('t1/a.txt')).toBe(true);
    const chunks: Buffer[] = [];
    for await (const c of storage.read('t1/a.txt')) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello');
    await storage.remove('t1/a.txt');
    expect(await storage.exists('t1/a.txt')).toBe(false);
  });

  it('checks itself by writing, reading and removing a test file', async () => {
    const r = await storage.check();
    expect(r).toMatchObject({ driver: 'local', ok: true, fallbackReads: 0 });
    expect(await storage.exists(`_health/none`)).toBe(false);
  });

  it('refuses keys that escape the storage root', async () => {
    await expect(
      storage.save('../evil.txt', Readable.from(['x'])),
    ).rejects.toThrow('Invalid storage key');
  });

  it('signs URLs that expire and cannot be reused for another key', () => {
    const { expires, sig } = storage.sign('t1/a.txt', 60, 0);
    expect(storage.verify('t1/a.txt', expires, sig, 1000)).toBe(true);
    expect(storage.verify('t1/b.txt', expires, sig, 1000)).toBe(false);
    expect(storage.verify('t1/a.txt', expires, sig, 61_000)).toBe(false);
  });
});
