import { Button } from '@flourishive/ui';

/** Shown once after MFA is switched on. The codes are never retrievable again. */
export function RecoveryCodes({
  codes,
  onDone,
  doneLabel = 'I have saved them',
}: {
  codes: string[];
  onDone: () => void;
  doneLabel?: string;
}) {
  const text = codes.join('\n');
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        Keep these recovery codes somewhere safe. Each works once if you lose your phone.{' '}
        <strong className="text-fg">They will not be shown again.</strong>
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-card border border-line bg-surface-2 p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void navigator.clipboard?.writeText(text)}
        >
          Copy
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(
              new Blob([`Flourishive recovery codes\n\n${text}\n`], { type: 'text/plain' }),
            );
            a.download = 'flourishive-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Download
        </Button>
      </div>
      <Button type="button" size="lg" onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}
