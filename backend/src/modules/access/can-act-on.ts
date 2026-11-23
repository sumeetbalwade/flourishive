import type { PermissionMap } from './access.service.js';

/**
 * The subset rule (D-63): a person may act on another only if everything the other can do, the actor can do too.
 * Equal powers are allowed. A power held for chosen companies only is covered by the same companies or by all.
 */
export function canActOn(actor: PermissionMap, target: PermissionMap): boolean {
  return Object.entries(target).every(([code, targetScopes]) => {
    const mine = actor[code];
    if (!mine) return false;
    if (mine.includes('*')) return true;
    // The target holds it everywhere but the actor does not.
    if (targetScopes.includes('*')) return false;
    return targetScopes.every((s) => mine.includes(s));
  });
}
