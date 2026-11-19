import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantScope =
  { kind: 'tenant'; tenantId: string } | { kind: 'system' };

const storage = new AsyncLocalStorage<TenantScope>();

/**
 * Runs `fn` with every database query restricted to one tenant.
 *
 * Prisma queries are lazy: they only run when awaited. Make `fn` async and
 * `await` every query inside it. A query returned un-awaited runs after the
 * scope has ended and is refused with "No tenant scope" (it fails closed).
 */
export function runInTenant<T>(tenantId: string, fn: () => T): T {
  if (!tenantId) throw new Error('runInTenant requires a tenantId');
  return storage.run({ kind: 'tenant', tenantId }, fn);
}

/**
 * Runs `fn` without tenant restriction. Only for platform code that is
 * deliberately cross-tenant: seeding, the super admin console, the queue
 * reconciler. Every use is a review point.
 */
export function runAsSystem<T>(fn: () => T): T {
  return storage.run({ kind: 'system' }, fn);
}

export function currentScope(): TenantScope | undefined {
  return storage.getStore();
}
