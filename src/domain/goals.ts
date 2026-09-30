import { completion } from './tasks';
import type { Goal, Project, Task } from './schemas';

export function projectCompletion(p: Project, tasks: Task[]) {
  return completion(tasks.filter((t) => t.projectIds.includes(p.id)));
}

/** R-GOL-1 */
export function goalProgress(g: Goal, projects: Project[], tasks: Task[]): number {
  if (g.progressMode === 'manual') return Math.round(g.manualProgress);
  const linked = projects.filter((p) => p.goalId === g.id && p.status !== 'archived');
  if (linked.length === 0) return 0;
  const sum = linked.reduce((acc, p) => acc + projectCompletion(p, tasks).pct, 0);
  return Math.round(sum / linked.length);
}

/** R-GOL-2: the goal in focus, or the active goal with the nearest target date. */
export function focusGoal(goals: Goal[]): Goal | undefined {
  const active = goals.filter((g) => g.status === 'active');
  return (
    active.find((g) => g.inFocus) ??
    [...active].sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') || a.createdAt.localeCompare(b.createdAt))[0]
  );
}
