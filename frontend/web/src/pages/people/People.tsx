import {
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@flourishive/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { go, setQuery, useRoute } from '../../router.ts';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { fmtDate, fullName } from '../../lib/format.ts';
import { Layout } from '../Layout.tsx';
import { PersonForm } from './PersonForm.tsx';

export function People() {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { query } = useRoute();
  const q = query.get('q') ?? '';
  const type = query.get('type') ?? undefined;
  const status = query.get('status') ?? undefined;
  const page = Number(query.get('page') ?? '1') || 1;
  const [search, setSearch] = useState(q);
  const [adding, setAdding] = useState(false);

  // Typing updates the URL after a short pause, so a filtered list can be shared or reloaded.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(
      () => setQuery('/app/people', { q: search || undefined, type, status }),
      300,
    );
    return () => clearTimeout(t);
  }, [search, q, type, status]);

  const params = {
    q: q || undefined,
    type: type as 'EMPLOYEE' | 'INTERN' | undefined,
    status: status as 'ACTIVE' | 'ENDED' | undefined,
    page,
    pageSize: 25,
  };
  const list = useQuery({
    queryKey: ['people', params],
    queryFn: () => api.people.list(params),
    placeholderData: keepPreviousData,
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const to = (p: Record<string, string | undefined>) =>
    setQuery('/app/people', { q: q || undefined, type, status, ...p });

  return (
    <Layout
      active="people"
      title="People"
      actions={
        auth.can('people.write') ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add person
          </Button>
        ) : undefined
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search people"
          className="max-w-xs"
          placeholder="Search name, email or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="w-40">
          <SelectField
            id="f-type"
            value={type}
            noneLabel="All types"
            placeholder="All types"
            onChange={(v) => to({ type: v, page: undefined })}
            options={[
              { value: 'EMPLOYEE', label: 'Employees' },
              { value: 'INTERN', label: 'Interns' },
            ]}
          />
        </div>
        <div className="w-40">
          <SelectField
            id="f-status"
            value={status}
            noneLabel="Any status"
            placeholder="Any status"
            onChange={(v) => to({ status: v, page: undefined })}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'ENDED', label: 'Ended' },
            ]}
          />
        </div>
        {list.data ? (
          <span className="ml-auto text-sm text-muted">
            {list.data.total} {list.data.total === 1 ? 'person' : 'people'}
          </span>
        ) : null}
      </div>

      {list.isError ? (
        <EmptyState
          title="Could not load people"
          description={messageOf(list.error)}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        />
      ) : list.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title={q || type || status ? 'No one matches' : 'No people yet'}
          description={
            q || type || status
              ? 'Try a different search or clear the filters.'
              : 'Add someone, or import your current employees and interns from a spreadsheet.'
          }
          action={
            !q && !type && !status && auth.can('people.import') ? (
              <Button onClick={() => go('/app/import')}>Import from CSV</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table compact>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Code</TH>
                <TH>Type</TH>
                <TH>Department</TH>
                <TH>Designation</TH>
                <TH>Started</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {list.data.items.map((e) => (
                <TR key={e.id} className="cursor-pointer" onClick={() => go(`/app/people/${e.id}`)}>
                  <TD>
                    <a
                      href={`#/app/people/${e.id}`}
                      className="font-medium text-fg hover:underline"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {fullName(e)}
                    </a>
                    <div className="text-xs text-faint">
                      {e.person.workEmail ?? 'No work email'}
                    </div>
                  </TD>
                  <TD className="font-mono text-xs">{e.employeeCode}</TD>
                  <TD>{e.type === 'INTERN' ? 'Intern' : 'Employee'}</TD>
                  <TD>{e.department?.name ?? '—'}</TD>
                  <TD>{e.designation?.name ?? '—'}</TD>
                  <TD>{fmtDate(e.startDate)}</TD>
                  <TD>
                    <StatusBadge status={e.status} />
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
                disabled={page <= 1}
                onClick={() => to({ page: String(page - 1) })}
              >
                Previous
              </Button>
              Page {page} of {pages}
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= pages}
                onClick={() => to({ page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Add person" className="max-w-2xl">
          <PersonForm
            onSaved={(e) => {
              setAdding(false);
              toast({ title: `${fullName(e)} added`, tone: 'success' });
              void qc.invalidateQueries({ queryKey: ['people'] });
              go(`/app/people/${e.id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
