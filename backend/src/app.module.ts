import { Module } from '@nestjs/common';
import { HealthController } from './platform/health/health.controller.js';

@Module({
  imports: [],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
