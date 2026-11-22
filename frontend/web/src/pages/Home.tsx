import { Badge, Button, Card, Skeleton } from '@flourishive/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Building2, ShieldCheck, ShieldAlert, Upload, Users } from 'lucide-react';
import { motion } from 'motion/react';
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

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const list = { show: { transition: { staggerChildren: 0.07 } } };
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

function Metric({
  value,
  label,
  icon,
  hint,
}: {
  value: string;
  label: string;
  icon: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card className="group p-6 transition-[transform,box-shadow] duration-[var(--dur-base)] hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-start justify-between">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-lo text-accent-hi">
          {icon}
        </span>
        {hint}
      </div>
      <div className="mt-6 font-display text-6xl font-light leading-none tracking-tight">
        {value}
      </div>
      <div className="mt-2 text-sm text-muted">{label}</div>
    </Card>
  );
}

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
      icon: <Users size={20} />,
      to: '/app/people',
      needs: 'people.read',
    },
    {
      label: 'Import a spreadsheet',
      hint: 'Add many people at once',
      icon: <Upload size={20} />,
      to: '/app/import',
      needs: 'people.import',
    },
    {
      label: 'Organisation',
      hint: 'Teams, designations and locations',
      icon: <Building2 size={20} />,
      to: '/app/org',
      needs: 'org.read',
    },
    {
      label: 'My security',
      hint: 'Two-step sign-in and recovery codes',
      icon: <ShieldCheck size={20} />,
      to: '/app/security',
    },
  ];

  const loading = people.isPending || interns.isPending;

  return (
    <Layout active="home" title={me ? `Welcome, ${firstName(me.email)}` : 'Welcome'}>
      <motion.div variants={list} initial="hidden" animate="show" className="grid max-w-6xl gap-6">
        <motion.p variants={item} className="-mb-3 text-sm text-muted">
          {greeting()}. Here is where things stand today.
        </motion.p>
        {needsTwoStep && (
          <motion.div variants={item}>
            <Card className="flex flex-wrap items-center gap-4 border-warning/40 bg-warning-lo">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-warning/20 text-warning">
                <ShieldAlert size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-medium">
                  Set up two-step sign-in{' '}
                  {me?.mfaRequired && <Badge tone="danger">Required for your role</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-muted">
                  It takes a minute and keeps your account safe if your password leaks.
                </p>
              </div>
              <Button onClick={() => go('/app/security')}>Set it up</Button>
            </Card>
          </motion.div>
        )}

        <div className="grid gap-5 lg:grid-cols-3">
          {canPeople &&
            (loading ? (
              <>
                <Skeleton className="h-52 rounded-card" />
                <Skeleton className="h-52 rounded-card" />
              </>
            ) : (
              <>
                <motion.div variants={item}>
                  <Metric
                    value={String(people.data?.total ?? '–')}
                    label="People on record"
                    icon={<Users size={20} />}
                  />
                </motion.div>
                <motion.div variants={item}>
                  <Metric
                    value={String(interns.data?.total ?? '–')}
                    label="Active interns"
                    icon={<Users size={20} />}
                    hint={
                      <Badge tone="success" dot>
                        Active
                      </Badge>
                    }
                  />
                </motion.div>
              </>
            ))}
          <motion.div variants={item} className={canPeople ? '' : 'lg:col-span-3'}>
            <Card tone="deep" className="flex h-full flex-col justify-between p-6">
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15">
                  <ShieldCheck size={20} />
                </span>
                <span className="rounded-pill bg-white/15 px-3 py-1 text-xs">Two-step sign-in</span>
              </div>
              <div>
                <div className="mt-6 font-display text-6xl font-light leading-none tracking-tight">
                  {me?.mfaEnabled ? 'On' : 'Off'}
                </div>
                <div className="mt-2 text-sm text-on-deep/70">
                  {me?.mfaEnabled
                    ? 'Your account is protected.'
                    : 'Add a second step to stay safe.'}
                </div>
              </div>
              {!me?.mfaEnabled && (
                <Button
                  size="sm"
                  className="mt-4 self-start bg-white text-deep hover:bg-white/90"
                  onClick={() => go('/app/security')}
                >
                  Set it up
                </Button>
              )}
            </Card>
          </motion.div>
        </div>

        <motion.h2 variants={item} className="mt-2 font-display text-xl font-medium">
          Jump to
        </motion.h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {actions
            .filter((a) => !a.needs || auth.can(a.needs))
            .map((a) => (
              <motion.button
                key={a.to}
                variants={item}
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={() => go(a.to)}
                className="group flex items-center gap-4 rounded-card border border-line bg-surface p-5 text-left shadow-card transition-[transform,box-shadow,border-color] duration-[var(--dur-base)] hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-pop"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-lo text-accent-hi transition-colors group-hover:bg-accent group-hover:text-on-accent">
                  {a.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg font-medium">{a.label}</span>
                  <span className="block text-sm text-muted">{a.hint}</span>
                </span>
                <ArrowUpRight
                  size={20}
                  className="text-faint transition-[transform,color] duration-[var(--dur-base)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent"
                />
              </motion.button>
            ))}
        </div>
      </motion.div>
    </Layout>
  );
}
