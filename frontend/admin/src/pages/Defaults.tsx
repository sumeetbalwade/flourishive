import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';
import { parseValue } from './TenantDetail.tsx';

/** Platform-wide defaults. A tenant follows these unless it has its own override. */
export function Defaults() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['platform-settings'], queryFn: () => api.settings.list() });
  const [edit, setEdit] = useState<{ key: string; description: string; value: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  return (
    <Layout active="settings" title="Platform defaults">
      <p className="mb-5 max-w-2xl text-sm text-muted">
        What every tenant gets unless its own setting says otherwise. Change a tenant’s own value
        from the tenant’s page.
      </p>
      {list.isError ? (
        <EmptyState title="Could not load" description={messageOf(list.error)} />
      ) : list.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="grid max-w-3xl gap-3">
          {list.data.map((d) => (
            <Card key={d.key} className="flex items-center justify-between gap-4 py-4">
              <div>
                <div className="font-medium">{d.description}</div>
                <div className="font-mono text-xs text-faint">
                  {d.key} · can be set per {d.levels.join(', ')}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {d.platformValue !== null && d.platformValue !== undefined ? (
                  <Badge tone="accent">{String(d.platformValue)}</Badge>
                ) : (
                  <Badge>Built-in: {String(d.default)}</Badge>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setEdit({
                      key: d.key,
                      description: d.description,
                      value: d.platformValue != null ? String(d.platformValue) : '',
                    })
                  }
                >
                  Change
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title="Change default" description={edit?.description}>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!edit) return;
              setBusy(true);
              try {
                await api.settings.set(edit.key, parseValue(edit.value));
                toast({ title: 'Default saved', tone: 'success' });
                setEdit(null);
                await qc.invalidateQueries({ queryKey: ['platform-settings'] });
              } catch (err) {
                toast({ title: 'Not saved', description: messageOf(err), tone: 'danger' });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Value" htmlFor="dv" hint={edit?.key}>
              <Input
                id="dv"
                value={edit?.value ?? ''}
                onChange={(e) => edit && setEdit({ ...edit, value: e.target.value })}
                autoFocus
              />
            </Field>
            <Button type="submit" disabled={busy || !edit?.value.trim()}>
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
