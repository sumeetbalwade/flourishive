import { Badge, Button, Card, CardTitle } from '@flourishive/ui';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

/** Checks that run on demand. For now: is file storage working? */
export function System() {
  const api = useApi();
  const storage = useMutation({ mutationFn: () => api.diagnostics.storage() });
  const r = storage.data;
  return (
    <Layout active="system" title="System checks">
      <Card className="grid max-w-xl gap-3 p-5">
        <CardTitle>File storage</CardTitle>
        <p className="text-sm text-muted">
          Writes a tiny test file, reads it back and removes it. Shows how many reads had to use the
          old local disk since the move to R2 (it should stay at 0).
        </p>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            loading={storage.isPending}
            disabled={storage.isPending}
            onClick={() => storage.mutate()}
          >
            Check now
          </Button>
          {r ? (
            <Badge tone={r.ok ? 'success' : 'danger'}>{r.ok ? 'Working' : 'Not working'}</Badge>
          ) : null}
        </div>
        {r ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">Where files are kept</dt>
            <dd>{r.driver === 'r2' ? 'Cloudflare R2' : 'Server disk'}</dd>
            <dt className="text-muted">Time taken</dt>
            <dd>{r.latencyMs} ms</dd>
            <dt className="text-muted">Reads from old local disk</dt>
            <dd>{r.fallbackReads}</dd>
            {r.error ? (
              <>
                <dt className="text-muted">Problem</dt>
                <dd className="text-danger">{r.error}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {storage.isError ? (
          <p role="alert" className="text-sm text-danger">
            {messageOf(storage.error)}
          </p>
        ) : null}
      </Card>
    </Layout>
  );
}
