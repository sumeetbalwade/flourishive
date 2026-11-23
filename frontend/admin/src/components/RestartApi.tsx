import { Button, Dialog, DialogClose, DialogContent, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Restart button with a confirmation. Waits until the API is back, then says so. */
export function RestartApi({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['system'], queryFn: () => api.system.info() });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canRestart = info.data?.canRestart ?? false;

  async function restart() {
    const before = info.data?.startedAt;
    setBusy(true);
    try {
      await api.system.restart(); // asks the person to confirm it is them first
      setOpen(false);
      toast({ title: 'Restarting the API…', tone: 'info' });
      // The API is down for a few seconds; wait until it answers with a new start time.
      for (let i = 0; i < 30; i++) {
        await wait(2000);
        try {
          const now = await api.system.info();
          if (now.startedAt !== before) {
            toast({ title: 'The API is back', tone: 'success' });
            await qc.invalidateQueries();
            return;
          }
        } catch {
          // still down
        }
      }
      toast({ title: 'The API has not answered yet. Check the server.', tone: 'danger' });
    } catch (e) {
      toast({ title: messageOf(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant="secondary"
        disabled={!canRestart || busy}
        loading={busy}
        title={canRestart ? undefined : 'Only available on the server'}
        onClick={() => setOpen(true)}
      >
        <RotateCw size={15} /> Restart API
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Restart the API?"
          description="It is unavailable for a few seconds. Anyone in the middle of a request may need to try again. Saved settings that need a restart are picked up."
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button loading={busy} disabled={busy} onClick={() => void restart()}>
              Restart now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
