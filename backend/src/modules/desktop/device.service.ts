import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { RedisService } from '../../platform/cache/redis.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { DeviceCtx } from '../signing/dsc-jobs.service.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// no 0/O or 1/I/L, so a code read aloud or from a screen is hard to mistype
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_SECONDS = 600;
const norm = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runtime: RuntimeConfigService,
  ) {}

  /** One-time code the signatory types into (or opens in) the desktop app. Valid ten minutes. */
  async pairingCode(a: { tenantId: string; userId: string }) {
    if (
      !(await this.access.entityScope(a.tenantId, a.userId, 'documents.sign'))
    )
      throw new ForbiddenException(
        'Only a signatory can pair a signing computer',
      );
    if (
      !(await this.redis.rateLimit(`pair:make:${a.userId}`, 10, 3600)).allowed
    )
      throw new BadRequestException('Too many codes. Try again later.');
    const raw = Array.from(
      { length: 8 },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join('');
    await this.redis.setJson(
      `pair:${sha256(raw)}`,
      { tenantId: a.tenantId, userId: a.userId },
      CODE_TTL_SECONDS,
    );
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    const server = (await this.runtime.require('API_URL')).replace(/\/$/, '');
    return {
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
      link: `flourishive://pair?code=${code}&server=${encodeURIComponent(server)}`,
      server,
    };
  }

  /** The desktop app swaps the code for a credential that can only reach the signing routes. */
  async pair(
    input: { code: string; name: string; platform: string; appVersion: string },
    ip?: string,
  ) {
    if (
      !(await this.redis.rateLimit(`pair:try:${ip ?? 'unknown'}`, 20, 600))
        .allowed
    )
      throw new BadRequestException('Too many attempts. Wait a few minutes.');
    const key = `pair:${sha256(norm(input.code))}`;
    const found = await this.redis.getJson<{
      tenantId: string;
      userId: string;
    }>(key);
    // the delete is the gate: only one caller can use a code
    if (!found || (await this.redis.del(key)) !== 1)
      throw new BadRequestException(
        'That code is not right or has expired. Make a new one in the web app.',
      );
    if (
      !(await this.access.entityScope(
        found.tenantId,
        found.userId,
        'documents.sign',
      ))
    )
      throw new ForbiddenException('This person can no longer sign');
    const credential = randomBytes(32).toString('base64url');
    const device = await runInTenant(found.tenantId, async () =>
      this.prisma.db.desktopDevice.create({
        data: {
          tenantId: found.tenantId,
          userId: found.userId,
          name: input.name,
          platform: input.platform,
          appVersion: input.appVersion,
          credentialHash: sha256(credential),
          lastSeenAt: new Date(),
        },
      }),
    );
    await this.audit.recordSafely({
      tenantId: found.tenantId,
      actorType: 'USER',
      actorId: found.userId,
      action: 'desktop.paired',
      entityType: 'desktop_device',
      entityId: device.id,
      meta: { name: input.name, platform: input.platform },
      ip: ip ?? null,
    });
    const tenant = await runAsSystem(async () =>
      this.prisma.db.tenant.findUniqueOrThrow({
        where: { id: found.tenantId },
      }),
    );
    return { deviceId: device.id, credential, company: tenant.name };
  }

  /** Turns the Authorization header of a desktop call into who is calling, or refuses. */
  async authenticate(header: string | undefined): Promise<DeviceCtx> {
    if (!header?.startsWith('Device ')) throw new UnauthorizedException();
    const credential = header.slice(7).trim();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(credential))
      throw new UnauthorizedException();
    const device = await runAsSystem(async () =>
      this.prisma.db.desktopDevice.findUnique({
        where: { credentialHash: sha256(credential) },
      }),
    );
    if (!device || device.revokedAt)
      throw new UnauthorizedException('This computer was unpaired');
    const user = await runAsSystem(async () =>
      this.prisma.db.user.findUnique({
        where: { id: device.userId },
        select: { status: true },
      }),
    );
    if (user?.status !== 'ACTIVE')
      throw new UnauthorizedException('This account is not active');
    if (
      !(await this.access.entityScope(
        device.tenantId,
        device.userId,
        'documents.sign',
      ))
    )
      throw new ForbiddenException('This person can no longer sign');
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000)
      await runInTenant(device.tenantId, async () =>
        this.prisma.db.desktopDevice.update({
          where: { id: device.id },
          data: { lastSeenAt: new Date() },
        }),
      );
    return {
      tenantId: device.tenantId,
      userId: device.userId,
      deviceId: device.id,
    };
  }

  async list(a: { tenantId: string; userId: string }, all: boolean) {
    return runInTenant(a.tenantId, async () =>
      this.prisma.db.desktopDevice.findMany({
        where: { ...(all ? {} : { userId: a.userId }), revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          name: true,
          platform: true,
          appVersion: true,
          createdAt: true,
          lastSeenAt: true,
        },
      }),
    );
  }

  async revoke(
    a: { tenantId: string; userId: string },
    id: string,
    any: boolean,
  ) {
    const done = await runInTenant(a.tenantId, async () =>
      this.prisma.db.desktopDevice.updateMany({
        where: { id, revokedAt: null, ...(any ? {} : { userId: a.userId }) },
        data: { revokedAt: new Date() },
      }),
    );
    if (done.count !== 1) throw new NotFoundException();
    await this.audit.recordSafely({
      tenantId: a.tenantId,
      actorType: 'USER',
      actorId: a.userId,
      action: 'desktop.unpaired',
      entityType: 'desktop_device',
      entityId: id,
    });
  }
}
