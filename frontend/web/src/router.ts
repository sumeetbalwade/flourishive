import { useEffect, useState } from 'react';

/** Tiny hash router (static hosting on cPanel needs no rewrite rules). Routes look like #/app/people?q=asha. */
export interface Route {
  path: string;
  query: URLSearchParams;
}

function read(): Route {
  const raw = location.hash.replace(/^#/, '') || '/login';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/login', query: new URLSearchParams(qs) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (to: string) => {
  location.hash = to;
};

/** Replaces the query string without adding a history entry (filters, paging). */
export function setQuery(path: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  history.replaceState(null, '', `#${path}${s ? `?${s}` : ''}`);
  dispatchEvent(new HashChangeEvent('hashchange'));
}
