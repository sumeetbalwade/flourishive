import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../platform/config/config.js';
import { RedisService } from '../../../platform/cache/redis.service.js';
import { MockEsignProvider } from './mock.provider.js';
import type { EsignProvider } from './provider.js';

/** Picks the configured provider. `none` means the feature is off. */
@Injectable()
export class EsignGateway {
  private readonly impl: EsignProvider | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig, redis: RedisService) {
    this.impl =
      config.ESIGN_PROVIDER === 'mock'
        ? new MockEsignProvider(redis, config.API_URL)
        : null;
  }

  get enabled() {
    return this.impl !== null;
  }

  provider(): EsignProvider | null {
    return this.impl;
  }

  mock(): MockEsignProvider | null {
    return this.impl instanceof MockEsignProvider ? this.impl : null;
  }
}
