import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../platform/cache/redis.service.js';

const TTL = 86_400;

interface Stored {
  state: 'running' | 'done';
  hash: string;
  body?: unknown;
}

/**
 * Idempotency keys for create endpoints. The same key with the same request gives back the first
 * answer instead of creating a second letter. Kept for 24 hours.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: RedisService) {}

  async run<T>(
    clientId: string,
    key: string | undefined,
    request: unknown,
    fn: () => Promise<T>,
  ): Promise<{ body: T; replayed: boolean }> {
    if (!key) return { body: await fn(), replayed: false };
    if (key.length > 120)
      throw new HttpException(
        {
          code: 'IDEMPOTENCY_KEY_INVALID',
          message: 'Idempotency-Key is too long',
        },
        400,
      );
    const redisKey = `idem:${clientId}:${key}`;
    const hash = createHash('sha256')
      .update(JSON.stringify(request ?? null))
      .digest('hex');
    const mine: Stored = { state: 'running', hash };
    const got = await this.redis.client.set(
      redisKey,
      JSON.stringify(mine),
      'EX',
      TTL,
      'NX',
    );
    if (got !== 'OK') {
      const prior = JSON.parse(
        (await this.redis.client.get(redisKey)) ?? 'null',
      ) as Stored | null;
      if (prior) {
        if (prior.hash !== hash)
          throw new HttpException(
            {
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'That Idempotency-Key was used with a different request',
            },
            422,
          );
        if (prior.state === 'done')
          return { body: prior.body as T, replayed: true };
        throw new ConflictException({
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'A request with that Idempotency-Key is still being handled',
        });
      }
    }
    try {
      const body = await fn();
      await this.redis.client.set(
        redisKey,
        JSON.stringify({ state: 'done', hash, body } satisfies Stored),
        'EX',
        TTL,
      );
      return { body, replayed: false };
    } catch (e) {
      await this.redis.client.del(redisKey); // a failed attempt may be retried with the same key
      throw e;
    }
  }
}
