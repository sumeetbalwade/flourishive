import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config.js';
import { RuntimeConfigService } from './runtime-config.service.js';

/**
 * Local development keeps its settings in backend/.env. Variables that are already
 * set (cPanel, CI, tests) always win, because loadEnvFile never overrides them.
 */
function loadDotEnv(): void {
  if (process.env.NODE_ENV === 'production') return;
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: rely on the real environment.
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => {
        loadDotEnv();
        return loadConfig();
      },
    },
    RuntimeConfigService,
  ],
  exports: [APP_CONFIG, RuntimeConfigService],
})
export class ConfigModule {}
