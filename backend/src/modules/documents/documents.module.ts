import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { FilesModule } from '../files/files.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { BulkService } from './bulk.service.js';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';
import { DocAccess } from './doc-access.service.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { LetterheadsService } from './letterheads.service.js';
import { NumberingService } from './numbering.service.js';
import { PdfService } from './pdf.service.js';
import { TemplatesService } from './templates.service.js';

@Module({
  imports: [AccessModule, FilesModule, SettingsModule, WorkflowModule],
  controllers: [DocumentsController, DeliveryController],
  providers: [
    BulkService,
    DeliveryService,
    DocAccess,
    DocumentsService,
    LetterheadsService,
    NumberingService,
    PdfService,
    TemplatesService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
