import type { ChainCheck } from '@flourishive/schemas';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@flourishive/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { describeAction } from '../lib/audit-labels.ts';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

export function Audit() {
  const api = useApi();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [check, setCheck] = useState<ChainCheck | 'running' | 'failed' | null>(null);
  const list = useQuery({
    queryKey: ['audit', { action, page }],
    queryFn: () => api.audit.list({ action: action || undefined, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <Layout
      active="audit"
      title="Audit log"
      actions={
        <Button
          size="sm"
          variant="secondary"
          disabled={check === 'running'}
          onClick={async () => {
            setCheck('running');
            try {
              setCheck(await api.audit.verify());
            } catch {
              setCheck('failed');
            }
          }}
        >
          Check integrity
        </Button>
      }
    >
      {check && check !== 'running' ? (
        <p role="status" className="mb-4 flex items-center gap-2 text-sm">
          {check === 'failed' ? (
            <Badge tone="danger">Could not run the check</Badge>
          ) : check.ok ? (
            <>
              <Badge tone="success">Intact</Badge> {check.checked} entries verified, none altered or
              removed.
            </>
          ) : (
            <>
              <Badge tone="danger">Problem found</Badge> {check.reason} (entry{' '}
              {check.brokenAtSeq ?? 'at the end'})
            </>
          )}
        </p>
      ) : check === 'running' ? (
        <p className="mb-4 text-sm text-muted">Checking every entry…</p>
      ) : null}

      <div className="mb-5 flex items-center gap-3">
        <Input
          aria-label="Filter by action"
          className="max-w-xs"
          placeholder="Filter, e.g. people or auth.login"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        />
        {list.data ? (
          <span className="ml-auto text-sm text-muted">{list.data.total} entries</span>
        ) : null}
      </div>

      {list.isError ? (
        <EmptyState title="Could not load the log" description={messageOf(list.error)} />
      ) : list.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title="Nothing recorded"
          description="Changes and sign-ins appear here as they happen."
        />
      ) : (
        <>
          <Table compact>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Action</TH>
                <TH>By</TH>
                <TH>About</TH>
                <TH>From</TH>
              </TR>
            </THead>
            <TBody>
              {list.data.items.map((r) => (
                <TR key={r.seq}>
                  <TD className="whitespace-nowrap text-xs">
                    {new Date(r.createdAt).toLocaleString('en-IN')}
                  </TD>
                  <TD title={r.action}>{describeAction(r.action)}</TD>
                  <TD>
                    <Badge tone={r.actorType === 'USER' ? 'neutral' : 'accent'}>
                      {r.actorType.toLowerCase()}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-muted">
                    {[r.entityType, r.entityId?.slice(0, 8)].filter(Boolean).join(' ')}
                  </TD>
                  <TD className="text-xs text-faint">{r.ip ?? ''}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {pages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Newer
              </Button>
              Page {page} of {pages}
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Older
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Layout>
  );
}
