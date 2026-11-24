import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { SigninOutcome } from '@flourishive/schemas';
import { currentRequestId } from '../../platform/http/request-id.js';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { SettingsService } from '../settings/settings.service.js';

export interface RequestLine {
  requestId: string;
  tenantId: string | null;
  actorType: string | null;
  actorId: string | null;
  method: string;
  routePattern: string;
  status: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
}

export interface SigninLine {
  tenantId: string | null;
  userId: string | null;
  /** Left out when only the account is known; the address is then looked up from it when the line is written. */
  email?: string;
  /** True for platform staff (their accounts live in another table). */
  platform?: boolean;
  outcome: SigninOutcome;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/** A request this slow is always kept, even a successful read. */
export const SLOW_MS = 1000;
const FLUSH_MS = 2000;
const MAX_BUFFER = 5000;

const short = (v: string | null | undefined, n: number) =>
  v ? v.slice(0, n) : null;

export const emailHash = (email: string) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/**
 * Request and sign-in lines are collected in memory and written together every two seconds, so logging
 * never adds a database round trip to a request. A failed write is dropped (and noted), never retried
 * forever: logs must not be able to take the app down.
 */
@Injectable()
export class LogWriterService implements OnModuleDestroy {
  private readonly log = new Logger(LogWriterService.name);
  private requests: RequestLine[] = [];
  private signins: Array<SigninLine & { at: Date }> = [];
  private timer?: NodeJS.Timeout;
  private sample = { value: 10, at: 0 };

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  /** Percentage of quick successful reads to keep, cached for 30 seconds. */
  private async samplePercent(): Promise<number> {
    if (Date.now() - this.sample.at > 30_000) {
      this.sample = {
        value: await this.settings
          .getPlatform('logs.sampleGetsPercent')
          .catch(() => 10),
        at: Date.now(),
      };
    }
    return this.sample.value;
  }

  /** Changes, failures and slow requests are always kept; plain successful reads are sampled. */
  async shouldKeep(
    line: Pick<
      RequestLine,
      'method' | 'status' | 'durationMs' | 'routePattern'
    >,
  ): Promise<boolean> {
    if (
      line.routePattern === '/health' ||
      line.routePattern.endsWith('/health')
    )
      return false;
    if (line.method !== 'GET' && line.method !== 'HEAD') return true;
    if (line.status >= 400 || line.durationMs >= SLOW_MS) return true;
    return Math.random() * 100 < (await this.samplePercent());
  }

  async request(line: RequestLine): Promise<void> {
    if (!(await this.shouldKeep(line))) return;
    if (this.requests.length < MAX_BUFFER) this.requests.push(line);
  }

  signin(line: SigninLine): void {
    if (this.signins.length < MAX_BUFFER)
      this.signins.push({
        ...line,
        requestId: line.requestId ?? currentRequestId(),
        at: new Date(),
      });
  }

  async flush(): Promise<void> {
    if (this.requests.length === 0 && this.signins.length === 0) return;
    const requests = this.requests;
    const signins = this.signins;
    this.requests = [];
    this.signins = [];
    try {
      await runAsSystem(async () => {
        if (requests.length)
          await this.prisma.db.logRequest.createMany({
            data: requests.map((r) => ({
              requestId: r.requestId,
              tenantId: r.tenantId,
              actorType: r.actorType,
              actorId: r.actorId,
              method: r.method,
              routePattern: r.routePattern.slice(0, 200),
              status: r.status,
              durationMs: r.durationMs,
              ip: short(r.ip, 64),
              userAgentShort: short(r.userAgent, 120),
            })),
          });
        if (signins.length) {
          const missing = signins.filter((s) => !s.email && s.userId);
          const found = new Map<string, string>();
          if (missing.length) {
            const tenantIds = missing
              .filter((s) => !s.platform)
              .map((s) => s.userId!);
            const staffIds = missing
              .filter((s) => s.platform)
              .map((s) => s.userId!);
            for (const u of await this.prisma.db.user.findMany({
              where: { id: { in: tenantIds } },
              select: { id: true, email: true },
            }))
              found.set(u.id, u.email);
            for (const u of await this.prisma.db.platformUser.findMany({
              where: { id: { in: staffIds } },
              select: { id: true, email: true },
            }))
              found.set(u.id, u.email);
          }
          await this.prisma.db.logSignin.createMany({
            data: signins.map((s) => ({
              tenantId: s.tenantId,
              userId: s.userId,
              emailHash: emailHash(s.email ?? found.get(s.userId ?? '') ?? ''),
              outcome: s.outcome,
              ip: short(s.ip, 64),
              userAgentShort: short(s.userAgent, 120),
              requestId: short(s.requestId ?? null, 64),
              createdAt: s.at,
            })),
          });
        }
      });
    } catch (e) {
      this.log.warn(
        `Dropped ${requests.length + signins.length} log lines: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
