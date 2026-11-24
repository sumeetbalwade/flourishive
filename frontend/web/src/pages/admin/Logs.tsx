import { LogsView, type LogParams } from '@flourishive/ui';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { setQuery, useRoute } from '../../router.ts';
import { Layout } from '../Layout.tsx';

/** This company's own activity, sign-ins and errors, in plain words (D-67). */
export function Logs() {
  const api = useApi();
  const { query } = useRoute();
  const params: LogParams = Object.fromEntries(query.entries());
  return (
    <Layout active="logs" title="Logs">
      <LogsView
        api={api.logs}
        params={params}
        onParams={(next) => setQuery('/app/logs', next)}
        readError={messageOf}
      />
    </Layout>
  );
}
