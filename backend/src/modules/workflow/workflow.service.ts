import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import {
  definitionSchema,
  LETTER_FLOW,
  LETTER_FLOW_KEY,
  type Transition,
  type WorkflowDefinitionData,
} from './definition.js';

export interface Subject {
  type: string;
  id: string;
}

@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  /** The newest saved flow for a key. The standard letters flow is created on first use. */
  async definition(tenantId: string, key: string) {
    return runInTenant(tenantId, async () => {
      let row = await this.prisma.db.workflowDefinition.findFirst({
        where: { key },
        orderBy: { version: 'desc' },
      });
      if (!row) {
        if (key !== LETTER_FLOW_KEY)
          throw new NotFoundException('Unknown flow');
        try {
          row = await this.prisma.db.workflowDefinition.create({
            data: {
              tenantId,
              key,
              name: 'Letters',
              version: 1,
              states: LETTER_FLOW.states,
              transitions: LETTER_FLOW.transitions,
            },
          });
        } catch (e) {
          if ((e as { code?: string }).code !== 'P2002') throw e;
          row = await this.prisma.db.workflowDefinition.findFirst({
            where: { key },
            orderBy: { version: 'desc' },
          });
        }
      }
      return row!;
    });
  }

  private data(row: { states: unknown; transitions: unknown }) {
    const parsed = definitionSchema.safeParse({
      initial: (row.states as { key: string }[])[0]?.key,
      states: row.states,
      transitions: row.transitions,
    });
    if (!parsed.success) throw new Error('A stored flow is invalid');
    return parsed.data as WorkflowDefinitionData;
  }

  /** Starts a subject in the flow's first state. */
  async start(
    a: { tenantId: string; userId: string | null },
    flowKey: string,
    subject: Subject,
  ) {
    const def = await this.definition(a.tenantId, flowKey);
    const d = this.data(def);
    return runInTenant(a.tenantId, async () =>
      this.prisma.db.workflowInstance.create({
        data: {
          tenantId: a.tenantId,
          definitionId: def.id,
          subjectType: subject.type,
          subjectId: subject.id,
          state: d.initial,
          createdBy: a.userId,
        },
      }),
    );
  }

  async forSubject(tenantId: string, subject: Subject) {
    const inst = await runInTenant(tenantId, async () =>
      this.prisma.db.workflowInstance.findUnique({
        where: {
          tenantId_subjectType_subjectId: {
            tenantId,
            subjectType: subject.type,
            subjectId: subject.id,
          },
        },
        include: { definition: true },
      }),
    );
    if (!inst) throw new NotFoundException();
    return inst;
  }

  /** States of many subjects at once, for lists. */
  async statesFor(tenantId: string, type: string, ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const rows = await runInTenant(tenantId, async () =>
      this.prisma.db.workflowInstance.findMany({
        where: { subjectType: type, subjectId: { in: ids } },
        select: { subjectId: true, state: true },
      }),
    );
    return new Map(rows.map((r) => [r.subjectId, r.state]));
  }

  /** What this person could do right now (for buttons in the screens). */
  async available(
    tenantId: string,
    subject: Subject,
    can: (permission: string) => Promise<boolean>,
  ) {
    const inst = await this.forSubject(tenantId, subject);
    const d = this.data(inst.definition);
    const out: { action: string; label: string; commentRequired: boolean }[] =
      [];
    for (const t of d.transitions) {
      if (t.system || !t.from.includes(inst.state)) continue;
      if (t.permission && !(await can(t.permission))) continue;
      out.push({
        action: t.action,
        label: t.label,
        commentRequired: t.commentRequired,
      });
    }
    return { state: inst.state, actions: out };
  }

  /**
   * Takes one action. A person's action needs the transition's permission (checked by `can`) and
   * must be allowed from the current state; the four-eyes rule and a required comment are enforced
   * here. The state change is conditional on the state still being what was read, so two people
   * acting at once cannot both succeed.
   */
  async act(
    a: { tenantId: string; userId: string | null },
    subject: Subject,
    action: string,
    opts: {
      comment?: string | null;
      can?: (permission: string) => Promise<boolean>;
      /** Only code that owns a system step (signing) passes this. */
      asSystem?: boolean;
    } = {},
  ) {
    const inst = await this.forSubject(a.tenantId, subject);
    const d = this.data(inst.definition);
    const t: Transition | undefined = d.transitions.find(
      (x) => x.action === action,
    );
    if (!t) throw new BadRequestException('Unknown action');
    if (t.system && !opts.asSystem)
      throw new ForbiddenException('That step is taken by the system');
    if (!t.from.includes(inst.state))
      throw new ConflictException(
        `You cannot ${t.label.toLowerCase()} while it is ${inst.state.replaceAll('_', ' ')}`,
      );
    if (!t.system && t.permission && !(await opts.can?.(t.permission)))
      throw new ForbiddenException('You do not have permission to do this');
    const comment = opts.comment?.trim() || null;
    if (t.commentRequired && !comment)
      throw new BadRequestException('Please add a comment');
    if (t.differentPersonFrom && a.userId) {
      const prior = await runInTenant(a.tenantId, async () =>
        this.prisma.db.workflowAction.findFirst({
          where: { instanceId: inst.id, action: t.differentPersonFrom },
          orderBy: { createdAt: 'desc' },
        }),
      );
      if (prior?.actorId === a.userId)
        throw new ForbiddenException('Someone else must do this step');
    }
    return runInTenant(a.tenantId, async () =>
      this.prisma.db.$transaction(async (tx) => {
        const moved = await tx.workflowInstance.updateMany({
          where: { id: inst.id, state: inst.state },
          data: { state: t.to },
        });
        if (moved.count !== 1)
          throw new ConflictException(
            'Someone else just changed this; reload and try again',
          );
        await tx.workflowAction.create({
          data: {
            tenantId: a.tenantId,
            instanceId: inst.id,
            action,
            fromState: inst.state,
            toState: t.to,
            actorId: a.userId,
            comment,
          },
        });
        return { from: inst.state, to: t.to };
      }),
    );
  }

  /** Records something that happened without moving the state (for example a revised draft). */
  async note(
    a: { tenantId: string; userId: string | null },
    subject: Subject,
    action: string,
    comment?: string,
  ) {
    const inst = await this.forSubject(a.tenantId, subject);
    await runInTenant(a.tenantId, async () =>
      this.prisma.db.workflowAction.create({
        data: {
          tenantId: a.tenantId,
          instanceId: inst.id,
          action,
          fromState: inst.state,
          toState: inst.state,
          actorId: a.userId,
          comment: comment ?? null,
        },
      }),
    );
  }

  async history(tenantId: string, subject: Subject) {
    const inst = await this.forSubject(tenantId, subject);
    const actions = await runInTenant(tenantId, async () =>
      this.prisma.db.workflowAction.findMany({
        where: { instanceId: inst.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return { state: inst.state, actions };
  }
}
