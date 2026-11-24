import type { SetupChecklist } from '@flourishive/schemas';
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { RequirePermission } from '../access/require-permission.js';
import { CurrentAuth } from '../identity/auth.context.js';
import type { AccessClaims } from '../identity/token.service.js';

/** "Finish setting up" for the first admin: what is still at its default (D-71). */
@Controller('setup')
export class SetupChecklistController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermission('settings.manage')
  @Get('checklist')
  async checklist(@CurrentAuth() a: AccessClaims): Promise<SetupChecklist> {
    const db = this.prisma.db;
    const brand = await runAsSystem(async () =>
      db.brandProfile.count({
        where: {
          scope: 'TENANT',
          tenantId: a.tenantId,
          status: 'PUBLISHED',
        },
      }),
    );
    const t = await runInTenant(a.tenantId, async () => ({
      sender: await db.mailSender.count({ where: { status: 'ACTIVE' } }),
      users: await db.user.count({ where: { status: { not: 'DISABLED' } } }),
      me: await db.user.findFirst({
        where: { id: a.userId },
        select: { mfaEnabledAt: true },
      }),
    }));
    const items = [
      {
        key: 'brand',
        label: 'Add your logo and colours',
        hint: 'Pick a look, upload a logo and publish it',
        done: brand > 0,
        href: '/app/brand',
      },
      {
        key: 'email',
        label: 'Send email from your own address',
        hint: 'Optional. Until then email goes out from our address',
        done: t.sender > 0,
        href: '/app/email',
      },
      {
        key: 'people',
        label: 'Invite your team',
        hint: 'Add people so they can sign in',
        done: t.users > 1,
        href: '/app/people',
      },
      {
        key: 'security',
        label: 'Turn on two-step sign-in for yourself',
        hint: 'Protects the account that controls everything else',
        done: Boolean(t.me?.mfaEnabledAt),
        href: '/app/security',
      },
    ];
    return { items, allDone: items.every((i) => i.done) };
  }
}
