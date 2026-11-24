import { Inject, Injectable } from '@nestjs/common';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { EmailTemplatesService } from '../notifications/email-templates.service.js';
import { ThrottleService } from '../identity/throttle.service.js';
import { BrandService } from '../brand/brand.service.js';
import { accentOf } from '@flourishive/schemas';
import { DomainsService } from '../domains/domains.service.js';
import { tenantUrl } from './tenant-host.js';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brand: BrandService,
    private readonly throttle: ThrottleService,
    private readonly mail: MailService,
    private readonly templates: EmailTemplatesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runtime: RuntimeConfigService,
    private readonly domains: DomainsService,
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
    const brandData = await this.brand.effective(tenant.id);
    return {
      slug: tenant.slug,
      name: tenant.name,
      accentColor: accentOf(brandData.theme),
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
          select: { tenant: { select: { id: true, slug: true, name: true } } },
        }),
    );
    if (users.length === 0) return;
    const template = await this.runtime.require('TENANT_URL_TEMPLATE');
    const lines = await Promise.all(
      users.map(
        async (u) =>
          `${u.tenant.name}: ${await this.domains.baseUrl(u.tenant.id, tenantUrl(template, u.tenant.slug))}`,
      ),
    );
    await this.mail.send({
      event: 'company.find',
      to: email,
      ...(await this.templates.render('company.find', null, {
        addresses: lines.join('\n'),
      })),
    });
  }
}
