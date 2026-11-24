import { Global, Module } from '@nestjs/common';
import { BrandAssetsService } from './brand-assets.service.js';
import { BrandController, PublicBrandController } from './brand.controller.js';
import { BrandService } from './brand.service.js';

@Global()
@Module({
  controllers: [BrandController, PublicBrandController],
  providers: [BrandService, BrandAssetsService],
  exports: [BrandService, BrandAssetsService],
})
export class BrandModule {}
