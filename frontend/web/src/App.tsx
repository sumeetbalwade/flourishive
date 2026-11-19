import {
  AppShell,
  Avatar,
  Badge,
  BarChart,
  DatePicker,
  Dialog,
  DialogContent,
  DialogTrigger,
  LineChart,
  Select,
  SheetContent,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToastProvider,
  TR,
  useToast,
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((m, i) => ({
  m,
  signed: [4, 9, 6, 12, 8, 14][i],
  sent: [6, 11, 9, 15, 12, 18][i],
}));

function Toaster() {
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() =>
        toast({
          tone: 'success',
          title: 'Letter signed',
          description: 'Offer letter for Riya Patil',
        })
      }
    >
      Show toast
    </Button>
  );
}

// Design-system gallery (Phase 0). Replaced by real screens in Phase 1.
export default function App() {
  const [active, setActive] = useState('home');
  const [state, setState] = useState<SigningState>('signing');
  const [date, setDate] = useState<Date>();
  const [dept, setDept] = useState<string>();
  return (
    <ToastProvider>
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

          <Card className="xl:col-span-2">
            <CardTitle>Letters signed</CardTitle>
            <div className="mt-4">
              <Tabs defaultValue="bar">
                <TabsList>
                  <TabsTrigger value="bar">Bars</TabsTrigger>
                  <TabsTrigger value="line">Lines</TabsTrigger>
                </TabsList>
                <TabsContent value="bar" className="mt-4">
                  <BarChart data={MONTHS} x="m" series={['sent', 'signed']} />
                </TabsContent>
                <TabsContent value="line" className="mt-4">
                  <LineChart data={MONTHS} x="m" series={['sent', 'signed']} />
                </TabsContent>
              </Tabs>
            </div>
          </Card>
          <Card>
            <CardTitle>Inputs and overlays</CardTitle>
            <div className="mt-4 grid gap-4">
              <Field label="Department" htmlFor="dept">
                <Select
                  id="dept"
                  value={dept}
                  onValueChange={setDept}
                  options={[
                    { value: 'hr', label: 'Human Resources' },
                    { value: 'eng', label: 'Engineering' },
                    { value: 'ops', label: 'Operations' },
                  ]}
                />
              </Field>
              <Field label="Joining date" htmlFor="doj">
                <DatePicker id="doj" value={date} onChange={setDate} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="secondary">
                      Dialog
                    </Button>
                  </DialogTrigger>
                  <DialogContent
                    title="Send for signature?"
                    description="The candidate gets an email with an OTP link."
                  >
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost">Cancel</Button>
                      <Button>Send</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="secondary">
                      Sheet
                    </Button>
                  </DialogTrigger>
                  <SheetContent title="Riya Patil" description="Intern, Engineering" />
                </Dialog>
                <Toaster />
              </div>
            </div>
          </Card>
          <div className="xl:col-span-3">
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Letter</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {[
                  ['Riya Patil', 'Offer letter', 'success', 'Signed'],
                  ['Arjun Rao', 'Internship certificate', 'accent', 'Awaiting signature'],
                  ['Meera Kulkarni', 'Experience letter', 'danger', 'Failed'],
                ].map(([n, l, tone, st]) => (
                  <TR key={n}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Avatar name={n!} />
                        {n}
                      </div>
                    </TD>
                    <TD className="text-muted">{l}</TD>
                    <TD>
                      <Badge tone={tone as 'success'}>{st}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </div>
      </AppShell>
    </ToastProvider>
  );
}
