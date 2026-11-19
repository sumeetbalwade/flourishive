import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { ThrottleService } from '../identity/throttle.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { tenantUrl } from './tenant-host.js';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly throttle: ThrottleService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async publicInfo(slug: string) {
    const tenant = await runAsSystem(
      async () =>
        await this.prisma.db.tenant.findUnique({
          where: { slug: slug.toLowerCase() },
        }),
    );
    if (!tenant || tenant.status !== 'ACTIVE' || tenant.slug.startsWith('_'))
      return null;
    return {
      slug: tenant.slug,
      name: tenant.name,
      accentColor: await this.settings.get('branding.accentColor', {
        tenantId: tenant.id,
      }),
    };
  }

  async emailSignInLinks(email: string, ip = 'unknown'): Promise<void> {
    await this.throttle.assertNotLocked('reset', `ip:${ip}`);
    await this.throttle.recordFailure('reset', `ip:${ip}`);
    const users = await runAsSystem(
      async () =>
        await this.prisma.db.user.findMany({
          where: {
            email: email.toLowerCase(),
            status: { not: 'DISABLED' },
            tenant: { status: 'ACTIVE' },
          },
          select: { tenant: { select: { slug: true, name: true } } },
        }),
    );
    if (users.length === 0) return;
    const lines = users.map(
      (u) =>
        `${u.tenant.name}: ${tenantUrl(this.config.TENANT_URL_TEMPLATE, u.tenant.slug)}`,
    );
    await this.mail.send({
      to: email,
      subject: 'Your Flourishive sign-in address',
      text: `Sign in at your company's address:\n\n${lines.join('\n')}\n\nIf you did not ask for this, you can ignore this email.`,
    });
  }
}
