import { Injectable } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'node:crypto';
import { RedisService } from '../../platform/cache/redis.service.js';
import { sha256 } from './token.service.js';

const MAX_TRIES = 5;

interface Stored {
  hash: string;
  tries: number;
}

/**
 * Six-digit one-time codes for account recovery. Only a hash is kept (in Redis, with an
 * expiry), a code works once, and five wrong guesses burn it. The code is never written
 * to the database or to the notifications table.
 */
@Injectable()
export class OtpService {
  constructor(private readonly redis: RedisService) {}

  private key(purpose: string, subject: string) {
    return `otp:${purpose}:${subject}`;
  }
  private digest(code: string, subject: string) {
    return sha256(`${subject}:${code}`);
  }

  /** Replaces any earlier code for the same purpose and person. */
  async issue(
    purpose: string,
    subject: string,
    ttlSeconds: number,
  ): Promise<string> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis.setJson(
      this.key(purpose, subject),
      { hash: this.digest(code, subject), tries: 0 },
      ttlSeconds,
    );
    return code;
  }

  async verify(
    purpose: string,
    subject: string,
    code: string,
  ): Promise<boolean> {
    const key = this.key(purpose, subject);
    const stored = await this.redis.getJson<Stored>(key);
    if (!stored) return false;
    const a = Buffer.from(this.digest(code, subject));
    const b = Buffer.from(stored.hash);
    if (a.length === b.length && timingSafeEqual(a, b))
      // Consume on success. The delete is the gate: only one caller can win it.
      return (await this.redis.del(key)) === 1;
    if (stored.tries + 1 >= MAX_TRIES) await this.redis.del(key);
    else
      await this.redis.setJson(
        key,
        { ...stored, tries: stored.tries + 1 },
        Math.max(1, await this.redis.client.ttl(key)),
      );
    return false;
  }
}
