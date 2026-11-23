import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { RedisService } from '../../platform/cache/redis.service.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import {
  runAsSystem,
  runInTenant,
} from '../../platform/database/tenant-context.js';
import {
  TrustedDeviceService,
  type DeviceScope,
} from './trusted-device.service.js';

/** Where the browser is: the passkey belongs to this host (the relying party) and nowhere else. */
export interface RelyingParty {
  origin: string;
  rpId: string;
}

export interface PasskeyView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
}

const CHALLENGE_SECONDS = 300;
const scopeKey = (s: DeviceScope) =>
  s.kind === 'tenant' ? `t:${s.tenantId}` : 'p';

interface StoredChallenge {
  /** Set when the challenge was made for one known person (registration, or a second factor). */
  userId?: string;
  scope: string;
}

/** Reads the host out of a browser Origin header. Only http(s) origins are accepted. */
export function relyingPartyFrom(
  origin: string | undefined,
): RelyingParty | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { origin: u.origin, rpId: u.hostname };
  } catch {
    return null;
  }
}

/**
 * Passkeys (D-64). A passkey is a key pair kept by the person's device (Touch ID, Face ID, Windows Hello,
 * a security key). We keep only the public half. Using one proves who they are and that they are present,
 * so it counts as password plus two-step in one step.
 */
@Injectable()
export class PasskeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private run<T>(scope: DeviceScope, fn: () => Promise<T>): Promise<T> {
    return scope.kind === 'tenant'
      ? runInTenant(scope.tenantId, fn)
      : runAsSystem(fn);
  }

  private rows(scope: DeviceScope, where: { userId?: string; id?: string }) {
    return this.run(scope, async () =>
      scope.kind === 'tenant'
        ? await this.db.passkey.findMany({
            where,
            orderBy: { createdAt: 'asc' },
          })
        : await this.db.platformPasskey.findMany({
            where,
            orderBy: { createdAt: 'asc' },
          }),
    );
  }

  async list(scope: DeviceScope, userId: string): Promise<PasskeyView[]> {
    return (await this.rows(scope, { userId })).map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt.toISOString(),
    }));
  }

  async count(scope: DeviceScope, userId: string): Promise<number> {
    return this.run(scope, async () =>
      scope.kind === 'tenant'
        ? await this.db.passkey.count({ where: { userId } })
        : await this.db.platformPasskey.count({ where: { userId } }),
    );
  }

  async revoke(scope: DeviceScope, userId: string, id: string): Promise<void> {
    await this.run(scope, async () => {
      if (scope.kind === 'tenant')
        await this.db.passkey.deleteMany({ where: { id, userId } });
      else await this.db.platformPasskey.deleteMany({ where: { id, userId } });
    });
  }

  async revokeAll(scope: DeviceScope, userId: string): Promise<number> {
    return this.run(scope, async () => {
      const r =
        scope.kind === 'tenant'
          ? await this.db.passkey.deleteMany({ where: { userId } })
          : await this.db.platformPasskey.deleteMany({ where: { userId } });
      return r.count;
    });
  }

  private async stash(challenge: string, v: StoredChallenge) {
    await this.redis.setJson(
      `passkey:challenge:${challenge}`,
      v,
      CHALLENGE_SECONDS,
    );
  }

  /** One-shot: a challenge can be answered once, so a captured response cannot be replayed. */
  private async take(challenge: string): Promise<StoredChallenge | null> {
    const key = `passkey:challenge:${challenge}`;
    const v = await this.redis.getJson<StoredChallenge>(key);
    if (!v) return null;
    return (await this.redis.del(key)) === 1 ? v : null;
  }

  /** Step 1 of adding a passkey. */
  async registrationOptions(
    scope: DeviceScope,
    user: { id: string; email: string },
    rp: RelyingParty,
  ) {
    const existing = await this.rows(scope, { userId: user.id });
    const options = await generateRegistrationOptions({
      rpName: this.config.APP_NAME,
      rpID: rp.rpId,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: parseTransports(c.transports),
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });
    await this.stash(options.challenge, {
      userId: user.id,
      scope: scopeKey(scope),
    });
    return options;
  }

  /** Step 2: checks the browser's answer and keeps the public key. */
  async registrationVerify(
    scope: DeviceScope,
    userId: string,
    response: RegistrationResponseJSON,
    rp: RelyingParty,
    label: string | undefined,
    userAgent: string | undefined,
  ): Promise<PasskeyView> {
    const challenge = challengeOf(response.response.clientDataJSON);
    const stored = await this.take(challenge);
    if (!stored || stored.userId !== userId || stored.scope !== scopeKey(scope))
      throw new BadRequestException(
        'That took too long or was already used. Start again.',
      );
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new BadRequestException(
        'The passkey could not be verified. Try again.',
      );
    }
    if (!verified.verified)
      throw new BadRequestException(
        'The passkey could not be verified. Try again.',
      );
    const cred = verified.registrationInfo.credential;
    const data = {
      userId,
      credentialId: cred.id,
      publicKey: Buffer.from(cred.publicKey),
      counter: cred.counter,
      transports: cred.transports?.join(',') ?? null,
      label: (label?.trim() || TrustedDeviceService.labelFrom(userAgent)).slice(
        0,
        120,
      ),
      rpId: rp.rpId,
    };
    const row = await this.run(scope, async () =>
      scope.kind === 'tenant'
        ? await this.db.passkey.create({
            data: { tenantId: scope.tenantId, ...data },
          })
        : await this.db.platformPasskey.create({ data }),
    );
    return {
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
    };
  }

  /**
   * Challenge for signing in. With `userId` (the second step after a password) only that person's
   * passkeys are offered; without it the browser picks from the passkeys it holds for this site.
   */
  async authenticationOptions(
    scope: DeviceScope,
    rp: RelyingParty,
    userId?: string,
  ) {
    const mine = userId ? await this.rows(scope, { userId }) : [];
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      userVerification: 'required',
      allowCredentials: mine.map((c) => ({
        id: c.credentialId,
        transports: parseTransports(c.transports),
      })),
    });
    await this.stash(options.challenge, {
      ...(userId ? { userId } : {}),
      scope: scopeKey(scope),
    });
    return options;
  }

  /**
   * Checks a sign-in answer and returns whose passkey it was. Refuses a wrong site, an unknown or
   * foreign credential, a used challenge, a bad signature and a counter that went backwards (a cloned key).
   */
  async authenticationVerify(
    scope: DeviceScope,
    response: AuthenticationResponseJSON,
    rp: RelyingParty,
    expectUserId?: string,
  ): Promise<{ userId: string }> {
    const fail = () => new UnauthorizedException('Passkey sign-in failed');
    const challenge = challengeOf(response.response.clientDataJSON);
    const stored = await this.take(challenge);
    if (!stored || stored.scope !== scopeKey(scope)) throw fail();
    if (expectUserId && stored.userId !== expectUserId) throw fail();
    const cred = (await this.run(scope, async () =>
      scope.kind === 'tenant'
        ? await this.db.passkey.findUnique({
            where: { credentialId: response.id },
          })
        : await this.db.platformPasskey.findUnique({
            where: { credentialId: response.id },
          }),
    )) as {
      id: string;
      userId: string;
      credentialId: string;
      publicKey: Uint8Array;
      counter: number;
      transports: string | null;
      rpId: string;
    } | null;
    if (!cred || cred.rpId !== rp.rpId) throw fail();
    if (stored.userId && cred.userId !== stored.userId) throw fail();
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpId,
        requireUserVerification: true,
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(cred.publicKey),
          counter: cred.counter,
          transports: parseTransports(cred.transports),
        },
      });
    } catch {
      throw fail();
    }
    if (!result.verified) throw fail();
    await this.run(scope, async () => {
      const data = {
        counter: result.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      };
      if (scope.kind === 'tenant')
        await this.db.passkey.update({ where: { id: cred.id }, data });
      else
        await this.db.platformPasskey.update({ where: { id: cred.id }, data });
    });
    return { userId: cred.userId };
  }
}

function parseTransports(
  v: string | null,
): AuthenticatorTransport[] | undefined {
  return v ? (v.split(',') as AuthenticatorTransport[]) : undefined;
}

/** The challenge the browser signed is inside clientDataJSON (base64url JSON). */
export function challengeOf(clientDataJSON: string): string {
  try {
    const parsed = JSON.parse(
      Buffer.from(clientDataJSON, 'base64url').toString('utf8'),
    ) as { challenge?: unknown };
    if (typeof parsed.challenge === 'string') return parsed.challenge;
  } catch {
    /* falls through */
  }
  throw new BadRequestException('Not a passkey response');
}
