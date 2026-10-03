import { db } from '../db/db';
import { addDays } from '../domain/dates';
import { occursOn } from '../domain/recurring';
import type { Goal, Note, Project, Sprint, Task } from '../domain/schemas';
import { missingSprintWeeks, sprintName, sprintRange } from '../domain/sprints';
import { isOpen } from '../domain/tasks';
import { nextSeq, nowIso, stamps } from './entity';

// ---------------------------------------------------------------------------
// Sprints (SPEC 3.3)
// ---------------------------------------------------------------------------

/** R-SPR-1: this week's and next week's sprints exist. */
export async function ensureSprints(today: string): Promise<void> {
  await db.transaction('rw', db.sprints, async () => {
    const existing = await db.sprints.toArray();
    for (const start of missingSprintWeeks(existing, today)) {
      await db.sprints.add({ ...stamps(), name: sprintName(start), ...sprintRange(start) });
    }
  });
}

export type ReviewMove = 'current' | 'backlog';

/** R-SPR-4: moves leftovers and marks the sprint reviewed. */
export async function reviewSprint(sprintId: string, moves: Record<string, ReviewMove>, currentSprintId: string): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', db.tasks, db.sprints, async () => {
    for (const [taskId, move] of Object.entries(moves)) {
      const t = await db.tasks.get(taskId);
      if (!t || t.sprintId !== sprintId || !isOpen(t)) continue;
      await db.tasks.put({ ...t, sprintId: move === 'current' ? currentSprintId : undefined, updatedAt: now });
    }
    await db.sprints.update(sprintId, { reviewedAt: now, updatedAt: now });
  });
}

export async function createSprintManually(startDate: string): Promise<Sprint> {
  const s: Sprint = { ...stamps(), name: sprintName(startDate), ...sprintRange(startDate) };
  await db.sprints.add(s);
  return s;
}

// ---------------------------------------------------------------------------
// Recurring (SPEC 3.9)
// ---------------------------------------------------------------------------

/**
 * R-REC-1: creates today's instances that don't exist yet.
 * R-REC-2: past instances that were not done are archived.
 */
export async function materializeRecurring(today: string): Promise<void> {
  const rules = await db.recurring.toArray();
  const now = nowIso();
  const stale = (await db.tasks.where('dueDate').below(today).toArray()).filter((t) => t.recurringId && isOpen(t));
  if (stale.length) await db.tasks.bulkPut(stale.map((t) => ({ ...t, status: 'archived' as const, updatedAt: now })));

  const todays = await db.tasks.where('dueDate').equals(today).toArray();
  for (const r of rules) {
    if (!occursOn(r, today)) continue;
    if (todays.some((t) => t.recurringId === r.id)) continue;
    const seq = await nextSeq();
    const t: Task = {
      ...stamps(),
      seq,
      title: r.title,
      body: r.body,
      status: 'todo',
      dueDate: today,
      startTime: r.startTime,
      durationMin: r.startTime ? (r.durationMin ?? 30) : undefined,
      projectIds: r.projectIds,
      labels: r.labels,
      urgent: false,
      important: false,
      recurringId: r.id,
      links: [],
      attachmentIds: [],
      sortOrder: Date.now(),
    };
    await db.tasks.add(t);
  }
}

/** R-REC-3: future occurrences for the calendar (computed, not stored). */
export function occurrencesBetween(rules: { id: string; title: string; rule: import('../domain/schemas').RecurrenceRule; startDate: string; endDate?: string; active: boolean; startTime?: string }[], from: string, to: string) {
  const out: { date: string; recurringId: string; title: string; startTime?: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const r of rules) if (occursOn(r, d)) out.push({ date: d, recurringId: r.id, title: r.title, startTime: r.startTime });
  }
  return out;
}

/** Runs the daily jobs: sprints for this/next week and today's recurring tasks (R-TOD-11). */
export async function runDaily(today: string): Promise<void> {
  await ensureSprints(today);
  await materializeRecurring(today);
}

// ---------------------------------------------------------------------------
// Projects, goals, notes
// ---------------------------------------------------------------------------

export async function createProject(input: Partial<Project> & { name: string }, templateSubtasks: string[] = []): Promise<Project> {
  const p: Project = { ...stamps(), body: '', icon: '🎯', status: 'planning', blockedByIds: [], ...input };
  await db.projects.add(p);
  for (const title of templateSubtasks) {
    const seq = await nextSeq();
    await db.tasks.add({
      ...stamps(), seq, title, body: '', status: 'todo', projectIds: [p.id], labels: [], urgent: false, important: false, links: [], attachmentIds: [], sortOrder: Date.now(),
    });
  }
  return p;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await db.projects.update(id, { ...patch, updatedAt: nowIso() });
}

/** Deleting a project unlinks its tasks and notes (they are kept). */
export async function deleteProject(id: string): Promise<void> {
  const now = nowIso();
  await db.transaction('rw', db.projects, db.tasks, db.notes, db.attachments, async () => {
    await db.attachments.where('ownerId').equals(id).delete(); // R-PRJ-3: logo and cover
    const tasks = await db.tasks.where('projectIds').equals(id).toArray();
    await db.tasks.bulkPut(tasks.map((t) => ({ ...t, projectIds: t.projectIds.filter((x) => x !== id), updatedAt: now })));
    const notes = await db.notes.where('projectIds').equals(id).toArray();
    await db.notes.bulkPut(notes.map((n) => ({ ...n, projectIds: n.projectIds.filter((x) => x !== id), updatedAt: now })));
    const others = await db.projects.toArray();
    await db.projects.bulkPut(others.filter((p) => p.blockedByIds.includes(id)).map((p) => ({ ...p, blockedByIds: p.blockedByIds.filter((x) => x !== id) })));
    await db.projects.delete(id);
  });
}

export async function createGoal(input: Partial<Goal> & { title: string }): Promise<Goal> {
  const g: Goal = { ...stamps(), body: '', status: 'active', progressMode: 'projects', manualProgress: 0, inFocus: false, ...input };
  await db.goals.add(g);
  return g;
}

export async function updateGoal(id: string, patch: Partial<Goal>): Promise<void> {
  await db.goals.update(id, { ...patch, updatedAt: nowIso() });
}

/** R-GOL-2: only one goal in focus. */
export async function setFocusGoal(id: string): Promise<void> {
  await db.transaction('rw', db.goals, async () => {
    const all = await db.goals.toArray();
    const now = nowIso();
    await db.goals.bulkPut(all.map((g) => ({ ...g, inFocus: g.id === id, updatedAt: g.id === id || g.inFocus ? now : g.updatedAt })));
  });
}

export async function deleteGoal(id: string): Promise<void> {
  await db.transaction('rw', db.goals, db.projects, async () => {
    const linked = await db.projects.where('goalId').equals(id).toArray();
    await db.projects.bulkPut(linked.map((p) => ({ ...p, goalId: undefined })));
    await db.goals.delete(id);
  });
}

/** R-NOT-1: a note without a title takes the first line of the body. */
export function noteTitle(n: Pick<Note, 'title' | 'body'>): string {
  return n.title.trim() || n.body.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || 'פתק ללא כותרת';
}

export async function createNote(input: Partial<Note> = {}): Promise<Note> {
  const n: Note = { ...stamps(), title: '', body: '', kinds: [], projectIds: [], links: [], attachmentIds: [], pinned: false, ...input };
  await db.notes.add(n);
  return n;
}

export async function updateNote(id: string, patch: Partial<Note>): Promise<void> {
  await db.notes.update(id, { ...patch, updatedAt: nowIso() });
}

export async function deleteNote(id: string): Promise<void> {
  await db.transaction('rw', db.notes, db.attachments, async () => {
    await db.attachments.where('ownerId').equals(id).delete();
    await db.notes.delete(id);
  });
}

/** Notes created by "new note" and left empty. */
export async function deleteEmptyNotes(): Promise<void> {
  const empty = (await db.notes.toArray()).filter((n) => !n.title.trim() && !n.body.trim() && !n.attachmentIds.length && !n.links.length);
  await db.notes.bulkDelete(empty.map((n) => n.id));
}
