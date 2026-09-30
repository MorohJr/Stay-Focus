import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { nowMinutes, todayISO } from '../domain/dates';

/** Live data from IndexedDB; re-renders when the tables change. */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[] = []): T | undefined {
  return useLiveQuery(fn, deps);
}

export interface Clock {
  now: Date;
  today: string;
  nowMin: number;
}

/** Ticks every 20 seconds; the Today screen follows the time of day (R-TOD-11). */
export function useClock(): Clock {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20_000);
    const vis = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  return { now, today: todayISO(now), nowMin: nowMinutes(now) };
}
