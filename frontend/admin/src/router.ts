import { useEffect, useState } from 'react';

/** Tiny hash router for the prototypes. The real app uses TanStack Router (D-06). */
export function useRoute() {
  const read = () => location.hash.replace(/^#/, '') || '/login';
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
