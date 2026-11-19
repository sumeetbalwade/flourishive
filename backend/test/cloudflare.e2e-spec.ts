import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { RedisService } from '../src/platform/cache/redis.service.js';

let app: INestApplication;

beforeAll(async () => {
  // The test client connects from loopback, so pretend loopback is Cloudflare.
  process.env.TRUST_CLOUDFLARE = 'true';
  process.env.CLOUDFLARE_IP_RANGES = '127.0.0.1/32,::1/128';
  app = (
    await Test.createTestingModule({ imports: [AppModule] }).compile()
  ).createNestApplication();
  configureApp(app);
  await app.init();
  await app.get(RedisService).client.flushdb();
});

afterAll(async () => {
  delete process.env.TRUST_CLOUDFLARE;
  delete process.env.CLOUDFLARE_IP_RANGES;
  await app.close();
});

const attempt = (visitor: string, n: number) =>
  request(app.getHttpServer())
    .post('/v1/auth/login')
    .set('CF-Connecting-IP', visitor)
    .send({
      tenant: 'nobody',
      email: `x${n}@nowhere.test`,
      password: 'wrong password!!',
    });

describe('behind Cloudflare', () => {
  it('counts sign-in failures per visitor, not per Cloudflare address', async () => {
    for (let i = 0; i < 5; i++) await attempt('198.51.100.1', i).expect(401);
    // The same visitor is now locked out...
    await attempt('198.51.100.1', 99).expect(429);
    // ...but another visitor behind the same Cloudflare connection is not.
    await attempt('198.51.100.2', 1).expect(401);
  });
});
