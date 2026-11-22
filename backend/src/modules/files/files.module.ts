import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { StorageMigrateService } from './storage-migrate.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [FilesController],
  providers: [FilesService, StorageMigrateService],
  exports: [FilesService, StorageMigrateService],
})
export class FilesModule {}
