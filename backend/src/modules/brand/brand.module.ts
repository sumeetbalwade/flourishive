import { Global, Module } from '@nestjs/common';
import { BrandController, PublicBrandController } from './brand.controller.js';
import { BrandService } from './brand.service.js';

@Global()
@Module({
  controllers: [BrandController, PublicBrandController],
  providers: [BrandService],
  exports: [BrandService],
})
export class BrandModule {}
