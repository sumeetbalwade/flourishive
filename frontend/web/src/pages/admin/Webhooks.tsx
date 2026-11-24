import {
  WEBHOOK_EVENTS,
  type WebhookCreated,
  type WebhookEvent,
  type WebhookView,
} from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Switch,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

interface Draft {
  id?: string;
  url: string;
  description: string;
  events: WebhookEvent[];
  active: boolean;
}
const blank: Draft = { url: '', description: '', events: ['employee.created'], active: true };

function Deliveries({ id }: { id: string }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['webhook-deliveries', id],
    queryFn: () => api.webhooks.deliveries(id),
  });
  if (q.isPending) return <Skeleton className="mt-3 h-16 w-full" />;
  if (!q.data?.length) return <p className="mt-3 text-sm text-muted">Nothing has been sent yet.</p>;
  return (
    <ul className="mt-3 grid gap-1 text-sm">
      {q.data.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <Badge
              tone={
                d.status === 'DELIVERED' ? 'success' : d.status === 'FAILED' ? 'danger' : 'warning'
              }
            >
              {d.status.toLowerCase()}
            </Badge>{' '}
            {d.eventType}{' '}
            <span className="text-xs text-muted">
              {new Date(d.at).toLocaleString()} · {d.attempts} {d.attempts === 1 ? 'try' : 'tries'}
              {d.statusCode ? ` · ${d.statusCode}` : ''}
              {d.error ? ` · ${d.error}` : ''}
            </span>
          </span>
          {d.status !== 'DELIVERED' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void api.webhooks
                  .resend(d.id)
                  .then(() => qc.invalidateQueries({ queryKey: ['webhook-deliveries', id] }))
                  .catch((e) => toast({ title: messageOf(e), tone: 'danger' }))
              }
            >
              Send again
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Where the company wants to be told about events, with the log of what was sent (D-20). */
export function Webhooks() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = useAuth().can('settings.manage');
  const list = useQuery({ queryKey: ['webhooks'], queryFn: () => api.webhooks.list() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [secret, setSecret] = useState<WebhookCreated | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhooks'] });

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        url: draft.url,
        description: draft.description,
        events: draft.events,
        active: draft.active,
      };
      if (draft.id) await api.webhooks.update(draft.id, body);
      else setSecret(await api.webhooks.create(body));
      await refresh();
      setDraft(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const edit = (w: WebhookView): Draft => ({
    id: w.id,
    url: w.url,
    description: w.description,
    events: w.events,
    active: w.active,
  });
  const fail = (e: unknown) => toast({ title: messageOf(e), tone: 'danger' });

  return (
    <Layout
      active="webhooks"
      title="Webhooks"
      actions={
        canEdit ? (
          <Button size="sm" onClick={() => (setError(''), setSecret(null), setDraft(blank))}>
            Add an endpoint
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted">
          We send a signed message to your address when something happens. Check the{' '}
          <code>X-Flourishive-Signature</code> header with the secret shown when you add an
          endpoint. Failed deliveries are retried for about a day.
        </p>
        {secret ? (
          <Card>
            <CardTitle>Copy the signing secret now</CardTitle>
            <p className="mt-1 text-sm text-muted">
              It is shown only once. Rotate it if it is lost.
            </p>
            <code className="mt-3 block break-all rounded-lg bg-surface-2 p-3 text-sm">
              {secret.secret}
            </code>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => setSecret(null)}>
              I have copied it
            </Button>
          </Card>
        ) : null}
        {draft ? (
          <Card>
            <CardTitle>{draft.id ? 'Edit endpoint' : 'New endpoint'}</CardTitle>
            <form
              className="mt-4 grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Field label="Address" htmlFor="wh-url" hint="https://example.com/hooks/flourishive">
                <Input
                  id="wh-url"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </Field>
              <Field label="Note" htmlFor="wh-desc" hint="Optional, for you">
                <Input
                  id="wh-desc"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              <fieldset className="grid gap-1">
                <legend className="text-sm font-medium">Tell me when</legend>
                {WEBHOOK_EVENTS.map((ev) => (
                  <label key={ev.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.events.includes(ev.key)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          events: draft.events.includes(ev.key)
                            ? draft.events.filter((k) => k !== ev.key)
                            : [...draft.events, ev.key],
                        })
                      }
                    />
                    {ev.label} <span className="font-mono text-xs text-muted">{ev.key}</span>
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.active}
                  onChange={(v) => setDraft({ ...draft, active: v })}
                  label="Active"
                />
                Send events
              </label>
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  loading={busy}
                  disabled={!draft.url.trim() || draft.events.length === 0}
                >
                  {draft.id ? 'Save' : 'Add endpoint'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        ) : null}
        {list.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : list.data?.length === 0 ? (
          <EmptyState
            title="No endpoints yet"
            description="Add one to be told when people or letters change."
          />
        ) : (
          list.data?.map((w) => (
            <Card key={w.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-medium">{w.url}</span>
                    {!w.active ? <Badge tone="warning">Paused</Badge> : null}
                    {w.recentFailures > 0 ? (
                      <Badge tone="danger">{w.recentFailures} failed this week</Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted">
                    {w.description ? `${w.description} · ` : ''}
                    {w.events.join(', ')}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setOpen(open === w.id ? null : w.id)}
                  >
                    {open === w.id ? 'Hide log' : 'Delivery log'}
                  </Button>
                  {canEdit ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void api.webhooks
                            .test(w.id)
                            .then(() =>
                              qc.invalidateQueries({ queryKey: ['webhook-deliveries', w.id] }),
                            )
                            .then(() =>
                              toast({ title: 'Test sent. See the delivery log.', tone: 'success' }),
                            )
                            .catch(fail)
                        }
                      >
                        Send a test
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => (setError(''), setDraft(edit(w)))}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void api.webhooks.rotate(w.id).then(setSecret).catch(fail)}
                      >
                        Rotate secret
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void api.webhooks.remove(w.id).then(refresh).catch(fail)}
                      >
                        Delete
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              {open === w.id ? <Deliveries id={w.id} /> : null}
            </Card>
          ))
        )}
      </div>
    </Layout>
  );
}
