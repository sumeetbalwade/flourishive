import type { CreateTenantBody } from '@flourishive/schemas';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Stat,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { go } from '../router.ts';
import { Layout } from './Layout.tsx';

export const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/** Suggests a company code from a name: "Acme Logistics Pvt Ltd" -> "acme-logistics". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function Tenants() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['tenants'], queryFn: () => api.tenants.list() });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', slug: '', legalName: '', adminEmail: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const total = list.data?.length ?? 0;
  const users = list.data?.reduce((n, t) => n + t.counts.users, 0) ?? 0;
  const suspended = list.data?.filter((t) => t.status === 'SUSPENDED').length ?? 0;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const body: CreateTenantBody = {
      slug: f.slug.trim(),
      name: f.name.trim(),
      companyName: f.name.trim(),
      legalName: f.legalName.trim() || f.name.trim(),
      adminEmail: f.adminEmail.trim(),
    };
    if (!body.name || !body.slug || !body.adminEmail)
      return setErrors(['Name, company code and the first admin’s email are required.']);
    setBusy(true);
    setErrors([]);
    try {
      const t = await api.tenants.create(body);
      toast({
        title: `${t.name} created`,
        description: `An invitation went to ${t.adminEmail}.`,
        tone: 'success',
      });
      setOpen(false);
      setF({ name: '', slug: '', legalName: '', adminEmail: '' });
      setSlugTouched(false);
      await qc.invalidateQueries({ queryKey: ['tenants'] });
      go(`/tenants/${t.id}`);
    } catch (err) {
      const details = (err as { details?: string[] }).details;
      setErrors(details?.length ? details : [messageOf(err)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      active="tenants"
      title="Tenants"
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={16} /> New tenant
        </Button>
      }
    >
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Stat value={String(total)} label="Tenants" />
        <Stat value={String(users)} label="Users across tenants" />
        <Stat value={String(suspended)} label="Suspended" />
      </div>
      {list.isError ? (
        <EmptyState
          title="Could not load tenants"
          description={messageOf(list.error)}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        />
      ) : list.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : list.data.length === 0 ? (
        <EmptyState
          title="No tenants yet"
          description="Create the first company. Its admin gets an email to choose a password."
          action={<Button onClick={() => setOpen(true)}>New tenant</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Tenant</TH>
              <TH>Company code</TH>
              <TH>Users</TH>
              <TH>People</TH>
              <TH>Status</TH>
              <TH>Created</TH>
            </TR>
          </THead>
          <TBody>
            {list.data.map((t) => (
              <TR key={t.id} className="cursor-pointer" onClick={() => go(`/tenants/${t.id}`)}>
                <TD>
                  <div className="flex items-center gap-3">
                    <Avatar name={t.name} />
                    <a
                      href={`#/tenants/${t.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.name}
                    </a>
                  </div>
                </TD>
                <TD className="font-mono text-xs">{t.slug}</TD>
                <TD>{t.counts.users}</TD>
                <TD>{t.counts.engagements}</TD>
                <TD>
                  <Badge tone={t.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {t.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                  </Badge>
                </TD>
                <TD className="text-muted">{fmt(t.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="New tenant"
          description="Creates the company, its roles and the first admin, who is invited by email."
        >
          <form onSubmit={create} className="grid gap-4">
            <Field label="Company name" htmlFor="t-name">
              <Input
                id="t-name"
                value={f.name}
                onChange={(e) =>
                  setF({
                    ...f,
                    name: e.target.value,
                    slug: slugTouched ? f.slug : slugify(e.target.value),
                  })
                }
              />
            </Field>
            <Field
              label="Company code"
              htmlFor="t-slug"
              hint="Employees type this at sign-in. Lowercase letters, digits and hyphens."
            >
              <Input
                id="t-slug"
                value={f.slug}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => {
                  setSlugTouched(true);
                  setF({ ...f, slug: e.target.value.toLowerCase() });
                }}
              />
            </Field>
            <Field
              label="Legal name"
              htmlFor="t-legal"
              hint="As on letters, e.g. Acme Logistics Pvt Ltd. Defaults to the company name."
            >
              <Input
                id="t-legal"
                value={f.legalName}
                onChange={(e) => setF({ ...f, legalName: e.target.value })}
              />
            </Field>
            <Field label="First admin’s email" htmlFor="t-admin">
              <Input
                id="t-admin"
                type="email"
                value={f.adminEmail}
                onChange={(e) => setF({ ...f, adminEmail: e.target.value })}
              />
            </Field>
            {errors.length ? (
              <ul role="alert" className="grid gap-1 text-sm text-danger">
                {errors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
            <Button type="submit" size="lg" loading={busy} disabled={busy}>
              {busy ? 'Creating…' : 'Create tenant'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
