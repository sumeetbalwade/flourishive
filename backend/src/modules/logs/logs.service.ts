import { Injectable } from '@nestjs/common';
import type {
  ErrorLogQuery,
  ErrorLogResponse,
  JobLogQuery,
  JobLogResponse,
  RequestLogQuery,
  RequestLogResponse,
  SigninLogQuery,
  SigninLogResponse,
  TraceEntry,
  TraceResponse,
} from '@flourishive/schemas';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runAsSystem } from '../../platform/database/tenant-context.js';
import { SettingsService } from '../settings/settings.service.js';
import { emailHash } from './log-writer.service.js';

/** Who is asking: a company admin sees one company; platform staff see all, and some may see stacks. */
export interface LogViewer {
  /** Set for a company admin: every query is pinned to it. */
  tenantId: string | null;
  /** Platform staff with `logs.errors.detail`. */
  detail: boolean;
}

const dayEnd = (d: string) => (d.length <= 10 ? `${d}T23:59:59.999Z` : d);
const dates = (from?: string, to?: string) =>
  from || to
    ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(dayEnd(to)) } : {}),
        },
      }
    : {};

/** A status filter is `2xx`/`4xx`/`5xx` or an exact code. */
function statusWhere(s?: string) {
  if (!s) return {};
  const m = /^([1-5])xx$/i.exec(s);
  if (m) {
    const base = Number(m[1]) * 100;
    return { status: { gte: base, lt: base + 100 } };
  }
  const n = Number(s);
  return Number.isInteger(n) ? { status: n } : {};
}

@Injectable()
export class LogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  private scope(v: LogViewer, asked?: string) {
    return v.tenantId
      ? { tenantId: v.tenantId }
      : asked
        ? { tenantId: asked }
        : {};
  }

  private async names(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (unique.length === 0) return new Map();
    const rows = await runAsSystem(
      async () =>
        await this.db.tenant.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true },
        }),
    );
    return new Map(rows.map((t) => [t.id, t.name]));
  }

  async requests(
    q: RequestLogQuery,
    v: LogViewer,
  ): Promise<RequestLogResponse> {
    const where = {
      ...this.scope(v, q.tenantId),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.method ? { method: q.method.toUpperCase() } : {}),
      ...(q.route ? { routePattern: { contains: q.route } } : {}),
      ...(q.requestId ? { requestId: q.requestId } : {}),
      ...statusWhere(q.status),
      ...dates(q.from, q.to),
    };
    const [total, rows] = await runAsSystem(async () => [
      await this.db.logRequest.count({ where }),
      await this.db.logRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const names = await this.names(rows.map((r) => r.tenantId));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        tenantId: r.tenantId,
        tenantName: r.tenantId ? (names.get(r.tenantId) ?? null) : null,
        actorType: r.actorType,
        actorId: r.actorId,
        method: r.method,
        routePattern: r.routePattern,
        status: r.status,
        durationMs: r.durationMs,
        ip: r.ip,
        userAgent: r.userAgentShort,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async errors(q: ErrorLogQuery, v: LogViewer): Promise<ErrorLogResponse> {
    const search = q.q?.trim();
    const where = {
      ...this.scope(v, q.tenantId),
      ...(q.route ? { routePattern: { contains: q.route } } : {}),
      ...(q.requestId ? { requestId: q.requestId } : {}),
      ...(search
        ? {
            OR: [
              { message: { contains: search } },
              { story: { contains: search } },
            ],
          }
        : {}),
      ...(q.from || q.to
        ? {
            lastSeen: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(dayEnd(q.to)) } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await runAsSystem(async () => [
      await this.db.logError.count({ where }),
      await this.db.logError.findMany({
        where,
        orderBy: { lastSeen: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const names = await this.names(rows.map((r) => r.tenantId));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        tenantId: r.tenantId,
        tenantName: r.tenantId ? (names.get(r.tenantId) ?? null) : null,
        routePattern: r.routePattern,
        errorCode: v.tenantId ? 'ERROR' : r.errorCode,
        // A company admin gets the story only; the technical text stays with platform staff.
        message: v.tenantId ? '' : r.message,
        story: r.story,
        stack: v.detail ? r.stack : null,
        count: r.count,
        firstSeen: r.firstSeen.toISOString(),
        lastSeen: r.lastSeen.toISOString(),
      })),
    };
  }

  async signins(q: SigninLogQuery, v: LogViewer): Promise<SigninLogResponse> {
    const search = q.q?.trim();
    const where = {
      ...this.scope(v, q.tenantId),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(search ? { emailHash: emailHash(search) } : {}),
      ...dates(q.from, q.to),
    };
    const [total, rows] = await runAsSystem(async () => [
      await this.db.logSignin.count({ where }),
      await this.db.logSignin.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const names = await this.names(rows.map((r) => r.tenantId));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: r.tenantId ? (names.get(r.tenantId) ?? null) : null,
        userId: r.userId,
        outcome: r.outcome,
        ip: r.ip,
        userAgent: r.userAgentShort,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async jobs(q: JobLogQuery, v: LogViewer): Promise<JobLogResponse> {
    const where = {
      ...(v.tenantId
        ? { tenantId: v.tenantId }
        : q.tenantId
          ? { tenantId: q.tenantId }
          : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.name ? { name: { contains: q.name } } : {}),
      ...dates(q.from, q.to),
    };
    const [total, rows] = await runAsSystem(async () => [
      await this.db.jobRecord.count({ where }),
      await this.db.jobRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const names = await this.names(rows.map((r) => r.tenantId));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: names.get(r.tenantId) ?? null,
        name: r.name,
        status: r.status,
        attempts: r.attempts,
        lastError: v.tenantId ? null : r.lastError,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  /** Everything that shares one request id, in time order (D-67). */
  async trace(requestId: string, v: LogViewer): Promise<TraceResponse> {
    const pin = v.tenantId ? { tenantId: v.tenantId } : {};
    const [requests, errors, signins, mails, jobs, audits] = await runAsSystem(
      async () =>
        await Promise.all([
          this.db.logRequest.findMany({ where: { requestId, ...pin } }),
          this.db.logError.findMany({ where: { requestId, ...pin } }),
          this.db.logSignin.findMany({ where: { requestId, ...pin } }),
          this.db.mailDelivery.findMany({ where: { requestId, ...pin } }),
          this.db.jobRecord.findMany({
            where: {
              payload: { path: '$.requestId', equals: requestId },
              ...pin,
            },
          }),
          this.db.auditLog.findMany({
            where: {
              meta: { path: '$.requestId', equals: requestId },
              ...pin,
            },
            orderBy: { seq: 'asc' },
            take: 50,
          }),
        ]),
    );
    const entries: TraceEntry[] = [];
    for (const r of requests)
      entries.push({
        at: r.createdAt.toISOString(),
        kind: 'request',
        title: `${r.method} ${r.routePattern} answered ${r.status}`,
        detail: `${r.durationMs} ms`,
        tone: r.status >= 500 ? 'bad' : r.status >= 400 ? 'warn' : 'ok',
      });
    for (const e of errors)
      entries.push({
        at: e.lastSeen.toISOString(),
        kind: 'error',
        title: 'The server hit an error',
        detail: e.story,
        tone: 'bad',
      });
    for (const s of signins)
      entries.push({
        at: s.createdAt.toISOString(),
        kind: 'signin',
        title: `Sign-in: ${s.outcome.toLowerCase().replace(/_/g, ' ')}`,
        detail: null,
        tone: ['SUCCESS', 'MFA_OK', 'PASSKEY', 'TRUSTED_DEVICE'].includes(
          s.outcome,
        )
          ? 'ok'
          : 'warn',
      });
    for (const m of mails)
      entries.push({
        at: m.createdAt.toISOString(),
        kind: 'mail',
        title: `Email “${m.event}” to ${m.toMasked} ${m.status.toLowerCase()}`,
        detail: v.tenantId ? null : m.error,
        tone: m.status === 'FAILED' ? 'bad' : 'ok',
      });
    for (const j of jobs)
      entries.push({
        at: j.createdAt.toISOString(),
        kind: 'job',
        title: `Background job “${j.name}” is ${j.status.toLowerCase()}`,
        detail: v.tenantId ? null : j.lastError,
        tone: j.status === 'FAILED' ? 'bad' : 'ok',
      });
    for (const a of audits)
      entries.push({
        at: a.createdAt.toISOString(),
        kind: 'audit',
        title: `Recorded in the audit trail: ${a.action}`,
        detail: null,
        tone: 'ok',
      });
    entries.sort((a, b) => a.at.localeCompare(b.at));
    return { requestId, entries };
  }

  /** A short summary that is safe to paste into a message: no stack, no addresses, no values. */
  async supportCopy(requestId: string, v: LogViewer): Promise<string> {
    const t = await this.trace(requestId, v);
    const lines = [
      `Reference: ${requestId}`,
      ...t.entries.map(
        (e) => `${e.at.replace('T', ' ').slice(0, 19)}  ${e.title}`,
      ),
    ];
    const story = t.entries.find((e) => e.kind === 'error')?.detail;
    if (story) lines.push('', story);
    return lines.join('\n');
  }

  /** Deletes log rows older than the retention setting. Returns how many went. */
  async purge(now = new Date()): Promise<number> {
    const days = await this.settings.getPlatform('logs.retentionDays');
    const before = new Date(now.getTime() - days * 86_400_000);
    return await runAsSystem(async () => {
      const [a, b, c] = await Promise.all([
        this.db.logRequest.deleteMany({ where: { createdAt: { lt: before } } }),
        this.db.logSignin.deleteMany({ where: { createdAt: { lt: before } } }),
        this.db.logError.deleteMany({ where: { lastSeen: { lt: before } } }),
      ]);
      return a.count + b.count + c.count;
    });
  }
}
