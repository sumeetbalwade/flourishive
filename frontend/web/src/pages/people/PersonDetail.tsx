import {
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { describeAction } from '../../lib/audit-labels.ts';
import { messageOf } from '../../lib/errors.ts';
import { go } from '../../router.ts';
import { Layout } from '../Layout.tsx';
import { PersonForm } from './PersonForm.tsx';
import { AccessCard } from '../../components/AccessCard.tsx';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { fmtDate, fullName } from '../../lib/format.ts';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-6 border-b border-line py-2.5 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-fg">{children || '—'}</dd>
    </div>
  );
}

export function PersonDetail({ id }: { id: string }) {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);

  const person = useQuery({ queryKey: ['person', id], queryFn: () => api.people.get(id) });
  const history = useQuery({
    queryKey: ['audit', 'people', id],
    queryFn: () => api.audit.list({ entityType: 'people', entityId: id, pageSize: 10 }),
    enabled: auth.can('audit.read'),
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['person', id] }),
      qc.invalidateQueries({ queryKey: ['people'] }),
      qc.invalidateQueries({ queryKey: ['audit', 'people', id] }),
    ]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok, tone: 'success' });
      await refresh();
    } catch (e) {
      toast({ title: 'That did not work', description: messageOf(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (person.isError) {
    return (
      <Layout active="people" title="Person">
        <EmptyState
          title="Could not open this person"
          description={messageOf(person.error)}
          action={
            <Button variant="secondary" onClick={() => go('/app/people')}>
              Back to people
            </Button>
          }
        />
      </Layout>
    );
  }
  if (!person.data) {
    return (
      <Layout active="people" title="Person">
        <Skeleton className="h-64 w-full" />
      </Layout>
    );
  }
  const p = person.data;
  const canWrite = auth.can('people.write');

  return (
    <Layout
      active="people"
      title={fullName(p)}
      actions={
        <>
          {canWrite ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          {auth.can('users.manage') && !p.person.userId && p.person.workEmail ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(() => api.people.invite(id), `Invitation sent to ${p.person.workEmail}`)
              }
            >
              Invite to sign in
            </Button>
          ) : null}
        </>
      }
    >
      <p className="mb-5 flex items-center gap-2 text-sm text-muted">
        <a href="#/app/people" className="underline">
          People
        </a>{' '}
        / {fullName(p)}
        <StatusBadge status={p.status} />
        <Badge tone="accent">{p.type === 'INTERN' ? 'Intern' : 'Employee'}</Badge>
        {p.person.userId ? <Badge tone="info">Has an account</Badge> : null}
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Details</CardTitle>
          <dl className="mt-3">
            <Row label="Employee code">
              <span className="font-mono">{p.employeeCode}</span>
            </Row>
            <Row label="Work email">{p.person.workEmail}</Row>
            <Row label="Phone">{p.person.phone}</Row>
            <Row label="Department">{p.department?.name}</Row>
            <Row label="Designation">{p.designation?.name}</Row>
            <Row label="Location">{p.location?.name}</Row>
            <Row label="Reports to">
              {p.manager ? `${p.manager.person.firstName} ${p.manager.person.lastName}` : ''}
            </Row>
            <Row label="Started">{fmtDate(p.startDate)}</Row>
            <Row label="Ends">{fmtDate(p.endDate)}</Row>
          </dl>
          {canWrite && p.status === 'ACTIVE' ? (
            <Button className="mt-4" size="sm" variant="secondary" onClick={() => setEnding(true)}>
              End this engagement…
            </Button>
          ) : null}
        </Card>
        {p.person.userId && auth.can('roles.read') ? <AccessCard userId={p.person.userId} /> : null}
        {p.type === 'INTERN' ? (
          <Card>
            <CardTitle>Internship</CardTitle>
            <dl className="mt-3">
              <Row label="College">{p.intern?.college}</Row>
              <Row label="Course">{p.intern?.course}</Row>
              <Row label="Graduation year">
                {p.intern?.graduationYear ? String(p.intern.graduationYear) : ''}
              </Row>
            </dl>
          </Card>
        ) : null}
        {auth.can('audit.read') ? (
          <Card className="lg:col-span-2">
            <CardTitle>History</CardTitle>
            {history.data && history.data.items.length > 0 ? (
              <ul className="mt-3 grid gap-2 text-sm">
                {history.data.items.map((h) => (
                  <li
                    key={h.seq}
                    className="flex justify-between gap-4 border-b border-line pb-2 last:border-0"
                  >
                    <span>
                      {describeAction(h.action)}{' '}
                      <span className="text-faint">· {h.actorType.toLowerCase()}</span>
                    </span>
                    <time className="text-faint" dateTime={h.createdAt}>
                      {new Date(h.createdAt).toLocaleString('en-IN')}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">
                {history.isPending ? 'Loading…' : 'No recorded changes yet.'}
              </p>
            )}
          </Card>
        ) : null}
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit person" className="max-w-2xl">
          <PersonForm
            existing={p}
            onSaved={() => {
              setEditing(false);
              toast({ title: 'Saved', tone: 'success' });
              void refresh();
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={ending} onOpenChange={setEnding}>
        <DialogContent
          title="End this engagement?"
          description={`${fullName(p)} will be marked as ended today. Their record and history stay.`}
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              disabled={busy}
              onClick={() => {
                setEnding(false);
                void act(
                  () =>
                    api.people.update(id, {
                      engagement: {
                        status: 'ENDED',
                        endDate: new Date().toISOString().slice(0, 10),
                      },
                    }),
                  'Engagement ended',
                );
              }}
            >
              End engagement
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
