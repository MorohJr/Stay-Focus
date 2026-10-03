import { addDays, diffDays, localDate } from './dates';
import type { AgendaItem, Milestone, Sprint, Task } from './schemas';
import { sprintStatus } from './sprints';
import { isActiveOpen, isStuck } from './tasks';

/** R-CLN: tasks worth a second look, oldest first. */
export const CLEANUP_DAYS = 60;
export function cleanupCandidates(tasks: Task[], sprints: Sprint[], today: string): Task[] {
  const live = new Set(sprints.filter((s) => ['current', 'next'].includes(sprintStatus(s, today))).map((s) => s.id));
  const since = (t: Task) => localDate(t.keptAt ?? t.createdAt);
  return tasks
    .filter((t) => isActiveOpen(t) && !t.parentId && !t.recurringId)
    .filter((t) => !(t.dueDate && t.dueDate >= today) && !(t.sprintId && live.has(t.sprintId)))
    .filter((t) => isStuck(t) || diffDays(since(t), today) >= CLEANUP_DAYS)
    .sort((a, b) => since(a).localeCompare(since(b)));
}

/** R-REV step 3: overdue and stuck tasks. */
export function stuckForReview(tasks: Task[], today: string): Task[] {
  return tasks
    .filter((t) => isActiveOpen(t) && !t.parentId && !t.recurringId && ((t.dueDate && t.dueDate < today) || isStuck(t)))
    .sort((a, b) => b.postponeCount - a.postponeCount || (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
}

// ---------------------------------------------------------------------------
// Milestones (R-MIL)
// ---------------------------------------------------------------------------

export function isMilestoneLate(m: Milestone, today: string): boolean {
  return !m.doneAt && !!m.dueDate && m.dueDate < today;
}

export function milestoneStats(list: Milestone[], today: string) {
  const done = list.filter((m) => m.doneAt);
  const onTime = done.filter((m) => !m.dueDate || localDate(m.doneAt!) <= m.dueDate);
  return { done: done.length, total: list.length, onTime: onTime.length, late: list.filter((m) => isMilestoneLate(m, today)).length };
}

export function nextMilestone(list: Milestone[]): Milestone | undefined {
  return [...list].sort((a, b) => a.order - b.order).find((m) => !m.doneAt);
}

// ---------------------------------------------------------------------------
// People (R-PPL)
// ---------------------------------------------------------------------------

/** Open talking points, plus the ones ticked in the last 7 days. */
export function visibleAgenda(items: AgendaItem[], today: string): AgendaItem[] {
  const cutoff = addDays(today, -7);
  return items.filter((a) => !a.doneAt || localDate(a.doneAt) > cutoff).sort((a, b) => Number(!!a.doneAt) - Number(!!b.doneAt) || a.createdAt.localeCompare(b.createdAt));
}
