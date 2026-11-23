import { StepUpDialog } from '@flourishive/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { messageOf } from './errors.ts';
import { useApi } from './api.tsx';

type Waiter = { resolve: (ok: boolean) => void };
let ask: (() => Promise<boolean>) | null = null;

/** Called by the API client when a sensitive call needs a fresh confirmation. Opens the dialog. */
export const requestStepUp = (): Promise<boolean> => (ask ? ask() : Promise.resolve(false));

/** Renders the "Confirm it is you" dialog whenever a call needs it, then lets the call retry. */
export function StepUpHost({ children }: { children: ReactNode }) {
  const api = useApi();
  const [waiter, setWaiter] = useState<Waiter | null>(null);
  useEffect(() => {
    ask = () =>
      new Promise<boolean>((resolve) => {
        setWaiter((w) => {
          w?.resolve(false);
          return { resolve };
        });
      });
    return () => {
      ask = null;
    };
  }, []);
  const close = (ok: boolean) => {
    waiter?.resolve(ok);
    setWaiter(null);
  };
  return (
    <>
      {children}
      <StepUpDialog
        open={waiter !== null}
        onCancel={() => close(false)}
        onConfirm={async (input) => {
          try {
            await api.auth.stepUp(input);
          } catch (e) {
            throw new Error(messageOf(e));
          }
          close(true);
        }}
      />
    </>
  );
}
