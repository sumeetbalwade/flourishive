import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { RedisService } from '../cache/redis.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { RuntimeConfigService } from '../config/runtime-config.service.js';
import { LocalDriver } from './local.driver.js';
import { R2Driver } from './r2.driver.js';
import type { DownloadUrlOptions, StorageDriver } from './storage-driver.js';

export const FALLBACK_COUNTER_KEY = 'storage:fallback_local';

/**
 * File storage with short-lived signed download URLs. The bytes live on local disk or in a private
 * R2 bucket (STORAGE_DRIVER); callers do not care which.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger('Storage');
  private driver: StorageDriver;
  /** Set when STORAGE_DRIVER=r2; the migration command uses it directly. */
  r2: R2Driver | null;
  readonly local: LocalDriver;

  private readonly useR2: boolean;
  private readonly localFallback: boolean;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly runtime?: RuntimeConfigService,
  ) {
    this.local = new LocalDriver(config.STORAGE_DIR);
    this.useR2 = config.STORAGE_DRIVER === 'r2';
    this.localFallback = config.STORAGE_LOCAL_FALLBACK;
    this.r2 = null;
    this.driver = this.local;
    // With no runtime config (unit tests) the keys come from the environment straight away.
    if (this.useR2 && !runtime) this.buildR2(this.fromEnv());
  }

  private fromEnv() {
    const c = this.config;
    return {
      accountId: c.R2_ACCOUNT_ID,
      accessKeyId: c.R2_ACCESS_KEY_ID,
      secretAccessKey: c.R2_SECRET_ACCESS_KEY,
      bucket: c.R2_BUCKET,
    };
  }

  /** The R2 keys saved in the console win over the environment. Read once, so a change needs a restart. */
  async onModuleInit(): Promise<void> {
    if (!this.useR2 || !this.runtime) return;
    const [accountId, accessKeyId, secretAccessKey, bucket] = await Promise.all(
      [
        this.runtime.get('R2_ACCOUNT_ID'),
        this.runtime.get('R2_ACCESS_KEY_ID'),
        this.runtime.get('R2_SECRET_ACCESS_KEY'),
        this.runtime.get('R2_BUCKET'),
      ],
    );
    this.buildR2({ accountId, accessKeyId, secretAccessKey, bucket });
  }

  private buildR2(k: {
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucket?: string;
  }) {
    if (!k.accountId || !k.accessKeyId || !k.secretAccessKey || !k.bucket)
      throw new Error(
        'STORAGE_DRIVER=r2 needs the R2 account ID, access key ID, secret access key and bucket (set in the console or api.env)',
      );
    const r2 = new R2Driver(
      {
        accountId: k.accountId,
        accessKeyId: k.accessKeyId,
        secretAccessKey: k.secretAccessKey,
        bucket: k.bucket,
      },
      this.localFallback ? this.local : null,
      (key) => this.countFallback(key),
    );
    this.r2 = r2;
    this.driver = r2;
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

  /** How many reads had to use local disk since the counter was last cleared. */
  async fallbackReads(): Promise<number> {
    const raw = await this.redis?.client.get(FALLBACK_COUNTER_KEY);
    return raw ? Number(raw) : 0;
  }

  /** Writes, reads back and deletes a tiny test object, so a broken bucket or key is noticed early. */
  async check(): Promise<{
    driver: 'local' | 'r2';
    ok: boolean;
    latencyMs: number;
    error?: string;
    fallbackReads: number;
  }> {
    const driver = this.r2 ? 'r2' : 'local';
    const key = `_health/${randomUUID()}`;
    const started = Date.now();
    let error: string | undefined;
    try {
      await this.driver.save(key, Readable.from(['ok']));
      let text = '';
      for await (const c of this.driver.read(key)) text += c;
      if (text !== 'ok') throw new Error('Read back the wrong content');
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : 'Check failed';
    } finally {
      await this.driver.remove(key).catch(() => undefined);
    }
    return {
      driver,
      ok: !error,
      latencyMs: Date.now() - started,
      error,
      fallbackReads: await this.fallbackReads().catch(() => 0),
    };
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
