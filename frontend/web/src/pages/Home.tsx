import { Badge, Button, Card, CardTitle, Skeleton, Stat } from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { Building2, ShieldCheck, Upload, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';
import { go } from '../router.ts';
import { Layout } from './Layout.tsx';

const firstName = (email: string) => {
  const local = email.split('@')[0] ?? email;
  const word = local.split(/[._-]/)[0] ?? local;
  return word.charAt(0).toUpperCase() + word.slice(1);
};

/** What to do next, built only from what this person is allowed to do. */
export function Home() {
  const api = useApi();
  const auth = useAuth();
  const me = auth.state.status === 'authed' ? auth.state.me : null;
  const canPeople = auth.can('people.read');
  const people = useQuery({
    queryKey: ['home', 'people'],
    queryFn: () => api.people.list({ pageSize: 1 }),
    enabled: canPeople,
  });
  const interns = useQuery({
    queryKey: ['home', 'interns'],
    queryFn: () => api.people.list({ pageSize: 1, type: 'INTERN', status: 'ACTIVE' }),
    enabled: canPeople,
  });

  const needsTwoStep = !!me && !me.mfaEnabled && me.mfaLevel !== 'OFF';
  const actions: { label: string; hint: string; icon: ReactNode; to: string; needs?: string }[] = [
    {
      label: 'People',
      hint: 'Find someone or update their details',
      icon: <Users size={18} />,
      to: '/app/people',
      needs: 'people.read',
    },
    {
      label: 'Import a spreadsheet',
      hint: 'Add many people at once',
      icon: <Upload size={18} />,
      to: '/app/import',
      needs: 'people.import',
    },
    {
      label: 'Organisation',
      hint: 'Teams, designations and locations',
      icon: <Building2 size={18} />,
      to: '/app/org',
      needs: 'org.read',
    },
    {
      label: 'My security',
      hint: 'Two-step sign-in and recovery codes',
      icon: <ShieldCheck size={18} />,
      to: '/app/security',
    },
  ];

  return (
    <Layout active="home" title={me ? `Welcome, ${firstName(me.email)}` : 'Welcome'}>
      <div className="grid max-w-5xl gap-6">
        {needsTwoStep && (
          <Card className="flex flex-wrap items-center gap-4 border-warning/40">
            <div className="min-w-0 flex-1">
              <CardTitle>
                Set up two-step sign-in{' '}
                {me?.mfaRequired && <Badge tone="danger">Required for your role</Badge>}
              </CardTitle>
              <p className="mt-1 text-sm text-muted">
                It takes a minute and keeps your account safe if your password leaks.
              </p>
            </div>
            <Button onClick={() => go('/app/security')}>Set it up</Button>
          </Card>
        )}

        {canPeople && (
          <div className="grid gap-4 sm:grid-cols-3">
            {people.isPending || interns.isPending ? (
              <>
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </>
            ) : (
              <>
                <Stat value={String(people.data?.total ?? '–')} label="People on record" />
                <Stat value={String(interns.data?.total ?? '–')} label="Active interns" />
                <Stat value={me?.mfaEnabled ? 'On' : 'Off'} label="Your two-step sign-in" />
              </>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {actions
            .filter((a) => !a.needs || auth.can(a.needs))
            .map((a) => (
              <button
                key={a.to}
                type="button"
                onClick={() => go(a.to)}
                className="flex items-center gap-4 rounded-card border border-line bg-surface p-5 text-left transition-colors hover:border-accent"
              >
                <span className="grid h-10 w-10 place-items-center rounded-pill bg-accent-lo text-accent-hi">
                  {a.icon}
                </span>
                <span>
                  <span className="block font-medium">{a.label}</span>
                  <span className="block text-sm text-muted">{a.hint}</span>
                </span>
              </button>
            ))}
        </div>
      </div>
    </Layout>
  );
}
