import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LocalDriver } from './local.driver.js';
import { R2Driver } from './r2.driver.js';
import type { StorageDriver } from './storage-driver.js';

const text = async (s: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString();
};

const s3 = mockClient(S3Client);
const notFound = () =>
  Object.assign(new Error('NotFound'), {
    name: 'NotFound',
    $metadata: { httpStatusCode: 404 },
  });

/** An in-memory bucket behind the mocked client. */
function fakeBucket() {
  const objects = new Map<string, Buffer>();
  s3.reset();
  s3.on(HeadObjectCommand).callsFake((i: { Key: string }) => {
    if (!objects.has(i.Key)) throw notFound();
    return {};
  });
  s3.on(PutObjectCommand).callsFake(
    async (i: { Key: string; Body: Readable | Uint8Array }) => {
      // Small files arrive as one buffer, larger ones as a stream.
      if (i.Body instanceof Uint8Array) {
        objects.set(i.Key, Buffer.from(i.Body));
        return {};
      }
      const chunks: Buffer[] = [];
      for await (const c of i.Body) chunks.push(Buffer.from(c as Uint8Array));
      objects.set(i.Key, Buffer.concat(chunks));
      return {};
    },
  );
  s3.on(GetObjectCommand).callsFake((i: { Key: string }) => {
    const o = objects.get(i.Key);
    if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { Body: Readable.from([o]) };
  });
  s3.on(DeleteObjectCommand).callsFake((i: { Key: string }) => {
    objects.delete(i.Key);
    return {};
  });
  return objects;
}

const settings = {
  accountId: 'acc',
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
  bucket: 'files',
};

let dir: string;
let local: LocalDriver;
let fallbacks: string[];
let r2: R2Driver;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fh-r2-'));
  local = new LocalDriver(dir);
  fallbacks = [];
  fakeBucket();
  r2 = new R2Driver(settings, local, (k) => fallbacks.push(k));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

// The same behaviour is expected from both drivers.
const drivers: [string, () => StorageDriver][] = [
  ['local', () => local],
  ['r2', () => r2],
];
describe.each(drivers)('%s driver contract', (_name, make) => {
  it('saves, reads, checks and removes a file', async () => {
    const d = make();
    await d.save('t1/a.txt', Readable.from(['hello']));
    expect(await d.exists('t1/a.txt')).toBe(true);
    expect(await text(d.read('t1/a.txt'))).toBe('hello');
    await d.remove('t1/a.txt');
    expect(await d.exists('t1/a.txt')).toBe(false);
  });

  it('never overwrites an existing key', async () => {
    const d = make();
    await d.save('t1/a.txt', Readable.from(['one']));
    await expect(d.save('t1/a.txt', Readable.from(['two']))).rejects.toThrow();
    expect(await text(d.read('t1/a.txt'))).toBe('one');
  });

  it.each(['../evil', '/abs', 'a/../b', 'a//b', ''])(
    'refuses the key %j',
    async (key) => {
      await expect(make().save(key, Readable.from(['x']))).rejects.toThrow(
        'Invalid storage key',
      );
    },
  );
});

describe('R2Driver', () => {
  it('presigns a short link carrying the filename and type', async () => {
    await r2.save('t1/a.pdf', Readable.from(['x']));
    const url = new URL(
      (await r2.downloadUrl('t1/a.pdf', {
        filename: 'Offer é.pdf',
        mimeType: 'application/pdf',
        disposition: 'inline',
        ttlSeconds: 300,
      }))!,
    );
    expect(url.hostname).toBe('files.acc.r2.cloudflarestorage.com');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-type')).toBe(
      'application/pdf',
    );
    expect(url.searchParams.get('response-content-disposition')).toContain(
      "filename*=UTF-8''Offer%20%C3%A9.pdf",
    );
    expect(url.searchParams.get('response-content-disposition')).toMatch(
      /^inline;/,
    );
  });

  it('gives no link for a file that is only on local disk, and streams it as a counted fallback', async () => {
    await local.save('t1/old.pdf', Readable.from(['legacy']));
    expect(
      await r2.downloadUrl('t1/old.pdf', { filename: 'o.pdf', mimeType: 'x' }),
    ).toBeNull();
    expect(await text(r2.read('t1/old.pdf'))).toBe('legacy');
    expect(await r2.exists('t1/old.pdf')).toBe(true);
    expect(fallbacks).toEqual(['t1/old.pdf', 't1/old.pdf']);
  });

  it('does not fall back when switched off', async () => {
    const strict = new R2Driver(settings, null);
    await local.save('t1/old.pdf', Readable.from(['legacy']));
    expect(await strict.exists('t1/old.pdf')).toBe(false);
    await expect(text(strict.read('t1/old.pdf'))).rejects.toThrow();
  });

  it('deletes the local copy too', async () => {
    await local.save('t1/b.txt', Readable.from(['b']));
    await r2.remove('t1/b.txt');
    expect(await local.exists('t1/b.txt')).toBe(false);
  });
});
