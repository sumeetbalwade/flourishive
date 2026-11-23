import type { SenderView } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  Field,
  Input,
  Select,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

type Kind = 'VERIFIED_FROM' | 'OWN_SMTP';

const KIND_TEXT: Record<Kind, string> = {
  VERIFIED_FROM: 'Our servers, your address (simplest)',
  OWN_SMTP: 'My own mail server (Google Workspace, Microsoft 365, …)',
};

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-line p-5">
      <h3 className="flex items-center gap-3 font-display text-lg font-medium">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-lo text-sm text-accent">
          {n}
        </span>
        {title}
        {done ? <Badge tone="success">Done</Badge> : null}
      </h3>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

/** Who this company's email comes from (D-58, D-60): our default, or the company's own address or server. */
export function EmailSender() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mail-sender'], queryFn: () => api.mail.sender() });
  const sender = q.data?.sender ?? null;

  const [kind, setKind] = useState<Kind>('VERIFIED_FROM');
  const [fromName, setFromName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [host, setHost] = useState('smtp.gmail.com');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [selector, setSelector] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmBack, setConfirmBack] = useState(false);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);

  // Fill the form from what is saved (the password is never sent back).
  useEffect(() => {
    if (!sender) return;
    setKind(sender.kind === 'OWN_SMTP' ? 'OWN_SMTP' : 'VERIFIED_FROM');
    setFromName(sender.fromName);
    setFromAddress(sender.fromAddress);
    setReplyTo(sender.replyTo ?? '');
    if (sender.smtp) {
      setHost(sender.smtp.host);
      setPort(String(sender.smtp.port));
      setSecure(sender.smtp.secure);
      setUser(sender.smtp.user);
    }
  }, [sender?.id]); // eslint-disable-line

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
  const refresh = () => qc.invalidateQueries({ queryKey: ['mail-sender'] });
  const apply = (s: SenderView) => qc.setQueryData(['mail-sender'], { ...q.data!, sender: s });

  const active = sender?.status === 'ACTIVE';
  const showWizard = !active || editing;

  return (
    <Layout active="email" title="Email sender">
      <div className="grid max-w-3xl gap-5">
        <Card>
          <CardTitle>Where your email comes from</CardTitle>
          {q.isPending ? (
            <Skeleton className="mt-3 h-10 w-full" />
          ) : active && sender ? (
            <>
              <p className="mt-2 text-sm text-muted">
                Invitations, codes and letters go out from{' '}
                <b className="text-fg">
                  {sender.fromName} &lt;{sender.fromAddress}&gt;
                </b>
                .
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(!editing)}>
                  {editing ? 'Hide settings' : 'Change'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmBack(true)}>
                  Switch back to default
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Email goes out from our default address,{' '}
              <b className="text-fg">{q.data?.defaultFrom}</b>. To send from your own address
              instead, set it up below. Nothing changes until you activate it.
            </p>
          )}
        </Card>

        {showWizard && q.data ? (
          <Card className="grid gap-5">
            <CardTitle>Use our own sender</CardTitle>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}

            <Step n={1} title="Details" done={Boolean(sender)}>
              <Field label="How should it send?" htmlFor="kind">
                <Select
                  id="kind"
                  value={kind}
                  onValueChange={(v) => setKind(v as Kind)}
                  options={(Object.keys(KIND_TEXT) as Kind[]).map((k) => ({
                    value: k,
                    label: KIND_TEXT[k],
                  }))}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name people see" htmlFor="fromName">
                  <Input
                    id="fromName"
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                  />
                </Field>
                <Field label="From address" htmlFor="fromAddress" hint="e.g. hr@yourcompany.com">
                  <Input
                    id="fromAddress"
                    type="email"
                    value={fromAddress}
                    onChange={(e) => setFromAddress(e.target.value)}
                  />
                </Field>
                <Field label="Replies go to (optional)" htmlFor="replyTo">
                  <Input
                    id="replyTo"
                    type="email"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                  />
                </Field>
              </div>
              {kind === 'OWN_SMTP' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Mail server" htmlFor="host" hint="e.g. smtp.gmail.com">
                    <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} />
                  </Field>
                  <Field label="Port" htmlFor="port" hint="587 for most; 465 if “secure” is on">
                    <Input
                      id="port"
                      inputMode="numeric"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                    />
                  </Field>
                  <Field label="Username" htmlFor="user">
                    <Input
                      id="user"
                      autoComplete="off"
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Password"
                    htmlFor="pass"
                    hint={
                      sender?.smtp?.passwordSet
                        ? 'Saved. Leave empty to keep it.'
                        : 'For Gmail, use an app password.'
                    }
                  >
                    <Input
                      id="pass"
                      type="password"
                      autoComplete="new-password"
                      value={pass}
                      onChange={(e) => setPass(e.target.value)}
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={secure}
                      onChange={(e) => setSecure(e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    Secure connection from the start (port 465)
                  </label>
                </div>
              ) : null}
              <div>
                <Button
                  loading={busy === 'save'}
                  disabled={busy !== null || !fromName.trim() || !fromAddress.trim()}
                  onClick={() =>
                    run('save', async () => {
                      const s = await api.mail.saveSender({
                        kind,
                        fromName: fromName.trim(),
                        fromAddress: fromAddress.trim(),
                        replyTo: replyTo.trim() || undefined,
                        smtp:
                          kind === 'OWN_SMTP'
                            ? {
                                host: host.trim(),
                                port: Number(port),
                                secure,
                                user: user.trim(),
                                pass: pass || undefined,
                              }
                            : undefined,
                      });
                      setPass('');
                      setTestNote(null);
                      apply(s);
                      toast({ title: 'Saved. Now confirm the address.', tone: 'success' });
                    })
                  }
                >
                  Save details
                </Button>
              </div>
            </Step>

            {sender ? (
              <>
                <Step n={2} title="Confirm the address is yours" done={sender.codeConfirmed}>
                  <p className="text-sm text-muted">
                    We email a 6-digit code to <b className="text-fg">{sender.fromAddress}</b>. Open
                    that mailbox and type the code here.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <Button
                      variant="secondary"
                      loading={busy === 'start'}
                      disabled={busy !== null}
                      onClick={() =>
                        run('start', async () => {
                          await api.mail.startVerify();
                          toast({ title: 'Code sent', tone: 'success' });
                        })
                      }
                    >
                      Email me a code
                    </Button>
                    <Field label="Code" htmlFor="sender-code">
                      <Input
                        id="sender-code"
                        inputMode="numeric"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                        className="w-40 text-center font-mono tracking-[0.4em]"
                      />
                    </Field>
                    <Button
                      loading={busy === 'confirm'}
                      disabled={busy !== null || code.length !== 6}
                      onClick={() =>
                        run('confirm', async () => {
                          apply(await api.mail.confirmCode(code));
                          setCode('');
                        })
                      }
                    >
                      Confirm
                    </Button>
                  </div>
                </Step>

                <Step n={3} title="Send a test" done={sender.lastTestResult === 'OK'}>
                  <p className="text-sm text-muted">
                    We send one email through this sender to your own address, so you can see it
                    arrives.
                  </p>
                  <div>
                    <Button
                      variant="secondary"
                      loading={busy === 'test'}
                      disabled={busy !== null || !sender.codeConfirmed}
                      onClick={() =>
                        run('test', async () => {
                          const r = await api.mail.test();
                          apply(r.sender);
                          setTestNote({ ok: r.ok, text: r.message });
                        })
                      }
                    >
                      Send test email
                    </Button>
                  </div>
                  {testNote ? (
                    <p
                      role="status"
                      className={testNote.ok ? 'text-sm text-success' : 'text-sm text-danger'}
                    >
                      {testNote.text}
                    </p>
                  ) : sender.lastTestResult && sender.lastTestResult !== 'OK' ? (
                    <p className="text-sm text-danger">{sender.lastTestResult}</p>
                  ) : null}
                </Step>

                <Step
                  n={4}
                  title="Check your domain’s email records"
                  done={Boolean(sender.dnsReport)}
                >
                  <p className="text-sm text-muted">
                    Records called SPF, DKIM and DMARC help your mail reach the inbox instead of
                    spam. Warnings do not stop you; they tell you what to ask your IT person to fix.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <Field
                      label="DKIM name (optional)"
                      htmlFor="selector"
                      hint="Leave empty to try common names"
                    >
                      <Input
                        id="selector"
                        value={selector}
                        onChange={(e) => setSelector(e.target.value)}
                      />
                    </Field>
                    <Button
                      variant="secondary"
                      loading={busy === 'dns'}
                      disabled={busy !== null}
                      onClick={() =>
                        run('dns', async () => {
                          apply(await api.mail.dns(selector.trim() || undefined));
                        })
                      }
                    >
                      Check records
                    </Button>
                  </div>
                  {sender.dnsReport ? (
                    <ul className="grid gap-2">
                      {sender.dnsReport.checks.map((c) => (
                        <li
                          key={c.name}
                          className="rounded-md border border-line px-4 py-3 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Badge tone={c.state === 'pass' ? 'success' : 'warning'}>
                              {c.name}
                            </Badge>
                            <span>{c.found}</span>
                          </div>
                          {c.state === 'warn' ? <p className="mt-1 text-muted">{c.hint}</p> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Step>

                <Step n={5} title="Turn it on" done={active}>
                  <p className="text-sm text-muted">
                    Needs the confirmed address and a test that arrived. From then on, your
                    company’s email goes out from this sender.
                  </p>
                  <div>
                    <Button
                      loading={busy === 'activate'}
                      disabled={
                        busy !== null ||
                        !sender.codeConfirmed ||
                        sender.lastTestResult !== 'OK' ||
                        active
                      }
                      onClick={() =>
                        run('activate', async () => {
                          apply(await api.mail.activate());
                          setEditing(false);
                          toast({ title: 'Your sender is on', tone: 'success' });
                        })
                      }
                    >
                      Activate
                    </Button>
                  </div>
                </Step>
              </>
            ) : null}
          </Card>
        ) : null}
      </div>

      <Dialog open={confirmBack} onOpenChange={setConfirmBack}>
        <DialogContent
          title="Switch back to the default sender?"
          description="Email will go out from our default address again. Your saved sender details are removed."
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              loading={busy === 'remove'}
              onClick={() =>
                run('remove', async () => {
                  await api.mail.removeSender();
                  setConfirmBack(false);
                  setEditing(false);
                  await refresh();
                  toast({ title: 'Back on the default sender', tone: 'success' });
                })
              }
            >
              Switch back
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
