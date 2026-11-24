import { LogsView, type LogParams } from '@flourishive/ui';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { setQuery, useRoute } from '../router.ts';
import { EmailLogPanel } from './EmailLog.tsx';
import { Layout } from './Layout.tsx';

/** Logs across every company: errors in plain words, activity, sign-ins, jobs and email (D-67). */
export function Logs() {
  const api = useApi();
  const { query } = useRoute();
  const params: LogParams = Object.fromEntries(query.entries());
  return (
    <Layout active="logs" title="Logs">
      <LogsView
        platform
        api={api.logs}
        params={params}
        onParams={(next) => setQuery('/logs', next)}
        readError={messageOf}
        extraTabs={[{ id: 'email', label: 'Email', content: <EmailLogPanel /> }]}
      />
    </Layout>
  );
}
