import { EmailLog as Log, useToast, type EmailLogFilters } from '@flourishive/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

/** The email log across every company, with plain-words reasons and Resend (D-60). */
export function EmailLog() {
  return (
    <Layout active="email-log" title="Email log">
      <EmailLogPanel />
    </Layout>
  );
}

/** The log itself, so the Logs area can show it as a tab. */
export function EmailLogPanel() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<EmailLogFilters>({ page: 1 });
  const list = useQuery({
    queryKey: ['platform-mail-deliveries', filters],
    queryFn: () =>
      api.mail.deliveries({
        page: filters.page,
        pageSize: 25,
        status: filters.status,
        q: filters.q,
      }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <Log
        showCompany
        data={list.data}
        loading={list.isPending}
        error={list.isError ? messageOf(list.error) : undefined}
        filters={filters}
        onFilters={setFilters}
        onResend={async (item) => {
          try {
            await api.mail.resend(item.id);
          } catch (e) {
            throw new Error(messageOf(e));
          }
          toast({ title: 'Sent again', tone: 'success' });
          await qc.invalidateQueries({ queryKey: ['platform-mail-deliveries'] });
        }}
      />
    </>
  );
}
