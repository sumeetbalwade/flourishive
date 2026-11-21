import { Button, Card, Field, Input, brand } from '@flourishive/ui';
import { useState } from 'react';
import { go } from '../router.ts';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="font-display text-4xl text-accent-hi">{brand.appName}</div>
          <p className="mt-1 text-sm text-muted">{brand.tagline}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const [error, setError] = useState('');
  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Sign in</h1>
        <form
          className="mt-6 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            if (!d.get('email') || !d.get('password'))
              return setError('Enter your email and password.');
            setError('');
            go('/mfa');
          }}
        >
          <Field label="Work email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@flourisense.com"
            />
          </Field>
          <Field label="Password" htmlFor="password" error={error}>
            <Input id="password" name="password" type="password" autoComplete="current-password" />
          </Field>
          <Button type="submit" size="lg">
            Continue
          </Button>
          <div className="flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <Button type="button" variant="secondary" size="lg" onClick={() => go('/mfa')}>
            Sign in with Google
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-center text-xs text-faint">
        <a href="#/design" className="underline">
          Design system
        </a>{' '}
        ·{' '}
        <a href="#/desktop" className="underline">
          Desktop app
        </a>
      </p>
    </Frame>
  );
}

export function Mfa() {
  const [code, setCode] = useState('');
  return (
    <Frame>
      <Card className="p-8">
        <h1 className="font-display text-3xl">Two-step check</h1>
        <p className="mt-2 text-sm text-muted">
          Enter the 6-digit code from your authenticator app.
        </p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) go('/app/letters');
          }}
        >
          <Field
            label="Authentication code"
            htmlFor="otp"
            hint="Lost your phone? Use a recovery code."
          >
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center font-mono text-xl tracking-[0.5em]"
              placeholder="000000"
            />
          </Field>
          <Button type="submit" size="lg" disabled={code.length !== 6}>
            Verify
          </Button>
        </form>
      </Card>
    </Frame>
  );
}
