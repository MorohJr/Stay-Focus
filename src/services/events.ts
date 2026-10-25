import { db } from '../db/db';
import { formatShort } from '../domain/dates';
import type { CalEvent, Note, Task, WorkSettings } from '../domain/schemas';
import { nowIso, stamps, updateSettings } from './entity';
import { createNote } from './planning';
import { updateTask } from './tasks';

/** Events (SPEC 3.17) and work hours (3.18). */

export type EventInput = Partial<CalEvent> & Pick<CalEvent, 'title' | 'date'>;

export async function saveEvent({ id, ...input }: EventInput): Promise<CalEvent> {
  const existing = id ? await db.events.get(id) : undefined;
  const e: CalEvent = existing
    ? { ...existing, ...input, skipDates: input.skipDates ?? existing.skipDates ?? [], updatedAt: nowIso() }
    : { ...stamps(), allDay: false, location: '', body: '', repeat: 'none', ...input, skipDates: input.skipDates ?? [] };
  // R-EVT-3: an all-day event has no hours.
  if (e.allDay) Object.assign(e, { startTime: undefined, endTime: undefined });
  await db.events.put(e);
  return e;
}

/** Deletes the whole series; meeting summaries stay, without the link (R-EVT-7). Returns what "undo" needs. */
export async function deleteEvent(id: string): Promise<{ event: CalEvent; notes: Note[] } | undefined> {
  return db.transaction('rw', db.events, db.notes, async () => {
    const event = await db.events.get(id);
    if (!event) return undefined;
    const notes = await db.notes.filter((n) => n.eventId === id).toArray();
    await db.notes.bulkPut(notes.map((n) => ({ ...n, eventId: undefined, eventDate: undefined })));
    await db.events.delete(id);
    return { event, notes };
  });
}

export async function restoreEvent({ event, notes }: { event: CalEvent; notes: Note[] }): Promise<void> {
  await db.transaction('rw', db.events, db.notes, async () => {
    await db.events.put(event);
    for (const n of notes) await db.notes.update(n.id, { eventId: n.eventId, eventDate: n.eventDate });
  });
}

/** R-EVT-5: delete only one date of a repeating event. Returns the "undo". */
export async function skipOccurrence(id: string, date: string): Promise<() => Promise<void>> {
  const e = await db.events.get(id);
  if (!e) return async () => {};
  await db.events.update(id, { skipDates: [...(e.skipDates ?? []), date], updatedAt: nowIso() });
  return async () => {
    const cur = await db.events.get(id);
    if (cur) await db.events.update(id, { skipDates: (cur.skipDates ?? []).filter((d) => d !== date), updatedAt: nowIso() });
  };
}

/** R-EVT-5: change only one date: the series skips it and a one-off event takes it, with that day's summaries. */
export async function detachOccurrence(id: string, date: string, changes: EventInput): Promise<CalEvent | undefined> {
  return db.transaction('rw', db.events, db.notes, async () => {
    const e = await db.events.get(id);
    if (!e) return undefined;
    await db.events.update(id, { skipDates: [...(e.skipDates ?? []), date], updatedAt: nowIso() });
    const { id: _drop, ...rest } = changes;
    const one = await saveEvent({ ...rest, repeat: 'none', skipDates: [] });
    await db.notes.filter((n) => n.eventId === id && n.eventDate === date).modify({ eventId: one.id, eventDate: one.date });
    return one;
  });
}

/** R-EVT-7: the summary of one occurrence; created from the meeting template when missing. */
export async function meetingNoteFor(e: CalEvent, date: string): Promise<Note> {
  const found = await db.notes.filter((n) => n.eventId === e.id && n.eventDate === date).first();
  if (found) return found;
  const tpl = await db.templates.get('tpl-meeting');
  return createNote({ title: `פגישה: ${e.title} · ${formatShort(date)}`, body: tpl?.body ?? '', kinds: ['meeting'], projectIds: e.projectId ? [e.projectId] : [], eventId: e.id, eventDate: date });
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
