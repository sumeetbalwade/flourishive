import {
  AppShell,
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Skeleton,
  SigningAnimation,
  Stat,
  type SigningState,
} from '@flourishive/ui';
import { FileText, Home, PenLine, Users } from 'lucide-react';
import { useState } from 'react';

const NAV = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'people', label: 'People', icon: Users },
  { id: 'letters', label: 'Letters', icon: FileText },
  { id: 'signing', label: 'Signing', icon: PenLine },
];

const STATES: SigningState[] = ['idle', 'signing', 'waiting', 'done', 'failed'];

// Design-system gallery (Phase 0). Replaced by real screens in Phase 1.
export default function App() {
  const [active, setActive] = useState('home');
  const [state, setState] = useState<SigningState>('signing');
  return (
    <AppShell
      brand={<span className="font-display text-2xl text-accent-hi">F</span>}
      nav={NAV}
      active={active}
      onNavigate={setActive}
      user={{ name: 'Noah Brooks', role: 'HR Lead' }}
      title="Design system"
      actions={<Button size="sm">Add employee</Button>}
    >
      <div className="grid gap-6 xl:grid-cols-3">
        <Stat value="456" label="Days in company" />
        <Stat value="11" label="Letters signed this month" />
        <Card>
          <CardTitle>Statuses</CardTitle>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>Draft</Badge>
            <Badge tone="accent">Awaiting signature</Badge>
            <Badge tone="success">Signed</Badge>
            <Badge tone="warning">Expiring</Badge>
            <Badge tone="danger">Failed</Badge>
            <Badge tone="info">Sent</Badge>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardTitle>Signing animation</CardTitle>
          <div className="mt-4 flex flex-wrap items-center gap-8">
            <SigningAnimation state={state} size={120} />
            <div className="flex flex-wrap gap-2">
              {STATES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === state ? 'primary' : 'secondary'}
                  onClick={() => setState(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </Card>
        <Card>
          <CardTitle>Sign in</CardTitle>
          <form className="mt-4 grid gap-4" onSubmit={(e) => e.preventDefault()}>
            <Field label="Work email" htmlFor="email" hint="Use your company address">
              <Input id="email" type="email" placeholder="you@company.com" />
            </Field>
            <Field label="Password" htmlFor="pw" error="Password is required">
              <Input id="pw" type="password" aria-invalid="true" />
            </Field>
            <Button type="submit">Continue</Button>
          </form>
        </Card>

        <Card className="xl:col-span-2">
          <CardTitle>Loading</CardTitle>
          <div className="mt-4 grid gap-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </Card>
        <EmptyState
          icon={<FileText size={22} />}
          title="No letters yet"
          description="Create your first offer letter from a template."
          action={<Button size="sm">New letter</Button>}
        />
      </div>
    </AppShell>
  );
}
