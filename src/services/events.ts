import { db } from '../db/db';
import type { CalEvent, Task, WorkSettings } from '../domain/schemas';
import { nowIso, stamps, updateSettings } from './entity';
import { updateTask } from './tasks';

/** Events (SPEC 3.17) and work hours (3.18). */

export type EventInput = Partial<CalEvent> & Pick<CalEvent, 'title' | 'date'>;

export async function saveEvent({ id, ...input }: EventInput): Promise<CalEvent> {
  const existing = id ? await db.events.get(id) : undefined;
  const e: CalEvent = existing
    ? { ...existing, ...input, updatedAt: nowIso() }
    : { ...stamps(), allDay: false, location: '', body: '', repeat: 'none', ...input };
  // R-EVT-3: an all-day event has no hours.
  if (e.allDay) Object.assign(e, { startTime: undefined, endTime: undefined });
  await db.events.put(e);
  return e;
}

export async function deleteEvent(id: string): Promise<CalEvent | undefined> {
  const e = await db.events.get(id);
  await db.events.delete(id);
  return e;
}

export async function restoreEvent(e: CalEvent): Promise<void> {
  await db.events.put(e);
}

/** R-WEK-5: put a task on a date and time. Returns the old values for "undo". */
export async function scheduleTask(id: string, date: string, startTime: string, durationMin: number): Promise<Pick<Task, 'dueDate' | 'startTime' | 'durationMin'> | undefined> {
  const t = await db.tasks.get(id);
  if (!t) return undefined;
  const before = { dueDate: t.dueDate, startTime: t.startTime, durationMin: t.durationMin };
  await updateTask(id, { dueDate: date, startTime, durationMin });
  return before;
}

export async function unschedule(id: string, before: Pick<Task, 'dueDate' | 'startTime' | 'durationMin'>): Promise<void> {
  await updateTask(id, before);
}

export async function saveWork(work: WorkSettings): Promise<void> {
  await updateSettings({ work });
}
