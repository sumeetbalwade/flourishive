import { brand } from '@flourishive/ui';
import { createPlatformClient, type PlatformClient } from '@flourishive/api-client';
import { createContext, use, type ReactNode } from 'react';

const Ctx = createContext<PlatformClient | null>(null);

export function ApiProvider({ client, children }: { client: PlatformClient; children: ReactNode }) {
  return <Ctx value={client}>{children}</Ctx>;
}

export function useApi(): PlatformClient {
  const c = use(Ctx);
  if (!c) throw new Error('useApi needs an ApiProvider');
  return c;
}

export const makeClient = (onSessionExpired: () => void, onStepUp?: () => Promise<boolean>) =>
  createPlatformClient({ baseUrl: brand.apiUrl, onSessionExpired, onStepUp });
