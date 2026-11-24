import {
  generateBody,
  tokenRequest,
  type GenerateBody,
  type TokenRequest,
} from '@flourishive/schemas';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { DocumentsService } from '../documents/documents.service.js';
import { Public } from '../identity/auth.context.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import {
  ApiClientGuard,
  RequireScope,
  type ApiRequest,
} from './api-client.guard.js';
import { ApiClientsService, type ApiPrincipal } from './api-clients.service.js';
import { IdempotencyService } from './idempotency.service.js';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /** ISO date: only records changed since then. */
  updatedSince: z.string().datetime().optional(),
  entityId: z.string().uuid().optional(),
});

const mayTouch = (who: ApiPrincipal, entityId: string) =>
  !who.entityIds || who.entityIds.includes(entityId);

/** OAuth 2.0 token endpoint for client credentials. */
@Public()
@Controller('oauth')
export class OAuthController {
  constructor(private readonly clients: ApiClientsService) {}

  @HttpCode(200)
  @Post('token')
  token(
    @Body(new ZodPipe(tokenRequest)) b: TokenRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.clients.token(b.client_id, b.client_secret, b.scope);
  }
}

/** The public API (D-20). Every route needs a client token with the right scope. */
@Public()
@UseGuards(ApiClientGuard)
@Controller('api')
export class PublicApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docs: DocumentsService,
    private readonly idem: IdempotencyService,
  ) {}

  private person(e: {
    id: string;
    employeeCode: string;
    type: string;
    status: string;
    entityId: string;
    startDate: Date;
    endDate: Date | null;
    updatedAt: Date;
    person: {
      id: string;
      firstName: string;
      lastName: string;
      workEmail: string | null;
      phone: string | null;
    };
    department: { name: string } | null;
    designation: { name: string } | null;
    location: { name: string } | null;
  }) {
    return {
      id: e.id,
      personId: e.person.id,
      employeeCode: e.employeeCode,
      type: e.type,
      status: e.status,
      companyId: e.entityId,
      firstName: e.person.firstName,
      lastName: e.person.lastName,
      workEmail: e.person.workEmail,
      phone: e.person.phone,
      department: e.department?.name ?? null,
      designation: e.designation?.name ?? null,
      location: e.location?.name ?? null,
      startDate: e.startDate.toISOString().slice(0, 10),
      endDate: e.endDate?.toISOString().slice(0, 10) ?? null,
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private readonly include = {
    person: true,
    department: true,
    designation: true,
    location: true,
  } as const;

  @RequireScope('employees:read')
  @Get('employees')
  async employees(
    @Req() req: ApiRequest,
    @Query(new ZodPipe(pageQuery)) q: z.infer<typeof pageQuery>,
  ) {
    const who = req.apiClient!;
    if (q.entityId && !mayTouch(who, q.entityId))
      throw new ForbiddenException(
        'That company is not allowed for this client',
      );
    const where = {
      ...(q.entityId
        ? { entityId: q.entityId }
        : who.entityIds
          ? { entityId: { in: who.entityIds } }
          : {}),
      ...(q.updatedSince
        ? { updatedAt: { gte: new Date(q.updatedSince) } }
        : {}),
    };
    const [total, rows] = await runInTenant(who.tenantId, async () =>
      Promise.all([
        this.prisma.db.engagement.count({ where }),
        this.prisma.db.engagement.findMany({
          where,
          include: this.include,
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]),
    );
    return {
      data: rows.map((r) => this.person(r)),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }

  @RequireScope('employees:read')
  @Get('employees/:id')
  async employee(@Req() req: ApiRequest, @Param('id') id: string) {
    const who = req.apiClient!;
    const e = await runInTenant(who.tenantId, async () =>
      this.prisma.db.engagement.findUnique({
        where: { id },
        include: this.include,
      }),
    );
    // A company outside the client's list is reported as missing, not forbidden.
    if (!e || !mayTouch(who, e.entityId)) throw new NotFoundException();
    return this.person(e);
  }

  @RequireScope('letters:create')
  @HttpCode(201)
  @Post('letters')
  async createLetter(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(generateBody)) b: GenerateBody,
  ) {
    const who = req.apiClient!;
    if (!mayTouch(who, b.entityId))
      throw new ForbiddenException(
        'That company is not allowed for this client',
      );
    const { body, replayed } = await this.idem.run(
      who.clientDbId,
      key,
      b,
      async () => {
        // The client acts as the person who made it, so it can never do more than they may.
        const doc = await this.docs.generate(
          { tenantId: who.tenantId, userId: who.actingUserId },
          b,
        );
        const out = {
          id: doc.id,
          reference: doc.reference,
          status: doc.status,
          companyId: doc.entityId,
          createdAt: doc.createdAt.toISOString(),
        };
        return out;
      },
    );
    if (replayed) {
      res.status(200);
      res.setHeader('Idempotent-Replayed', 'true');
    }
    return body;
  }

  @RequireScope('letters:read')
  @Get('letters/:id')
  async letter(@Req() req: ApiRequest, @Param('id') id: string) {
    const who = req.apiClient!;
    const d = await runInTenant(who.tenantId, async () =>
      this.prisma.db.generatedDocument.findUnique({ where: { id } }),
    );
    if (!d || !mayTouch(who, d.entityId)) throw new NotFoundException();
    return {
      id: d.id,
      reference: d.reference,
      status: d.status,
      companyId: d.entityId,
      personId: d.personId,
      engagementId: d.engagementId,
      pageCount: d.pageCount,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
