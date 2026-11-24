import { addDomainBody, setPrimaryDomainBody } from '@flourishive/schemas';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RequirePermission } from '../access/require-permission.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth, Public } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';
import { ZodPipe } from '../identity/zod.pipe.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { RedisService } from '../../platform/cache/redis.service.js';
import { DomainsService } from './domains.service.js';

const body = <T>(schema: z.ZodType<T>) => new ZodPipe(schema);

/** Company side: the company's own web addresses (D-69). */
@Controller('domains')
export class DomainsController {
  constructor(
    private readonly domains: DomainsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  private note(
    a: AccessClaims,
    action: string,
    req: Request,
    meta: Record<string, unknown>,
  ) {
    return this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action,
      entityType: 'tenant_domains',
      entityId: null,
      meta,
      ip: req.ip,
    });
  }

  private async slug(tenantId: string) {
    const t = await runAsSystem(async () =>
      this.prisma.db.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { slug: true },
      }),
    );
    return t.slug;
  }

  @RequirePermission('domains.manage')
  @Get()
  async state(@CurrentAuth() a: AccessClaims) {
    return this.domains.state(a.tenantId, await this.slug(a.tenantId));
  }

  @RequirePermission('domains.manage')
  @Post()
  async add(
    @CurrentAuth() a: AccessClaims,
    @Body(body(addDomainBody)) b: z.infer<typeof addDomainBody>,
    @Req() req: Request,
  ) {
    const v = await this.domains.add(a.tenantId, b.hostname);
    await this.note(a, 'domains.added', req, { hostname: b.hostname });
    return v;
  }

  @RequirePermission('domains.manage')
  @HttpCode(200)
  @Post(':id/check')
  async check(@CurrentAuth() a: AccessClaims, @Param('id') id: string) {
    return this.domains.check(a.tenantId, id);
  }

  @RequirePermission('domains.manage')
  @Put('primary')
  async primary(
    @CurrentAuth() a: AccessClaims,
    @Body(body(setPrimaryDomainBody)) b: z.infer<typeof setPrimaryDomainBody>,
    @Req() req: Request,
  ) {
    await this.domains.setPrimary(a.tenantId, a.userId, b.hostname);
    await this.note(a, 'domains.primary_changed', req, {
      hostname: b.hostname,
    });
    return this.domains.state(a.tenantId, await this.slug(a.tenantId));
  }

  @RequirePermission('domains.manage')
  @Delete(':id')
  async remove(
    @CurrentAuth() a: AccessClaims,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const hostname = await this.domains.remove(a.tenantId, id);
    // Emails must not keep pointing at an address that is gone.
    const state = await this.domains.state(
      a.tenantId,
      await this.slug(a.tenantId),
    );
    await this.note(a, 'domains.removed', req, { hostname });
    return state;
  }
}

const isLoopback = (ip: string | undefined) =>
  ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/** Open lookups used by browsers on a custom address, and by Caddy before it asks for a certificate. */
@Public()
@Controller()
export class DomainsPublicController {
  constructor(
    private readonly domains: DomainsService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Which company is the address the browser is on? Caddy forwards the visitor's own Host, so this reads
   * the Host header, not a parameter. An address that is not ours gets a 404.
   */
  @Get('public/host')
  async host(@Req() req: Request) {
    const host = req.hostname.toLowerCase();
    const slug = await this.domains.slugForHost(host, { markActive: true });
    if (!slug) throw new ForbiddenException('Unknown address');
    return { slug };
  }

  /**
   * Caddy asks this before getting a certificate (`on_demand_tls ask`). 200 only for a verified address, so
   * nobody can make us request certificates for names that are not set up. Only answers Caddy on this machine.
   */
  @Get('internal/domains/allowed')
  async allowed(
    @Query('domain') domain: string | undefined,
    @Req() req: Request,
  ) {
    if (!isLoopback(req.socket.remoteAddress) || req.headers['x-forwarded-for'])
      throw new ForbiddenException();
    const n = await this.redis.hit('domains:ask', 60);
    if (n > 120) throw new ForbiddenException('Too many requests');
    const d = (domain ?? '').toLowerCase();
    if (!d || !(await this.domains.allowedForCertificate(d)))
      throw new ForbiddenException('Not allowed');
    return { ok: true };
  }
}
