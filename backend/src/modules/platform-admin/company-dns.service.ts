import { Inject, Injectable, Logger } from '@nestjs/common';
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

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled() {
    const c = this.config;
    return Boolean(
      c.APP_DOMAIN &&
      c.CLOUDFLARE_API_TOKEN &&
      c.CLOUDFLARE_ZONE_ID &&
      c.DNS_TARGET_IP,
    );
  }

  hostFor(slug: string) {
    return `${slug}.${this.config.APP_DOMAIN}`;
  }

  private async cf<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${this.config.CLOUDFLARE_ZONE_ID}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.CLOUDFLARE_API_TOKEN}`,
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
    if (!this.enabled) return 'off';
    const name = this.hostFor(slug);
    const wanted = {
      type: 'A',
      name,
      content: this.config.DNS_TARGET_IP,
      proxied: this.config.DNS_PROXIED,
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
