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

export interface StaffProfile {
  email: string;
  role: { id: string; key: string; name: string } | null;
  permissions: string[];
}
type State = { status: 'loading' } | { status: 'anon' } | ({ status: 'authed' } & StaffProfile);
interface AuthValue {
  state: State;
  onSignedIn: () => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [state, setState] = useState<State>({ status: 'loading' });

  const loadMe = useCallback(async () => {
    try {
      const me = await api.auth.me();
      setState({
        status: 'authed',
        email: me.email,
        role: me.role,
        permissions: me.permissions,
      });
    } catch {
      setState({ status: 'anon' });
    }
  }, [api]);

  // No token in memory after a reload; the httpOnly refresh cookie restores the session.
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
      signOut: async () => {
        try {
          await api.auth.logout();
        } finally {
          setState({ status: 'anon' });
          go('/login');
        }
      },
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

/** Whether the signed-in staff member may do something. Hide what they cannot use; the API refuses it anyway. */
export function useCan() {
  const { state } = useAuth();
  const held = state.status === 'authed' ? state.permissions : [];
  return (...codes: string[]) => codes.some((c) => held.includes(c));
}
