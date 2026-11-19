import { createPlatformClient, type PlatformClient } from '@flourishive/api-client';
import { createContext, use, type ReactNode } from 'react';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const Ctx = createContext<PlatformClient | null>(null);

export function ApiProvider({ client, children }: { client: PlatformClient; children: ReactNode }) {
  return <Ctx value={client}>{children}</Ctx>;
}

export function useApi(): PlatformClient {
  const c = use(Ctx);
  if (!c) throw new Error('useApi needs an ApiProvider');
  return c;
}

export const makeClient = (onSessionExpired: () => void) =>
  createPlatformClient({ baseUrl: API_URL, onSessionExpired });
