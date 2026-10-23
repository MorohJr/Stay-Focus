import { describe, expect, it } from 'vitest';
import type { Area, Project, Task } from './schemas';
import { niceTicks, trendSeries } from './trend';

const T0 = '2025-06-01T12:00:00.000Z';
let n = 0;
function doneOn(date: string, p: Partial<Task> = {}): Task {
  n++;
  return {
    id: `t${n}`, createdAt: T0, updatedAt: T0, seq: n, title: `task ${n}`, body: '', status: 'done', completedAt: `${date}T12:00:00.000Z`, projectIds: [], labels: [],
    urgent: false, important: false, links: [], attachmentIds: [], sortOrder: 0, someday: false, postponeCount: 0, ...p,
  };
}
const project = (p: Partial<Project>): Project => ({ id: 'p', createdAt: T0, updatedAt: T0, name: 'P', body: '', icon: '🎯', status: 'active', blockedByIds: [], ...p });
const areas = [{ id: 'a1', name: 'עבודה', color: '#111' }, { id: 'a2', name: 'בית', color: '#222' }] as Area[];
const projects = [project({ id: 'p1', areaId: 'a1' }), project({ id: 'p2', areaId: 'a2' })];
const TODAY = '2026-10-14';

describe('R-DSK-3 trend chart', () => {
  const tasks = [
    doneOn('2026-01-01', { projectIds: ['p1'] }),
    doneOn('2026-01-03', { projectIds: ['p2'] }),
    doneOn('2026-01-04', { projectIds: ['p1'] }),
    doneOn('2026-10-10'),
    doneOn('2025-01-02'),
    doneOn('2025-12-30'),
    doneOn('2024-05-05'),
    { ...doneOn('2026-02-02'), status: 'todo' } as Task,
  ];

  it('months: 12 buckets, split by area, last year as the comparison', () => {
    const t = trendSeries(tasks, projects, areas, 2026, 'month', TODAY);
    expect(t.buckets).toHaveLength(12);
    expect(t.buckets[0]).toMatchObject({ from: '2026-01-01', to: '2026-01-31', total: 3, prev: 1, future: false });
    expect(t.buckets[1]!.total).toBe(0); // not done: not counted
    expect(t.buckets[9]!.total).toBe(1);
    expect(t.buckets[11]).toMatchObject({ prev: 1, future: true });
    expect(t.areas.map((a) => a.id)).toEqual(['a1', 'a2', '']);
    expect(t.buckets[0]!.byArea).toEqual([2, 1, 0]);
    expect(t.buckets[9]!.byArea).toEqual([0, 0, 1]);
  });

  it('weeks: Sunday to Saturday, cut at the edges of the year', () => {
    const t = trendSeries(tasks, projects, areas, 2026, 'week', TODAY);
    expect(t.buckets).toHaveLength(53);
    expect(t.buckets[0]).toMatchObject({ from: '2026-01-01', to: '2026-01-03', total: 2 }); // 1/1/2026 is a Thursday
    expect(t.buckets[1]).toMatchObject({ from: '2026-01-04', to: '2026-01-10', total: 1 });
    expect(t.buckets[52]!.to).toBe('2026-12-31');
    expect(t.buckets[0]!.prev).toBe(1); // 2/1/2025 was in the first week of 2025
  });

  it('years: every year from the first with data, each against the one before', () => {
    const t = trendSeries(tasks, projects, areas, 2026, 'year', TODAY);
    expect(t.buckets.map((b) => [b.from.slice(0, 4), b.total, b.prev])).toEqual([
      ['2024', 1, undefined],
      ['2025', 2, 1],
      ['2026', 4, 2],
    ]);
  });

  it('the total is compared with last year up to the same date', () => {
    const t = trendSeries(tasks, projects, areas, 2026, 'month', TODAY);
    expect(t.total).toBe(4);
    expect(t.prevTotal).toBe(1); // 30/12/2025 is after 14/10
    expect(t.change).toBe(300);
    const past = trendSeries(tasks, projects, areas, 2025, 'month', TODAY);
    expect(past.prevTotal).toBe(1); // a finished year: all of 2024
    expect(trendSeries(tasks, projects, areas, 2024, 'month', TODAY)).toMatchObject({ prevTotal: null, change: null });
    expect(trendSeries(tasks, projects, areas, 2024, 'month', TODAY).buckets[0]!.prev).toBeUndefined();
  });

  it('axis ticks are round numbers that reach the max', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(9)).toEqual([0, 5, 10]);
    expect(niceTicks(37)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(120)).toEqual([0, 50, 100, 150]);
  });
});
