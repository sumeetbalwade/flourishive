import { Inject, Injectable, Logger } from '@nestjs/common';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';

export type DnsResult = 'created' | 'exists' | 'updated' | 'off';

type CfRecord = { id: string; content: string; proxied: boolean };
type CfResponse<T> = {
  success: boolean;
  result: T;
  errors?: { message: string }[];
};

/**
 * Gives each company its own address (<slug>.<APP_DOMAIN>) by adding one A record in Cloudflare.
 * There is no wildcard record, so a name that was never created simply does not exist.
 * Does nothing unless the token, zone and target address are all configured.
 */
@Injectable()
export class CompanyDnsService {
  private readonly log = new Logger(CompanyDnsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runtime: RuntimeConfigService,
  ) {}

  private async cfg() {
    const [token, zone, ip, proxied] = await Promise.all([
      this.runtime.get('CLOUDFLARE_API_TOKEN'),
      this.runtime.get('CLOUDFLARE_ZONE_ID'),
      this.runtime.get('DNS_TARGET_IP'),
      this.runtime.get('DNS_PROXIED'),
    ]);
    return { token, zone, ip, proxied: proxied ?? false };
  }

  async isEnabled(): Promise<boolean> {
    const c = await this.cfg();
    return Boolean(this.config.APP_DOMAIN && c.token && c.zone && c.ip);
  }

  hostFor(slug: string) {
    return `${slug}.${this.config.APP_DOMAIN}`;
  }

  private async cf<T>(path: string, init?: RequestInit): Promise<T> {
    const c = await this.cfg();
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${c.zone}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${c.token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await res.json().catch(() => null)) as CfResponse<T> | null;
    if (!res.ok || !body?.success)
      throw new Error(
        `Cloudflare said: ${body?.errors?.map((e) => e.message).join('; ') ?? res.status}`,
      );
    return body.result;
  }

  /** Makes sure the company's address exists and points at this server. Safe to repeat. */
  async ensure(slug: string): Promise<DnsResult> {
    if (!(await this.isEnabled())) return 'off';
    const c = await this.cfg();
    const name = this.hostFor(slug);
    const wanted = {
      type: 'A',
      name,
      content: c.ip,
      proxied: c.proxied,
      ttl: 1,
      comment: 'Created by Flourishive for a company address',
    };
    const found = await this.cf<CfRecord[]>(
      `/dns_records?type=A&name=${encodeURIComponent(name)}`,
    );
    const have = found[0];
    if (!have) {
      await this.cf('/dns_records', {
        method: 'POST',
        body: JSON.stringify(wanted),
      });
      this.log.log(`Created DNS record for ${name}`);
      return 'created';
    }
    if (have.content === wanted.content && have.proxied === wanted.proxied)
      return 'exists';
    await this.cf(`/dns_records/${have.id}`, {
      method: 'PUT',
      body: JSON.stringify(wanted),
    });
    this.log.log(`Updated DNS record for ${name}`);
    return 'updated';
  }
}
