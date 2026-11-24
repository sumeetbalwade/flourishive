import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../platform/database/prisma.service.js';
import { runInTenant } from '../../platform/database/tenant-context.js';
import { SettingsService } from '../settings/settings.service.js';
import { LimitsService } from '../billing/limits.service.js';
import { AuthService } from '../identity/auth.service.js';
import { AccessService } from '../access/access.service.js';
import type { AccessClaims } from '../identity/token.service.js';
import {
  createPersonBody,
  listQuery,
  parseDate,
  updatePersonBody,
} from './people.schemas.js';

type Auth = Pick<AccessClaims, 'tenantId' | 'userId'>;
const include = {
  person: true,
  department: true,
  designation: true,
  location: true,
  intern: true,
  manager: {
    include: { person: { select: { firstName: true, lastName: true } } },
  },
} as const;

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    private readonly limits: LimitsService,
  ) {}

  /** When the company limits email domains (D-69), an address outside them is refused. */
  private async assertDomain(tenantId: string, email?: string | null) {
    if (!email) return;
    const allowed = await this.settings.get('signin.allowedEmailDomains', {
      tenantId,
    });
    if (allowed.length === 0) return;
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    if (!allowed.includes(domain))
      throw new BadRequestException(
        `Email addresses must end in ${allowed.map((d) => `@${d}`).join(' or ')}`,
      );
  }

  private async assertEntity(
    a: Auth,
    code: 'people.read' | 'people.write' | 'people.import',
    entityId: string,
  ) {
    if (!(await this.access.can(a.tenantId, a.userId, code, entityId))) {
      throw new ForbiddenException('You do not have access to that company');
    }
  }

  /** Every referenced id must exist inside this tenant (the scoped client cannot see other tenants). */
  private async assertRefs(
    db: PrismaService['db'],
    refs: {
      entityId?: string | null;
      departmentId?: string | null;
      designationId?: string | null;
      locationId?: string | null;
      managerId?: string | null;
    },
  ) {
    const checks: [
      string,
      string | null | undefined,
      () => Promise<unknown>,
    ][] = [
      [
        'company',
        refs.entityId,
        () => db.entity.findUnique({ where: { id: refs.entityId! } }),
      ],
      [
        'department',
        refs.departmentId,
        () => db.department.findUnique({ where: { id: refs.departmentId! } }),
      ],
      [
        'designation',
        refs.designationId,
        () => db.designation.findUnique({ where: { id: refs.designationId! } }),
      ],
      [
        'location',
        refs.locationId,
        () => db.location.findUnique({ where: { id: refs.locationId! } }),
      ],
      [
        'manager',
        refs.managerId,
        () => db.engagement.findUnique({ where: { id: refs.managerId! } }),
      ],
    ];
    for (const [label, id, find] of checks) {
      if (id && !(await find()))
        throw new BadRequestException(`Unknown ${label}`);
    }
  }

  async list(a: Auth, query: z.infer<typeof listQuery>) {
    const scope = await this.access.entityScope(
      a.tenantId,
      a.userId,
      'people.read',
    );
    if (!scope) throw new ForbiddenException();
    return runInTenant(a.tenantId, async () => {
      const where = {
        ...(scope === '*' ? {} : { entityId: { in: scope } }),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.q
          ? {
              OR: [
                { employeeCode: { contains: query.q } },
                { person: { firstName: { contains: query.q } } },
                { person: { lastName: { contains: query.q } } },
                { person: { workEmail: { contains: query.q } } },
              ],
            }
          : {}),
      };
      const [total, items] = await Promise.all([
        this.prisma.db.engagement.count({ where }),
        this.prisma.db.engagement.findMany({
          where,
          include,
          orderBy: [{ person: { firstName: 'asc' } }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return { total, page: query.page, pageSize: query.pageSize, items };
    });
  }

  async get(a: Auth, id: string) {
    const row = await runInTenant(
      a.tenantId,
      async () =>
        await this.prisma.db.engagement.findUnique({ where: { id }, include }),
    );
    if (!row) throw new NotFoundException();
    await this.assertEntity(a, 'people.read', row.entityId).catch(() => {
      throw new NotFoundException(); // do not reveal rows in companies the caller cannot see
    });
    return row;
  }

  async create(a: Auth, body: z.infer<typeof createPersonBody>) {
    const e = body.engagement;
    await this.assertEntity(a, 'people.write', e.entityId);
    if (!body.personId && !body.person)
      throw new BadRequestException('Provide person details or a personId');
    return runInTenant(a.tenantId, async () => {
      await this.assertRefs(this.prisma.db, e);
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          const personId =
            body.personId ??
            (
              await tx.person.create({
                data: { tenantId: a.tenantId, ...body.person! },
              })
            ).id;
          if (
            body.personId &&
            !(await tx.person.findUnique({ where: { id: body.personId } }))
          ) {
            throw new BadRequestException('Unknown person');
          }
          const engagement = await tx.engagement.create({
            data: {
              tenantId: a.tenantId,
              personId,
              entityId: e.entityId,
              type: e.type,
              employeeCode: e.employeeCode,
              departmentId: e.departmentId ?? null,
              designationId: e.designationId ?? null,
              locationId: e.locationId ?? null,
              managerId: e.managerId ?? null,
              startDate: parseDate(e.startDate)!,
              endDate: e.endDate ? parseDate(e.endDate) : null,
            },
          });
          if (e.type === 'INTERN' && body.intern) {
            await tx.internDetail.create({
              data: {
                tenantId: a.tenantId,
                engagementId: engagement.id,
                ...body.intern,
              },
            });
          }
          return await tx.engagement.findUniqueOrThrow({
            where: { id: engagement.id },
            include,
          });
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002')
          throw new ConflictException(
            'Employee code or work email already exists',
          );
        throw err;
      }
    });
  }

  async update(a: Auth, id: string, body: z.infer<typeof updatePersonBody>) {
    const current = await this.get(a, id);
    await this.assertEntity(a, 'people.write', current.entityId);
    const e = body.engagement;
    await this.assertDomain(a.tenantId, body.person?.workEmail);
    return runInTenant(a.tenantId, async () => {
      await this.assertRefs(this.prisma.db, e ?? {});
      if (e?.managerId === id)
        throw new BadRequestException('A person cannot report to themselves');
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          if (body.person)
            await tx.person.update({
              where: { id: current.personId },
              data: body.person,
            });
          if (e) {
            const { startDate, endDate, ...rest } = e;
            await tx.engagement.update({
              where: { id },
              data: {
                ...rest,
                ...(startDate ? { startDate: parseDate(startDate)! } : {}),
                ...(endDate !== undefined
                  ? { endDate: endDate ? parseDate(endDate) : null }
                  : {}),
              },
            });
          }
          if (body.intern) {
            await tx.internDetail.upsert({
              where: { engagementId: id },
              update: body.intern,
              create: {
                tenantId: a.tenantId,
                engagementId: id,
                ...body.intern,
              },
            });
          }
          return await tx.engagement.findUniqueOrThrow({
            where: { id },
            include,
          });
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002')
          throw new ConflictException(
            'Employee code or work email already exists',
          );
        throw err;
      }
    });
  }

  /**
   * Creates a sign-in account for a person, gives them the employee or intern role and
   * emails a set-password link. The person must have a work email.
   */
  async invite(a: Auth, id: string): Promise<{ email: string }> {
    const eng = await this.get(a, id);
    await this.assertEntity(a, 'people.write', eng.entityId);
    const email = eng.person.workEmail;
    if (!email) throw new BadRequestException('Add a work email first');
    await this.assertDomain(a.tenantId, email);
    if (eng.person.userId)
      throw new ConflictException('This person already has an account');

    await this.limits.assert(a.tenantId, 'users');
    const userId = await runInTenant(a.tenantId, async () => {
      try {
        return await this.prisma.db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { tenantId: a.tenantId, email, status: 'INVITED' },
          });
          await tx.person.update({
            where: { id: eng.personId },
            data: { userId: user.id },
          });
          return user.id;
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002')
          throw new ConflictException('That email already has an account');
        throw err;
      }
    });
    await this.access.assignRole(a.tenantId, a.userId, {
      userId,
      roleKey: eng.type === 'INTERN' ? 'intern' : 'employee',
    });
    await this.auth.sendPasswordLink(a.tenantId, userId, email, 'invite');
    return { email };
  }
}
