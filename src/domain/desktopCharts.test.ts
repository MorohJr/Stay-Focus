import { describe, expect, it } from 'vitest';
import type { Challenge, ChallengeLog, RoutineItem, RoutineLog, Sprint, Task } from './schemas';
import { burndown, challengeLanes, dailyTrend, routineMatrix, sprintHistory, taskFlow } from './desktopCharts';

const T0 = '2026-09-01T12:00:00.000Z';
let n = 0;
function task(p: Partial<Task> = {}): Task {
  n++;
  return {
    id: `t${n}`, createdAt: T0, updatedAt: T0, seq: n, title: `task ${n}`, body: '', status: 'todo', projectIds: [], labels: [],
    urgent: false, important: false, links: [], attachmentIds: [], sortOrder: 0, someday: false, postponeCount: 0, ...p,
  };
}
const doneOn = (date: string, p: Partial<Task> = {}) => task({ status: 'done', completedAt: `${date}T12:00:00.000Z`, ...p });
const sprint = (id: string, startDate: string, endDate: string): Sprint => ({ id, createdAt: T0, updatedAt: T0, name: id, startDate, endDate, weeklyGoals: [] });
const TODAY = '2026-10-14'; // a Wednesday

describe('R-DSK-4 desktop charts', () => {
  it('daily trend: the last 30 days against the 30 before', () => {
    const t = dailyTrend([doneOn('2026-10-14'), doneOn('2026-10-14'), doneOn('2026-09-15'), doneOn('2026-09-14'), doneOn('2026-08-16'), task()], TODAY);
    expect(t.days).toHaveLength(30);
    expect(t.days[0]).toMatchObject({ date: '2026-09-15', count: 1, prev: 1 }); // 16/8 is 30 days before 15/9
    expect(t.days[29]).toMatchObject({ date: '2026-10-14', count: 2 });
    expect(t).toMatchObject({ total: 3, prevTotal: 2, change: 50, avg: 0.1 });
  });

  it('sprint history: started sprints with tasks, main tasks only, archived left out', () => {
    const s1 = sprint('s1', '2026-10-04', '2026-10-10');
    const s2 = sprint('s2', '2026-10-11', '2026-10-17');
    const s3 = sprint('s3', '2026-10-18', '2026-10-24');
    const s0 = sprint('s0', '2026-09-27', '2026-10-03');
    const tasks = [
      doneOn('2026-10-05', { sprintId: 's1' }), task({ sprintId: 's1' }), task({ sprintId: 's1', status: 'archived' }), task({ sprintId: 's1', parentId: 'x' }),
      task({ sprintId: 's2' }), task({ sprintId: 's3' }),
    ];
    const h = sprintHistory([s2, s3, s1, s0], tasks, TODAY);
    expect(h.rows.map((r) => [r.id, r.done, r.total, r.pct, r.current])).toEqual([['s1', 1, 2, 50, false], ['s2', 0, 1, 0, true]]);
    expect(h.avg).toBe(25);
  });

  it('burndown: open tasks left each day, the even pace down to 0, nothing for days ahead', () => {
    const s = sprint('s', '2026-10-11', '2026-10-17');
    const b = burndown(s, [doneOn('2026-10-12', { sprintId: 's' }), doneOn('2026-10-14', { sprintId: 's' }), task({ sprintId: 's' }), task({ sprintId: 's' }), task({ sprintId: 's', status: 'archived' }), task()], TODAY);
    expect(b.total).toBe(4);
    expect(b.days.map((d) => d.left)).toEqual([4, 3, 3, 2, undefined, undefined, undefined]);
    expect(b.days[0]!.ideal).toBe(4);
    expect(b.days[6]!.ideal).toBe(0);
    expect(b.days[3]!.ideal).toBe(2);
  });

  it('task flow: added, done and still open per week', () => {
    const c = (d: string) => `${d}T12:00:00.000Z`;
    const tasks = [
      task({ createdAt: c('2026-10-12') }),
      doneOn('2026-10-13', { createdAt: c('2026-10-05') }),
      doneOn('2026-10-06', { createdAt: c('2026-10-05') }),
      task({ createdAt: c('2026-10-06'), parentId: 'x' }),
      task({ createdAt: c('2026-10-06'), status: 'archived' }),
    ];
    const f = taskFlow(tasks, TODAY, 2);
    expect(f.rows.map((r) => [r.from, r.added, r.done, r.open])).toEqual([
      ['2026-10-04', 2, 1, 1],
      ['2026-10-11', 1, 1, 1],
    ]);
    expect([f.added, f.done]).toEqual([3, 2]);
  });

  it('routine matrix: ticks per item and day, empty before the item existed', () => {
    const item = (id: string, routine: 'morning' | 'evening', order: number, created = T0): RoutineItem => ({ id, createdAt: created, updatedAt: created, routine, title: id, order, active: true });
    const items = [item('e1', 'evening', 0), item('m2', 'morning', 1, '2026-10-13T12:00:00.000Z'), item('m1', 'morning', 0), { ...item('off', 'morning', 3), active: false }];
    const logs: RoutineLog[] = [
      { id: 'a', date: '2026-10-14', itemId: 'm1', done: true },
      { id: 'b', date: '2026-10-13', itemId: 'e1', done: true },
      { id: 'c', date: '2026-10-14', itemId: 'm2', done: false },
    ];
    const m = routineMatrix(items, logs, TODAY, 3);
    expect(m.dates).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(m.rows.map((r) => [r.id, r.cells])).toEqual([
      ['m1', [false, false, true]],
      ['m2', [null, false, false]],
      ['e1', [false, true, false]],
    ]);
    expect(m.pct).toEqual([0, 33, 33]);
  });

  it('challenge lanes: clean runs, current and longest', () => {
    const c: Challenge = { id: 'c', createdAt: T0, updatedAt: T0, name: 'C', startDate: '2026-10-08', endDate: '2026-10-30', rules: [{ id: 'r', title: 'r' }] };
    const log = (date: string, value: 'kept' | 'broken'): ChallengeLog => ({ id: date, challengeId: 'c', date, ruleId: 'r', value });
    const logs = [log('2026-10-08', 'kept'), log('2026-10-09', 'kept'), log('2026-10-10', 'broken'), log('2026-10-12', 'kept'), log('2026-10-13', 'kept')];
    const { dates, lanes } = challengeLanes([c, { ...c, id: 'old', endDate: '2026-08-01', startDate: '2026-07-01' }], logs, TODAY, 10);
    expect(dates[0]).toBe('2026-10-05');
    expect(lanes).toHaveLength(1);
    const l = lanes[0]!;
    expect(l.marks.slice(0, 4)).toEqual([null, null, null, 'clean']);
    expect(l.marks[5]).toBe('broken');
    expect(l.runs).toEqual([{ start: 3, end: 4 }, { start: 7, end: 8 }]);
    expect([l.longest, l.current, l.clean]).toEqual([2, 2, 4]); // today not marked yet: the run up to yesterday counts
  });
});
