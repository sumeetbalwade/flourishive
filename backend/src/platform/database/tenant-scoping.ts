import { Prisma } from '../../generated/prisma/client.js';
import { currentScope } from './tenant-context.js';

/**
 * Models that carry a `tenantId` column. The cross-tenant test suite parses
 * prisma/schema/*.prisma and fails if a model with `tenantId` is missing here.
 */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  'Entity',
  'JobRecord',
  'User',
  'RecoveryCode',
  'Session',
  'RefreshToken',
  'Role',
  'RolePermission',
  'UserRole',
  'SettingValue',
  'Location',
  'Department',
  'Designation',
  'Person',
  'Engagement',
  'InternDetail',
  'AuditLog',
  'AuditChainHead',
  'File',
  'Notification',
  'Letterhead',
  'NumberingScheme',
  'NumberingCounter',
  'Template',
  'TemplateVersion',
  'GeneratedDocument',
  'BulkBatch',
  'BulkBatchRow',
  'DeliveryLink',
  'EsignTransaction',
  'WorkflowDefinition',
  'WorkflowInstance',
  'WorkflowAction',
  'SignatureRequest',
  'SignatureParty',
  'SignatureEvent',
  'DesktopDevice',
  'SupportSession',
]);

/** The tenants table itself is scoped by its own id. */
const TENANT_MODEL = 'Tenant';

type Args = Record<string, unknown>;

const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);
const UNIQUE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
]);

function and(where: unknown, extra: Args): Args {
  return where ? { AND: [where as Args, extra] } : extra;
}

function stamp(data: unknown, key: string, tenantId: string): Args {
  const row = { ...(data as Args) };
  if (row[key] !== undefined && row[key] !== tenantId) {
    throw new Error('Cross-tenant write refused');
  }
  row[key] = tenantId;
  return row;
}

/** Pure function so the rules can be unit tested without a database. */
export function scopeArgs(
  model: string,
  operation: string,
  args: Args,
  tenantId: string,
): Args {
  const key = model === TENANT_MODEL ? 'id' : 'tenantId';
  const filter = { [key]: tenantId };
  const next: Args = { ...args };

  if (WHERE_OPS.has(operation)) {
    next.where = and(args.where, filter);
  } else if (UNIQUE_OPS.has(operation)) {
    next.where = { ...(args.where as Args), ...filter };
  } else if (operation === 'upsert') {
    next.where = { ...(args.where as Args), ...filter };
    next.create = stamp(args.create, key, tenantId);
  } else if (operation === 'create') {
    next.data = stamp(args.data, key, tenantId);
  } else if (
    operation === 'createMany' ||
    operation === 'createManyAndReturn'
  ) {
    const rows = Array.isArray(args.data) ? args.data : [args.data];
    next.data = rows.map((r) => stamp(r, key, tenantId));
  } else {
    throw new Error(
      `Operation ${operation} is not allowed on ${model} in a tenant scope`,
    );
  }
  return next;
}

/**
 * Prisma client extension: reads, updates and deletes on a scoped model get the
 * current tenant added. Prisma validates `create` arguments before this runs, so
 * creates must pass `tenantId` themselves; the extension then refuses any value
 * that is not the current tenant.
 */
export const tenantScopingExtension = Prisma.defineExtension({
  name: 'tenant-scoping',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const scoped =
          TENANT_SCOPED_MODELS.has(model) || model === TENANT_MODEL;
        if (!scoped) return query(args);

        const scope = currentScope();
        if (!scope) {
          throw new Error(
            `No tenant scope for ${model}.${operation}; wrap the call in runInTenant or runAsSystem`,
          );
        }
        if (scope.kind === 'system') return query(args);
        return query(
          scopeArgs(
            model,
            operation,
            args as Args,
            scope.tenantId,
          ) as typeof args,
        );
      },
    },
  },
});
