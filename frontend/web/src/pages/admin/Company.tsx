import {
  EmptyState,
  SettingsEditor,
  Skeleton,
  useToast,
  type SettingChange,
  type SettingItem,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

/** This company's own settings. Anything the platform has locked is shown but cannot be changed. */
export function Company() {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = auth.can('settings.manage');
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() });

  const items: SettingItem[] = q.data
    ? Object.entries(q.data.definitions)
        .filter(([, d]) => d.levels.includes('tenant') && d.kind !== 'json')
        .map(([key, d]) => ({
          key,
          label: d.label,
          description: d.description,
          group: d.group,
          kind: d.kind,
          options: d.options,
          min: d.min,
          max: d.max,
          value: q.data.values[key],
          fallback: q.data.values[key],
          overridden: q.data.overridden.includes(key),
          locked: q.data.locked.includes(key),
          readOnly: !canEdit,
        }))
    : [];

  async function save(changes: SettingChange[]) {
    try {
      for (const c of changes) {
        if (c.clear) await api.settings.clearTenant(c.key);
        else await api.settings.setTenant(c.key, c.value);
      }
      toast({ title: 'Settings saved', tone: 'success' });
    } catch (err) {
      toast({ title: 'Not saved', description: messageOf(err), tone: 'danger' });
      throw err;
    } finally {
      await qc.invalidateQueries({ queryKey: ['settings'] });
    }
  }

  return (
    <Layout active="company" title="Company settings">
      <p className="mb-5 max-w-2xl text-sm text-muted">
        {canEdit
          ? 'Settings for your company. “Reset” goes back to the platform default. A setting marked as set by the platform cannot be changed here.'
          : 'Your company’s settings. Ask an administrator to change them.'}
      </p>
      {q.isError ? (
        <EmptyState title="Could not load" description={messageOf(q.error)} />
      ) : q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="max-w-4xl">
          <SettingsEditor mode="tenant" items={items} onSave={save} />
        </div>
      )}
    </Layout>
  );
}
