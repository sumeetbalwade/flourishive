import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { RuntimeConfigService } from '../../platform/config/runtime-config.service.js';
import { buildStory, classifyError, fingerprint, scrub } from './stories.js';

export interface ErrorContext {
  requestId?: string;
  tenantId?: string | null;
  actorId?: string | null;
  actorType?: string | null;
  method?: string | null;
  route?: string | null;
}

/**
 * Keeps every unexpected error (D-67): grouped by what went wrong and where, with a readable story,
 * and forwarded to a Sentry-compatible service when one is set up. Recording is best effort and never
 * throws, because it runs while another error is already being handled.
 */
@Injectable()
export class ErrorLogService {
  private readonly log = new Logger(ErrorLogService.name);
  private sentryDsn: string | null = null;
  private dsnCheckedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeConfigService,
  ) {}

  /** "Asha (HR admin, Flourisense)" for a signed-in company user; null otherwise. */
  private async describeActor(ctx: ErrorContext): Promise<string | null> {
    if (!ctx.actorId) return null;
    try {
      return await runAsSystem(async () => {
        if (ctx.actorType === 'PLATFORM') return 'A member of platform staff';
        if (!ctx.tenantId) return null;
        const [user, tenant] = await Promise.all([
          this.prisma.db.user.findFirst({
            where: { id: ctx.actorId!, tenantId: ctx.tenantId },
            select: {
              person: { select: { firstName: true } },
              userRoles: {
                select: { role: { select: { name: true } } },
                take: 1,
              },
            },
          }),
          this.prisma.db.tenant.findUnique({
            where: { id: ctx.tenantId },
            select: { name: true },
          }),
        ]);
        const name = user?.person?.firstName ?? 'A signed-in user';
        const role = user?.userRoles[0]?.role.name;
        return `${name} (${[role, tenant?.name].filter(Boolean).join(', ')})`;
      });
    } catch {
      return null;
    }
  }

  async record(err: unknown, ctx: ErrorContext): Promise<void> {
    try {
      const facts = classifyError(err);
      const who = await this.describeActor(ctx);
      const story = buildStory({
        ...facts,
        who,
        method: ctx.method ?? null,
        route: ctx.route ?? null,
      });
      const print = fingerprint(err, ctx.route ?? null);
      const stack =
        err instanceof Error && err.stack
          ? scrub(err.stack).slice(0, 8000)
          : null;
      const message = scrub(facts.message).slice(0, 500);
      const tenantId = ctx.tenantId ?? null;
      await runAsSystem(async () => {
        const existing = await this.prisma.db.logError.findFirst({
          where: { fingerprint: print, tenantId },
        });
        if (existing)
          await this.prisma.db.logError.update({
            where: { id: existing.id },
            data: {
              count: { increment: 1 },
              lastSeen: new Date(),
              requestId: ctx.requestId ?? existing.requestId,
              actorId: ctx.actorId ?? existing.actorId,
              message,
              story,
              stack,
            },
          });
        else
          await this.prisma.db.logError.create({
            data: {
              requestId: ctx.requestId ?? null,
              tenantId,
              actorId: ctx.actorId ?? null,
              routePattern: ctx.route?.slice(0, 200) ?? null,
              errorCode: facts.code,
              message,
              story,
              stack,
              fingerprint: print,
            },
          });
      });
      void this.forward(err, ctx, facts.code);
    } catch (e) {
      this.log.warn(
        `Could not record an error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async dsn(): Promise<string | null> {
    if (Date.now() - this.dsnCheckedAt > 60_000) {
      this.dsnCheckedAt = Date.now();
      this.sentryDsn = (await this.runtime.get('ERROR_TRACKING_DSN')) ?? null;
      if (this.sentryDsn) this.initSentry(this.sentryDsn);
    }
    return this.sentryDsn;
  }

  private initedFor: string | null = null;
  private initSentry(dsn: string): void {
    if (this.initedFor === dsn) return;
    Sentry.init({
      dsn,
      defaultIntegrations: false,
      tracesSampleRate: 0,
      beforeSend(event) {
        // Personal data stays here: no request, user or cookie details leave the server.
        delete event.request;
        delete event.user;
        delete event.contexts?.device;
        if (event.message) event.message = scrub(event.message);
        for (const v of event.exception?.values ?? [])
          if (v.value) v.value = scrub(v.value);
        return event;
      },
    });
    this.initedFor = dsn;
  }

  /** Sends one error to the tracking service, with the request id as a tag. */
  private async forward(err: unknown, ctx: ErrorContext, code: string) {
    try {
      if (!(await this.dsn())) return;
      Sentry.withScope((scope) => {
        scope.setTag('request_id', ctx.requestId ?? 'none');
        scope.setTag('error_code', code);
        if (ctx.route) scope.setTag('route', ctx.route);
        Sentry.captureException(err);
      });
    } catch {
      // Forwarding must never get in the way.
    }
  }

  /** Sends a test event so an admin can see forwarding works (PR 1 only checked the address). */
  async sendTestEvent(
    requestId: string,
  ): Promise<{ ok: boolean; message: string }> {
    this.dsnCheckedAt = 0;
    const dsn = await this.dsn();
    if (!dsn)
      return { ok: false, message: 'No error tracking address is set.' };
    Sentry.withScope((scope) => {
      scope.setTag('request_id', requestId);
      scope.setTag('test', 'true');
      Sentry.captureMessage('Flourishive test event', 'info');
    });
    const flushed = await Sentry.flush(4000);
    return flushed
      ? {
          ok: true,
          message: 'A test event was sent. Check your error tracking service.',
        }
      : {
          ok: false,
          message:
            'The test event could not be delivered in time. Check the address.',
        };
  }
}
