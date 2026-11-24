import { useState } from 'react';
import { Badge } from './badge.tsx';
import { Button } from './button.tsx';
import { EmptyState } from './empty-state.tsx';
import { Input } from './input.tsx';
import { Select } from './select.tsx';
import { Skeleton } from './skeleton.tsx';
import { Table, TBody, TD, TH, THead, TR } from './table.tsx';
import { fmtDateTime } from '../format.ts';

export interface DeliveryItem {
  id: string;
  tenantName: string | null;
  event: string;
  to: string;
  status: 'QUEUED' | 'SENT' | 'FAILED';
  error: string | null;
  attempts: number;
  createdAt: string;
}
export interface DeliveriesResponse {
  items: DeliveryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EmailLogFilters {
  status?: 'QUEUED' | 'SENT' | 'FAILED';
  q?: string;
  event?: string;
  page: number;
}

const TONE = { SENT: 'success', FAILED: 'danger', QUEUED: 'warning' } as const;
const LABEL = { SENT: 'Sent', FAILED: 'Failed', QUEUED: 'Waiting' } as const;

/** Human names for the `event` codes shown in the log. */
export function describeMailEvent(e: string): string {
  const known: Record<string, string> = {
    'auth.otp.password': 'Password code',
    'auth.otp.mfa': 'Two-step code',
    'auth.otp.mfa-signin': 'Sign-in code',
    'signing.request': 'Document to accept',
    'signing.otp': 'Acceptance code',
    'letter.delivery': 'Letter link',
    'company.find': 'Sign-in address',
    'platform.invite': 'Admin invitation',
    'platform.password_reset': 'Admin password link',
    'platform.signin_code': 'Admin sign-in code',
    'platform.recovery_code': 'Admin recovery code',
    'platform.account_notice': 'Admin account notice',
    'platform.alert': 'Platform alert',
    'sender.verify': 'Sender address code',
    'sender.test': 'Sender test',
  };
  return known[e] ?? e.replaceAll('.', ' ').replaceAll('_', ' ');
}

/**
 * The email log (D-60): what was sent, what failed and why, with Resend. Shared by the company app and
 * the admin console (which also shows the company column).
 */
export function EmailLog({
  data,
  loading,
  error,
  filters,
  onFilters,
  onResend,
  showCompany = false,
}: {
  data?: DeliveriesResponse;
  loading: boolean;
  error?: string;
  filters: EmailLogFilters;
  onFilters: (f: EmailLogFilters) => void;
  /** Resolves when sent again; throw a readable error when it cannot be. */
  onResend: (item: DeliveryItem) => Promise<void>;
  showCompany?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const [text, setText] = useState(filters.q ?? '');
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <form
        className="mb-5 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onFilters({ ...filters, q: text.trim() || undefined, page: 1 });
        }}
      >
        <Input
          aria-label="Find an address"
          className="max-w-xs"
          placeholder="Type a full address to find its mail"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="w-44">
          <Select
            value={filters.status ?? 'ALL'}
            onValueChange={(v) =>
              onFilters({
                ...filters,
                status: v === 'ALL' ? undefined : (v as 'SENT' | 'FAILED' | 'QUEUED'),
                page: 1,
              })
            }
            options={[
              { value: 'ALL', label: 'Any status' },
              { value: 'FAILED', label: 'Failed' },
              { value: 'SENT', label: 'Sent' },
              { value: 'QUEUED', label: 'Waiting' },
            ]}
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {data ? <span className="ml-auto text-sm text-muted">{data.total} emails</span> : null}
      </form>

      {error ? (
        <EmptyState title="Could not load the email log" description={error} />
      ) : loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No email yet"
          description="Every email the system sends appears here, with what went wrong if it failed."
        />
      ) : (
        <>
          <Table compact>
            <THead>
              <TR>
                <TH>When</TH>
                {showCompany ? <TH>Company</TH> : null}
                <TH>What</TH>
                <TH>To</TH>
                <TH>Status</TH>
                <TH>{''}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</TD>
                  {showCompany ? <TD>{r.tenantName ?? 'Platform'}</TD> : null}
                  <TD title={r.event}>{describeMailEvent(r.event)}</TD>
                  <TD className="font-mono text-xs">{r.to}</TD>
                  <TD>
                    <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                    {r.attempts > 1 ? (
                      <span className="ml-2 text-xs text-faint">{r.attempts} tries</span>
                    ) : null}
                    {r.error ? <p className="mt-1 max-w-sm text-xs text-muted">{r.error}</p> : null}
                    {note?.id === r.id ? (
                      <p role="status" className="mt-1 max-w-sm text-xs text-danger">
                        {note.text}
                      </p>
                    ) : null}
                  </TD>
                  <TD>
                    {r.status === 'FAILED' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === r.id}
                        disabled={busy !== null}
                        onClick={async () => {
                          setBusy(r.id);
                          setNote(null);
                          try {
                            await onResend(r);
                          } catch (e) {
                            setNote({
                              id: r.id,
                              text: e instanceof Error ? e.message : 'Could not send it again',
                            });
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        Resend
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {pages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted">
              <Button
                size="sm"
                variant="secondary"
                disabled={filters.page <= 1}
                onClick={() => onFilters({ ...filters, page: filters.page - 1 })}
              >
                Newer
              </Button>
              Page {filters.page} of {pages}
              <Button
                size="sm"
                variant="secondary"
                disabled={filters.page >= pages}
                onClick={() => onFilters({ ...filters, page: filters.page + 1 })}
              >
                Older
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
