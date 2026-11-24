import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { FilesModule } from '../files/files.module.js';
import { CustomFieldsController } from './custom-fields.controller.js';
import { CustomFieldsService } from './custom-fields.service.js';

/** Custom fields on people and engagements, with role-based visibility (D-29). */
@Module({
  imports: [AccessModule, FilesModule],
  controllers: [CustomFieldsController],
  providers: [CustomFieldsService],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
