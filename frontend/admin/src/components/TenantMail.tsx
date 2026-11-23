import { Badge, Button, Card, CardTitle, Skeleton, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';

/** Which sender a company's email goes out from, with a way back to the default if theirs is broken (D-58). */
export function TenantMail({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['tenant-mail', tenantId],
    queryFn: () => api.mail.tenantSender(tenantId),
  });
  const s = q.data?.sender;
  return (
    <Card>
      <CardTitle>Email sender</CardTitle>
      {q.isPending ? (
        <Skeleton className="mt-3 h-10 w-full" />
      ) : s ? (
        <div className="mt-2 text-sm">
          <p>
            <b>
              {s.fromName} &lt;{s.fromAddress}&gt;
            </b>{' '}
            <Badge
              tone={
                s.status === 'ACTIVE' ? 'success' : s.status === 'FAILED' ? 'danger' : 'neutral'
              }
            >
              {s.status.toLowerCase()}
            </Badge>
          </p>
          <p className="mt-1 text-muted">
            {s.kind === 'OWN_SMTP'
              ? `Own mail server (${s.smtp?.host})`
              : 'Our servers, their address'}
            {s.lastTestResult && s.lastTestResult !== 'OK'
              ? ` · last test: ${s.lastTestResult}`
              : ''}
          </p>
          {canManage ? (
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.mail.removeTenantSender(tenantId);
                  toast({ title: 'Back on the default sender', tone: 'success' });
                  await qc.invalidateQueries({ queryKey: ['tenant-mail', tenantId] });
                } catch (e) {
                  toast({ title: messageOf(e), tone: 'danger' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Switch back to default
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Uses the default sender, {q.data?.defaultFrom}.</p>
      )}
    </Card>
  );
}
