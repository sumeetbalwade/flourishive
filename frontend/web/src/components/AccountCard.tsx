import { AccountPanel, Card, CardTitle, Skeleton, type AccountActionName } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';

/** A person's sign-in account: status, two-step, remembered devices and the admin actions (D-63). */
export function AccountCard({ userId }: { userId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['account', userId],
    queryFn: () => api.users.account(userId),
  });
  return (
    <Card>
      <CardTitle>Account</CardTitle>
      <div className="mt-3">
        {q.isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : q.isError ? (
          <p className="text-sm text-muted">{messageOf(q.error)}</p>
        ) : (
          <AccountPanel
            account={q.data}
            onAct={async (action: AccountActionName, reason: string) => {
              try {
                await api.users.act(userId, action, reason);
              } catch (e) {
                throw new Error(messageOf(e));
              }
              await qc.invalidateQueries({ queryKey: ['account', userId] });
            }}
          />
        )}
      </div>
    </Card>
  );
}
