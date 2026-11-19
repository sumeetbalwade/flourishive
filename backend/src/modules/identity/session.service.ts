import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { RedisService } from '../../platform/cache/redis.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { TokenService, sha256 } from './token.service.js';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTtlMs: number;
  sessionId: string;
}

const revokedKey = (sessionId: string) => `revoked:session:${sessionId}`;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Session length is the tenant's `security.sessionDays` setting. */
  private async refreshMs(tenantId: string): Promise<number> {
    return (
      (await this.settings.get('security.sessionDays', { tenantId })) *
      24 *
      3600 *
      1000
    );
  }

  async start(
    tenantId: string,
    userId: string,
    meta: ClientMeta,
  ): Promise<IssuedTokens> {
    const refresh = this.tokens.newRefreshToken();
    const refreshMs = await this.refreshMs(tenantId);
    const expiresAt = new Date(Date.now() + refreshMs);
    const sessionId = await runInTenant(tenantId, async () => {
      const session = await this.prisma.db.session.create({
        data: {
          tenantId,
          userId,
          expiresAt,
          ip: meta.ip?.slice(0, 64),
          userAgent: meta.userAgent?.slice(0, 255),
        },
      });
      await this.prisma.db.refreshToken.create({
        data: {
          tenantId,
          sessionId: session.id,
          tokenHash: refresh.hash,
          expiresAt,
        },
      });
      await this.prisma.db.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });
      return session.id;
    });
    return this.issue(tenantId, userId, sessionId, refresh.token);
  }

  private async issue(
    tenantId: string,
    userId: string,
    sessionId: string,
    refreshToken: string,
  ): Promise<IssuedTokens> {
    const accessToken = await this.tokens.signAccess({
      tenantId,
      userId,
      sessionId,
    });
    return {
      refreshTtlMs: await this.refreshMs(tenantId),
      accessToken,
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
      sessionId,
    };
  }

  /** Rotates a refresh token. Presenting an already-used token revokes the whole session. */
  async rotate(
    presented: string,
  ): Promise<IssuedTokens & { tenantId: string; userId: string }> {
    const hash = sha256(presented);
    const found = await runAsSystem(
      async () =>
        await this.prisma.db.refreshToken.findUnique({
          where: { tokenHash: hash },
          include: { session: { include: { user: true } } },
        } as never),
    );
    const row = found as unknown as {
      id: string;
      tenantId: string;
      usedAt: Date | null;
      expiresAt: Date;
      session: {
        id: string;
        userId: string;
        revokedAt: Date | null;
        expiresAt: Date;
        user: { status: string };
      };
    } | null;
    if (!row) throw new UnauthorizedException('Invalid refresh token');

    const { tenantId, session } = row;
    if (row.usedAt) {
      await this.audit.recordSafely({
        tenantId,
        actorType: 'SYSTEM',
        actorId: session.userId,
        action: 'auth.refresh_token_reuse',
        entityType: 'sessions',
        entityId: session.id,
        meta: { revoked: true },
      });
      await this.revoke(tenantId, session.id); // token theft signal
      throw new UnauthorizedException('Invalid refresh token');
    }
    const now = new Date();
    if (
      session.revokedAt ||
      session.expiresAt < now ||
      row.expiresAt < now ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Session expired');
    }

    const next = this.tokens.newRefreshToken();
    const refreshMs = await this.refreshMs(tenantId);
    const claimed = await runInTenant(tenantId, async () => {
      // Atomic claim: only one concurrent request can mark the token used.
      const res = await this.prisma.db.refreshToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (res.count !== 1) return false;
      await this.prisma.db.refreshToken.create({
        data: {
          tenantId,
          sessionId: session.id,
          tokenHash: next.hash,
          expiresAt: new Date(Date.now() + refreshMs),
        },
      });
      return true;
    });
    if (!claimed) {
      await this.revoke(tenantId, session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }
    const issued = await this.issue(
      tenantId,
      session.userId,
      session.id,
      next.token,
    );
    return { ...issued, tenantId, userId: session.userId };
  }

  async revoke(tenantId: string, sessionId: string): Promise<void> {
    await runInTenant(tenantId, async () => {
      await this.prisma.db.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.redis.client.set(
      revokedKey(sessionId),
      '1',
      'EX',
      this.config.ACCESS_TOKEN_TTL_SECONDS + 5,
    );
  }

  async revokeAll(tenantId: string, userId: string): Promise<number> {
    const ids = await runInTenant(tenantId, async () => {
      const active = await this.prisma.db.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true },
      });
      await this.prisma.db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return active.map((s) => s.id);
    });
    await Promise.all(
      ids.map((id) =>
        this.redis.client.set(
          revokedKey(id),
          '1',
          'EX',
          this.config.ACCESS_TOKEN_TTL_SECONDS + 5,
        ),
      ),
    );
    return ids.length;
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.client.exists(revokedKey(sessionId))) === 1;
  }
}
