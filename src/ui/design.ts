import { useSyncExternalStore } from 'react';

/**
 * R-UI-7: the look is a per-device choice, kept in localStorage (not in the DB and not in backups).
 * "glass" (1.11) is the default; "classic" is exactly the 1.10 look. The choice is a class on <html>,
 * and every glass rule in glass.css is scoped under it, so classic never sees them.
 */
export type Design = 'glass' | 'classic';

const KEY = 'sf-design';
const THEME: Record<Design, string> = { glass: '#efeadb', classic: '#ffffff' };

function read(): Design {
  try {
    return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'glass';
  } catch {
    return 'glass';
  }
}

let current: Design = read();
const subs = new Set<() => void>();

function apply(): void {
  document.documentElement.classList.toggle('gl', current === 'glass');
  document.querySelector('meta[name="theme-color"][media*="light"]')?.setAttribute('content', THEME[current]);
}

/** Called once before the first render, so the first paint already has the right look. */
export function initDesign(): void {
  apply();
}

export function setDesign(d: Design): void {
  current = d;
  try {
    localStorage.setItem(KEY, d);
  } catch {
    // private mode: the choice lasts for this visit only
  }
  apply();
  subs.forEach((f) => f());
}

export function useDesign(): Design {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}

export const useGlass = (): boolean => useDesign() === 'glass';

/** R-UI-10: no motion when the system asks for less of it. */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** R-DSK-1 / R-DSK-3: the desktop layout (same breakpoint as the CSS). */
const WIDE = '(min-width: 1024px)';
export function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(WIDE);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => typeof matchMedia === 'function' && matchMedia(WIDE).matches,
  );
}
