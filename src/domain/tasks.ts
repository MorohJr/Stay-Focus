import type { Priority, Project, Task, TaskStatus } from './schemas';

export const STATUS_EMOJI: Record<TaskStatus, string> = { todo: '🍵', doing: '🔄', done: '✅', archived: '♲' };
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'לעשות', doing: 'בתהליך', done: 'בוצע', archived: 'בארכיון' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function isOpen(t: Pick<Task, 'status'>): boolean {
  return t.status === 'todo' || t.status === 'doing';
}

/** Open and not parked in "someday" (R-SMD): what the normal lists work with. */
export function isActiveOpen(t: Pick<Task, 'status' | 'someday'>): boolean {
  return isOpen(t) && !t.someday;
}

/** R-INB-1: open, no date, no project, no sprint, not a sub-task, not "someday". */
export function isInbox(t: Task): boolean {
  return isActiveOpen(t) && !t.dueDate && t.projectIds.length === 0 && !t.sprintId && !t.parentId;
}

export type TaskTab = 'inbox' | 'projects' | 'matrix' | 'waiting' | 'someday' | 'done' | 'calendar';

/** R-TAB-1: inbox first when it has items, last when empty; the calendar always just before the end. */
export function taskTabsOrder(inboxCount: number): TaskTab[] {
  const middle: TaskTab[] = ['projects', 'matrix', 'waiting', 'someday', 'done', 'calendar'];
  return inboxCount > 0 ? ['inbox', ...middle] : [...middle, 'inbox'];
}

/** R-PRC: postponed 3 times or more. */
export const STUCK_AT = 3;
export function isStuck(t: Pick<Task, 'postponeCount' | 'status'>): boolean {
  return isOpen(t) && t.postponeCount >= STUCK_AT;
}

/** R-TSK-1: completedAt follows the done status. */
export function withStatus(t: Task, status: TaskStatus, nowIso: string): Task {
  return {
    ...t,
    status,
    completedAt: status === 'done' ? (t.status === 'done' ? t.completedAt : nowIso) : undefined,
  };
}

/** R-PRJ-1 / R-SPR-3: done ÷ non-archived; 0 when empty. Returns 0–100. */
export function completion(tasks: Pick<Task, 'status'>[]): { done: number; total: number; pct: number } {
  const counted = tasks.filter((t) => t.status !== 'archived');
  const done = counted.filter((t) => t.status === 'done').length;
  return { done, total: counted.length, pct: counted.length ? Math.round((done / counted.length) * 100) : 0 };
}

/** R-PRJ-2: the blockers that are not done yet. */
export function activeBlockers(p: Project, all: Project[]): Project[] {
  return p.blockedByIds.map((id) => all.find((x) => x.id === id)).filter((x): x is Project => !!x && x.status !== 'done');
}

/** Scheduled first (by time), then by priority, then by manual order / creation. */
export function compareForDay(a: Task, b: Task): number {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
  if (a.startTime) return -1;
  if (b.startTime) return 1;
  const pa = a.priority ? PRIORITY_RANK[a.priority] : 3;
  const pb = b.priority ? PRIORITY_RANK[b.priority] : 3;
  if (pa !== pb) return pa - pb;
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

export type Quadrant = 'do' | 'plan' | 'delegate' | 'drop';

/** Urgent/important matrix (SPEC 5.2). */
export function quadrantOf(t: Pick<Task, 'urgent' | 'important'>): Quadrant {
  if (t.urgent && t.important) return 'do';
  if (t.important) return 'plan';
  if (t.urgent) return 'delegate';
  return 'drop';
}

export const QUADRANT_LABEL: Record<Quadrant, { title: string; sub: string }> = {
  do: { title: 'עשה עכשיו', sub: 'דחוף וחשוב' },
  plan: { title: 'תכנן', sub: 'חשוב, לא דחוף' },
  delegate: { title: 'האצל', sub: 'דחוף, לא חשוב' },
  drop: { title: 'וותר', sub: 'לא דחוף ולא חשוב' },
};
