import { Badge, Button, Card, CardTitle, Select, Skeleton, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';

/** The roles one person holds. Anyone with roles.read can see them; roles.assign can change them. */
export function AccessCard({ userId }: { userId: string }) {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: ['user-roles', userId],
    queryFn: () => api.access.userRoles(userId),
  });
  const all = useQuery({ queryKey: ['roles'], queryFn: () => api.access.roles() });
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const canAssign = auth.can('roles.assign');

  async function change(work: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await work();
      toast({ title: ok, tone: 'success' });
      setPick('');
      await qc.invalidateQueries({ queryKey: ['user-roles', userId] });
    } catch (e) {
      toast({ title: 'That did not work', description: messageOf(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const held = new Set(mine.data?.map((r) => r.roleKey));
  const available = (all.data ?? []).filter((r) => !held.has(r.key));

  return (
    <Card>
      <CardTitle>Access</CardTitle>
      <p className="mt-1 text-sm text-muted">What this person can do once signed in.</p>
      {mine.isPending ? (
        <Skeleton className="mt-4 h-8 w-48" />
      ) : mine.isError ? (
        <p className="mt-3 text-sm text-danger">{messageOf(mine.error)}</p>
      ) : mine.data.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No roles yet. They can only see their own details.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {mine.data.map((r) => (
            <li key={`${r.roleKey}:${r.entityId ?? ''}`}>
              <Badge tone="accent" className="gap-2 py-1 pl-3 pr-2">
                {r.name}
                {canAssign && (
                  <button
                    type="button"
                    aria-label={`Remove ${r.name}`}
                    disabled={busy}
                    className="rounded-full p-0.5 hover:bg-accent/20"
                    onClick={() =>
                      void change(
                        () => api.access.remove(userId, r.roleKey, r.entityId ?? undefined),
                        `${r.name} removed`,
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {canAssign && available.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          <div className="w-56">
            <Select
              value={pick}
              onValueChange={setPick}
              placeholder="Add a role…"
              options={available.map((r) => ({ value: r.key, label: r.name }))}
            />
          </div>
          <Button
            size="sm"
            disabled={!pick || busy}
            onClick={() => void change(() => api.access.assign(userId, pick), 'Role added')}
          >
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}
