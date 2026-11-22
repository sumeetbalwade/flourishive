import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { fmtDate } from '../../lib/format.ts';
import { go, setQuery, useRoute } from '../../router.ts';
import { Layout } from '../Layout.tsx';
import { stateOf, typeLabel } from './labels.ts';

export function Letters() {
  const api = useApi();
  const auth = useAuth();
  const { query } = useRoute();
  const page = Number(query.get('page') ?? '1') || 1;
  const list = useQuery({
    queryKey: ['documents', page],
    queryFn: () => api.documents.list({ page, pageSize: 25 }),
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <Layout
      active="letters"
      title="Letters"
      actions={
        auth.can('documents.generate') ? (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => go('/app/letters/bulk')}>
              Issue in bulk
            </Button>
            <Button size="sm" onClick={() => go('/app/letters/new')}>
              <Plus size={16} /> New letter
            </Button>
          </div>
        ) : undefined
      }
    >
      {list.isError ? (
        <EmptyState
          title="Could not load letters"
          description={messageOf(list.error)}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        />
      ) : list.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} />}
          title="No letters yet"
          description="Create an offer letter or certificate from a template. It goes for approval, then to the candidate."
          action={
            auth.can('documents.generate') ? (
              <Button onClick={() => go('/app/letters/new')}>New letter</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table compact>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Letter</TH>
                <TH>Reference</TH>
                <TH>Status</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {list.data.items.map((l) => {
                const s = stateOf(l.state);
                return (
                  <TR
                    key={l.id}
                    className="cursor-pointer"
                    onClick={() => go(`/app/letters/${l.id}`)}
                  >
                    <TD className="font-medium">{l.personName ?? '—'}</TD>
                    <TD>{typeLabel(l.letterType)}</TD>
                    <TD className="font-mono text-xs text-muted">{l.reference}</TD>
                    <TD>
                      <Badge dot tone={s.tone}>
                        {s.label}
                      </Badge>
                    </TD>
                    <TD className="text-muted">{fmtDate(l.createdAt)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {pages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm text-muted">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setQuery('/app/letters', { page: String(page - 1) })}
              >
                Previous
              </Button>
              Page {page} of {pages}
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= pages}
                onClick={() => setQuery('/app/letters', { page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Layout>
  );
}
