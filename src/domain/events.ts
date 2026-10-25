import { addDays, dayOfWeek, hhmmOf, lastDayOfMonth, minutesOf, parseISODate } from './dates';
import type { CalEvent, EventRepeat } from './schemas';

/** Events (SPEC 3.17). Occurrences are computed, never stored. */

export const EVENT_DEFAULT_MIN = 60;

export const REPEAT_LABEL: Record<EventRepeat, string> = { none: 'פעם אחת', weekly: 'כל שבוע', monthly: 'כל חודש', yearly: 'כל שנה' };

/** R-EVT-1: does the event fall on this date? */
export function eventOccursOn(e: Pick<CalEvent, 'date' | 'repeat'> & { skipDates?: string[] }, date: string): boolean {
  if (date < e.date || e.skipDates?.includes(date)) return false;
  if (date === e.date) return true;
  const a = parseISODate(e.date);
  const d = parseISODate(date);
  switch (e.repeat) {
    case 'none':
      return false;
    case 'weekly':
      return dayOfWeek(date) === dayOfWeek(e.date);
    case 'monthly':
      return d.getDate() === Math.min(a.getDate(), lastDayOfMonth(d.getFullYear(), d.getMonth() + 1));
    case 'yearly':
      return d.getMonth() === a.getMonth() && d.getDate() === Math.min(a.getDate(), lastDayOfMonth(d.getFullYear(), a.getMonth() + 1));
  }
}

/** R-EVT-3: start/end minutes of a timed event (end after start; default one hour). */
export function eventSpan(e: Pick<CalEvent, 'allDay' | 'startTime' | 'endTime'>): { start: number; end: number } | undefined {
  if (e.allDay || !e.startTime) return undefined;
  const start = minutesOf(e.startTime);
  const end = e.endTime ? minutesOf(e.endTime) : 0;
  return { start, end: end > start ? end : start + EVENT_DEFAULT_MIN };
}

export interface Occurrence {
  event: CalEvent;
  date: string;
  /** undefined = all day */
  start?: number;
  end?: number;
}

/** R-TOD-12: the events of a date, all-day first, then by start time. */
export function eventsOn(events: CalEvent[], date: string): Occurrence[] {
  return events
    .filter((e) => eventOccursOn(e, date))
    .map((event) => ({ event, date, ...eventSpan(event) }))
    .sort((a, b) => (a.start ?? -1) - (b.start ?? -1) || a.event.title.localeCompare(b.event.title));
}

/** "10:00–11:30" or "כל היום" */
export function occurrenceTime(o: Pick<Occurrence, 'start' | 'end'>): string {
  return o.start === undefined ? 'כל היום' : `${hhmmOf(o.start)}–${hhmmOf(o.end!)}`;
}

/** R-EVT-6: the next occurrence on or after `from` (within a year and a bit), if any. */
export function nextOccurrence(e: CalEvent, from: string): string | undefined {
  for (let d = from < e.date ? e.date : from, i = 0; i < 400; d = addDays(d, 1), i++) if (eventOccursOn(e, d)) return d;
  return undefined;
}

/** R-EVT-6: the last occurrence before `before` (within a year and a bit), if any. */
export function lastOccurrence(e: CalEvent, before: string): string | undefined {
  for (let d = addDays(before, -1), i = 0; i < 400 && d >= e.date; d = addDays(d, -1), i++) if (eventOccursOn(e, d)) return d;
  return undefined;
}

/** R-EVT-6: a project's or person's events: upcoming first (by next date), then the last 5 past ones. */
export function eventsTimeline(events: CalEvent[], today: string): { upcoming: Occurrence[]; past: Occurrence[] } {
  const at = (event: CalEvent, date: string): Occurrence => ({ event, date, ...eventSpan(event) });
  const upcoming: Occurrence[] = [];
  const past: Occurrence[] = [];
  for (const e of events) {
    const next = nextOccurrence(e, today);
    if (next) upcoming.push(at(e, next));
    const last = lastOccurrence(e, today);
    if (last) past.push(at(e, last));
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? -1) - (b.start ?? -1));
  past.sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, past: past.slice(0, 5) };
}
