import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditInput {
  tenantId: string;
  actorType: 'USER' | 'PLATFORM' | 'SYSTEM' | 'SUPPORT';
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Non-sensitive context only: never passwords, tokens or personal data values. */
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  brokenAtSeq?: string;
  reason?: string;
}

/** JSON with sorted keys, so the hash does not depend on how the database orders them. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function computeHash(
  prevHash: string,
  f: {
    tenantId: string;
    actorType: string;
    actorId: string | null;
    action: string;
    entityType: string | null;
    entityId: string | null;
    meta: unknown;
    ip: string | null;
    createdAt: Date;
  },
): string {
  const body = stableStringify([
    f.tenantId,
    f.actorType,
    f.actorId,
    f.action,
    f.entityType,
    f.entityId,
    f.meta ?? null,
    f.ip,
    f.createdAt.toISOString(),
  ]);
  return createHash('sha256').update(`${prevHash}|${body}`).digest('hex');
}

/**
 * Append-only audit trail, one hash chain per tenant. Appends serialise on the
 * chain-head row, so concurrent requests never fork the chain.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.append(input);
        return;
      } catch (e) {
        // Two writers creating the very first head row at once: one loses, retry.
        if ((e as { code?: string }).code !== 'P2002' || attempt === 2) throw e;
      }
    }
  }

  /** For callers that must not fail because auditing failed; the failure is logged loudly. */
  async recordSafely(input: AuditInput): Promise<void> {
    try {
      await this.record(input);
    } catch (e) {
      this.log.error(
        `AUDIT WRITE FAILED for ${input.action} (tenant ${input.tenantId}): ${(e as Error).message}`,
      );
    }
  }

  private append(input: AuditInput): Promise<void> {
    const { tenantId } = input;
    return runInTenant(tenantId, async () => {
      await this.prisma.db.$transaction(async (tx) => {
        // Upserting takes the head row's lock until commit, so appends are serial.
        await tx.auditChainHead.upsert({
          where: { tenantId },
          update: { version: { increment: 1 } },
          create: { tenantId, lastHash: GENESIS_HASH, version: 1 },
        });
        const head = await tx.auditChainHead.findUniqueOrThrow({
          where: { tenantId },
        });
        const createdAt = new Date();
        const fields = {
          tenantId,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          meta: input.meta ?? null,
          ip: input.ip ?? null,
          createdAt,
        };
        const hash = computeHash(head.lastHash, fields);
        const row = await tx.auditLog.create({
          data: {
            ...fields,
            meta: (input.meta ?? undefined) as never,
            prevHash: head.lastHash,
            hash,
          },
        });
        await tx.auditChainHead.update({
          where: { tenantId },
          data: { lastSeq: row.seq, lastHash: hash },
        });
      });
    });
  }

  async list(
    tenantId: string,
    q: {
      page: number;
      pageSize: number;
      entityType?: string;
      entityId?: string;
      action?: string;
    },
  ) {
    return runInTenant(tenantId, async () => {
      const where = {
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.action ? { action: { contains: q.action } } : {}),
      };
      const [total, rows] = await Promise.all([
        this.prisma.db.auditLog.count({ where }),
        this.prisma.db.auditLog.findMany({
          where,
          orderBy: { seq: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((r) => ({ ...r, seq: r.seq.toString() })),
      };
    });
  }

  /** Re-computes every hash from the start and compares the tip with the chain head. */
  async verifyChain(tenantId: string): Promise<ChainCheck> {
    return runInTenant(tenantId, async () => {
      let prev = GENESIS_HASH;
      let checked = 0;
      let cursor: bigint | undefined;
      for (;;) {
        const rows = await this.prisma.db.auditLog.findMany({
          orderBy: { seq: 'asc' },
          take: 500,
          ...(cursor !== undefined ? { where: { seq: { gt: cursor } } } : {}),
        });
        if (rows.length === 0) break;
        for (const r of rows) {
          const expected = computeHash(r.prevHash, { ...r, meta: r.meta });
          if (r.prevHash !== prev)
            return {
              ok: false,
              checked,
              brokenAtSeq: r.seq.toString(),
              reason: 'Chain link is broken (a row was removed or reordered)',
            };
          if (r.hash !== expected)
            return {
              ok: false,
              checked,
              brokenAtSeq: r.seq.toString(),
              reason: 'Row content does not match its hash (edited)',
            };
          prev = r.hash;
          checked++;
          cursor = r.seq;
        }
      }
      const head = await this.prisma.db.auditChainHead.findUnique({
        where: { tenantId },
      });
      const tip = head?.lastHash ?? GENESIS_HASH;
      if (tip !== prev)
        return {
          ok: false,
          checked,
          reason:
            'Chain tip does not match the head (rows were removed from the end)',
        };
      return { ok: true, checked };
    });
  }
}
