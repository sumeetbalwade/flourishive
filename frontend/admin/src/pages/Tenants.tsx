import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Stat,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { go } from '../router.ts';
import { NewTenantWizard } from '../components/NewTenantWizard.tsx';
import { Layout } from './Layout.tsx';
import { fmtDate } from '@flourishive/ui';

export const fmt = (iso: string) => fmtDate(iso);

export { slugify } from '../components/NewTenantWizard.tsx';

export function Tenants() {
  const api = useApi();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['tenants'], queryFn: () => api.tenants.list() });
  const [open, setOpen] = useState(false);
  const total = list.data?.length ?? 0;
  const users = list.data?.reduce((n, t) => n + t.counts.users, 0) ?? 0;
  const suspended = list.data?.filter((t) => t.status === 'SUSPENDED').length ?? 0;

  return (
    <Layout
      active="tenants"
      title="Tenants"
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={16} /> New tenant
        </Button>
      }
    >
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Stat value={String(total)} label="Tenants" />
        <Stat value={String(users)} label="Users across tenants" />
        <Stat value={String(suspended)} label="Suspended" />
      </div>
      {list.isError ? (
        <EmptyState
          title="Could not load tenants"
          description={messageOf(list.error)}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        />
      ) : list.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : list.data.length === 0 ? (
        <EmptyState
          title="No tenants yet"
          description="Create the first company. Its admin gets an email to choose a password."
          action={<Button onClick={() => setOpen(true)}>New tenant</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Tenant</TH>
              <TH>Company code</TH>
              <TH>Users</TH>
              <TH>People</TH>
              <TH>Status</TH>
              <TH>Created</TH>
            </TR>
          </THead>
          <TBody>
            {list.data.map((t) => (
              <TR key={t.id} className="cursor-pointer" onClick={() => go(`/tenants/${t.id}`)}>
                <TD>
                  <div className="flex items-center gap-3">
                    <Avatar name={t.name} />
                    <a
                      href={`#/tenants/${t.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.name}
                    </a>
                  </div>
                </TD>
                <TD className="font-mono text-xs">{t.slug}</TD>
                <TD>{t.counts.users}</TD>
                <TD>{t.counts.engagements}</TD>
                <TD>
                  <Badge tone={t.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {t.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                  </Badge>
                </TD>
                <TD className="text-muted">{fmt(t.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <NewTenantWizard
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => {
          void qc.invalidateQueries({ queryKey: ['tenants'] });
          go(`/tenants/${id}`);
        }}
      />
    </Layout>
  );
}
