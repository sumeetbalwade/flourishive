import type { OrgItem, OrgKind } from '@flourishive/schemas';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

const KINDS: { kind: OrgKind; label: string; one: string }[] = [
  { kind: 'departments', label: 'Departments', one: 'department' },
  { kind: 'designations', label: 'Designations', one: 'designation' },
  { kind: 'locations', label: 'Locations', one: 'location' },
];

function Catalogue({ kind, one }: { kind: OrgKind; one: string }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const canWrite = useAuth().can('org.write');
  const list = useQuery({ queryKey: ['org', kind], queryFn: () => api.org.list(kind) });
  const [name, setName] = useState('');
  const [extra, setExtra] = useState({ city: '', state: '' });
  const [rename, setRename] = useState<OrgItem | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [remove, setRemove] = useState<OrgItem | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['org', kind] });

  async function run(fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok, tone: 'success' });
      after?.();
      await refresh();
    } catch (e) {
      toast({ title: 'That did not work', description: messageOf(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 grid gap-5">
      {canWrite ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void run(
              () =>
                api.org.create(
                  kind,
                  kind === 'locations'
                    ? {
                        name: name.trim(),
                        city: extra.city.trim() || null,
                        state: extra.state.trim() || null,
                      }
                    : { name: name.trim() },
                ),
              `${name.trim()} added`,
              () => {
                setName('');
                setExtra({ city: '', state: '' });
              },
            );
          }}
        >
          <Field label={`New ${one}`} htmlFor={`new-${kind}`}>
            <Input
              id={`new-${kind}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-64"
            />
          </Field>
          {kind === 'locations' ? (
            <>
              <Field label="City" htmlFor="new-city">
                <Input
                  id="new-city"
                  value={extra.city}
                  onChange={(e) => setExtra({ ...extra, city: e.target.value })}
                  className="w-44"
                />
              </Field>
              <Field label="State" htmlFor="new-state">
                <Input
                  id="new-state"
                  value={extra.state}
                  onChange={(e) => setExtra({ ...extra, state: e.target.value })}
                  className="w-44"
                  placeholder="Maharashtra"
                />
              </Field>
            </>
          ) : null}
          <Button type="submit" disabled={busy || !name.trim()}>
            Add
          </Button>
        </form>
      ) : null}

      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : list.isError ? (
        <EmptyState title="Could not load" description={messageOf(list.error)} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={`No ${kind} yet`}
          description={
            canWrite
              ? `Add your first ${one} above, or import people with a CSV and let it create them.`
              : undefined
          }
        />
      ) : (
        <Table compact>
          <THead>
            <TR>
              <TH>Name</TH>
              {kind === 'locations' ? (
                <>
                  <TH>City</TH>
                  <TH>State</TH>
                </>
              ) : null}
              <TH>People</TH>
              {canWrite ? <TH className="w-40" /> : null}
            </TR>
          </THead>
          <TBody>
            {list.data.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.name}</TD>
                {kind === 'locations' ? (
                  <>
                    <TD>{r.city ?? '—'}</TD>
                    <TD>{r.state ?? '—'}</TD>
                  </>
                ) : null}
                <TD>{r._count.engagements}</TD>
                {canWrite ? (
                  <TD className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRename(r);
                        setRenameTo(r.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemove(r)}>
                      Delete
                    </Button>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={rename !== null} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent title={`Rename ${one}`}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (rename && renameTo.trim())
                void run(
                  () => api.org.update(kind, rename.id, { name: renameTo.trim() }),
                  'Renamed',
                  () => setRename(null),
                );
            }}
          >
            <Field label="Name" htmlFor="rename">
              <Input
                id="rename"
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                autoFocus
              />
            </Field>
            <Button type="submit" disabled={busy || !renameTo.trim()}>
              Save
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={remove !== null} onOpenChange={(o) => !o && setRemove(null)}>
        <DialogContent
          title={`Delete ${remove?.name ?? ''}?`}
          description={
            remove && remove._count.engagements > 0
              ? `${remove._count.engagements} people still use it, so it cannot be deleted. Move them first.`
              : 'This cannot be undone.'
          }
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              disabled={busy || (remove?._count.engagements ?? 0) > 0}
              onClick={() =>
                remove &&
                void run(
                  () => api.org.remove(kind, remove.id),
                  'Deleted',
                  () => setRemove(null),
                )
              }
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function Org() {
  return (
    <Layout active="org" title="Organisation">
      <Tabs defaultValue="departments">
        <TabsList>
          {KINDS.map((k) => (
            <TabsTrigger key={k.kind} value={k.kind}>
              {k.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {KINDS.map((k) => (
          <TabsContent key={k.kind} value={k.kind}>
            <Catalogue kind={k.kind} one={k.one} />
          </TabsContent>
        ))}
      </Tabs>
    </Layout>
  );
}
