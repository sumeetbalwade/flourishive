import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ErrorLogService } from '../logs/error-log.service.js';
import { MailService } from '../../platform/mail/mail.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import {
  RUNTIME_GROUPS,
  type RuntimeGroup,
} from '../../platform/config/runtime-keys.js';
import { StorageService } from '../../platform/storage/storage.service.js';

export interface TestResult {
  ok: boolean;
  message: string;
}

const ok = (message: string): TestResult => ({ ok: true, message });
const fail = (message: string): TestResult => ({ ok: false, message });

const asText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The console's Test buttons: each says in plain words what worked or what did not. */
@Injectable()
export class ConfigTestService {
  constructor(
    private readonly runtime: RuntimeConfigService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly errorLog: ErrorLogService,
  ) {}

  groups(): RuntimeGroup[] {
    return RUNTIME_GROUPS;
  }

  async run(group: RuntimeGroup): Promise<TestResult> {
    try {
      switch (group) {
        case 'Email':
          return await this.email();
        case 'Google sign-in':
          return await this.google();
        case 'Cloudflare':
          return await this.cloudflare();
        case 'Time-stamping':
          return await this.timestamping();
        case 'Error tracking':
          return await this.errorTracking();
        case 'File storage':
          return await this.fileStorage();
        case 'Addresses':
          return await this.addresses();
      }
    } catch (e) {
      return fail(asText(e));
    }
  }

  private async email(): Promise<TestResult> {
    try {
      await this.mail.verifyConnection();
    } catch (e) {
      return fail(
        `Could not connect to the mail server: ${asText(e)}. Check the server name, port, secure setting, user name and password.`,
      );
    }
    const host = await this.runtime.get('SMTP_HOST');
    return ok(`Connected to ${host} and it accepted the sign-in.`);
  }

  private async google(): Promise<TestResult> {
    const id = await this.runtime.get('GOOGLE_CLIENT_ID');
    if (!id)
      return fail('No Google client ID is set, so Google sign-in is off.');
    return /^[\w-]+\.apps\.googleusercontent\.com$/.test(id)
      ? ok(
          'The client ID has the right shape. Google confirms it on the first sign-in.',
        )
      : fail(
          'That does not look like a Google client ID (it should end in .apps.googleusercontent.com).',
        );
  }

  private async cloudflare(): Promise<TestResult> {
    const [token, zone] = await Promise.all([
      this.runtime.get('CLOUDFLARE_API_TOKEN'),
      this.runtime.get('CLOUDFLARE_ZONE_ID'),
    ]);
    if (!token || !zone)
      return fail('Set both the API token and the zone ID first.');
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zone}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      result?: { name?: string };
      errors?: { message: string }[];
    } | null;
    if (!res.ok || !body?.success)
      return fail(
        `Cloudflare said: ${body?.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`}`,
      );
    return ok(
      `Cloudflare gave access to the zone ${body.result?.name ?? zone}.`,
    );
  }

  private async timestamping(): Promise<TestResult> {
    const urls = [
      ['DSC_TSA_URL', 'Signing time-stamp server'],
      ['SEAL_TSA_URL', 'Seal time-stamp server'],
    ] as const;
    const lines: string[] = [];
    let allOk = true;
    for (const [key, label] of urls) {
      const url = await this.runtime.get(key);
      if (!url) {
        lines.push(`${label}: not set`);
        continue;
      }
      try {
        // A time-stamp server answers a plain GET with an error page; any answer means it is reachable.
        const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        lines.push(`${label}: reachable (HTTP ${res.status})`);
      } catch (e) {
        allOk = false;
        lines.push(`${label}: could not connect (${asText(e)})`);
      }
    }
    return { ok: allOk, message: lines.join('. ') };
  }

  private async errorTracking(): Promise<TestResult> {
    const dsn = await this.runtime.get('ERROR_TRACKING_DSN');
    if (!dsn)
      return fail('No error tracking address is set, so nothing is forwarded.');
    try {
      const u = new URL(dsn);
      if (!u.username || u.pathname.length < 2)
        throw new Error('missing key or project');
    } catch {
      return fail(
        'That is not a valid DSN. It looks like https://<key>@host/<project>.',
      );
    }
    const sent = await this.errorLog.sendTestEvent(randomUUID());
    return sent.ok ? ok(sent.message) : fail(sent.message);
  }

  private async fileStorage(): Promise<TestResult> {
    const r = await this.storage.check();
    return r.ok
      ? ok(`Files are working (${r.driver}, ${r.latencyMs} ms).`)
      : fail(
          `File storage (${r.driver}) failed: ${r.error ?? 'unknown error'}`,
        );
  }

  private async addresses(): Promise<TestResult> {
    const problems: string[] = [];
    for (const key of [
      'WEB_URL',
      'ADMIN_URL',
      'VERIFY_URL',
      'API_URL',
    ] as const) {
      const v = await this.runtime.get(key);
      try {
        new URL(v ?? '');
      } catch {
        problems.push(key);
      }
    }
    const t = await this.runtime.get('TENANT_URL_TEMPLATE');
    if (!t?.includes('{slug}')) problems.push('TENANT_URL_TEMPLATE');
    return problems.length
      ? fail(`These are not valid addresses: ${problems.join(', ')}.`)
      : ok('Every address is valid.');
  }
}
