import {
  SecurityExtras,
  PasskeysCard,
  Card,
  CardTitle,
  Badge,
  Skeleton,
  useToast,
} from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../lib/api.tsx';
import { useAuth } from '../lib/auth.tsx';
import { messageOf } from '../lib/errors.ts';
import { makePasskey, passkeysSupported } from '../lib/passkeys.ts';
import { Layout } from './Layout.tsx';

/** My security for platform staff: remembered devices and turning two-step off where the policy allows. */
export function Security() {
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['staff-security'], queryFn: () => api.auth.security() });
  const me = auth.state.status === 'authed' ? auth.state : null;
  return (
    <Layout active="security" title="My security">
      <div className="grid max-w-3xl gap-5">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Two-step sign-in</CardTitle>
              <p className="mt-2 text-sm text-muted">
                {me?.email} · role {me?.role?.name ?? 'Staff'}
              </p>
            </div>
            <Badge tone={info.data?.mfaEnabled ? 'success' : 'neutral'}>
              {info.data?.mfaEnabled ? 'On' : 'Off'}
            </Badge>
          </div>
        </Card>
        {info.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : info.data ? (
          <>
            <PasskeysCard
              passkeys={info.data.passkeys ?? []}
              supported={passkeysSupported()}
              onAdd={async () => {
                const options = await api.auth.passkeyRegisterOptions();
                const response = await makePasskey(options);
                await api.auth.passkeyRegister(response);
                toast({ title: 'Passkey added', tone: 'success' });
                await qc.invalidateQueries({ queryKey: ['staff-security'] });
              }}
              onRemove={async (id) => {
                try {
                  await api.auth.passkeyRemove(id);
                  await qc.invalidateQueries({ queryKey: ['staff-security'] });
                } catch (e) {
                  toast({ title: messageOf(e), tone: 'danger' });
                }
              }}
            />
            <SecurityExtras
              info={info.data}
              onRevoke={async (id) => {
                try {
                  await api.auth.revokeDevice(id);
                  await qc.invalidateQueries({ queryKey: ['staff-security'] });
                } catch (e) {
                  toast({ title: messageOf(e), tone: 'danger' });
                }
              }}
              onDisable={async (password) => {
                try {
                  await api.auth.mfaDisable(password);
                } catch (e) {
                  throw new Error(messageOf(e));
                }
                toast({ title: 'Two-step is off', tone: 'success' });
                await qc.invalidateQueries({ queryKey: ['staff-security'] });
              }}
            />
          </>
        ) : null}
      </div>
    </Layout>
  );
}
