import { type PlatformSettingItem } from '@flourishive/schemas';
import {
  EmptyState,
  SettingsEditor,
  Skeleton,
  useToast,
  type SettingChange,
  type SettingItem,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute } from '../router.ts';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

function toItem(s: PlatformSettingItem): SettingItem {
  const platformSet = s.platformValue !== null && s.platformValue !== undefined;
  return {
    key: s.key,
    label: s.label,
    description: s.description,
    group: s.group,
    kind: s.kind,
    options: s.options,
    min: s.min,
    max: s.max,
    value: platformSet ? s.platformValue : s.default,
    fallback: s.default,
    overridden: platformSet,
    locked: false,
    // Platform-only settings (no company level) have nothing for a company to override.
    lockable: s.levels.length > 0,
    lockedByPlatform: s.locked,
    source: platformSet ? 'Set by the platform' : 'Built-in default',
  };
}

/** What every company gets, and which of those a company may not change. */
export function Defaults() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const focus = useRoute().query.get('focus') ?? undefined;
  const list = useQuery({ queryKey: ['platform-settings'], queryFn: () => api.settings.list() });

  async function save(changes: SettingChange[]) {
    try {
      for (const c of changes) {
        if (c.clear) await api.settings.clear(c.key);
        else await api.settings.set(c.key, { value: c.value, locked: c.locked });
      }
      toast({ title: 'Platform settings saved', tone: 'success' });
    } catch (err) {
      toast({ title: 'Not saved', description: messageOf(err), tone: 'danger' });
      throw err;
    } finally {
      await qc.invalidateQueries({ queryKey: ['platform-settings'] });
    }
  }

  return (
    <Layout active="settings" title="Platform settings">
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Defaults for every company. Lock a setting to stop companies changing it. A company that
        already has its own value is overridden by a lock.
      </p>
      {list.isError ? (
        <EmptyState title="Could not load" description={messageOf(list.error)} />
      ) : list.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="max-w-4xl">
          <SettingsEditor
            mode="platform"
            items={list.data.map(toItem)}
            onSave={save}
            focusKey={focus}
          />
        </div>
      )}
    </Layout>
  );
}
