import { brand } from '@flourishive/ui';
import { createApiClient, type ApiClient } from '@flourishive/api-client';
import { createContext, use, type ReactNode } from 'react';

const Ctx = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <Ctx value={client}>{children}</Ctx>;
}

export function useApi(): ApiClient {
  const c = use(Ctx);
  if (!c) throw new Error('useApi needs an ApiProvider');
  return c;
}

export function makeClient(
  onSessionExpired: () => void,
  onStepUp?: () => Promise<boolean>,
  onPlanLimit?: (message: string) => void,
): ApiClient {
  return createApiClient({ baseUrl: brand.apiUrl, onSessionExpired, onStepUp, onPlanLimit });
}

/** Remembers non-secret preferences (company code). Storage can be blocked, so never rely on it. */
export const remember = {
  get(key: string): string {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private window or blocked storage: the field is just empty next time
    }
  },
};
