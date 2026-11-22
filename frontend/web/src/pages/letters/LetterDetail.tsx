import {
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  Skeleton,
  brand,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Send } from 'lucide-react';
import { useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { go } from '../../router.ts';
import { Layout } from '../Layout.tsx';
import { DeliveryPanel } from './DeliveryPanel.tsx';
import { PdfPreview } from './PdfPreview.tsx';
import { REQUEST_STATUS, eventLabel, stateOf, typeLabel } from './labels.ts';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function LetterDetail({ id }: { id: string }) {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const doc = useQuery({ queryKey: ['document', id], queryFn: () => api.documents.get(id) });
  const history = useQuery({
    queryKey: ['document', id, 'history'],
    queryFn: () => api.documents.history(id),
  });
  const requests = useQuery({
    queryKey: ['document', id, 'requests'],
    queryFn: () => api.documents.signatureRequests(id),
  });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendTo, setSendTo] = useState<{
    name: string;
    email: string;
    method: 'OTP' | 'AADHAAR';
  } | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['document', id] }),
      qc.invalidateQueries({ queryKey: ['documents'] }),
    ]);

  async function act(action: string, label: string, needsComment: boolean) {
    if (needsComment && !comment.trim()) {
      toast({
        tone: 'danger',
        title: 'Please add a comment',
        description: `"${label}" needs a reason.`,
      });
      return;
    }
    setBusy(true);
    try {
      await api.documents.act(id, action, comment.trim() || undefined);
      setComment('');
      await refresh();
      toast({ tone: 'success', title: label });
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not do that', description: messageOf(e) });
    } finally {
      setBusy(false);
    }
  }

  async function sendRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!sendTo) return;
    setBusy(true);
    try {
      await api.documents.requestAcceptance(id, {
        name: sendTo.name.trim(),
        email: sendTo.email.trim(),
        method: sendTo.method,
      });
      setSendTo(null);
      await refresh();
      toast({
        tone: 'success',
        title: 'Sent to the candidate',
        description: 'They get a private link by email. It expires in 7 days.',
      });
    } catch (err) {
      toast({ tone: 'danger', title: 'Could not send', description: messageOf(err) });
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(requestId: string) {
    setBusy(true);
    try {
      await api.documents.cancelRequest(id, requestId, 'Cancelled by HR');
      await refresh();
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not cancel', description: messageOf(e) });
    } finally {
      setBusy(false);
    }
  }

  // The file link lasts five minutes, so ask for a fresh one when downloading.
  async function download() {
    try {
      const fresh = await api.documents.get(id);
      location.href = `${brand.apiUrl}${fresh.downloadUrl}`;
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not download', description: messageOf(e) });
    }
  }

  const d = doc.data;
  const state = stateOf(d?.workflow.state);
  const canRequest =
    d?.workflow.state === 'approved' &&
    auth.can('documents.generate') &&
    !requests.data?.some((r) => r.status === 'PENDING');

  return (
    <Layout
      active="letters"
      title={d ? typeLabel(d.letterType) : 'Letter'}
      actions={
        d ? (
          <Button size="sm" variant="secondary" onClick={() => void download()}>
            <Download size={14} /> Download PDF
          </Button>
        ) : undefined
      }
    >
      <button
        type="button"
        onClick={() => go('/app/letters')}
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft size={14} /> All letters
      </button>
      {doc.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(doc.error)}
        </p>
      ) : !d ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <Card className="overflow-hidden p-0">
            <PdfPreview path={d.downloadUrl} title={`${d.reference} preview`} />
          </Card>
          <div className="grid content-start gap-6">
            <Card>
              <CardTitle>{d.personName ?? 'No person'}</CardTitle>
              <div className="mt-2 flex items-center gap-2">
                <Badge tone={state.tone}>{state.label}</Badge>
                <span className="font-mono text-xs text-faint">{d.reference}</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {d.pageCount} {d.pageCount === 1 ? 'page' : 'pages'} · created {when(d.createdAt)}
              </div>
              {d.workflow.actions.length > 0 ? (
                <div className="mt-4 grid gap-3">
                  <Input
                    aria-label="Comment"
                    placeholder="Comment (needed to ask for changes)"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {d.workflow.actions.map((a) => (
                      <Button
                        key={a.action}
                        size="sm"
                        variant={
                          a.action === 'cancel' || a.action === 'request_changes'
                            ? 'ghost'
                            : 'primary'
                        }
                        disabled={busy}
                        onClick={() => void act(a.action, a.label, a.commentRequired)}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </Card>

            {canRequest ? (
              <Card>
                <CardTitle>Send to the candidate</CardTitle>
                <p className="mt-1 text-sm text-muted">
                  They read the letter, get a code by email and accept it. The signed copy is
                  sealed.
                </p>
                {sendTo ? (
                  <form onSubmit={sendRequest} className="mt-4 grid gap-3">
                    <Field label="Name" htmlFor="s-name">
                      <Input
                        id="s-name"
                        value={sendTo.name}
                        onChange={(e) => setSendTo({ ...sendTo, name: e.target.value })}
                      />
                    </Field>
                    <Field label="Email" htmlFor="s-email">
                      <Input
                        id="s-email"
                        type="email"
                        value={sendTo.email}
                        onChange={(e) => setSendTo({ ...sendTo, email: e.target.value })}
                      />
                    </Field>
                    <Field label="How they accept" htmlFor="s-method">
                      <SelectField
                        id="s-method"
                        value={sendTo.method}
                        allowNone={false}
                        onChange={(m) => setSendTo({ ...sendTo, method: m as 'OTP' | 'AADHAAR' })}
                        options={[
                          { value: 'OTP', label: 'Email code' },
                          { value: 'AADHAAR', label: 'Aadhaar eSign' },
                        ]}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busy || !sendTo.email || !sendTo.name}
                      >
                        <Send size={14} /> Send
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setSendTo(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    className="mt-4"
                    size="sm"
                    onClick={() =>
                      setSendTo({
                        name: d.personName ?? '',
                        email: d.personEmail ?? '',
                        method: 'OTP',
                      })
                    }
                  >
                    <Send size={14} /> Send for acceptance
                  </Button>
                )}
              </Card>
            ) : null}

            {requests.data && requests.data.length > 0 ? (
              <Card>
                <CardTitle>Acceptance</CardTitle>
                <div className="mt-3 grid gap-5">
                  {requests.data.map((r) => {
                    const s = REQUEST_STATUS[r.status] ?? {
                      label: r.status,
                      tone: 'neutral' as const,
                    };
                    return (
                      <div key={r.id} className="grid gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={s.tone}>{s.label}</Badge>
                          <span className="text-xs text-muted">
                            {r.parties.map((p) => p.name).join(', ')}
                          </span>
                          {r.status === 'PENDING' && auth.can('documents.generate') ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto"
                              disabled={busy}
                              onClick={() => void cancelRequest(r.id)}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                        <ol className="grid gap-1 border-l border-line pl-4">
                          {r.events.map((ev, i) => (
                            <li key={i} className="text-sm">
                              {eventLabel(ev.type)}
                              <span className="ml-2 font-mono text-xs text-faint">
                                {when(ev.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : null}

            {d.workflow.state === 'issued' && auth.can('documents.generate') ? (
              <DeliveryPanel id={id} letterType={d.letterType} />
            ) : null}

            <Card>
              <CardTitle>History</CardTitle>
              <ol className="mt-4 grid gap-4">
                {(history.data?.actions ?? []).map((a, i) => (
                  <li key={i} className="relative pl-6">
                    <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-pill bg-accent" />
                    <div className="text-sm">
                      {stateOf(a.toState).label}
                      {a.comment ? <span className="text-muted"> — {a.comment}</span> : null}
                    </div>
                    <div className="font-mono text-xs text-faint">{when(a.createdAt)}</div>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      )}
    </Layout>
  );
}
