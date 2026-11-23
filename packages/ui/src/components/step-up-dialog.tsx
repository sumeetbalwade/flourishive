import { useState } from 'react';
import { Button } from './button.tsx';
import { Dialog, DialogContent } from './dialog.tsx';
import { Field, Input } from './input.tsx';

/**
 * Asks the person to confirm it is them before a sensitive action. One box takes either the
 * six-digit authenticator code or, for people without two-step, the password.
 */
export function StepUpDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  /** Resolve when confirmed; throw (with a readable message) when the code or password was wrong. */
  onConfirm: (input: { code?: string; password?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(/^\d{6}$/.test(value.trim()) ? { code: value.trim() } : { password: value });
      setValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not match. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setValue('');
          setError(null);
          onCancel();
        }
      }}
    >
      <DialogContent
        title="Confirm it is you"
        description="This change is sensitive. Enter your authenticator code (or your password if you do not use two-step)."
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Code or password" htmlFor="step-up" error={error ?? undefined}>
            <Input
              id="step-up"
              type="password"
              autoComplete="one-time-code"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={busy || value === ''}>
              Confirm
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
