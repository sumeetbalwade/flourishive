import type { MeResponse } from '@flourishive/schemas';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { go } from '../router.ts';
import { useApi } from './api.tsx';

type State = { status: 'loading' } | { status: 'anon' } | { status: 'authed'; me: MeResponse };

interface AuthValue {
  state: State;
  /** Call after any sign-in step that ends in a session. */
  onSignedIn: () => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
  reloadMe: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [state, setState] = useState<State>({ status: 'loading' });

  const loadMe = useCallback(async () => {
    try {
      setState({ status: 'authed', me: await api.auth.me() });
    } catch {
      setState({ status: 'anon' });
    }
  }, [api]);

  // On page load there is no token in memory; the httpOnly refresh cookie restores the session.
  useEffect(() => {
    let live = true;
    void (async () => {
      const restored = await api.restoreSession();
      if (!live) return;
      if (restored) await loadMe();
      else setState({ status: 'anon' });
    })();
    return () => {
      live = false;
    };
  }, [api, loadMe]);

  const value = useMemo<AuthValue>(
    () => ({
      state,
      onSignedIn: loadMe,
      reloadMe: loadMe,
      signOut: async () => {
        try {
          await api.auth.logout();
        } finally {
          setState({ status: 'anon' });
          go('/login');
        }
      },
      can: (p) => state.status === 'authed' && state.me.permissions.includes(p),
    }),
    [state, api, loadMe],
  );
  return <Ctx value={value}>{children}</Ctx>;
}

export function useAuth(): AuthValue {
  const v = use(Ctx);
  if (!v) throw new Error('useAuth needs an AuthProvider');
  return v;
}
