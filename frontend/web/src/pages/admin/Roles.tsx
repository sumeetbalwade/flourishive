import { Badge, Card, CardTitle, EmptyState, Skeleton } from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

/** What each role is allowed to do. People get roles from their own page under People. */
export function Roles() {
  const api = useApi();
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.access.roles() });
  return (
    <Layout active="roles" title="Roles & access">
      <p className="mb-5 max-w-2xl text-sm text-muted">
        A role is a set of permissions. To give someone a role, open them under People and use the
        Access card. Two-step and recovery for each role are under Security policy.
      </p>
      {q.isError ? (
        <EmptyState title="Could not load" description={messageOf(q.error)} />
      ) : q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid max-w-5xl gap-4 md:grid-cols-2">
          {q.data.map((r) => (
            <Card key={r.key}>
              <div className="flex items-start justify-between gap-3">
                <CardTitle>{r.name}</CardTitle>
                {!r.isSystem && <Badge>Custom</Badge>}
              </div>
              <p className="mt-1 text-xs text-faint">
                {r.permissions.length} {r.permissions.length === 1 ? 'permission' : 'permissions'}
              </p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {r.permissions.map((p) => (
                  <li
                    key={p}
                    className="rounded-pill bg-surface-2 px-2.5 py-0.5 font-mono text-[11px] text-muted"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
