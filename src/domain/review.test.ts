import { describe, expect, it } from 'vitest';
import { cleanupCandidates, milestoneStats, nextMilestone, stuckForReview, visibleAgenda } from './review';
import { isInbox, isStuck } from './tasks';
import { overdue } from './today';
import type { AgendaItem, Milestone, Sprint, Task } from './schemas';

const TODAY = '2026-10-03';
const T0 = '2026-01-01T09:00:00.000Z';
let n = 0;
const task = (p: Partial<Task> = {}): Task => ({
  id: `t${++n}`, createdAt: T0, updatedAt: T0, seq: n, title: 't', body: '', status: 'todo', projectIds: [], labels: [], urgent: false, important: false,
  links: [], attachmentIds: [], sortOrder: 0, someday: false, postponeCount: 0, ...p,
});
const sprint = (startDate: string, endDate: string): Sprint => ({ id: startDate, createdAt: T0, updatedAt: T0, name: '', startDate, endDate, weeklyGoals: [] });

describe('R-SMD someday', () => {
  it('is not in the inbox and not overdue', () => {
    expect(isInbox(task({ someday: true }))).toBe(false);
    expect(overdue([task({ someday: true, dueDate: '2026-09-01' })], TODAY)).toHaveLength(0);
  });
});

describe('R-PRC stuck', () => {
  it('from 3 postponements, open only', () => {
    expect(isStuck(task({ postponeCount: 2 }))).toBe(false);
    expect(isStuck(task({ postponeCount: 3 }))).toBe(true);
    expect(isStuck(task({ postponeCount: 5, status: 'done' }))).toBe(false);
  });
  it('review step 3 lists overdue and stuck, most postponed first', () => {
    const a = task({ dueDate: '2026-10-01' });
    const b = task({ postponeCount: 4 });
    const c = task({ dueDate: '2026-10-05' });
    expect(stuckForReview([a, b, c], TODAY).map((t) => t.id)).toEqual([b.id, a.id]);
  });
});

describe('R-CLN cleanup', () => {
  const cur = sprint('2026-09-27', '2026-10-03');
  it('old untouched tasks and stuck tasks, not current-sprint, future-dated, someday or recently kept', () => {
    const old = task({ createdAt: '2026-06-01T09:00:00.000Z' });
    const fresh = task({ createdAt: '2026-09-20T09:00:00.000Z' });
    const stuck = task({ createdAt: '2026-09-20T09:00:00.000Z', postponeCount: 3 });
    const inSprint = task({ createdAt: '2026-06-01T09:00:00.000Z', sprintId: cur.id });
    const future = task({ createdAt: '2026-06-01T09:00:00.000Z', dueDate: '2026-10-10' });
    const parked = task({ createdAt: '2026-06-01T09:00:00.000Z', someday: true });
    const kept = task({ createdAt: '2026-06-01T09:00:00.000Z', keptAt: '2026-09-15T09:00:00.000Z' });
    const ids = cleanupCandidates([old, fresh, stuck, inSprint, future, parked, kept], [cur], TODAY).map((t) => t.id);
    expect(ids).toEqual([old.id, stuck.id]);
  });
});

describe('R-MIL milestones', () => {
  const m = (p: Partial<Milestone>): Milestone => ({ id: `m${++n}`, createdAt: T0, updatedAt: T0, projectId: 'p', title: 'm', order: 0, ...p });
  it('counts done, on time and late', () => {
    const list = [
      m({ order: 0, dueDate: '2026-09-10', doneAt: '2026-09-09T10:00:00.000Z' }),
      m({ order: 1, dueDate: '2026-09-20', doneAt: '2026-09-25T10:00:00.000Z' }),
      m({ order: 2, dueDate: '2026-09-30' }),
      m({ order: 3, dueDate: '2026-11-01' }),
    ];
    expect(milestoneStats(list, TODAY)).toEqual({ done: 2, total: 4, onTime: 1, late: 1 });
    expect(nextMilestone(list)?.order).toBe(2);
  });
});

describe('R-PPL agenda', () => {
  it('shows open items and ones ticked in the last 7 days', () => {
    const a = (p: Partial<AgendaItem>): AgendaItem => ({ id: `a${++n}`, createdAt: T0, updatedAt: T0, personId: 'x', text: 'x', ...p });
    const open = a({});
    const recent = a({ doneAt: '2026-10-01T10:00:00.000Z' });
    const old = a({ doneAt: '2026-09-01T10:00:00.000Z' });
    expect(visibleAgenda([recent, old, open], TODAY).map((x) => x.id)).toEqual([open.id, recent.id]);
  });
});
