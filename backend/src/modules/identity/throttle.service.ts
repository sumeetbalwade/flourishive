import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';

/**
 * Redis-backed lockouts shared by every API process. Failures are counted per
 * account and per IP so one attacker cannot lock out everyone or spray freely.
 */
@Injectable()
export class ThrottleService {
  constructor(private readonly redis: RedisService) {}

  private static readonly LIMITS = {
    login: { max: 5, windowSeconds: 15 * 60 },
    mfa: { max: 5, windowSeconds: 10 * 60 },
    reset: { max: 5, windowSeconds: 60 * 60 },
  } as const;

  /** Throws 429 if the key is already locked. Call before checking credentials. */
  async assertNotLocked(
    kind: keyof typeof ThrottleService.LIMITS,
    ...keys: string[]
  ): Promise<void> {
    return this.assertBelow(kind, ThrottleService.LIMITS[kind].max, ...keys);
  }

  /** Same as assertNotLocked, with a lock threshold chosen by the company's settings. */
  async assertBelow(
    kind: keyof typeof ThrottleService.LIMITS,
    max: number,
    ...keys: string[]
  ): Promise<void> {
    for (const key of keys) {
      const count = Number(
        (await this.redis.client.get(`fail:${kind}:${key}`)) ?? 0,
      );
      if (count >= max) {
        throw new HttpException(
          'Too many attempts. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  async recordFailure(
    kind: keyof typeof ThrottleService.LIMITS,
    ...keys: string[]
  ): Promise<void> {
    const { windowSeconds } = ThrottleService.LIMITS[kind];
    await Promise.all(
      keys.map((k) => this.redis.hit(`fail:${kind}:${k}`, windowSeconds)),
    );
  }

  async clear(
    kind: keyof typeof ThrottleService.LIMITS,
    ...keys: string[]
  ): Promise<void> {
    await this.redis.del(...keys.map((k) => `fail:${kind}:${k}`));
  }
}
