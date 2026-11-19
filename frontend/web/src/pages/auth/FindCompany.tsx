import { Button, Card, Field, Input } from '@flourishive/ui';
import { useState } from 'react';
import { Frame } from '../../components/Frame.tsx';
import { useApi } from '../../lib/api.tsx';
import { messageOf } from '../../lib/errors.ts';
import { go } from '../../router.ts';

/** "Which company am I in?" The answer is emailed, so this page cannot be used to find out who has an account. */
export function FindCompany() {
  const api = useApi();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (sent)
    return (
      <Frame>
        <Card className="p-8">
          <h1 className="font-display text-3xl">Check your email</h1>
          <p className="mt-3 text-sm text-muted">
            If that address belongs to a company, we have sent its sign-in link.
          </p>
          <Button className="mt-6 w-full" size="lg" variant="secondary" onClick={() => go('/login')}>
            Back to sign in
          </Button>
        </Card>
      </Frame>
    );

  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Find your company</h1>
        <p className="mt-2 text-sm text-muted">
          Enter your work email. We will email you the address where you sign in.
        </p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
            if (!email) return setError('Enter your work email.');
            setBusy(true);
            setError('');
            try {
              await api.company.find(email);
              setSent(true);
            } catch (err) {
              setError(messageOf(err));
              setBusy(false);
            }
          }}
        >
          <Field label="Work email" htmlFor="fc-email" error={error}>
            <Input id="fc-email" name="email" type="email" autoComplete="username" placeholder="you@company.com" />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Sending…' : 'Email me the link'}
          </Button>
          <a href="#/login" className="text-center text-sm text-muted underline">
            Back to sign in
          </a>
        </form>
      </Card>
    </Frame>
  );
}
