import { db } from '../db/db';
import { addDays, hhmmOf, minutesOf, todayISO } from '../domain/dates';
import type { Attachment, Task, TaskStatus } from '../domain/schemas';
import { withStatus } from '../domain/tasks';
import { overdue, top3 } from '../domain/today';
import { nextSeq, nowIso, stamps } from './entity';

export type NewTask = Partial<Omit<Task, 'id' | 'seq' | 'createdAt' | 'updatedAt'>> & { title: string };

export async function createTask(input: NewTask): Promise<Task> {
  const seq = await nextSeq();
  let parentBits: Partial<Task> = {};
  if (input.parentId) {
    // R-TSK-3: a sub-task inherits the parent's projects and sprint.
    const parent = await db.tasks.get(input.parentId);
    if (parent) parentBits = { projectIds: parent.projectIds, sprintId: parent.sprintId };
  }
  const t: Task = {
    ...stamps(),
    seq,
    body: '',
    status: 'todo',
    projectIds: [],
    labels: [],
    urgent: false,
    important: false,
    links: [],
    attachmentIds: [],
    sortOrder: Date.now(),
    ...parentBits,
    ...input,
    title: input.title.trim(),
    someday: input.someday ?? false,
    postponeCount: input.postponeCount ?? 0,
  };
  if (t.status === 'done' && !t.completedAt) t.completedAt = nowIso();
  await db.tasks.add(t);
  return t;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    const cur = await db.tasks.get(id);
    if (!cur) return;
    let next: Task = { ...cur, ...patch, updatedAt: nowIso() };
    // R-PRC: moving an overdue task's date forward counts as a postponement.
    if (patch.postponeCount === undefined && patch.dueDate && cur.dueDate && cur.dueDate < todayISO() && patch.dueDate > cur.dueDate) {
      next.postponeCount = cur.postponeCount + 1;
    }
    if (patch.status && patch.status !== cur.status) next = withStatus({ ...next, status: cur.status }, patch.status, nowIso());
    if (next.startTime && !next.durationMin) next.durationMin = 30;
    await db.tasks.put(next);
  });
}

export function setStatus(id: string, status: TaskStatus) {
  return updateTask(id, { status });
}

export async function toggleDone(id: string): Promise<void> {
  const t = await db.tasks.get(id);
  if (t) await setStatus(id, t.status === 'done' ? 'todo' : 'done');
}

export interface DeletedTasks {
  tasks: Task[];
  attachments: Attachment[];
}

/** R-TSK-2: removes the task, its sub-tasks (recursively) and their photos. Returns what's needed to undo. */
export async function deleteTask(id: string): Promise<DeletedTasks> {
  return db.transaction('rw', db.tasks, db.attachments, async () => {
    const ids: string[] = [];
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      ids.push(cur);
      const kids = await db.tasks.where('parentId').equals(cur).primaryKeys();
      queue.push(...kids);
    }
    const tasks = (await db.tasks.bulkGet(ids)).filter((t): t is Task => !!t);
    const attachments = await db.attachments.where('ownerId').anyOf(ids).toArray();
    await db.tasks.bulkDelete(ids);
    await db.attachments.bulkDelete(attachments.map((a) => a.id));
    return { tasks, attachments };
  });
}

export async function restoreTasks(d: DeletedTasks): Promise<void> {
  await db.transaction('rw', db.tasks, db.attachments, async () => {
    await db.tasks.bulkPut(d.tasks);
    await db.attachments.bulkPut(d.attachments);
  });
}

/** R-TOD-4: adds a task to today's top 3 (and gives it today's date if it had none). */
export async function addToTop3(id: string, today: string): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    const all = await db.tasks.where('top3Date').equals(today).toArray();
    const current = top3(all, today);
    if (current.length >= 3 || current.some((t) => t.id === id)) return;
    const t = await db.tasks.get(id);
    if (!t) return;
    const used = new Set(current.map((x) => x.top3Order));
    const order = [1, 2, 3].find((o) => !used.has(o))!;
    await db.tasks.put({ ...t, top3Date: today, top3Order: order, dueDate: t.dueDate ?? today, updatedAt: nowIso() });
  });
}

export async function removeFromTop3(id: string): Promise<void> {
  await updateTask(id, { top3Date: undefined, top3Order: undefined });
}

/** Moves a top-3 task up or down one place. */
export async function moveTop3(id: string, today: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    const list = top3(await db.tasks.where('top3Date').equals(today).toArray(), today);
    const i = list.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    const now = nowIso();
    await db.tasks.bulkPut(list.map((t, k) => ({ ...t, top3Order: k + 1, updatedAt: now })));
  });
}

export type Postpone = 'plus30' | 'plus60' | 'tomorrow' | { date: string };

/** "דחה" (R-TOD-2 / R-TOD-5). Time shifts only apply to scheduled tasks. */
export async function postponeTask(id: string, how: Postpone, today: string): Promise<void> {
  const t = await db.tasks.get(id);
  if (!t) return;
  if (how === 'plus30' || how === 'plus60') {
    if (!t.startTime) return;
    const next = minutesOf(t.startTime) + (how === 'plus30' ? 30 : 60);
    if (next < 24 * 60) {
      await updateTask(id, { startTime: hhmmOf(next), dueDate: t.dueDate ?? today });
      return;
    }
    await updateTask(id, { dueDate: addDays(today, 1) });
    return;
  }
  const date = how === 'tomorrow' ? addDays(today, 1) : how.date;
  // A top-3 slot belongs to a day: moving the task away frees it.
  const clearTop3 = t.top3Date && t.top3Date !== date ? { top3Date: undefined, top3Order: undefined } : {};
  await updateTask(id, { dueDate: date, ...clearTop3, postponeCount: t.postponeCount + 1 }); // R-PRC
}

/** R-TOD-5 "להיום" */
export function moveToToday(id: string, today: string) {
  return updateTask(id, { dueDate: today });
}

/** R-TOD-5 "דחה הכול למחר" */
export async function postponeAllOverdue(today: string): Promise<void> {
  const all = await db.tasks.where('dueDate').below(today).toArray();
  const late = overdue(all, today);
  const now = nowIso();
  const tomorrow = addDays(today, 1);
  await db.tasks.bulkPut(late.map((t) => ({ ...t, dueDate: tomorrow, postponeCount: t.postponeCount + 1, updatedAt: now }))); // R-PRC
}

export async function addToSprint(ids: string[], sprintId: string | undefined): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', db.tasks, async () => {
    const list = (await db.tasks.bulkGet(ids)).filter((t): t is Task => !!t);
    await db.tasks.bulkPut(list.map((t) => ({ ...t, sprintId, updatedAt: now })));
  });
}

/** R-SMD: park a task in "someday" (clears date, time, sprint and top-3) or bring it back. */
export async function setSomeday(id: string, on: boolean): Promise<void> {
  await updateTask(id, on
    ? { someday: true, dueDate: undefined, startTime: undefined, sprintId: undefined, top3Date: undefined, top3Order: undefined, postponeCount: 0 }
    : { someday: false, keptAt: nowIso() });
}

/** R-PRC: the four ways out of a stuck task. Delete is handled by deleteTask. */
export async function resolveStuck(id: string, action: 'today' | 'split' | 'someday', today: string): Promise<void> {
  if (action === 'someday') return setSomeday(id, true);
  await updateTask(id, { postponeCount: 0, ...(action === 'today' ? { dueDate: today } : {}) });
  if (action === 'today') await addToTop3(id, today);
}

/** R-CLN "להשאיר". */
export function keepTask(id: string) {
  return updateTask(id, { keptAt: nowIso() });
}

/** R-WAI */
export function setWaiting(id: string, personId: string | undefined) {
  return updateTask(id, { waitingPersonId: personId });
}
