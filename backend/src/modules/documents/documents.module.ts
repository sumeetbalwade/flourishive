import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { FilesModule } from '../files/files.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { BulkService } from './bulk.service.js';
import { DocAccess } from './doc-access.service.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { LetterheadsService } from './letterheads.service.js';
import { NumberingService } from './numbering.service.js';
import { PdfService } from './pdf.service.js';
import { TemplatesService } from './templates.service.js';

@Module({
  imports: [AccessModule, FilesModule, WorkflowModule],
  controllers: [DocumentsController],
  providers: [
    BulkService,
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
