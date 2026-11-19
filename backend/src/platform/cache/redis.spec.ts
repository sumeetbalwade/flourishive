import { loadConfig } from '../config/config.js';
import { RedisService } from './redis.service.js';

const redis = new RedisService(
  loadConfig({
    DATABASE_URL: 'x',
    FIELD_ENCRYPTION_KEY: 'ab'.repeat(32),
    HMAC_SECRET: 'x'.repeat(32),
    REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  }),
);
const key = `test:${Date.now()}`;

afterAll(async () => {
  await redis.del(key, `rl:${key}`);
  await redis.onModuleDestroy();
});

describe('RedisService (needs local Redis)', () => {
  it('round-trips JSON with a TTL', async () => {
    await redis.setJson(key, { a: 1 }, 30);
    expect(await redis.getJson(key)).toEqual({ a: 1 });
  });

  it('rate limits after the allowed count', async () => {
    const results = [];
    for (let i = 0; i < 3; i++)
      results.push((await redis.rateLimit(key, 2, 30)).allowed);
    expect(results).toEqual([true, true, false]);
  });
});
