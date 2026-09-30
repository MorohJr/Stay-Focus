import { useEffect, useState } from 'react';

/** Hash routing (`#/task/abc`) so GitHub Pages needs no 404 fallback (SPEC 6.3). */

function current(): string[] {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h.split('?')[0]!.split('/').filter(Boolean).map(decodeURIComponent);
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const on = () => {
      setRoute(current());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string): void {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash !== target) window.location.hash = target;
}

/** Replaces the current entry (tabs), so Back leaves the screen instead of cycling tabs. */
export function replace(path: string): void {
  const url = `${window.location.pathname}${window.location.search}#${path.startsWith('/') ? path : `/${path}`}`;
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function back(fallback = '/'): void {
  if (window.history.length > 1) window.history.back();
  else go(fallback);
}
