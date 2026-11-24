import { AlertsCard, useToast, type AlertRow } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmptyState, Skeleton } from '@flourishive/ui';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

/** Which problems this staff member wants to hear about, and how. Opt-in (D-68). */
export function Alerts() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-alerts'], queryFn: () => api.alerts.list() });
  // What the person changed on screen but has not saved yet.
  const [edits, setEdits] = useState<Record<string, AlertRow['delivery']>>({});
  const [saving, setSaving] = useState(false);
  const draft: AlertRow[] = (q.data?.items ?? []).map((r) => ({
    ...r,
    delivery: edits[r.event] ?? r.delivery,
  }));
  const dirty = q.data
    ? draft.filter((d, i) => d.delivery !== q.data.items[i]?.delivery).length
    : 0;
  return (
    <Layout active="alerts" title="My alerts">
      <p className="mb-5 max-w-xl text-sm text-muted">
        Choose which problems you are told about. Nothing is sent until you turn it on. An instant
        alert arrives at most once an hour for the same problem; the daily summary comes at 08:00.
      </p>
      {q.isError ? (
        <EmptyState title="Could not load your alerts" description={messageOf(q.error)} />
      ) : !q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <AlertsCard
          items={draft}
          dirty={dirty}
          saving={saving}
          onChange={(event, delivery) => setEdits((e) => ({ ...e, [event]: delivery }))}
          onDiscard={() => setEdits({})}
          onSave={async () => {
            setSaving(true);
            try {
              await api.alerts.save({
                items: draft.map((d) => ({ event: d.event as never, delivery: d.delivery })),
              });
              setEdits({});
              await qc.invalidateQueries({ queryKey: ['platform-alerts'] });
              toast({ title: 'Alerts saved', tone: 'success' });
            } catch (e) {
              toast({ title: messageOf(e), tone: 'danger' });
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </Layout>
  );
}
