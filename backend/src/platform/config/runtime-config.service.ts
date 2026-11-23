import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import { RedisService } from '../cache/redis.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { runAsSystem } from '../database/tenant-context.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import {
  RUNTIME_KEYS,
  isRuntimeKey,
  type RuntimeGroup,
  type RuntimeKey,
} from './runtime-keys.js';

const CACHE_KEY = 'runtime-config';
const CACHE_SECONDS = 60;

interface Row {
  key: string;
  valueJson: unknown;
  secretEnc: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export type RuntimeValueOf<K extends RuntimeKey> = z.infer<
  (typeof RUNTIME_KEYS)[K]['schema']
>;

export interface RuntimeEntry {
  key: RuntimeKey;
  label: string;
  group: RuntimeGroup;
  hint: string;
  kind: 'text' | 'number' | 'boolean' | 'url' | 'secret';
  restartRequired: boolean;
  /** Where the value in use comes from. */
  source: 'console' | 'environment' | 'default' | 'unset';
  /** Plain values only; a secret is never returned. */
  value?: string | number | boolean;
  /** Secrets: whether a value exists, whatever its source. */
  isSet: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
}

/**
 * Platform settings that used to live only in `api.env` (D-57). The value in use is the one saved
 * from the console, else the environment variable, else the built-in default. Secrets are stored
 * encrypted, decrypted only at the point of use, and never returned by any API.
 */
@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    @Inject(APP_CONFIG) private readonly env: AppConfig,
  ) {}

  private async rows(): Promise<Map<string, Row>> {
    let list = await this.redis.getJson<Row[]>(CACHE_KEY).catch(() => null);
    if (!list) {
      const found = await runAsSystem(() =>
        this.prisma.db.platformConfig.findMany(),
      );
      list = found.map((r) => ({
        key: r.key,
        valueJson: r.valueJson,
        secretEnc: r.secretEnc,
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt.toISOString(),
      }));
      await this.redis
        .setJson(CACHE_KEY, list, CACHE_SECONDS)
        .catch(() => undefined);
    }
    return new Map(list.map((r) => [r.key, r]));
  }

  private fromEnv(key: RuntimeKey): string | number | boolean | undefined {
    const v = (this.env as Record<string, unknown>)[key];
    return typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
      ? v
      : undefined;
  }

  /** The value in use: console, then environment, then the built-in default. Secrets are decrypted here. */
  async get<K extends RuntimeKey>(
    key: K,
  ): Promise<RuntimeValueOf<K> | undefined> {
    const row = (await this.rows()).get(key);
    if (row?.secretEnc)
      return this.crypto.decrypt(row.secretEnc) as RuntimeValueOf<K>;
    if (row?.valueJson !== null && row?.valueJson !== undefined)
      return row.valueJson as RuntimeValueOf<K>;
    return this.fromEnv(key) as RuntimeValueOf<K> | undefined;
  }

  /** Like `get`, for values the caller cannot work without. */
  async require<K extends RuntimeKey>(key: K): Promise<RuntimeValueOf<K>> {
    const v = await this.get(key);
    if (v === undefined || v === '')
      throw new Error(`${RUNTIME_KEYS[key].label} is not configured`);
    return v;
  }

  /** Every key with where its value comes from, for the console. Secrets show only whether they are set. */
  async describe(): Promise<RuntimeEntry[]> {
    const rows = await this.rows();
    return (Object.keys(RUNTIME_KEYS) as RuntimeKey[]).map((key) => {
      const def = RUNTIME_KEYS[key] as (typeof RUNTIME_KEYS)[RuntimeKey] & {
        restartRequired?: boolean;
      };
      const row = rows.get(key);
      const stored = Boolean(
        row &&
        (row.secretEnc ||
          (row.valueJson !== null && row.valueJson !== undefined)),
      );
      const envValue = this.fromEnv(key);
      const source: RuntimeEntry['source'] = stored
        ? 'console'
        : envValue !== undefined && envValue !== ''
          ? 'environment'
          : 'unset';
      const secret = def.kind === 'secret';
      const value = stored
        ? (row!.valueJson as RuntimeEntry['value'])
        : envValue;
      return {
        key,
        label: def.label,
        group: def.group,
        hint: def.hint,
        kind: def.kind,
        restartRequired: Boolean(def.restartRequired),
        source,
        isSet: stored || (envValue !== undefined && envValue !== ''),
        ...(secret || value === undefined ? {} : { value }),
        ...(stored
          ? { updatedAt: row!.updatedAt, updatedBy: row!.updatedBy }
          : {}),
      };
    });
  }

  /** Saves a value from the console. The caller has already required step-up and writes the audit entry. */
  async set(key: string, value: unknown, actorId: string): Promise<void> {
    if (!isRuntimeKey(key)) throw new NotFoundException('Unknown setting');
    const def = RUNTIME_KEYS[key];
    const parsed = (def.schema as z.ZodType).safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    const data =
      def.kind === 'secret'
        ? {
            valueJson: undefined,
            secretEnc: this.crypto.encrypt(String(parsed.data)),
          }
        : { valueJson: parsed.data as never, secretEnc: null };
    await runAsSystem(() =>
      this.prisma.db.platformConfig.upsert({
        where: { key },
        update: { ...data, updatedBy: actorId },
        create: { key, ...data, updatedBy: actorId },
      }),
    );
    await this.redis.del(CACHE_KEY);
  }

  /** Forgets the console value, so the environment variable (or default) applies again. */
  async clear(key: string): Promise<void> {
    if (!isRuntimeKey(key)) throw new NotFoundException('Unknown setting');
    await runAsSystem(() =>
      this.prisma.db.platformConfig.deleteMany({ where: { key } }),
    );
    await this.redis.del(CACHE_KEY);
  }
}
