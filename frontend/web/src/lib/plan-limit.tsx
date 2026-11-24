import { Button, Dialog, DialogClose, DialogContent } from '@flourishive/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { go } from '../router.ts';

let show: ((message: string) => void) | null = null;

/** Called by the API client when a plan limit is reached. Opens the upgrade prompt. */
export const announcePlanLimit = (message: string): void => show?.(message);

/** Shows "Plan limit reached" with a way to see the plan, wherever in the app the limit was hit. */
export function PlanLimitHost({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    show = setMessage;
    return () => {
      show = null;
    };
  }, []);
  return (
    <>
      {children}
      <Dialog open={message !== null} onOpenChange={(o) => !o && setMessage(null)}>
        <DialogContent title="Plan limit reached" description={message ?? ''}>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Not now</Button>
            </DialogClose>
            <Button
              onClick={() => {
                setMessage(null);
                go('/app/plan');
              }}
            >
              See your plan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
