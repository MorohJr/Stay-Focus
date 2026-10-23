import { describe, expect, it } from 'vitest';
import type { Area, Challenge, ChallengeLog, Goal, Milestone, Project, Sprint, Task } from './schemas';
import { finishedAt } from './tasks';
import {
  activeDayStats, areaBreakdown, challengeStats, completedIn, dailyCounts, dayPart, monthlyByArea, monthlyCounts, onTimeRate, projectSpans, sprintStats,
  timeline, weekdayCounts, yearBanner, yearFraction, yearsWithData, yearSummary, type YearInput,
} from './yearReview';

const T0 = '2025-06-01T12:00:00.000Z';
let n = 0;
function task(p: Partial<Task> = {}): Task {
  n++;
  return {
    id: `t${n}`, createdAt: T0, updatedAt: T0, seq: n, title: `task ${n}`, body: '', status: 'todo', projectIds: [], labels: [],
    urgent: false, important: false, links: [], attachmentIds: [], sortOrder: 0, someday: false, postponeCount: 0, ...p,
  };
}
/** Done at noon UTC on a date, so the local date is the same in any normal time zone. */
const doneOn = (date: string, p: Partial<Task> = {}) => task({ status: 'done', completedAt: `${date}T12:00:00.000Z`, ...p });
const project = (p: Partial<Project>): Project => ({ id: 'p', createdAt: T0, updatedAt: T0, name: 'P', body: '', icon: '🎯', status: 'active', blockedByIds: [], ...p });
const TODAY = '2026-10-14';

describe('year review (R-YIR)', () => {
  it('R-PRJ-4 / R-GOL-3: finishing stamps the time, leaving clears it', () => {
    expect(finishedAt('active', 'done', 'done', undefined, 'NOW')).toBe('NOW');
    expect(finishedAt('done', 'done', 'done', 'OLD', 'NOW')).toBe('OLD');
    expect(finishedAt('done', 'active', 'done', 'OLD', 'NOW')).toBeUndefined();
  });

  it('counts by month, day, weekday; active days and the longest streak', () => {
    const done = [doneOn('2026-01-05'), doneOn('2026-01-06'), doneOn('2026-01-07'), doneOn('2026-01-07'), doneOn('2026-03-10'), doneOn('2025-12-31'), task()];
    const y = completedIn(done, 2026);
    expect(y).toHaveLength(5);
    expect(monthlyCounts(y).slice(0, 3)).toEqual([4, 0, 1]);
    const daily = dailyCounts(y);
    expect(daily['2026-01-07']).toBe(2);
    expect(activeDayStats(daily)).toEqual({ activeDays: 4, longestStreak: 3, best: { date: '2026-01-07', count: 2 } });
    expect(weekdayCounts(y)[1]).toBe(1); // 2026-01-05 is a Monday
  });

  it('day parts and on-time rate', () => {
    expect([dayPart(5), dayPart(12), dayPart(17), dayPart(22), dayPart(2)]).toEqual(['morning', 'noon', 'evening', 'night', 'night']);
    expect(onTimeRate([doneOn('2026-02-01', { dueDate: '2026-02-01' }), doneOn('2026-02-03', { dueDate: '2026-02-02' }), doneOn('2026-02-03')])).toBe(50);
    expect(onTimeRate([doneOn('2026-02-03')])).toBeNull();
  });

  it('R-YIR-2 step 7: project spans are clipped to the year; open ones run to today', () => {
    const ps = [
      project({ id: 'a', name: 'A', startDate: '2025-11-01', status: 'done', doneAt: '2026-02-10T12:00:00.000Z' }),
      project({ id: 'b', name: 'B', startDate: '2026-05-01' }),
      project({ id: 'c', name: 'C', status: 'planning' }), // never started
      project({ id: 'd', name: 'D', status: 'done', startDate: '2024-01-01', doneAt: '2024-05-01T12:00:00.000Z' }),
    ];
    const spans = projectSpans(ps, [doneOn('2026-01-10', { projectIds: ['a'] })], 2026, TODAY);
    expect(spans.map((s) => [s.id, s.start, s.end, s.done, s.tasksDone])).toEqual([
      ['a', '2026-01-01', '2026-02-10', true, 1],
      ['b', '2026-05-01', TODAY, false, 0],
    ]);
    expect(yearFraction('2026-01-01', 2026)).toBe(0);
    expect(yearFraction('2026-12-31', 2026)).toBeCloseTo(364 / 365);
  });

  it('R-YIR-2 step 8: by area of the project, "no area" last', () => {
    const areas: Area[] = [{ id: 'w', name: 'עבודה', color: '#111', order: 0, work: false, createdAt: T0, updatedAt: T0 }];
    const ps = [project({ id: 'p1', areaId: 'w' })];
    const r = areaBreakdown([doneOn('2026-01-01'), doneOn('2026-01-02', { projectIds: ['p1'] }), doneOn('2026-01-03', { projectIds: ['p1'] })], ps, areas);
    expect(r.map((x) => [x.name, x.count, x.pct])).toEqual([['עבודה', 2, 67], ['בלי תחום', 1, 33]]);
  });

  it('R-YIR-5: per month by area, in the same order as the area breakdown', () => {
    const areas: Area[] = [
      { id: 'w', name: 'עבודה', color: '#111', order: 0, work: false, createdAt: T0, updatedAt: T0 },
      { id: 'h', name: 'בית', color: '#222', order: 1, work: false, createdAt: T0, updatedAt: T0 },
    ];
    const ps = [project({ id: 'p1', areaId: 'w' }), project({ id: 'p2', areaId: 'h' })];
    const done = [doneOn('2026-01-05', { projectIds: ['p1'] }), doneOn('2026-01-20', { projectIds: ['p1'] }), doneOn('2026-03-02', { projectIds: ['p2'] }), doneOn('2026-03-03')];
    const r = monthlyByArea(done, ps, areas);
    expect(r.areas.map((a) => a.name)).toEqual(['עבודה', 'בית', 'בלי תחום']);
    expect(r.months[0]).toEqual([2, 0, 0]);
    expect(r.months[2]).toEqual([0, 1, 1]);
    expect(r.months.flat().reduce((x, y) => x + y, 0)).toBe(4);
  });

  it('sprints, challenges and the timeline', () => {
    const s: Sprint = { id: 's1', createdAt: T0, updatedAt: T0, name: 'שבוע 2', startDate: '2026-01-04', endDate: '2026-01-10', weeklyGoals: [] };
    const st = sprintStats([s], [doneOn('2026-01-05', { sprintId: 's1' }), doneOn('2026-01-05', { sprintId: 's1' }), task({ sprintId: 's1' }), doneOn('2026-01-06', { sprintId: 's1' })], 2026, TODAY);
    expect(st).toMatchObject({ count: 1, avgPct: 75, best: { pct: 75, total: 4 } });

    const c: Challenge = { id: 'c', createdAt: T0, updatedAt: T0, name: 'ch', startDate: '2026-03-01', endDate: '2026-03-04', rules: [{ id: 'r', title: 'r' }] };
    const kept = (date: string): ChallengeLog => ({ id: date, challengeId: 'c', date, ruleId: 'r', value: 'kept' });
    expect(challengeStats([c], [kept('2026-03-01'), kept('2026-03-02'), kept('2026-03-04')], 2026, TODAY)).toEqual({ count: 1, cleanDays: 3, longest: 2 });

    const g: Goal = { id: 'g', createdAt: T0, updatedAt: T0, title: 'מטרה', body: '', status: 'achieved', progressMode: 'manual', manualProgress: 100, inFocus: false, achievedAt: '2026-03-20T12:00:00.000Z' };
    const m: Milestone = { id: 'm', createdAt: T0, updatedAt: T0, projectId: 'p', title: 'גרסה', order: 0, doneAt: '2026-03-02T12:00:00.000Z' };
    const tl = timeline({ tasks: [doneOn('2026-03-05'), doneOn('2026-01-09')], projects: [project({ doneAt: '2026-01-15T12:00:00.000Z', status: 'done' })], goals: [g], milestones: [m], challenges: [c] }, 2026, TODAY);
    expect(tl.map((x) => x.month)).toEqual([3, 1]); // newest first, empty months skipped
    expect(tl[0]!.events.map((e) => e.kind)).toEqual(['goal', 'challenge', 'milestone']);
    expect(tl[1]!.events[0]!.kind).toBe('project');
  });

  it('R-YIR-1/3: years with data, and the January banner', () => {
    const tasks = [doneOn('2025-05-01'), doneOn('2026-02-01')];
    expect(yearsWithData({ tasks, projects: [] }, TODAY)).toEqual([2026, 2025]);
    expect(yearsWithData({ tasks: [], projects: [] }, TODAY)).toEqual([2026]);
    expect(yearBanner('2026-01-03', tasks, [])).toBe(2025);
    expect(yearBanner('2026-01-03', tasks, [{ id: '2025', seenAt: T0 }])).toBeUndefined();
    expect(yearBanner('2026-02-01', tasks, [])).toBeUndefined();
    expect(yearBanner('2026-01-03', [doneOn('2026-01-02')], [])).toBeUndefined();
  });

  it('summary: KPIs, change vs last year, highlights only with data', () => {
    const empty: YearInput = { tasks: [], projects: [], goals: [], milestones: [], challenges: [], challengeLogs: [], sprints: [], routineItems: [], routineLogs: [], notes: [], people: [], agenda: [], areas: [] };
    const none = yearSummary(empty, 2026, TODAY);
    expect(none.kpi.tasks).toBe(0);
    expect(none.highlights).toEqual([]);
    expect(none.partial).toBe(true);
    const s = yearSummary({ ...empty, tasks: [doneOn('2025-03-01'), doneOn('2026-03-01'), doneOn('2026-03-01')] }, 2026, TODAY);
    expect(s.kpi).toMatchObject({ tasks: 2, change: 100, activeDays: 1, perDay: 2 });
    expect(s.highlights[0]!.text).toBe('החודש החזק ביותר: מרץ, עם 2 משימות');
    expect(s.prevMonths?.[2]).toBe(1);
  });
});
