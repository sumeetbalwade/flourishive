import { Badge, Button, Card, CardTitle, Field, Input, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { fmtDateTime } from '@flourishive/ui';

const when = (iso: string) => fmtDateTime(iso);

/** Email an issued letter as a private link; admins can release or hold the download. */
export function DeliveryPanel({ id, letterType }: { id: string; letterType: string }) {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['document', id, 'delivery'],
    queryFn: () => api.documents.deliveryStatus(id),
  });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['document', id, 'delivery'] });

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      toast({ tone: 'success', title: done });
      await refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const s = status.data;
  return (
    <Card>
      <CardTitle>Email to the recipient</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Sends a private link that works for 30 days. Leave the address empty to use the one on the
        person's record.
      </p>
      <div className="mt-4 grid gap-3">
        <Field label="Email address (optional)" htmlFor="d-email">
          <Input
            id="d-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={busy}
            disabled={busy}
            onClick={() =>
              void run(() => api.documents.deliver(id, email.trim() || undefined), 'Link emailed')
            }
          >
            Email the link
          </Button>
          {s?.links.some((l) => l.active) ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => api.documents.revokeLinks(id), 'Links cancelled')}
            >
              Cancel links
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {s ? (
        <div className="mt-4 grid gap-2 border-t border-line pt-4 text-sm">
          {letterType === 'OFFER' || s.held || s.releasedAt ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone={s.held ? 'warning' : 'success'}>
                  {s.held ? 'Download held' : 'Download open'}
                </Badge>
                <span className="text-muted">
                  {s.held ? 'Until the person has joined' : 'The recipient can download'}
                </span>
              </div>
              {auth.can('documents.release') ? (
                s.held ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(() => api.documents.releaseDownload(id), 'Download released')
                    }
                  >
                    Release download
                  </Button>
                ) : s.releasedAt ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => api.documents.holdDownload(id), 'Download held')}
                  >
                    Hold again
                  </Button>
                ) : null
              ) : null}
            </div>
          ) : null}
          {s.links.length === 0 ? (
            <p className="text-muted">Not emailed yet.</p>
          ) : (
            s.links.map((l, i) => (
              <p key={i} className="text-muted">
                {l.sentTo} · {when(l.sentAt)} · {l.active ? 'link active' : 'link ended'}
              </p>
            ))
          )}
        </div>
      ) : null}
    </Card>
  );
}
