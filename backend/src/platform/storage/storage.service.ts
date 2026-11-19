import { Inject, Injectable } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CryptoService } from '../crypto/crypto.service.js';

/** Local-disk file storage outside public_html, with short-lived signed download URLs. */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly crypto: CryptoService,
  ) {
    this.root = resolve(config.STORAGE_DIR);
  }

  /** Resolves a storage key to a path, refusing anything that escapes the root. */
  private pathFor(key: string): string {
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

  /** Returns `expires` and `sig` query values for a download of `key`. */
  sign(
    key: string,
    ttlSeconds = 300,
    now = Date.now(),
  ): { expires: number; sig: string } {
    const expires = Math.floor(now / 1000) + ttlSeconds;
    return { expires, sig: this.crypto.hmac(`${key}:${expires}`) };
  }

  verify(key: string, expires: number, sig: string, now = Date.now()): boolean {
    return (
      expires * 1000 > now && this.crypto.verifyHmac(`${key}:${expires}`, sig)
    );
  }
}
