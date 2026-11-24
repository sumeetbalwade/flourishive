import {
  Button,
  EmptyState,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { go } from '../router.ts';
import { Layout } from './Layout.tsx';

/** A tiny trend line. Drawn with the accent colour; the numbers beside it carry the meaning. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="text-xs text-muted">Collecting data</span>;
  const w = 96;
  const h = 24;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1);
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label={label} className="text-accent">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(1)} MB`);

/** How much each company uses the product (D-70). Written once a night. */
export function Usage() {
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api.controls.usage() });
  const [busy, setBusy] = useState(false);
  return (
    <Layout
      active="usage"
      title="Usage"
      actions={
        can('tenants.manage') ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => {
              setBusy(true);
              api.controls
                .refreshUsage()
                .then(() => qc.invalidateQueries({ queryKey: ['usage'] }))
                .then(() => toast({ title: 'Usage updated', tone: 'success' }))
                .catch((e) => toast({ title: messageOf(e), tone: 'danger' }))
                .finally(() => setBusy(false));
            }}
          >
            Update now
          </Button>
        ) : undefined
      }
    >
      {q.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(q.error)}
        </p>
      ) : q.data.tenants.length === 0 ? (
        <EmptyState title="No companies yet" description="Usage appears once a company exists." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Company</TH>
              <TH>Users</TH>
              <TH>Active (30 days)</TH>
              <TH>Trend</TH>
              <TH>People</TH>
              <TH>Letters this month</TH>
              <TH>Storage</TH>
              <TH>Emails this month</TH>
              <TH>Last activity</TH>
            </TR>
          </THead>
          <TBody>
            {q.data.tenants.map((t) => (
              <TR
                key={t.tenantId}
                onClick={() => go(`/tenants/${t.tenantId}`)}
                className="cursor-pointer"
              >
                <TD>
                  <a
                    href={`#/tenants/${t.tenantId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {t.name}
                  </a>
                </TD>
                <TD>{t.latest?.users ?? '–'}</TD>
                <TD>{t.latest?.activeUsers30d ?? '–'}</TD>
                <TD>
                  <Sparkline
                    values={t.trend}
                    label={`Active users over the last 30 days for ${t.name}`}
                  />
                </TD>
                <TD>{t.latest?.people ?? '–'}</TD>
                <TD>{t.latest?.lettersMonth ?? '–'}</TD>
                <TD>{t.latest ? mb(t.latest.storageBytes) : '–'}</TD>
                <TD>{t.latest?.emailsSent ?? '–'}</TD>
                <TD>
                  {t.latest?.lastActivityAt
                    ? new Date(t.latest.lastActivityAt).toLocaleDateString()
                    : '–'}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Layout>
  );
}
