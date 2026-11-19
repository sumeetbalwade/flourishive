import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { AuditService } from './audit.service.js';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(64).optional(),
  action: z.string().max(120).optional(),
});

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit.read')
  list(
    @CurrentAuth() a: AccessClaims,
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.audit.list(a.tenantId, q);
  }

  /** Re-computes the hash chain and reports the first broken row, if any. */
  @Get('verify')
  @RequirePermission('audit.read')
  verify(@CurrentAuth() a: AccessClaims) {
    return this.audit.verifyChain(a.tenantId);
  }
}
