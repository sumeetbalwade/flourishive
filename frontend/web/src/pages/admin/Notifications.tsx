import { CollapsibleSection, EmptyState, Input, Skeleton, Switch, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/api.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { messageOf } from '../../lib/errors.ts';
import { Layout } from '../Layout.tsx';

type Quiet = { enabled: boolean; start: string; end: string };

/** Who is told about which event, plus reminders and quiet hours (D-69). One Save per section. */
export function Notifications() {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = auth.can('settings.manage');
  const rules = useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => api.notificationRules.get(),
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() });

  const [cellEdits, setCellEdits] = useState<Record<string, boolean>>({});
  const [reminderEdit, setReminderEdit] = useState<string | null>(null);
  const [quietEdit, setQuietEdit] = useState<Quiet | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const keyOf = (e: string, r: string) => `${e}|${r}`;
  const on = (e: string, r: string) =>
    cellEdits[keyOf(e, r)] ??
    rules.data?.cells.find((c) => c.event === e && c.roleKey === r)?.enabled ??
    false;

  const savedReminders = (
    (settings.data?.values['notifications.reminderHours'] as number[] | undefined) ?? [24, 72]
  ).join(', ');
  const reminders = reminderEdit ?? savedReminders;
  const savedQuiet = (settings.data?.values['notifications.quietHours'] as Quiet | undefined) ?? {
    enabled: false,
    start: '22:00',
    end: '07:00',
  };
  const quiet = quietEdit ?? savedQuiet;

  async function run(section: string, work: () => Promise<void>, done: () => void) {
    setSaving(section);
    try {
      await work();
      done();
      toast({ title: 'Saved', tone: 'success' });
    } catch (e) {
      toast({ title: 'Not saved', description: messageOf(e), tone: 'danger' });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Layout active="notifications" title="Notifications">
      <p className="mb-5 max-w-2xl text-sm text-muted">
        Choose who is emailed about each event. Codes, password links and security emails are always
        sent and cannot be switched off.
      </p>
      {rules.isError ? (
        <EmptyState title="Could not load" description={messageOf(rules.error)} />
      ) : !rules.data || !settings.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid max-w-4xl gap-5">
          <CollapsibleSection
            id="rules"
            title="Who is told"
            summary={`${rules.data.events.length} events`}
            defaultOpen
            dirtyCount={Object.keys(cellEdits).length}
            saving={saving === 'rules'}
            onDiscard={() => setCellEdits({})}
            onSave={
              canEdit
                ? () =>
                    run(
                      'rules',
                      async () => {
                        await api.notificationRules.save({
                          cells: Object.entries(cellEdits).map(([k, enabled]) => {
                            const [event = '', roleKey = ''] = k.split('|');
                            return { event, roleKey, channel: 'EMAIL' as const, enabled };
                          }),
                        });
                        await qc.invalidateQueries({ queryKey: ['notification-rules'] });
                      },
                      () => setCellEdits({}),
                    )
                : undefined
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-2 pr-4 font-medium">Event (email)</th>
                    {rules.data.roles.map((r) => (
                      <th key={r.key} className="px-2 py-2 text-center font-medium">
                        {r.name}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center font-medium">The person it is about</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data.events.map((ev) => (
                    <tr key={ev.key} className="border-t border-line">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-fg">{ev.label}</p>
                        <p className="text-xs text-muted">{ev.description}</p>
                      </td>
                      {[...rules.data.roles.map((r) => r.key), 'SUBJECT'].map((rk) => (
                        <td key={rk} className="px-2 py-3 text-center">
                          {rk === 'SUBJECT' && !ev.subject ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <Switch
                              label={`${ev.label}: ${rk}`}
                              checked={on(ev.key, rk)}
                              disabled={!canEdit}
                              onChange={(v) =>
                                setCellEdits((c) => ({ ...c, [keyOf(ev.key, rk)]: v }))
                              }
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-faint">
              In-app notices arrive with an in-app inbox; for now every notice is an email.
            </p>
          </CollapsibleSection>

          <CollapsibleSection
            id="reminders"
            title="Reminders"
            summary={`after ${savedReminders} hours`}
            defaultOpen
            dirtyCount={reminderEdit !== null && reminderEdit !== savedReminders ? 1 : 0}
            saving={saving === 'reminders'}
            onDiscard={() => setReminderEdit(null)}
            onSave={
              canEdit
                ? () =>
                    run(
                      'reminders',
                      async () => {
                        const hours = reminders.split(/[ ,]+/).filter(Boolean).map(Number);
                        await api.settings.setTenant('notifications.reminderHours', hours);
                        await qc.invalidateQueries({ queryKey: ['settings'] });
                      },
                      () => setReminderEdit(null),
                    )
                : undefined
            }
          >
            <label className="grid max-w-sm gap-1 text-sm">
              <span className="font-medium text-fg">Remind after (hours, separated by commas)</span>
              <Input
                value={reminders}
                disabled={!canEdit}
                onChange={(e) => setReminderEdit(e.target.value)}
                placeholder="24, 72"
              />
              <span className="text-xs text-muted">
                A letter waiting for approval reminds the people chosen above after each of these.
              </span>
            </label>
          </CollapsibleSection>

          <CollapsibleSection
            id="quiet"
            title="Quiet hours"
            summary={savedQuiet.enabled ? `${savedQuiet.start} to ${savedQuiet.end}` : 'off'}
            defaultOpen
            dirtyCount={
              quietEdit && JSON.stringify(quietEdit) !== JSON.stringify(savedQuiet) ? 1 : 0
            }
            saving={saving === 'quiet'}
            onDiscard={() => setQuietEdit(null)}
            onSave={
              canEdit
                ? () =>
                    run(
                      'quiet',
                      async () => {
                        await api.settings.setTenant('notifications.quietHours', quiet);
                        await qc.invalidateQueries({ queryKey: ['settings'] });
                      },
                      () => setQuietEdit(null),
                    )
                : undefined
            }
          >
            <div className="grid gap-4">
              <div className="flex items-center gap-3">
                <Switch
                  label="Hold emails during quiet hours"
                  checked={quiet.enabled}
                  disabled={!canEdit}
                  onChange={(enabled) => setQuietEdit({ ...quiet, enabled })}
                />
                <span className="text-sm text-fg">Hold emails that can wait</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  From
                  <Input
                    type="time"
                    className="w-32"
                    value={quiet.start}
                    disabled={!canEdit || !quiet.enabled}
                    onChange={(e) => setQuietEdit({ ...quiet, start: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2">
                  Until
                  <Input
                    type="time"
                    className="w-32"
                    value={quiet.end}
                    disabled={!canEdit || !quiet.enabled}
                    onChange={(e) => setQuietEdit({ ...quiet, end: e.target.value })}
                  />
                </label>
              </div>
              <p className="text-xs text-muted">
                In your company’s time zone. Codes, password links and security emails are never
                held.
              </p>
            </div>
          </CollapsibleSection>
        </div>
      )}
    </Layout>
  );
}
