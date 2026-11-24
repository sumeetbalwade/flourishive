import type {
  ApiClientBody,
  ApiClientCreated,
  ApiClientView,
  ApiScope,
} from '@flourishive/schemas';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { sha256 } from '../identity/token.service.js';

const TOKEN_TTL = 3600;
const ISSUER = 'flourishive-api';
const AUDIENCE = 'api-client';

export interface ApiPrincipal {
  clientDbId: string;
  tenantId: string;
  clientId: string;
  actingUserId: string;
  scopes: ApiScope[];
  entityIds: string[] | null;
  rateLimitPerMinute: number;
}

type Row = Awaited<
  ReturnType<PrismaService['db']['apiClient']['findFirstOrThrow']>
>;

const view = (r: Row): ApiClientView => ({
  id: r.id,
  name: r.name,
  clientId: r.clientId,
  secretLast4: r.secretLast4,
  scopes: r.scopes as ApiScope[],
  entityIds: (r.entityIds as string[] | null) ?? null,
  rateLimitPerMinute: r.rateLimitPerMinute,
  active: r.active,
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

const secretOf = () => `fhs_${randomBytes(32).toString('base64url')}`;

/** OAuth clients of the public API, and the short-lived tokens they trade their secret for. */
@Injectable()
export class ApiClientsService {
  private readonly key: Uint8Array;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  // Management ----------------------------------------------------------------------------------

  async list(tenantId: string): Promise<ApiClientView[]> {
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.apiClient.findMany({ orderBy: { createdAt: 'desc' } }),
    );
    return rows.map(view);
  }

  async create(
    tenantId: string,
    actingUserId: string,
    b: ApiClientBody,
  ): Promise<ApiClientCreated> {
    await this.assertEntities(tenantId, b.entityIds);
    const secret = secretOf();
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.apiClient.create({
        data: {
          tenantId,
          name: b.name,
          clientId: `fhc_${randomBytes(12).toString('hex')}`,
          secretHash: sha256(secret),
          secretLast4: secret.slice(-4),
          scopes: b.scopes,
          entityIds: b.entityIds ?? undefined,
          rateLimitPerMinute: b.rateLimitPerMinute,
          active: b.active,
          actingUserId,
        },
      }),
    );
    return { ...view(row), clientSecret: secret };
  }

  private async assertEntities(tenantId: string, ids: string[] | null) {
    if (!ids?.length) return;
    const n = await runInTenant(tenantId, async () =>
      this.prisma.db.entity.count({ where: { id: { in: ids } } }),
    );
    if (n !== new Set(ids).size)
      throw new NotFoundException('One of those companies does not exist');
  }

  async update(
    tenantId: string,
    id: string,
    b: ApiClientBody,
  ): Promise<ApiClientView> {
    await this.assertEntities(tenantId, b.entityIds);
    const r = await runInTenant(tenantId, async () =>
      this.prisma.db.apiClient.updateMany({
        where: { id },
        data: {
          name: b.name,
          scopes: b.scopes,
          entityIds: b.entityIds ?? (null as never),
          rateLimitPerMinute: b.rateLimitPerMinute,
          active: b.active,
        },
      }),
    );
    if (r.count === 0) throw new NotFoundException();
    return view(
      await runInTenant(tenantId, async () =>
        this.prisma.db.apiClient.findFirstOrThrow({ where: { id } }),
      ),
    );
  }

  async rotate(tenantId: string, id: string): Promise<ApiClientCreated> {
    const secret = secretOf();
    const r = await runInTenant(tenantId, async () =>
      this.prisma.db.apiClient.updateMany({
        where: { id },
        data: { secretHash: sha256(secret), secretLast4: secret.slice(-4) },
      }),
    );
    if (r.count === 0) throw new NotFoundException();
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.apiClient.findFirstOrThrow({ where: { id } }),
    );
    return { ...view(row), clientSecret: secret };
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const r = await runInTenant(tenantId, async () =>
      this.prisma.db.apiClient.deleteMany({ where: { id } }),
    );
    if (r.count === 0) throw new NotFoundException();
  }

  // Tokens --------------------------------------------------------------------------------------

  /** client_credentials: checks the secret and returns a one hour bearer token. */
  async token(clientId: string, secret: string, scope?: string) {
    const c = await runAsSystem(async () =>
      this.prisma.db.apiClient.findUnique({ where: { clientId } }),
    );
    const given = Buffer.from(sha256(secret));
    const ok =
      c?.active &&
      given.length === c.secretHash.length &&
      timingSafeEqual(given, Buffer.from(c.secretHash));
    if (!c || !ok) throw new UnauthorizedException('invalid_client');
    const allowed = c.scopes as ApiScope[];
    const asked = scope ? scope.split(/\s+/).filter(Boolean) : allowed;
    if (asked.some((s) => !allowed.includes(s as ApiScope)))
      throw new UnauthorizedException('invalid_scope');
    const access_token = await new SignJWT({
      tenantId: c.tenantId,
      cid: c.id,
      scopes: asked,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(c.clientId)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL}s`)
      .sign(this.key);
    return {
      access_token,
      token_type: 'Bearer' as const,
      expires_in: TOKEN_TTL,
      scope: asked.join(' '),
    };
  }

  /** Checks a bearer token and re-reads the client, so a revoked or paused client stops at once. */
  async authenticate(bearer: string): Promise<ApiPrincipal> {
    let p: Record<string, unknown>;
    try {
      p = (
        await jwtVerify(bearer, this.key, {
          issuer: ISSUER,
          audience: AUDIENCE,
          algorithms: ['HS256'],
        })
      ).payload;
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
    const c = await runAsSystem(async () =>
      this.prisma.db.apiClient.findUnique({ where: { id: String(p.cid) } }),
    );
    if (!c?.active) throw new UnauthorizedException('invalid_token');
    // Updated at most once a minute, so a busy client does not write on every call.
    if (!c.lastUsedAt || Date.now() - c.lastUsedAt.getTime() > 60_000)
      void runAsSystem(async () =>
        this.prisma.db.apiClient.update({
          where: { id: c.id },
          data: { lastUsedAt: new Date() },
        }),
      ).catch(() => undefined);
    const granted = (p.scopes as ApiScope[]) ?? [];
    return {
      clientDbId: c.id,
      tenantId: c.tenantId,
      clientId: c.clientId,
      actingUserId: c.actingUserId,
      scopes: granted.filter((s) => (c.scopes as ApiScope[]).includes(s)),
      entityIds: (c.entityIds as string[] | null) ?? null,
      rateLimitPerMinute: c.rateLimitPerMinute,
    };
  }
}
