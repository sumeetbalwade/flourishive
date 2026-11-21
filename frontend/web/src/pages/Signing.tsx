import {
  Badge,
  Button,
  Card,
  CardTitle,
  SigningAnimation,
  brand,
  type SigningState,
  useToast,
} from '@flourishive/ui';
import { MonitorSmartphone } from 'lucide-react';
import { useState } from 'react';
import { LETTERS } from '../mock.ts';
import { Layout } from './Layout.tsx';

export function Signing() {
  const toast = useToast();
  const queue = LETTERS.filter(
    (l) => l.status === 'awaiting' || l.status === 'draft' || l.status === 'failed',
  );
  const [states, setStates] = useState<Record<string, SigningState>>(
    Object.fromEntries(queue.map((l) => [l.id, l.status === 'failed' ? 'failed' : 'idle'])),
  );
  const [running, setRunning] = useState(false);

  // Prototype only: steps through each letter. The real UI follows desktop-reported state.
  async function signAll() {
    setRunning(true);
    for (const l of queue) {
      setStates((s) => ({ ...s, [l.id]: 'signing' }));
      await new Promise((r) => setTimeout(r, 1400));
      setStates((s) => ({ ...s, [l.id]: 'done' }));
    }
    setRunning(false);
    toast({
      tone: 'success',
      title: `${queue.length} letters signed`,
      description: 'Timestamps added and candidates emailed.',
    });
  }

  return (
    <Layout
      active="signing"
      title="Signing queue"
      actions={
        <Button size="sm" onClick={signAll} disabled={running}>
          {running ? 'Signing…' : `Sign ${queue.length} letters`}
        </Button>
      }
    >
      <Card className="mb-5 flex items-center gap-4 p-5">
        <MonitorSmartphone className="text-accent" />
        <div className="text-sm">
          <div className="font-medium">{brand.appName} Desktop connected</div>
          <div className="text-muted">
            mToken CryptoID detected. You will be asked for the token PIN once per batch.
          </div>
        </div>
        <Badge tone="success" className="ml-auto">
          Online
        </Badge>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {queue.map((l) => (
          <Card key={l.id} className="flex items-center gap-5 p-5">
            <SigningAnimation state={states[l.id]!} size={64} />
            <div className="min-w-0">
              <CardTitle className="truncate">{l.person}</CardTitle>
              <div className="truncate text-sm text-muted">{l.type}</div>
              <div className="mt-1 font-mono text-xs text-faint">{l.ref}</div>
            </div>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
