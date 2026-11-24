import {
  type DomainView,
  type DomainsState,
  type DomainStatus,
} from '@flourishive/schemas';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { RedisService } from '../../platform/cache/redis.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import {
  systemResolver,
  type Resolver,
} from '../../platform/mail/dns-report.js';
import { isOwnHost, ownDomain, tenantUrl } from '../company/tenant-host.js';
import { SettingsService } from '../settings/settings.service.js';

/** How long a new address keeps being re-checked by the worker before it is marked failed. */
const WATCH_HOURS = 48;
const CACHE_SECONDS = 60;

const trimDot = (s: string) => s.replace(/\.$/, '').toLowerCase();

/** Pure: what the DNS answers say about the two records we ask for. */
export function checkRecords(
  target: string,
  token: string,
  cnames: string[],
  txts: string[],
): { cname: boolean; txt: boolean } {
  return {
    cname: cnames.map(trimDot).includes(target.toLowerCase()),
    txt: txts.some((t) => t.trim() === token),
  };
}

/**
 * Companies' own web addresses (D-69): adding, checking, and finding which company an address belongs to.
 * An address is only ever used (for a certificate, for sign-in) once both DNS records have been seen.
 */
@Injectable()
export class DomainsService {
  /** Replaced in tests. */
  resolver: Resolver = systemResolver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly runtime: RuntimeConfigService,
    private readonly settings: SettingsService,
  ) {}

  private async domain(): Promise<string> {
    return ownDomain(await this.runtime.require('TENANT_URL_TEMPLATE'));
  }

  private async target(): Promise<string> {
    return `custom.${await this.domain()}`;
  }

  private txtName(hostname: string) {
    return `_flourishive.${hostname}`;
  }

  private async view(
    r: {
      id: string;
      hostname: string;
      status: DomainStatus;
      verificationToken: string;
      checkedAt: Date | null;
      error: string | null;
      createdAt: Date;
    },
    primary: string,
    target: string,
    found?: { cname: boolean; txt: boolean },
  ): Promise<DomainView> {
    const ok = r.status === 'VERIFIED' || r.status === 'ACTIVE';
    return {
      id: r.id,
      hostname: r.hostname,
      status: r.status,
      records: [
        {
          type: 'CNAME',
          name: r.hostname,
          value: target,
          found: ok || !!found?.cname,
        },
        {
          type: 'TXT',
          name: this.txtName(r.hostname),
          value: r.verificationToken,
          found: ok || !!found?.txt,
        },
      ],
      checkedAt: r.checkedAt?.toISOString() ?? null,
      error: r.error,
      primary: primary === r.hostname,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async state(tenantId: string, slug: string): Promise<DomainsState> {
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.tenantDomain.findMany({ orderBy: { createdAt: 'asc' } }),
    );
    const primary = await this.settings.get('domains.primary', { tenantId });
    const target = await this.target();
    const template = await this.runtime.require('TENANT_URL_TEMPLATE');
    return {
      defaultAddress: tenantUrl(template, slug),
      cnameTarget: target,
      domains: await Promise.all(
        rows.map((r) => this.view(r, primary, target)),
      ),
    };
  }

  async add(tenantId: string, hostname: string): Promise<DomainView> {
    const domain = await this.domain();
    if (isOwnHost(domain, hostname))
      throw new BadRequestException(
        `Addresses ending in ${domain} are ours. Enter an address on your own website.`,
      );
    const taken = await runAsSystem(async () =>
      this.prisma.db.tenantDomain.findUnique({ where: { hostname } }),
    );
    if (taken)
      throw new ConflictException(
        taken.tenantId === tenantId
          ? 'You have already added this address'
          : 'This address is already used by another company',
      );
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.tenantDomain.create({
        data: {
          tenantId,
          hostname,
          verificationToken: randomBytes(18).toString('base64url'),
        },
      }),
    );
    return this.view(row, '', await this.target());
  }

  /** Looks up both records now. Returns the updated view. */
  async check(tenantId: string, id: string): Promise<DomainView> {
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.tenantDomain.findFirst({ where: { id } }),
    );
    if (!row) throw new NotFoundException('Address not found');
    return this.checkRow(row);
  }

  private async checkRow(row: {
    id: string;
    tenantId: string;
    hostname: string;
    status: DomainStatus;
    verificationToken: string;
    checkedAt: Date | null;
    error: string | null;
    createdAt: Date;
  }): Promise<DomainView> {
    const target = await this.target();
    const [cnames, txts] = await Promise.all([
      this.resolver.cname(row.hostname).catch(() => [] as string[]),
      this.resolver.txt(this.txtName(row.hostname)).catch(() => [] as string[]),
    ]);
    const found = checkRecords(target, row.verificationToken, cnames, txts);
    const both = found.cname && found.txt;
    let status: DomainStatus = row.status;
    let error: string | null = null;
    if (both) {
      if (status === 'PENDING_DNS' || status === 'FAILED') status = 'VERIFIED';
    } else {
      // A domain that was working and lost a record is not served any more.
      if (status === 'VERIFIED' || status === 'ACTIVE') status = 'PENDING_DNS';
      error = !found.cname
        ? cnames.length
          ? `The address points to ${cnames.map(trimDot).join(', ')} instead of ${target}`
          : `No CNAME record found yet for ${row.hostname}`
        : `The TXT record on ${this.txtName(row.hostname)} was not found or does not match`;
    }
    const updated = await runInTenant(row.tenantId, async () =>
      this.prisma.db.tenantDomain.update({
        where: { id: row.id },
        data: { status, error, checkedAt: new Date() },
      }),
    );
    await this.redis.del(`domain-host:${row.hostname}`);
    const primary = await this.settings.get('domains.primary', {
      tenantId: row.tenantId,
    });
    return this.view(updated, primary, target, found);
  }

  async remove(tenantId: string, id: string): Promise<string> {
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.tenantDomain.findFirst({ where: { id } }),
    );
    if (!row) throw new NotFoundException('Address not found');
    await runInTenant(tenantId, async () =>
      this.prisma.db.tenantDomain.deleteMany({ where: { id } }),
    );
    await this.redis.del(`domain-host:${row.hostname}`);
    return row.hostname;
  }

  /** The worker's job: re-check addresses still waiting for DNS, every ten minutes, for 48 hours. */
  async tick(now = new Date()): Promise<number> {
    const slot = Math.floor(now.getTime() / 600_000);
    if (
      (await this.redis.client.set(
        `domains:tick:${slot}`,
        '1',
        'EX',
        900,
        'NX',
      )) !== 'OK'
    )
      return 0;
    const since = new Date(now.getTime() - WATCH_HOURS * 3_600_000);
    const rows = await runAsSystem(async () =>
      this.prisma.db.tenantDomain.findMany({
        where: { status: 'PENDING_DNS' },
      }),
    );
    let n = 0;
    for (const r of rows) {
      if (r.createdAt < since) {
        await runInTenant(r.tenantId, async () =>
          this.prisma.db.tenantDomain.update({
            where: { id: r.id },
            data: {
              status: 'FAILED',
              error:
                'We did not see the DNS records within 48 hours. Check them and press Check now.',
            },
          }),
        );
        continue;
      }
      await this.checkRow(r);
      n++;
    }
    return n;
  }

  /**
   * Which company an address belongs to. Only VERIFIED or ACTIVE addresses count. A VERIFIED address that is
   * being asked for over HTTPS has evidently got its certificate, so it becomes ACTIVE.
   */
  async slugForHost(
    hostname: string,
    opts: { markActive?: boolean } = {},
  ): Promise<string | null> {
    const key = `domain-host:${hostname}`;
    const cached = await this.redis.getJson<{ slug: string | null }>(key);
    if (cached && !opts.markActive) return cached.slug;
    const row = await runAsSystem(async () =>
      this.prisma.db.tenantDomain.findUnique({
        where: { hostname },
        include: { tenant: { select: { slug: true, status: true } } },
      }),
    );
    const usable =
      row &&
      (row.status === 'VERIFIED' || row.status === 'ACTIVE') &&
      row.tenant.status === 'ACTIVE';
    if (usable && opts.markActive && row.status === 'VERIFIED')
      await runInTenant(row.tenantId, async () =>
        this.prisma.db.tenantDomain.update({
          where: { id: row.id },
          data: { status: 'ACTIVE' },
        }),
      );
    const slug = usable ? row.tenant.slug : null;
    await this.redis.setJson(key, { slug }, CACHE_SECONDS);
    return slug;
  }

  /** Caddy's question before it asks for a certificate: is this one of ours? */
  async allowedForCertificate(hostname: string): Promise<boolean> {
    return (await this.slugForHost(hostname)) !== null;
  }

  async setPrimary(
    tenantId: string,
    userId: string,
    hostname: string | null,
  ): Promise<void> {
    if (hostname) {
      const row = await runInTenant(tenantId, async () =>
        this.prisma.db.tenantDomain.findFirst({ where: { hostname } }),
      );
      if (!row || (row.status !== 'VERIFIED' && row.status !== 'ACTIVE'))
        throw new BadRequestException(
          'Only a verified address can be used in emails',
        );
    }
    await this.settings.set(
      { tenantId, updatedBy: userId },
      'tenant',
      'domains.primary',
      hostname ?? '',
    );
  }

  /** The address that links in emails to this company's people should start with (no trailing slash). */
  async baseUrl(tenantId: string, fallback: string): Promise<string> {
    const primary = await this.settings.get('domains.primary', { tenantId });
    if (!primary) return fallback;
    const row = await runInTenant(tenantId, async () =>
      this.prisma.db.tenantDomain.findFirst({
        where: { hostname: primary },
      }),
    );
    return row && (row.status === 'VERIFIED' || row.status === 'ACTIVE')
      ? `https://${primary}`
      : fallback;
  }
}
