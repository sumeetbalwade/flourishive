import type { AnnouncementView } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

/** `datetime-local` wants local time without a zone. */
const toLocal = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => new Date(v).toISOString();
const TONE = { INFO: 'info', WARNING: 'warning', CRITICAL: 'danger' } as const;

function Maintenance() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['maintenance'], queryFn: () => api.controls.maintenance() });
  const [message, setMessage] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!q.data) return;
    setMessage(q.data.message);
    setUntil(q.data.until ? toLocal(q.data.until) : '');
  }, [q.data]);

  async function save(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      const r = await api.controls.setMaintenance({
        enabled,
        message: message.trim(),
        until: until ? fromLocal(until) : null,
      });
      qc.setQueryData(['maintenance'], r);
      toast({ title: enabled ? 'Maintenance is on' : 'Maintenance is off', tone: 'success' });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const on = q.data?.enabled ?? false;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Maintenance mode</CardTitle>
        {q.data ? <Badge tone={on ? 'warning' : 'success'}>{on ? 'On' : 'Off'}</Badge> : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        While it is on, every company sees a maintenance page and cannot sign in. Platform staff,
        the support console and public document checks keep working.
      </p>
      {q.isPending ? (
        <Skeleton className="mt-3 h-24 w-full" />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Message shown to people" htmlFor="m-msg" hint="Optional">
            <Input id="m-msg" value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Field label="Expected back" htmlFor="m-until" hint="Optional">
            <Input
              id="m-until"
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        {on ? (
          <>
            <Button loading={busy} onClick={() => void save(false)}>
              Turn off
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void save(true)}>
              Update message
            </Button>
          </>
        ) : (
          <Button variant="danger" loading={busy} onClick={() => void save(true)}>
            Turn on maintenance
          </Button>
        )}
      </div>
    </Card>
  );
}

function Announcements() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['announcements'], queryFn: () => api.controls.announcements() });
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: () => api.tenants.list() });
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<AnnouncementView['tone']>('INFO');
  const [tenantId, setTenantId] = useState('');
  const [starts, setStarts] = useState(() => toLocal(new Date().toISOString()));
  const [ends, setEnds] = useState(() => toLocal(new Date(Date.now() + 86_400_000).toISOString()));
  const [dismissible, setDismissible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements'] });
  const nameOf = (id: string) => tenants.data?.find((t) => t.id === id)?.name ?? id.slice(0, 8);
  const now = Date.now();
  const state = (a: AnnouncementView) =>
    new Date(a.endsAt).getTime() <= now
      ? 'Ended'
      : new Date(a.startsAt).getTime() > now
        ? 'Scheduled'
        : 'Showing';

  return (
    <Card>
      <CardTitle>Announcements</CardTitle>
      <p className="mt-1 text-sm text-muted">
        A banner above every page of the company app, for everyone or for one company, between two
        times.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          api.controls
            .createAnnouncement({
              message: message.trim(),
              tone,
              tenantIds: tenantId ? [tenantId] : null,
              startsAt: fromLocal(starts),
              endsAt: fromLocal(ends),
              dismissible,
            })
            .then(async () => {
              setMessage('');
              await refresh();
              toast({ title: 'Announcement saved', tone: 'success' });
            })
            .catch((err) => setError(messageOf(err)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="sm:col-span-2">
          <Field label="Message" htmlFor="a-msg" hint="Up to 500 characters">
            <Input id="a-msg" value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        </div>
        <Field label="Style" htmlFor="a-tone">
          <Select
            id="a-tone"
            value={tone}
            onValueChange={(v) => setTone(v as AnnouncementView['tone'])}
            options={[
              { value: 'INFO', label: 'Information' },
              { value: 'WARNING', label: 'Warning' },
              { value: 'CRITICAL', label: 'Critical' },
            ]}
          />
        </Field>
        <Field label="Who sees it" htmlFor="a-who">
          <Select
            id="a-who"
            value={tenantId || 'all'}
            onValueChange={(v) => setTenantId(v === 'all' ? '' : v)}
            options={[
              { value: 'all', label: 'Every company' },
              ...(tenants.data ?? []).map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        </Field>
        <Field label="Starts" htmlFor="a-start">
          <Input
            id="a-start"
            type="datetime-local"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </Field>
        <Field label="Ends" htmlFor="a-end">
          <Input
            id="a-end"
            type="datetime-local"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch checked={dismissible} onChange={setDismissible} label="People can dismiss it" />
          <span className="text-sm text-muted">People can dismiss it</span>
          <div className="ml-auto">
            <Button type="submit" loading={busy} disabled={!message.trim()}>
              Add announcement
            </Button>
          </div>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-5">
        {!q.data ? (
          <Skeleton className="h-16 w-full" />
        ) : q.data.length === 0 ? (
          <EmptyState title="No announcements yet" description="Add one above." />
        ) : (
          <ul className="grid gap-2">
            {q.data.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={TONE[a.tone]}>{state(a)}</Badge>
                    <span className="truncate text-sm">{a.message}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {a.tenantIds ? a.tenantIds.map(nameOf).join(', ') : 'Every company'} ·{' '}
                    {new Date(a.startsAt).toLocaleString()} to {new Date(a.endsAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void api.controls
                      .removeAnnouncement(a.id)
                      .then(refresh)
                      .catch((err) => setError(messageOf(err)))
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Platform-wide switches: announcements and maintenance (D-70). */
export function Controls() {
  const can = useCan();
  return (
    <Layout active="controls" title="Platform controls">
      {can('platform.controls') ? (
        <div className="grid max-w-3xl gap-5">
          <Maintenance />
          <Announcements />
        </div>
      ) : (
        <p className="text-sm text-muted">You do not have access to platform controls.</p>
      )}
    </Layout>
  );
}
