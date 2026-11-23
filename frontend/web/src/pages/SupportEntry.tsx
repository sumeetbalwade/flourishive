import { PageLoader } from '@flourishive/ui';
import { useEffect } from 'react';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';
import { go } from '../router.ts';

/**
 * Where "Open as support" lands. The short-lived token arrives in the address fragment (never sent to
 * a server), is kept in memory only, and is removed from the address bar straight away. A reload ends it.
 */
export function SupportEntry({ token }: { token: string }) {
  const api = useApi();
  const auth = useAuth();
  useEffect(() => {
    if (!token) {
      go('/login');
      return;
    }
    api.http.setAccessToken(token);
    void auth.onSignedIn().then(() => go('/app/home'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return <PageLoader fullscreen />;
}
