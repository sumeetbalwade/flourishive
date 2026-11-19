import type { CreatePersonBody, Engagement, UpdatePersonBody } from '@flourishive/schemas';
import { Button, Field, Input } from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SelectField } from '../../components/SelectField.tsx';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';

const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');

/** Create (no `existing`) or edit one person's details. Company cannot change after creation. */
export function PersonForm({
  existing,
  onSaved,
}: {
  existing?: Engagement;
  onSaved: (e: Engagement) => void;
}) {
  const api = useApi();
  const entities = useQuery({ queryKey: ['entities'], queryFn: () => api.org.entities() });
  const departments = useQuery({
    queryKey: ['org', 'departments'],
    queryFn: () => api.org.list('departments'),
  });
  const designations = useQuery({
    queryKey: ['org', 'designations'],
    queryFn: () => api.org.list('designations'),
  });
  const locations = useQuery({
    queryKey: ['org', 'locations'],
    queryFn: () => api.org.list('locations'),
  });

  const [f, setF] = useState({
    firstName: existing?.person.firstName ?? '',
    lastName: existing?.person.lastName ?? '',
    workEmail: existing?.person.workEmail ?? '',
    phone: existing?.person.phone ?? '',
    entityId: existing?.entityId as string | undefined,
    type: (existing?.type ?? 'EMPLOYEE') as 'EMPLOYEE' | 'INTERN',
    employeeCode: existing?.employeeCode ?? '',
    departmentId: existing?.department?.id as string | undefined,
    designationId: existing?.designation?.id as string | undefined,
    locationId: existing?.location?.id as string | undefined,
    startDate: day(existing?.startDate),
    endDate: day(existing?.endDate),
    college: existing?.intern?.college ?? '',
    course: existing?.intern?.course ?? '',
    graduationYear: existing?.intern?.graduationYear ? String(existing.intern.graduationYear) : '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const opts = (rows?: { id: string; name: string }[]) =>
    (rows ?? []).map((r) => ({ value: r.id, label: r.name }));
  const only = entities.data?.length === 1 ? entities.data[0]!.id : undefined;
  const entityId = f.entityId ?? only;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problems: string[] = [];
    if (!f.firstName.trim()) problems.push('First name is required.');
    if (!f.lastName.trim()) problems.push('Last name is required.');
    if (!f.employeeCode.trim()) problems.push('Employee code is required.');
    if (!f.startDate) problems.push('Start date is required.');
    if (!existing && !entityId) problems.push('Choose a company.');
    if (problems.length) return setErrors(problems);

    const person = {
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      workEmail: f.workEmail.trim() || null,
      phone: f.phone.trim() || null,
    };
    const common = {
      employeeCode: f.employeeCode.trim(),
      departmentId: f.departmentId ?? null,
      designationId: f.designationId ?? null,
      locationId: f.locationId ?? null,
      startDate: f.startDate,
      endDate: f.endDate || null,
    };
    const intern =
      f.type === 'INTERN'
        ? {
            college: f.college.trim() || null,
            course: f.course.trim() || null,
            graduationYear: f.graduationYear ? Number(f.graduationYear) : null,
          }
        : undefined;
    setBusy(true);
    setErrors([]);
    try {
      const saved = existing
        ? await api.people.update(existing.id, {
            person,
            engagement: { ...common, type: f.type },
            intern,
          } satisfies UpdatePersonBody)
        : await api.people.create({
            person,
            engagement: { ...common, entityId: entityId!, type: f.type },
            intern,
          } satisfies CreatePersonBody);
      onSaved(saved);
    } catch (err) {
      const details = (err as { details?: string[] }).details;
      setErrors(details?.length ? details : [messageOf(err)]);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="p-first">
          <Input
            id="p-first"
            value={f.firstName}
            onChange={(e) => set('firstName', e.target.value)}
          />
        </Field>
        <Field label="Last name" htmlFor="p-last">
          <Input id="p-last" value={f.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
        <Field label="Work email" htmlFor="p-email" hint="Needed to invite them to sign in">
          <Input
            id="p-email"
            type="email"
            value={f.workEmail}
            onChange={(e) => set('workEmail', e.target.value)}
          />
        </Field>
        <Field label="Phone" htmlFor="p-phone">
          <Input id="p-phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        {!existing && entities.data && entities.data.length > 1 ? (
          <Field label="Company" htmlFor="p-entity">
            <SelectField
              id="p-entity"
              value={entityId}
              onChange={(v) => set('entityId', v)}
              allowNone={false}
              placeholder="Choose…"
              options={entities.data.map((x) => ({ value: x.id, label: x.name }))}
            />
          </Field>
        ) : null}
        <Field label="Type" htmlFor="p-type">
          <SelectField
            id="p-type"
            allowNone={false}
            value={f.type}
            onChange={(v) => set('type', (v ?? 'EMPLOYEE') as 'EMPLOYEE' | 'INTERN')}
            options={[
              { value: 'EMPLOYEE', label: 'Employee' },
              { value: 'INTERN', label: 'Intern' },
            ]}
          />
        </Field>
        <Field label="Employee code" htmlFor="p-code">
          <Input
            id="p-code"
            value={f.employeeCode}
            onChange={(e) => set('employeeCode', e.target.value)}
          />
        </Field>
        <Field label="Department" htmlFor="p-dept">
          <SelectField
            id="p-dept"
            value={f.departmentId}
            onChange={(v) => set('departmentId', v)}
            options={opts(departments.data)}
          />
        </Field>
        <Field label="Designation" htmlFor="p-des">
          <SelectField
            id="p-des"
            value={f.designationId}
            onChange={(v) => set('designationId', v)}
            options={opts(designations.data)}
          />
        </Field>
        <Field label="Location" htmlFor="p-loc">
          <SelectField
            id="p-loc"
            value={f.locationId}
            onChange={(v) => set('locationId', v)}
            options={opts(locations.data)}
          />
        </Field>
        <Field label="Start date" htmlFor="p-start">
          <Input
            id="p-start"
            type="date"
            value={f.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </Field>
        <Field label="End date" htmlFor="p-end">
          <Input
            id="p-end"
            type="date"
            value={f.endDate}
            onChange={(e) => set('endDate', e.target.value)}
          />
        </Field>
      </div>
      {f.type === 'INTERN' ? (
        <div className="grid gap-4 rounded-card border border-line p-4 sm:grid-cols-3">
          <Field label="College" htmlFor="p-college">
            <Input
              id="p-college"
              value={f.college}
              onChange={(e) => set('college', e.target.value)}
            />
          </Field>
          <Field label="Course" htmlFor="p-course">
            <Input id="p-course" value={f.course} onChange={(e) => set('course', e.target.value)} />
          </Field>
          <Field label="Graduation year" htmlFor="p-grad">
            <Input
              id="p-grad"
              inputMode="numeric"
              maxLength={4}
              value={f.graduationYear}
              onChange={(e) => set('graduationYear', e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
      ) : null}
      {errors.length ? (
        <ul role="alert" className="grid gap-1 text-sm text-danger">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? 'Saving…' : existing ? 'Save changes' : 'Add person'}
      </Button>
    </form>
  );
}
