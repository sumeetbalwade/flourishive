import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { SettingsService } from '../settings/settings.service.js';
import { PasswordService } from './password.service.js';

/** The company's password rules beyond length (D-69): a mix of characters, and no repeats of recent ones. */
@Injectable()
export class PasswordPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly passwords: PasswordService,
  ) {}

  static hasMix(password: string): boolean {
    return (
      /\p{L}/u.test(password) &&
      /\d/.test(password) &&
      /[^\p{L}\d\s]/u.test(password)
    );
  }

  async check(
    tenantId: string,
    userId: string,
    password: string,
  ): Promise<void> {
    if (
      (await this.settings.get('security.passwordRequireMix', { tenantId })) &&
      !PasswordPolicyService.hasMix(password)
    )
      throw new BadRequestException(
        'The password must mix letters, numbers and at least one symbol',
      );
    const keep = await this.settings.get('security.passwordHistory', {
      tenantId,
    });
    if (keep === 0) return;
    const recent = await runInTenant(tenantId, async () =>
      this.prisma.db.passwordHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: keep,
      }),
    );
    for (const r of recent)
      if (await this.passwords.verify(password, r.hash))
        throw new BadRequestException(
          `Choose a password you have not used in your last ${keep}`,
        );
  }

  /** Remembers the hash that was just replaced, and forgets the ones beyond the limit. */
  async remember(
    tenantId: string,
    userId: string,
    oldHash: string | null,
  ): Promise<void> {
    const keep = await this.settings.get('security.passwordHistory', {
      tenantId,
    });
    if (keep === 0 || !oldHash) return;
    await runInTenant(tenantId, async () => {
      await this.prisma.db.passwordHistory.create({
        data: { tenantId, userId, hash: oldHash },
      });
      const rows = await this.prisma.db.passwordHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: keep,
      });
      if (rows.length)
        await this.prisma.db.passwordHistory.deleteMany({
          where: { id: { in: rows.map((r) => r.id) } },
        });
    });
  }
}
