import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { sha256 } from './token.service.js';

export type DeviceScope =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'platform' };

export interface DeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

/** "Remember this device" (D-64): a random cookie value whose hash is kept, valid for a number of days. */
@Injectable()
export class TrustedDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  /** A short readable name from the browser's user agent, e.g. "Chrome on macOS". */
  static labelFrom(userAgent?: string): string {
    const ua = userAgent ?? '';
    const browser = /Edg\//.test(ua)
      ? 'Edge'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
    const os = /Windows/.test(ua)
      ? 'Windows'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /iPhone|iPad/.test(ua)
            ? 'iOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'unknown system';
    return `${browser} on ${os}`;
  }

  /** Makes a new device record and returns the secret to put in the cookie. */
  async remember(
    scope: DeviceScope,
    userId: string,
    userAgent: string | undefined,
    days: number,
  ): Promise<{ token: string; maxAgeMs: number } | null> {
    if (days <= 0) return null;
    const token = randomBytes(32).toString('base64url');
    const maxAgeMs = days * 24 * 3600 * 1000;
    const data = {
      userId,
      tokenHash: sha256(token),
      label: TrustedDeviceService.labelFrom(userAgent),
      expiresAt: new Date(Date.now() + maxAgeMs),
    };
    if (scope.kind === 'tenant')
      await runInTenant(scope.tenantId, async () => {
        await this.db.trustedDevice.create({
          data: { tenantId: scope.tenantId, ...data },
        });
      });
    else
      await runAsSystem(async () => {
        await this.db.platformTrustedDevice.create({ data });
      });
    return { token, maxAgeMs };
  }

  /** True when the cookie value belongs to this person and has not expired. Counts as a use. */
  async check(
    scope: DeviceScope,
    userId: string,
    token: string | undefined,
  ): Promise<boolean> {
    if (!token) return false;
    const where = {
      userId,
      tokenHash: sha256(token),
      expiresAt: { gt: new Date() },
    };
    if (scope.kind === 'tenant')
      return runInTenant(scope.tenantId, async () => {
        const n = await this.db.trustedDevice.updateMany({
          where,
          data: { lastUsedAt: new Date() },
        });
        return n.count === 1;
      });
    return runAsSystem(async () => {
      const n = await this.db.platformTrustedDevice.updateMany({
        where,
        data: { lastUsedAt: new Date() },
      });
      return n.count === 1;
    });
  }

  async list(scope: DeviceScope, userId: string): Promise<DeviceView[]> {
    const where = { userId, expiresAt: { gt: new Date() } };
    const rows =
      scope.kind === 'tenant'
        ? await runInTenant(
            scope.tenantId,
            async () =>
              await this.db.trustedDevice.findMany({
                where,
                orderBy: { lastUsedAt: 'desc' },
              }),
          )
        : await runAsSystem(
            async () =>
              await this.db.platformTrustedDevice.findMany({
                where,
                orderBy: { lastUsedAt: 'desc' },
              }),
          );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  async count(scope: DeviceScope, userId: string): Promise<number> {
    return (await this.list(scope, userId)).length;
  }

  async revoke(scope: DeviceScope, userId: string, id: string): Promise<void> {
    if (scope.kind === 'tenant')
      await runInTenant(scope.tenantId, async () => {
        await this.db.trustedDevice.deleteMany({ where: { id, userId } });
      });
    else
      await runAsSystem(async () => {
        await this.db.platformTrustedDevice.deleteMany({ where: { id, userId } });
      });
  }

  /** Forget every remembered device (two-step reset or turned off, password reset). */
  async revokeAll(scope: DeviceScope, userId: string): Promise<void> {
    if (scope.kind === 'tenant')
      await runInTenant(scope.tenantId, async () => {
        await this.db.trustedDevice.deleteMany({ where: { userId } });
      });
    else
      await runAsSystem(async () => {
        await this.db.platformTrustedDevice.deleteMany({ where: { userId } });
      });
  }
}
