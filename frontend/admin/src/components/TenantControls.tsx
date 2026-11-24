import type { SetupImportResult, TenantExport } from '@flourishive/schemas';
import { tenantExport } from '@flourishive/schemas';
import { Button, Card, CardTitle, Skeleton, Switch, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { useCan } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';

/** Feature switches, and copying this company's setup out or in (D-70). */
export function TenantControls({ tenantId, name }: { tenantId: string; name: string }) {
  const api = useApi();
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = can('tenants.manage');
  const features = useQuery({
    queryKey: ['tenant-features', tenantId],
    queryFn: () => api.controls.features(tenantId),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [file, setFile] = useState<TenantExport | null>(null);
  const [preview, setPreview] = useState<SetupImportResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Card>
        <CardTitle>Features</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Switch a module off for this company. Its menu disappears and the server refuses it.
        </p>
        {features.isPending ? (
          <Skeleton className="mt-3 h-24 w-full" />
        ) : (
          <ul className="mt-3 grid gap-3">
            {features.data?.features.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="text-xs text-muted">{f.hint}</div>
                </div>
                <Switch
                  checked={f.enabled}
                  label={`${f.label} for ${name}`}
                  disabled={!canEdit || busy === f.key}
                  onChange={(on) =>
                    void run(f.key, async () => {
                      const next = await api.controls.setFeature(tenantId, f.key, on);
                      qc.setQueryData(['tenant-features', tenantId], next);
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canEdit ? (
        <Card>
          <CardTitle>Copy setup</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Export this company’s settings, brand, email wording, notification rules, sign-in policy
            and feature switches as a file. It never includes passwords, keys or people. Import a
            file from another company to copy its setup here; you see exactly what changes first.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={busy === 'export'}
              onClick={() =>
                void run('export', async () => {
                  const data = await api.controls.exportSetup(tenantId);
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(
                    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                  );
                  a.download = `${data.source.slug}-setup.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                })
              }
            >
              Export setup
            </Button>
            <Button variant="secondary" onClick={() => input.current?.click()}>
              Import setup…
            </Button>
            <input
              ref={input}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Setup file to import"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                void run('preview', async () => {
                  const parsed = tenantExport.safeParse(JSON.parse(await f.text()));
                  if (!parsed.success) throw new Error('This is not a Flourishive setup file');
                  setFile(parsed.data);
                  setPreview(await api.controls.previewImport(tenantId, parsed.data));
                });
              }}
            />
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {preview && file ? (
            <div className="mt-4 rounded-lg border border-line p-3">
              <div className="text-sm font-medium">
                Importing {file.source.name}’s setup into {name}
              </div>
              {preview.changes.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  Nothing would change. This company already matches.
                </p>
              ) : (
                <ul className="mt-2 grid gap-1 text-sm">
                  {preview.changes.map((c, i) => (
                    <li key={i}>
                      <span className="text-muted">{c.area}:</span> {c.text}
                    </li>
                  ))}
                </ul>
              )}
              {preview.skipped.length ? (
                <p className="mt-2 text-xs text-muted">Not copied: {preview.skipped.join('; ')}</p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Button
                  loading={busy === 'apply'}
                  disabled={preview.changes.length === 0}
                  onClick={() =>
                    void run('apply', async () => {
                      const r = await api.controls.applyImport(tenantId, file);
                      toast({ title: `Imported: ${r.changes.length} changes`, tone: 'success' });
                      setPreview(null);
                      setFile(null);
                      await qc.invalidateQueries();
                    })
                  }
                >
                  Apply changes
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPreview(null);
                    setFile(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
