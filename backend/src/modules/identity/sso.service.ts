import type {
  SsoConfigBody,
  SsoConfigView,
  SsoOptions,
} from '@flourishive/schemas';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { RedisService } from '../../platform/cache/redis.service.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { CryptoService } from '../../platform/crypto/crypto.service.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import { SettingsService } from '../settings/settings.service.js';

const STATE_TTL = 600;
const TICKET_TTL = 60;

interface Endpoints {
  authorize: string;
  token: string;
  jwks: string;
  issuer: (tid?: string) => string;
}

const endpoints = (
  provider: 'GOOGLE' | 'MICROSOFT',
  dir: string | null,
): Endpoints =>
  provider === 'GOOGLE'
    ? {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        jwks: 'https://www.googleapis.com/oauth2/v3/certs',
        issuer: () => 'https://accounts.google.com',
      }
    : {
        authorize: `https://login.microsoftonline.com/${dir}/oauth2/v2.0/authorize`,
        token: `https://login.microsoftonline.com/${dir}/oauth2/v2.0/token`,
        jwks: `https://login.microsoftonline.com/${dir}/discovery/v2.0/keys`,
        issuer: (tid) => `https://login.microsoftonline.com/${tid}/v2.0`,
      };

/** A company's own single sign-on through OpenID Connect (D-16). It signs in existing people; it never creates accounts. */
@Injectable()
export class SsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly runtime: RuntimeConfigService,
    private readonly settings: SettingsService,
  ) {}

  private async redirectUri(): Promise<string> {
    return `${(await this.runtime.require('API_URL')).replace(/\/$/, '')}/v1/auth/sso/callback`;
  }

  private async tenantBySlug(slug: string) {
    return runAsSystem(async () =>
      this.prisma.db.tenant.findFirst({
        where: { slug: slug.toLowerCase(), status: 'ACTIVE' },
      }),
    );
  }

  private conn(tenantId: string) {
    return runInTenant(tenantId, async () =>
      this.prisma.db.ssoConnection.findUnique({ where: { tenantId } }),
    );
  }

  // Configuration -------------------------------------------------------------------------------

  async view(tenantId: string): Promise<SsoConfigView | null> {
    const c = await this.conn(tenantId);
    if (!c) return null;
    return {
      provider: c.provider,
      clientId: c.clientId,
      hasSecret: Boolean(c.clientSecretEnc),
      directoryId: c.directoryId,
      hostedDomain: c.hostedDomain,
      enabled: c.enabled,
      enforce: c.enforce,
      redirectUri: await this.redirectUri(),
    };
  }

  async save(
    tenantId: string,
    b: SsoConfigBody,
    by: string,
  ): Promise<SsoConfigView> {
    const existing = await this.conn(tenantId);
    if (!b.clientSecret && !existing)
      throw new BadRequestException('Enter the client secret');
    const data = {
      provider: b.provider,
      clientId: b.clientId,
      clientSecretEnc: b.clientSecret
        ? this.crypto.encrypt(b.clientSecret)
        : existing!.clientSecretEnc,
      directoryId: b.provider === 'MICROSOFT' ? b.directoryId : null,
      hostedDomain: b.provider === 'GOOGLE' ? b.hostedDomain : null,
      enabled: b.enabled,
      enforce: b.enforce,
      updatedBy: by,
    };
    await runInTenant(tenantId, async () =>
      this.prisma.db.ssoConnection.upsert({
        where: { tenantId },
        update: data,
        create: { tenantId, ...data },
      }),
    );
    return (await this.view(tenantId))!;
  }

  async remove(tenantId: string): Promise<void> {
    await runInTenant(tenantId, async () =>
      this.prisma.db.ssoConnection.deleteMany({ where: { tenantId } }),
    );
  }

  // Sign-in -------------------------------------------------------------------------------------

  async options(slug: string): Promise<SsoOptions> {
    const t = await this.tenantBySlug(slug);
    const c = t ? await this.conn(t.id) : null;
    return {
      enabled: Boolean(c?.enabled),
      provider: c?.enabled ? c.provider : null,
      enforce: Boolean(c?.enabled && c.enforce),
    };
  }

  /** Tenant admins stay able to use a password, so a broken connection never locks a company out. */
  async assertPasswordAllowed(tenantId: string, userId: string): Promise<void> {
    const c = await this.conn(tenantId);
    if (!c?.enabled || !c.enforce) return;
    const admin = await runInTenant(tenantId, async () =>
      this.prisma.db.userRole.count({
        where: { userId, role: { key: 'tenant_admin' } },
      }),
    );
    if (admin > 0) return;
    throw new ForbiddenException({
      message:
        'Your company requires single sign-on. Use the single sign-on button.',
      code: 'SSO_REQUIRED',
    });
  }

  /** Builds the provider's sign-in address. The browser is sent there; state and PKCE stay on the server. */
  async start(slug: string): Promise<{ url: string }> {
    const t = await this.tenantBySlug(slug);
    const c = t ? await this.conn(t.id) : null;
    if (!t || !c?.enabled)
      throw new NotFoundException(
        'Single sign-on is not switched on for this company',
      );
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    await this.redis.client.set(
      `sso:state:${state}`,
      JSON.stringify({ tenantId: t.id, slug: t.slug, nonce, verifier }),
      'EX',
      STATE_TTL,
    );
    const e = endpoints(c.provider, c.directoryId);
    const q = new URLSearchParams({
      client_id: c.clientId,
      response_type: 'code',
      redirect_uri: await this.redirectUri(),
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...(c.provider === 'GOOGLE' && c.hostedDomain
        ? { hd: c.hostedDomain }
        : {}),
    });
    return { url: `${e.authorize}?${q.toString()}` };
  }

  /** Where to send the browser afterwards: the company's own sign-in address. */
  async webUrl(slug: string): Promise<string> {
    const tpl = await this.runtime.get('TENANT_URL_TEMPLATE');
    const web = await this.runtime.get('WEB_URL');
    return (tpl ? tpl.replace('{slug}', slug) : (web ?? '')).replace(/\/$/, '');
  }

  /**
   * Finishes the provider's redirect: trades the code for an ID token, checks it, and finds the person.
   * Returns a one-time ticket the web app exchanges for a session. Nothing secret reaches the URL.
   */
  async callback(
    code: string,
    state: string,
  ): Promise<{ slug: string; ticket?: string; error?: string }> {
    const raw = await this.redis.client.getdel(`sso:state:${state}`);
    if (!raw)
      return {
        slug: '',
        error: 'The sign-in took too long. Please try again.',
      };
    const s = JSON.parse(raw) as {
      tenantId: string;
      slug: string;
      nonce: string;
      verifier: string;
    };
    const fail = (error: string) => ({ slug: s.slug, error });
    const c = await this.conn(s.tenantId);
    if (!c?.enabled) return fail('Single sign-on is switched off.');
    try {
      const e = endpoints(c.provider, c.directoryId);
      const res = await fetch(e.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: await this.redirectUri(),
          client_id: c.clientId,
          client_secret: this.crypto.decrypt(c.clientSecretEnc),
          code_verifier: s.verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const tok = (await res.json()) as { id_token?: string };
      if (!res.ok || !tok.id_token)
        return fail('The provider refused the sign-in.');
      const { payload } = await jwtVerify(
        tok.id_token,
        createRemoteJWKSet(new URL(e.jwks)),
        {
          audience: c.clientId,
          ...(c.provider === 'GOOGLE'
            ? { issuer: ['https://accounts.google.com', 'accounts.google.com'] }
            : {}),
        },
      );
      if (payload.nonce !== s.nonce)
        return fail('The sign-in could not be verified.');
      if (c.provider === 'MICROSOFT') {
        const tid = String(payload.tid ?? '');
        if (
          payload.iss !== e.issuer(tid) ||
          (c.directoryId &&
            /^[0-9a-f-]{36}$/i.test(c.directoryId) &&
            tid !== c.directoryId.toLowerCase())
        )
          return fail('That account is not in your company’s directory.');
      } else {
        if (payload.email_verified !== true)
          return fail('Your email address is not verified.');
        if (c.hostedDomain && payload.hd !== c.hostedDomain)
          return fail(
            'That Google account is not in your company’s workspace.',
          );
      }
      const email = String(
        payload.email ?? payload.preferred_username ?? '',
      ).toLowerCase();
      if (!email.includes('@'))
        return fail('The provider did not share an email address.');
      const allowed = await this.settings.get('signin.allowedEmailDomains', {
        tenantId: s.tenantId,
      });
      if (
        allowed.length &&
        !allowed
          .map((d: string) => d.toLowerCase())
          .includes(email.split('@')[1]!)
      )
        return fail('Your email domain is not allowed for this company.');
      const user = await runInTenant(s.tenantId, async () =>
        this.prisma.db.user.findFirst({ where: { email } }),
      );
      if (!user || user.status === 'DISABLED')
        return fail(
          'No account exists for that email. Ask your administrator to add you.',
        );
      const ticket = randomBytes(24).toString('base64url');
      await this.redis.client.set(
        `sso:ticket:${ticket}`,
        JSON.stringify({ tenantId: s.tenantId, userId: user.id }),
        'EX',
        TICKET_TTL,
      );
      return { slug: s.slug, ticket };
    } catch {
      return fail('The sign-in could not be completed. Please try again.');
    }
  }

  /** One use only. */
  async redeem(
    ticket: string,
  ): Promise<{ tenantId: string; userId: string } | null> {
    const raw = await this.redis.client.getdel(`sso:ticket:${ticket}`);
    return raw
      ? (JSON.parse(raw) as { tenantId: string; userId: string })
      : null;
  }
}
