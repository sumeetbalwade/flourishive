import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { RedisService } from '../cache/redis.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { LocalDriver } from './local.driver.js';
import { R2Driver } from './r2.driver.js';
import type { DownloadUrlOptions, StorageDriver } from './storage-driver.js';

export const FALLBACK_COUNTER_KEY = 'storage:fallback_local';

/**
 * File storage with short-lived signed download URLs. The bytes live on local disk or in a private
 * R2 bucket (STORAGE_DRIVER); callers do not care which.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger('Storage');
  private readonly driver: StorageDriver;
  /** Set when STORAGE_DRIVER=r2; the migration command uses it directly. */
  readonly r2: R2Driver | null;
  readonly local: LocalDriver;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly crypto: CryptoService,
    @Optional() private readonly redis?: RedisService,
  ) {
    this.local = new LocalDriver(config.STORAGE_DIR);
    if (config.STORAGE_DRIVER === 'r2') {
      const {
        R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY,
        R2_BUCKET,
      } = config;
      if (
        !R2_ACCOUNT_ID ||
        !R2_ACCESS_KEY_ID ||
        !R2_SECRET_ACCESS_KEY ||
        !R2_BUCKET
      )
        throw new Error(
          'STORAGE_DRIVER=r2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET',
        );
      this.r2 = new R2Driver(
        {
          accountId: R2_ACCOUNT_ID,
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
          bucket: R2_BUCKET,
        },
        config.STORAGE_LOCAL_FALLBACK ? this.local : null,
        (key) => this.countFallback(key),
      );
      this.driver = this.r2;
    } else {
      this.r2 = null;
      this.driver = this.local;
    }
  }

  /** The key is logged; it holds ids, never names or other personal data. */
  private countFallback(key: string): void {
    this.log.warn(`storage.fallback_local ${key}`);
    void this.redis?.client.incr(FALLBACK_COUNTER_KEY).catch(() => undefined);
  }

  save(key: string, data: Readable): Promise<void> {
    return this.driver.save(key, data);
  }

  read(key: string): Readable {
    return this.driver.read(key);
  }

  exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  remove(key: string): Promise<void> {
    return this.driver.remove(key);
  }

  /**
   * A direct, short-lived link to the bytes, or null when the API has to stream them (local storage,
   * or an object that has not been copied to R2 yet). Only call this after the permission checks.
   */
  downloadUrl(key: string, opts: DownloadUrlOptions): Promise<string | null> {
    return this.driver.downloadUrl(key, { ttlSeconds: 300, ...opts });
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
