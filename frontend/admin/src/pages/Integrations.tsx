import type { ConfigTestResult, RuntimeConfigEntry } from '@flourishive/schemas';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  SettingControl,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

const SOURCE: Record<RuntimeConfigEntry['source'], string> = {
  console: 'Set here',
  environment: 'From the server file',
  default: 'Built-in',
  unset: 'Not set',
};

function Row({ entry, onSaved }: { entry: RuntimeConfigEntry; onSaved: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [draft, setDraft] = useState<unknown>(entry.kind === 'secret' ? '' : (entry.value ?? ''));
  const dirty = entry.kind === 'secret' ? draft !== '' : draft !== (entry.value ?? '');

  const save = useMutation({
    mutationFn: () => api.config.set(entry.key, draft as string | number | boolean),
    onSuccess: () => {
      toast({ title: `${entry.label} saved`, tone: 'success' });
      if (entry.kind === 'secret') setDraft('');
      onSaved();
    },
    onError: (e) => toast({ title: messageOf(e), tone: 'danger' }),
  });
  const reset = useMutation({
    mutationFn: () => api.config.clear(entry.key),
    onSuccess: () => {
      toast({ title: `${entry.label} goes back to the server file`, tone: 'success' });
      onSaved();
    },
    onError: (e) => toast({ title: messageOf(e), tone: 'danger' }),
  });

  return (
    <div className="grid gap-2 border-t border-line py-4 first:border-t-0 md:grid-cols-[minmax(0,16rem)_1fr]">
      <div>
        <p className="text-sm font-medium">{entry.label}</p>
        <p className="mt-0.5 text-xs text-faint">{entry.hint}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={entry.source === 'console' ? 'success' : 'neutral'}>
            {SOURCE[entry.source]}
          </Badge>
          {entry.restartRequired ? <Badge tone="neutral">Needs a restart</Badge> : null}
        </div>
      </div>
      <div className="grid content-start gap-3">
        <SettingControl
          kind={entry.kind === 'url' ? 'url' : entry.kind}
          label={entry.label}
          value={draft}
          onChange={setDraft}
          secret={{ isSet: entry.isSet, updatedAt: entry.updatedAt, updatedBy: entry.updatedBy }}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
          {entry.source === 'console' ? (
            <Button
              size="sm"
              variant="ghost"
              loading={reset.isPending}
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              Use server file value
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TestButton({ group }: { group: string }) {
  const api = useApi();
  const test = useMutation<ConfigTestResult>({ mutationFn: () => api.config.test(group) });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="secondary"
        loading={test.isPending}
        disabled={test.isPending}
        onClick={() => test.mutate()}
      >
        Test
      </Button>
      {test.data ? (
        <p role="status" className={test.data.ok ? 'text-sm text-success' : 'text-sm text-danger'}>
          {test.data.message}
        </p>
      ) : null}
      {test.isError ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(test.error)}
        </p>
      ) : null}
    </div>
  );
}

/** Keys, mail server and addresses that used to need a server-file edit. Secrets are write-only. */
export function Integrations() {
  const api = useApi();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['platform-config'], queryFn: () => api.config.list() });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['platform-config'] });

  const groups = new Map<string, RuntimeConfigEntry[]>();
  for (const e of list.data ?? []) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);

  return (
    <Layout active="integrations" title="Integrations">
      {list.isPending ? (
        <Skeleton className="h-64 w-full max-w-3xl" />
      ) : list.isError ? (
        <EmptyState title="Could not load the settings" description={messageOf(list.error)} />
      ) : (
        <div className="grid max-w-3xl gap-5">
          <p className="text-sm text-muted">
            Changing a key or password asks you to confirm it is you. Saved secrets are never shown
            again. A value set here wins over the server file.
          </p>
          {[...groups].map(([group, entries]) => (
            <Card key={group} className="p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <CardTitle>{group}</CardTitle>
                <TestButton group={group} />
              </div>
              {entries.map((e) => (
                <Row key={e.key} entry={e} onSaved={refresh} />
              ))}
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
