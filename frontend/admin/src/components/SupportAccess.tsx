import {
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  DialogContent,
  Field,
  Segmented,
  Select,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { fmtDateTime } from '@flourishive/ui';

const when = (iso: string) => fmtDateTime(iso);

/** "Open as support" (D-56): a reason, a mode and a time limit, then the company opens in a new tab. */
export function OpenAsSupport({ tenantId }: { tenantId: string }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'READ' | 'WRITE'>('READ');
  const [minutes, setMinutes] = useState('60');
  const [busy, setBusy] = useState(false);
  if (!can('tenants.data.read', 'tenants.data.write')) return null;

  async function start() {
    setBusy(true);
    try {
      const s = await api.support.start(tenantId, {
        reason: reason.trim(),
        mode,
        minutes: Number(minutes),
      });
      setOpen(false);
      setReason('');
      window.open(s.url, '_blank', 'noopener');
      toast({ title: 'Support session opened in a new tab', tone: 'success' });
      await qc.invalidateQueries({ queryKey: ['support-sessions', tenantId] });
    } catch (e) {
      toast({ title: messageOf(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <LifeBuoy size={15} /> Open as support
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Open as support"
          description="You will see this company the way its admin does. They are told, and every request is recorded in their audit log."
        >
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <Field
              label="Why are you opening it?"
              htmlFor="support-reason"
              hint="Shown to the company."
            >
              <textarea
                id="support-reason"
                autoFocus
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-card border border-line-strong bg-surface px-4 py-3 text-sm focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_var(--accent-lo)]"
              />
            </Field>
            {can('tenants.data.write') ? (
              <Field
                label="What can you do?"
                htmlFor="support-mode"
                hint={
                  mode === 'READ'
                    ? 'View only. Nothing can be changed.'
                    : 'Change mode lets you edit their data. Use only when you must.'
                }
              >
                <Segmented
                  label="Support mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'READ', label: 'View only' },
                    { value: 'WRITE', label: 'Can change' },
                  ]}
                />
              </Field>
            ) : null}
            <Field label="How long?" htmlFor="support-minutes">
              <Select
                id="support-minutes"
                value={minutes}
                onValueChange={setMinutes}
                options={[
                  { value: '30', label: '30 minutes' },
                  { value: '60', label: '1 hour (default)' },
                  { value: '120', label: '2 hours' },
                  { value: '240', label: '4 hours (longest)' },
                ]}
              />
            </Field>
            <Button type="submit" loading={busy} disabled={busy || reason.trim().length < 5}>
              Open {mode === 'WRITE' ? 'in change mode' : 'view only'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Who has opened this company, why, and for how long. Active sessions can be ended. */
export function SupportHistory({ tenantId }: { tenantId: string }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['support-sessions', tenantId],
    queryFn: () => api.support.list(tenantId),
  });
  return (
    <Card>
      <CardTitle>Support sessions</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Every time staff opened this company. The company sees the same list in its audit screen.
      </p>
      {list.isPending ? (
        <p className="mt-4 text-sm text-faint">Loading…</p>
      ) : list.data?.length ? (
        <ul className="mt-4 grid gap-2">
          {list.data.map((s) => (
            <li key={s.id} className="rounded-md border border-line px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.staff}</span>
                <Badge tone={s.mode === 'WRITE' ? 'warning' : 'neutral'}>
                  {s.mode === 'WRITE' ? 'Could change' : 'View only'}
                </Badge>
                {s.active ? <Badge tone="success">Open until {when(s.expiresAt)}</Badge> : null}
                {s.active ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={async () => {
                      try {
                        await api.support.end(s.id);
                        await qc.invalidateQueries({ queryKey: ['support-sessions', tenantId] });
                      } catch (e) {
                        toast({ title: messageOf(e), tone: 'danger' });
                      }
                    }}
                  >
                    End now
                  </Button>
                ) : null}
              </div>
              <p className="mt-1 text-muted">“{s.reason}”</p>
              <p className="mt-0.5 text-xs text-faint">
                Started {when(s.startedAt)}
                {s.endedAt ? ` · ended ${when(s.endedAt)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-faint">Nobody has opened this company.</p>
      )}
    </Card>
  );
}
