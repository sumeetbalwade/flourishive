import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PeopleController } from './people.controller.js';
import { PeopleImportService } from './people-import.service.js';
import { PeopleService } from './people.service.js';

@Module({
  imports: [AccessModule, IdentityModule],
  controllers: [PeopleController],
  providers: [PeopleService, PeopleImportService],
  exports: [PeopleService],
})
export class PeopleModule {}
