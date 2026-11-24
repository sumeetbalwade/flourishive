import {
  API_SCOPES,
  type ApiClientCreated,
  type ApiClientView,
  type ApiScope,
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
  brand,
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
  name: string;
  scopes: ApiScope[];
  entityIds: string[];
  rate: string;
  active: boolean;
}
const blank: Draft = {
  name: '',
  scopes: ['employees:read'],
  entityIds: [],
  rate: '60',
  active: true,
};

/** Systems outside Flourishive that read employees or create letters through the public API (D-20). */
export function ApiClients() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = useAuth().can('settings.manage');
  const list = useQuery({ queryKey: ['api-clients'], queryFn: () => api.apiClients.list() });
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => api.org.entities() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [secret, setSecret] = useState<ApiClientCreated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-clients'] });

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        name: draft.name,
        scopes: draft.scopes,
        entityIds: draft.entityIds.length ? draft.entityIds : null,
        rateLimitPerMinute: Number(draft.rate) || 60,
        active: draft.active,
      };
      if (draft.id) await api.apiClients.update(draft.id, body);
      else setSecret(await api.apiClients.create(body));
      await refresh();
      setDraft(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const edit = (c: ApiClientView): Draft => ({
    id: c.id,
    name: c.name,
    scopes: c.scopes,
    entityIds: c.entityIds ?? [],
    rate: String(c.rateLimitPerMinute),
    active: c.active,
  });
  const toggle = <T,>(arr: T[], v: T) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <Layout
      active="api-clients"
      title="API access"
      actions={
        canEdit ? (
          <Button size="sm" onClick={() => (setError(''), setSecret(null), setDraft(blank))}>
            Add a client
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted">
          Systems you connect (an ERP, a payroll tool) get a client ID and secret. They trade it for
          a one-hour token at <code>{brand.apiUrl}/v1/oauth/token</code> and call{' '}
          <code>/v1/api/…</code>. A client acts as you, so it can never do more than you may.
        </p>
        {secret ? (
          <Card>
            <CardTitle>Copy the secret now</CardTitle>
            <p className="mt-1 text-sm text-muted">
              It is shown only once. Rotate it if it is lost.
            </p>
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="text-muted">Client ID</dt>
                <dd className="break-all font-mono">{secret.clientId}</dd>
              </div>
              <div>
                <dt className="text-muted">Client secret</dt>
                <dd className="break-all font-mono">{secret.clientSecret}</dd>
              </div>
            </dl>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => setSecret(null)}>
              I have copied it
            </Button>
          </Card>
        ) : null}
        {draft ? (
          <Card>
            <CardTitle>{draft.id ? 'Edit client' : 'New client'}</CardTitle>
            <form
              className="mt-4 grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <Field label="Name" htmlFor="ac-name" hint="For example: Payroll system">
                <Input
                  id="ac-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Requests per minute" htmlFor="ac-rate">
                <Input
                  id="ac-rate"
                  inputMode="numeric"
                  value={draft.rate}
                  onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                />
              </Field>
              <fieldset className="grid gap-1 sm:col-span-2">
                <legend className="text-sm font-medium">What it may do</legend>
                {API_SCOPES.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.scopes.includes(s.key)}
                      onChange={() => setDraft({ ...draft, scopes: toggle(draft.scopes, s.key) })}
                    />
                    {s.label} <span className="font-mono text-xs text-muted">{s.key}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="grid gap-1 sm:col-span-2">
                <legend className="text-sm font-medium">Which companies</legend>
                <p className="text-xs text-muted">
                  {draft.entityIds.length === 0
                    ? 'All of them. Tick to limit.'
                    : 'Only the ticked ones.'}
                </p>
                {entities.data?.map((en) => (
                  <label key={en.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.entityIds.includes(en.id)}
                      onChange={() =>
                        setDraft({ ...draft, entityIds: toggle(draft.entityIds, en.id) })
                      }
                    />
                    {en.name}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch
                  checked={draft.active}
                  onChange={(v) => setDraft({ ...draft, active: v })}
                  label="Active"
                />
                Allowed to call the API
              </label>
              {error ? (
                <p role="alert" className="text-sm text-danger sm:col-span-2">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2 sm:col-span-2">
                <Button
                  type="submit"
                  loading={busy}
                  disabled={!draft.name.trim() || draft.scopes.length === 0}
                >
                  {draft.id ? 'Save' : 'Create client'}
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
            title="No API clients yet"
            description="Add one to let another system read your people or create letters."
          />
        ) : (
          <ul className="grid gap-2">
            {list.data?.map((c) => (
              <li key={c.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {!c.active ? <Badge tone="warning">Paused</Badge> : null}
                    </div>
                    <div className="text-xs text-muted">
                      <span className="font-mono">{c.clientId}</span> · secret ends {c.secretLast4}{' '}
                      · {c.rateLimitPerMinute}/min · last used{' '}
                      {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : 'never'}
                    </div>
                    <div className="text-xs text-muted">{c.scopes.join(', ')}</div>
                  </div>
                  {canEdit ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => (setError(''), setDraft(edit(c)))}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void api.apiClients
                            .rotate(c.id)
                            .then(setSecret)
                            .then(refresh)
                            .catch((e) => toast({ title: messageOf(e), tone: 'danger' }))
                        }
                      >
                        Rotate secret
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api.apiClients
                            .remove(c.id)
                            .then(refresh)
                            .catch((e) => toast({ title: messageOf(e), tone: 'danger' }))
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}
