import { dayOfWeek, hhmmOf, lastDayOfMonth, minutesOf, parseISODate } from './dates';
import type { CalEvent, EventRepeat } from './schemas';

/** Events (SPEC 3.17). Occurrences are computed, never stored. */

export const EVENT_DEFAULT_MIN = 60;

export const REPEAT_LABEL: Record<EventRepeat, string> = { none: 'פעם אחת', weekly: 'כל שבוע', monthly: 'כל חודש', yearly: 'כל שנה' };

/** R-EVT-1: does the event fall on this date? */
export function eventOccursOn(e: Pick<CalEvent, 'date' | 'repeat'>, date: string): boolean {
  if (date < e.date) return false;
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
