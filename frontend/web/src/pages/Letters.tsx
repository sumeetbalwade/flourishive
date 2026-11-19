import { Avatar, Badge, Select, Input, Table, TBody, TD, TH, THead, TR } from '@flourishive/ui';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { LETTERS, STATUS } from '../mock.ts';
import { go } from '../router.ts';
import { Layout } from './Layout.tsx';

export function Letters() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const rows = LETTERS.filter(
    (l) =>
      (status === 'all' || l.status === status) &&
      (l.person + l.type).toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Layout active="letters" title="Letters">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint"
          />
          <Input
            aria-label="Search letters"
            className="pl-11"
            placeholder="Search name or letter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select
            value={status}
            onValueChange={setStatus}
            options={[
              { value: 'all', label: 'All statuses' },
              ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
            ]}
          />
        </div>
      </div>
      <Table compact>
        <THead>
          <TR>
            <TH>Person</TH>
            <TH>Letter</TH>
            <TH>Reference</TH>
            <TH>Status</TH>
            <TH>Updated</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((l) => (
            <TR key={l.id} className="cursor-pointer" onClick={() => go(`/app/letters/${l.id}`)}>
              <TD>
                <div className="flex items-center gap-3">
                  <Avatar name={l.person} />
                  <div>
                    <div className="font-medium">{l.person}</div>
                    <div className="text-xs text-muted">{l.role}</div>
                  </div>
                </div>
              </TD>
              <TD>{l.type}</TD>
              <TD className="font-mono text-xs text-muted">{l.ref}</TD>
              <TD>
                <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
              </TD>
              <TD className="text-muted">{l.updated}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {rows.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted">No letters match.</p>
      ) : null}
    </Layout>
  );
}
