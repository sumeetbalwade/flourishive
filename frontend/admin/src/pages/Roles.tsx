import type { PlatformPermissionInfo, PlatformRoleView } from '@flourishive/schemas';
import {
  Badge,
  Button,
  CollapsibleSection,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  SearchBox,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function RoleCard({
  role,
  catalogue,
  held,
  forced,
  query,
  onChanged,
  onDuplicate,
}: {
  role: PlatformRoleView;
  catalogue: PlatformPermissionInfo[];
  /** What the signed-in person holds: they can only hand out what they have. */
  held: string[];
  forced: { open?: boolean; token: number };
  query: string;
  onChanged: () => Promise<void>;
  onDuplicate: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const current = draft ?? role.permissions;
  const dirty =
    draft && !sameSet(draft, role.permissions)
      ? Math.abs(draft.length - role.permissions.length) || 1
      : 0;
  const readOnly = role.isPreset;

  const q = query.trim().toLowerCase();
  const shown = q
    ? catalogue.filter(
        (p) =>
          role.name.toLowerCase().includes(q) ||
          [p.label, p.hint, p.code, p.area].some((t) => t.toLowerCase().includes(q)),
      )
    : catalogue;
  const areas = [...new Set(shown.map((p) => p.area))];

  async function save() {
    setSaving(true);
    try {
      await api.roles.update(role.id, { permissions: current });
      toast({ title: `${role.name} saved`, tone: 'success' });
      setDraft(null);
      await onChanged();
    } catch (e) {
      toast({ title: messageOf(e), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleSection
      id={`role-${role.id}`}
      title={role.name}
      summary={`${role.members} ${role.members === 1 ? 'person' : 'people'} · ${role.permissions.length} powers${readOnly ? ' · built in' : ''}`}
      open={q ? true : forced.open}
      forceToken={forced.token}
      dirtyCount={dirty}
      saving={saving}
      onSave={readOnly ? undefined : save}
      onDiscard={() => setDraft(null)}
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onDuplicate}>
            <Copy size={14} /> Duplicate
          </Button>
          {!readOnly ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={role.members > 0}
              title={role.members > 0 ? 'Move its people to another role first' : undefined}
              onClick={async () => {
                try {
                  await api.roles.remove(role.id);
                  toast({ title: `${role.name} deleted`, tone: 'success' });
                  await onChanged();
                } catch (e) {
                  toast({ title: messageOf(e), tone: 'danger' });
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          ) : null}
        </div>
      }
    >
      <p className="py-4 text-sm text-muted">
        {role.description ? `${role.description.replace(/\.$/, '')}.` : 'No description.'}
        {readOnly ? ' Built-in roles cannot be edited. Duplicate it to make your own.' : ''}
      </p>
      {areas.map((area) => (
        <fieldset key={area} className="border-t border-line py-4">
          <legend className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-faint">
            {area}
          </legend>
          <ul className="grid gap-2">
            {shown
              .filter((p) => p.area === area)
              .map((p) => {
                const on = current.includes(p.code);
                const cannot = !readOnly && !on && !held.includes(p.code);
                return (
                  <li key={p.code}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-surface-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={readOnly || cannot}
                        onChange={(e) =>
                          setDraft(
                            e.target.checked
                              ? [...current, p.code]
                              : current.filter((c) => c !== p.code),
                          )
                        }
                        className="mt-1 h-4 w-4 accent-[var(--accent)]"
                      />
                      <span>
                        <span className="text-sm font-medium">{p.label}</span>
                        <span className="block text-xs text-faint">
                          {p.hint}
                          {cannot ? ' (you do not hold this power yourself)' : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
          </ul>
        </fieldset>
      ))}
    </CollapsibleSection>
  );
}

/** Staff roles (D-55): built-in roles are read-only; custom roles are a checklist of plain-English powers. */
export function Roles() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const data = useQuery({ queryKey: ['platform-roles'], queryFn: () => api.roles.list() });
  const me = useQuery({ queryKey: ['platform-me'], queryFn: () => api.auth.me() });
  const [query, setQuery] = useState('');
  const [force, setForce] = useState<{ open?: boolean; token: number }>({ token: 0 });
  const [create, setCreate] = useState<{ name: string; from: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['platform-roles'] });
  };

  const q = query.trim().toLowerCase();
  const roles = useMemo(() => {
    const all = data.data?.roles ?? [];
    if (!q) return all;
    const cat = data.data?.permissions ?? [];
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        cat.some(
          (p) =>
            r.permissions.includes(p.code) &&
            [p.label, p.hint, p.code, p.area].some((t) => t.toLowerCase().includes(q)),
        ),
    );
  }, [data.data, q]);

  return (
    <Layout
      active="roles"
      title="Staff roles"
      actions={
        can('roles.manage') ? (
          <Button size="sm" onClick={() => setCreate({ name: '', from: [] })}>
            <Plus size={16} /> New role
          </Button>
        ) : undefined
      }
    >
      {data.isPending ? (
        <Skeleton className="h-64 w-full max-w-3xl" />
      ) : data.isError ? (
        <EmptyState title="Could not load roles" description={messageOf(data.error)} />
      ) : (
        <div className="grid max-w-3xl gap-4">
          <p className="text-sm text-muted">
            A role is a set of powers. Every staff member has one. You can only give a role powers
            you hold yourself, and there is always at least one active Owner.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox
              className="min-w-60 flex-1"
              value={query}
              onChange={setQuery}
              label="Search roles"
              placeholder="Search roles and powers"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForce((f) => ({ open: true, token: f.token + 1 }))}
            >
              Expand all
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForce((f) => ({ open: false, token: f.token + 1 }))}
            >
              Collapse all
            </Button>
          </div>
          {roles.length === 0 ? (
            <EmptyState
              title={`Nothing matches “${query.trim()}”`}
              description="Try a role name or a power such as restart or secrets."
            />
          ) : (
            roles.map((r) => (
              <RoleCard
                key={r.id}
                role={r}
                catalogue={data.data.permissions}
                held={me.data?.permissions ?? []}
                forced={force}
                query={query}
                onChanged={refresh}
                onDuplicate={() =>
                  setCreate({
                    name: `${r.name} copy`,
                    from: r.permissions.filter((c) => (me.data?.permissions ?? []).includes(c)),
                  })
                }
              />
            ))
          )}
        </div>
      )}
      <Dialog open={create !== null} onOpenChange={(o) => !o && setCreate(null)}>
        <DialogContent
          title="New role"
          description="Start with the powers shown, then adjust them on the role."
        >
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!create) return;
              setBusy(true);
              try {
                await api.roles.create({ name: create.name, permissions: create.from });
                toast({ title: 'Role created', tone: 'success' });
                setCreate(null);
                await refresh();
              } catch (err) {
                toast({ title: messageOf(err), tone: 'danger' });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Name" htmlFor="role-name">
              <Input
                id="role-name"
                autoFocus
                value={create?.name ?? ''}
                onChange={(e) => setCreate((c) => c && { ...c, name: e.target.value })}
              />
            </Field>
            <p className="text-xs text-muted">
              {create?.from.length ?? 0} powers copied. Adding or removing powers comes next, on the
              role itself.
            </p>
            <Badge tone="neutral">Asks you to confirm it is you</Badge>
            <Button
              type="submit"
              loading={busy}
              disabled={busy || (create?.name.trim().length ?? 0) < 2}
            >
              Create role
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
