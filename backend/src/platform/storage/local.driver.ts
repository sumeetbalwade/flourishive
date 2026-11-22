import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { assertSafeKey, type StorageDriver } from './storage-driver.js';

/** Files on local disk outside public_html. The API streams every download. */
export class LocalDriver implements StorageDriver {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  /** Resolves a storage key to a path, refusing anything that escapes the root. */
  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep))
      throw new Error('Invalid storage key');
    return full;
  }

  async save(key: string, data: Readable): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await pipeline(data, createWriteStream(path, { flags: 'wx' }));
  }

  read(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.pathFor(key)).then(
      () => true,
      () => false,
    );
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  downloadUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
