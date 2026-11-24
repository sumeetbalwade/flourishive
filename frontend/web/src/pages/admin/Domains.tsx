import type { DomainView } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

const STATUS: Record<
  DomainView['status'],
  { text: string; tone: 'success' | 'warning' | 'danger' | 'info' }
> = {
  PENDING_DNS: { text: 'Waiting for DNS', tone: 'warning' },
  VERIFIED: { text: 'Verified, getting HTTPS', tone: 'info' },
  ACTIVE: { text: 'Live', tone: 'success' },
  FAILED: { text: 'Not verified', tone: 'danger' },
};

function CopyBox({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-2 rounded-md bg-surface-2 px-2 py-1 text-left font-mono text-xs"
      aria-label={`Copy ${text}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      <span className="break-all">{text}</span>
      {done ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
    </button>
  );
}

function DomainCard({
  d,
  busy,
  onCheck,
  onPrimary,
  onRemove,
}: {
  d: DomainView;
  busy: string | null;
  onCheck: () => void;
  onPrimary: (on: boolean) => void;
  onRemove: () => void;
}) {
  const live = d.status === 'VERIFIED' || d.status === 'ACTIVE';
  const s = STATUS[d.status];
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{d.hostname}</CardTitle>
        <div className="flex items-center gap-2">
          {d.primary ? <Badge tone="accent">Used in emails</Badge> : null}
          <Badge tone={s.tone}>{s.text}</Badge>
        </div>
      </div>
      {!live ? (
        <>
          <p className="mt-2 text-sm text-muted">
            Add these two records where your domain’s DNS is managed (your domain registrar or IT
            team), then press Check now. DNS changes can take a few minutes. We also re-check every
            10 minutes for 2 days.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Type</th>
                  <th className="py-1 pr-3 font-medium">Name</th>
                  <th className="py-1 pr-3 font-medium">Value</th>
                  <th className="py-1 font-medium">Seen</th>
                </tr>
              </thead>
              <tbody>
                {d.records.map((r) => (
                  <tr key={r.type} className="align-top">
                    <td className="py-1.5 pr-3 font-medium">{r.type}</td>
                    <td className="py-1.5 pr-3">
                      <CopyBox text={r.name} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <CopyBox text={r.value} />
                    </td>
                    <td className="py-1.5">
                      {r.found ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <Check size={14} aria-hidden /> Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted">
                          <X size={14} aria-hidden /> Not yet
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.error ? (
            <p role="status" className="mt-3 text-sm text-warning">
              {d.error}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {d.status === 'ACTIVE'
            ? 'People can sign in on this address, with HTTPS.'
            : 'DNS is right. The secure certificate is issued the first time anyone opens the address.'}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy === `check:${d.id}`} onClick={onCheck}>
          Check now
        </Button>
        {live ? (
          <Button
            variant="secondary"
            loading={busy === `primary:${d.id}`}
            onClick={() => onPrimary(!d.primary)}
          >
            {d.primary ? 'Stop using in emails' : 'Use in emails'}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </Card>
  );
}

/** The company's own web address, such as hr.company.com (D-69). */
export function Domains() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['domains'], queryFn: () => api.domains.state() });
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DomainView | null>(null);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }
  const refresh = () => qc.invalidateQueries({ queryKey: ['domains'] });

  return (
    <Layout active="domains" title="Web address">
      <div className="grid max-w-3xl gap-5">
        <Card>
          <CardTitle>Your address</CardTitle>
          {q.isPending ? (
            <Skeleton className="mt-3 h-10 w-full" />
          ) : (
            <p className="mt-2 text-sm text-muted">
              People can always sign in at <b className="text-fg">{q.data?.defaultAddress}</b>. You
              can also use an address on your own website, such as{' '}
              <b className="text-fg">hr.yourcompany.com</b>. Sign-in, passkeys and links in emails
              then work on that address.
            </p>
          )}
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run('add', async () => {
                await api.domains.add(hostname);
                setHostname('');
                await refresh();
                toast({ title: 'Address added. Now add the DNS records below.', tone: 'success' });
              });
            }}
          >
            <Field label="Add an address" htmlFor="hostname" hint="A subdomain of your own website">
              <Input
                id="hostname"
                value={hostname}
                placeholder="hr.yourcompany.com"
                onChange={(e) => setHostname(e.target.value)}
              />
            </Field>
            <Button type="submit" loading={busy === 'add'} disabled={!hostname.trim()}>
              Add address
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </Card>

        {q.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : q.isError ? (
          <p role="alert" className="text-sm text-danger">
            {messageOf(q.error)}
          </p>
        ) : q.data.domains.length === 0 ? (
          <EmptyState
            title="No address of your own yet"
            description="Add one above if you want people to sign in on your own website’s address."
          />
        ) : (
          q.data.domains.map((d) => (
            <DomainCard
              key={d.id}
              d={d}
              busy={busy}
              onCheck={() =>
                void run(`check:${d.id}`, async () => {
                  const r = await api.domains.check(d.id);
                  await refresh();
                  toast({
                    title:
                      r.status === 'PENDING_DNS' || r.status === 'FAILED'
                        ? 'Not ready yet'
                        : 'DNS is right',
                    tone: r.status === 'PENDING_DNS' || r.status === 'FAILED' ? 'info' : 'success',
                  });
                })
              }
              onPrimary={(on) =>
                void run(`primary:${d.id}`, async () => {
                  await api.domains.setPrimary(on ? d.hostname : null);
                  await refresh();
                  toast({
                    title: on ? 'Emails will use this address' : 'Emails use the default address',
                    tone: 'success',
                  });
                })
              }
              onRemove={() => setRemoving(d)}
            />
          ))
        )}
      </div>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent
          title={`Remove ${removing?.hostname ?? 'this address'}?`}
          description="People can no longer sign in on it, and emails go back to the default address. You can add it again later."
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              loading={busy === 'remove'}
              onClick={() =>
                void run('remove', async () => {
                  if (removing) await api.domains.remove(removing.id);
                  setRemoving(null);
                  await refresh();
                  toast({ title: 'Address removed', tone: 'success' });
                })
              }
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
