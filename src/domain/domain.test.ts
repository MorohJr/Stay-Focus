import { describe, expect, it } from 'vitest';
import * as D from './dates';
import { activeBlockers, completion, isInbox, quadrantOf, withStatus } from './tasks';
import { missingSprintWeeks, sprintName, sprintNeedingReview, sprintRange, sprintStatus } from './sprints';
import { describeRule, occursOn } from './recurring';
import { activeRoutineWindow, routineCard, routineDayStats } from './routine';
import { challengeDay, dayMark, nextRuleValue, rulesCardVisible, streak } from './challenge';
import { focusGoal, goalProgress } from './goals';
import { dayBlocks, freeMinutes, greeting, moreToday, nextTask, nowCard, overdue, regulars, ringsAverage, ring, top3 } from './today';
import { DEFAULT_ROUTINES, type Challenge, type ChallengeLog, type Goal, type Project, type Recurring, type RoutineItem, type RoutineLog, type Sprint, type Task } from './schemas';

const T0 = '2026-09-01T00:00:00.000Z';
let n = 0;
function task(p: Partial<Task> = {}): Task {
  n++;
  return {
    id: p.id ?? `t${n}`, createdAt: T0, updatedAt: T0, seq: n, title: `task ${n}`, body: '', status: 'todo', projectIds: [], labels: [],
    urgent: false, important: false, links: [], attachmentIds: [], sortOrder: 0, ...p,
  };
}
const TODAY = '2026-09-30'; // Wednesday
const m = D.minutesOf;

describe('dates', () => {
  it('week starts on Sunday and week numbers count from the week of Jan 1', () => {
    expect(D.dayOfWeek(TODAY)).toBe(3);
    expect(D.weekStart(TODAY)).toBe('2026-09-27');
    expect(D.weekNumber(TODAY)).toBe(40);
    expect(D.weekNumber('2026-01-01')).toBe(1);
    expect(D.weekNumber('2026-01-04')).toBe(2);
    expect(D.weeksInYear(2026)).toBe(53);
  });
  it('formats in Hebrew', () => {
    expect(D.formatLong(TODAY)).toBe('יום רביעי · 30 בספטמבר');
    expect(D.formatRelative('2026-09-29', TODAY)).toBe('אתמול');
    expect(D.formatRelative('2026-09-27', TODAY)).toBe('לפני 3 ימים');
    expect(D.addDays('2026-09-30', 1)).toBe('2026-10-01');
  });
});

describe('tasks', () => {
  it('R-INB-1: inbox = open with no date, project, sprint or parent', () => {
    expect(isInbox(task())).toBe(true);
    expect(isInbox(task({ dueDate: TODAY }))).toBe(false);
    expect(isInbox(task({ projectIds: ['p'] }))).toBe(false);
    expect(isInbox(task({ sprintId: 's' }))).toBe(false);
    expect(isInbox(task({ parentId: 'x' }))).toBe(false);
    expect(isInbox(task({ status: 'done' }))).toBe(false);
  });
  it('R-TSK-1: completedAt follows done', () => {
    const t = withStatus(task(), 'done', 'NOW');
    expect(t.completedAt).toBe('NOW');
    expect(withStatus(t, 'done', 'LATER').completedAt).toBe('NOW');
    expect(withStatus(t, 'todo', 'X').completedAt).toBeUndefined();
  });
  it('R-PRJ-1: completion ignores archived, 0 when empty', () => {
    expect(completion([]).pct).toBe(0);
    expect(completion([task({ status: 'done' }), task(), task({ status: 'archived' })]).pct).toBe(50);
  });
  it('R-PRJ-2: blockers that are not done', () => {
    const a = { id: 'a', status: 'active', blockedByIds: ['b', 'c'] } as Project;
    const all = [a, { id: 'b', status: 'done', blockedByIds: [] }, { id: 'c', status: 'planning', blockedByIds: [] }] as Project[];
    expect(activeBlockers(a, all).map((p) => p.id)).toEqual(['c']);
  });
  it('matrix quadrants', () => {
    expect(quadrantOf({ urgent: true, important: true })).toBe('do');
    expect(quadrantOf({ urgent: false, important: true })).toBe('plan');
    expect(quadrantOf({ urgent: true, important: false })).toBe('delegate');
    expect(quadrantOf({ urgent: false, important: false })).toBe('drop');
  });
});

describe('sprints', () => {
  const mk = (startDate: string): Sprint => ({ id: startDate, createdAt: T0, updatedAt: T0, name: sprintName(startDate), ...sprintRange(startDate) });
  it('R-SPR-1: Sunday–Saturday, named by week', () => {
    expect(sprintRange(TODAY)).toEqual({ startDate: '2026-09-27', endDate: '2026-10-03' });
    expect(sprintName('2026-09-27')).toBe('שבוע 40 · 27/9–3/10');
    expect(missingSprintWeeks([mk('2026-09-27')], TODAY)).toEqual(['2026-10-04']);
    expect(missingSprintWeeks([], TODAY)).toEqual(['2026-09-27', '2026-10-04']);
  });
  it('R-SPR-2: status from dates', () => {
    expect(sprintStatus(mk('2026-09-27'), TODAY)).toBe('current');
    expect(sprintStatus(mk('2026-10-04'), TODAY)).toBe('next');
    expect(sprintStatus(mk('2026-10-11'), TODAY)).toBe('future');
    expect(sprintStatus(mk('2026-09-20'), TODAY)).toBe('last');
    expect(sprintStatus(mk('2026-09-13'), TODAY)).toBe('past');
  });
  it('R-SPR-4: last week needs a review until reviewedAt is set', () => {
    const last = mk('2026-09-20');
    expect(sprintNeedingReview([last, mk('2026-09-27')], TODAY)?.id).toBe(last.id);
    expect(sprintNeedingReview([{ ...last, reviewedAt: 'x' }], TODAY)).toBeUndefined();
  });
});

describe('recurring', () => {
  const rec = (rule: Recurring['rule'], startDate = '2026-09-01'): Recurring =>
    ({ id: 'r', createdAt: T0, updatedAt: T0, title: 'x', body: '', projectIds: [], labels: [], rule, startDate, active: true });
  it('weekly on Wednesday', () => {
    expect(occursOn(rec({ type: 'weekly', days: [3] }), TODAY)).toBe(true);
    expect(occursOn(rec({ type: 'weekly', days: [3] }), '2026-10-01')).toBe(false);
  });
  it('every two weeks from the start week', () => {
    const r = rec({ type: 'interval', weeks: 2, day: 3 }, '2026-09-16');
    expect(occursOn(r, '2026-09-16')).toBe(true);
    expect(occursOn(r, '2026-09-23')).toBe(false);
    expect(occursOn(r, TODAY)).toBe(true);
  });
  it('monthly falls on the last day in short months', () => {
    const r = rec({ type: 'monthly', dayOfMonth: 31 }, '2026-01-01');
    expect(occursOn(r, TODAY)).toBe(true);
    expect(occursOn(r, '2026-10-30')).toBe(false);
    expect(occursOn(r, '2026-10-31')).toBe(true);
  });
  it('respects start, end and active', () => {
    expect(occursOn(rec({ type: 'daily' }, '2026-10-01'), TODAY)).toBe(false);
    expect(occursOn({ ...rec({ type: 'daily' }), endDate: '2026-09-29' }, TODAY)).toBe(false);
    expect(occursOn({ ...rec({ type: 'daily' }), active: false }, TODAY)).toBe(false);
  });
  it('describes rules in Hebrew', () => {
    expect(describeRule({ type: 'weekly', days: [3] })).toBe('כל רביעי');
    expect(describeRule({ type: 'interval', weeks: 2, day: 3 })).toBe('כל שבועיים ביום רביעי');
  });
});

describe('routine', () => {
  const item = (routine: 'morning' | 'evening', id: string, active = true): RoutineItem => ({ id, createdAt: T0, updatedAt: T0, routine, title: id, order: 0, active });
  const items = [item('morning', 'm1'), item('morning', 'm2'), item('evening', 'e1'), item('evening', 'off', false)];
  const logs: RoutineLog[] = [{ id: `${TODAY}:m1`, date: TODAY, itemId: 'm1', done: true }];
  it('R-RTN-1/2: morning until leaving home, nothing midday, evening in its window', () => {
    expect(activeRoutineWindow(DEFAULT_ROUTINES, TODAY, m('08:30'))?.kind).toBe('morning');
    expect(activeRoutineWindow(DEFAULT_ROUTINES, TODAY, m('09:30'))).toBeUndefined();
    expect(activeRoutineWindow(DEFAULT_ROUTINES, TODAY, m('14:10'))).toBeUndefined();
    expect(activeRoutineWindow(DEFAULT_ROUTINES, TODAY, m('21:15'))?.kind).toBe('evening');
    expect(activeRoutineWindow(DEFAULT_ROUTINES, TODAY, m('22:30'))).toBeUndefined();
  });
  it('weekend morning end applies on Friday and Saturday only when enabled', () => {
    const s = { ...DEFAULT_ROUTINES, weekendDifferent: true };
    expect(activeRoutineWindow(s, '2026-10-02', m('10:30'))?.kind).toBe('morning');
    expect(activeRoutineWindow(s, TODAY, m('10:30'))).toBeUndefined();
  });
  it('R-RTN-3/5: card model, hidden without items, complete when all done', () => {
    const card = routineCard(DEFAULT_ROUTINES, items, logs, TODAY, m('08:00'))!;
    expect(card.total).toBe(2);
    expect(card.done).toBe(1);
    expect(card.complete).toBe(false);
    expect(routineCard(DEFAULT_ROUTINES, [], logs, TODAY, m('08:00'))).toBeUndefined();
    const all = [...logs, { id: 'x', date: TODAY, itemId: 'm2', done: true }];
    expect(routineCard(DEFAULT_ROUTINES, items, all, TODAY, m('08:00'))!.complete).toBe(true);
  });
  it('routine ring counts both routines, active items only', () => {
    expect(routineDayStats(items, logs, TODAY)).toEqual({ done: 1, total: 3 });
  });
});

describe('challenge', () => {
  const c: Challenge = { id: 'c', createdAt: T0, updatedAt: T0, name: 'x', startDate: '2026-09-25', endDate: '2026-12-01', rules: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] };
  const log = (date: string, ruleId: string, value: 'kept' | 'broken'): ChallengeLog => ({ id: `c:${date}:${ruleId}`, challengeId: 'c', date, ruleId, value });
  const clean = (d: string) => [log(d, 'a', 'kept'), log(d, 'b', 'kept')];
  it('R-CHL-2: card visible until all rules of today are marked', () => {
    expect(rulesCardVisible(c, [], TODAY)).toBe(true);
    expect(rulesCardVisible(c, [log(TODAY, 'a', 'kept')], TODAY)).toBe(true);
    expect(rulesCardVisible(c, [log(TODAY, 'a', 'kept'), log(TODAY, 'b', 'broken')], TODAY)).toBe(false);
    expect(rulesCardVisible(undefined, [], TODAY)).toBe(false);
  });
  it('R-CHL-3: toggle cycle', () => {
    expect(nextRuleValue(undefined)).toBe('kept');
    expect(nextRuleValue('kept')).toBe('broken');
    expect(nextRuleValue('broken')).toBeUndefined();
  });
  it('R-CHL-4: streak counts back from yesterday, today only if clean', () => {
    const logs = [...clean('2026-09-27'), ...clean('2026-09-28'), ...clean('2026-09-29')];
    expect(streak(c, logs, TODAY)).toBe(3);
    expect(streak(c, [...logs, ...clean(TODAY)], TODAY)).toBe(4);
    expect(streak(c, [...clean('2026-09-27'), log('2026-09-28', 'a', 'broken'), ...clean('2026-09-29')], TODAY)).toBe(1);
    expect(streak(c, clean('2026-09-28'), TODAY)).toBe(0); // the 29th was not marked
  });
  it('R-CHL-5 and history marks', () => {
    expect(challengeDay(c, TODAY)).toBe(6);
    expect(dayMark(c, clean('2026-09-28'), '2026-09-28', TODAY)).toBe('clean');
    expect(dayMark(c, [log('2026-09-28', 'a', 'broken')], '2026-09-28', TODAY)).toBe('broken');
    expect(dayMark(c, [], '2026-10-05', TODAY)).toBe('future');
  });
});

describe('goals', () => {
  const g = (p: Partial<Goal>): Goal => ({ id: 'g', createdAt: T0, updatedAt: T0, title: 'g', body: '', status: 'active', progressMode: 'projects', manualProgress: 0, inFocus: false, ...p });
  it('R-GOL-1: average of linked project completion', () => {
    const projects = [{ id: 'p1', goalId: 'g', status: 'active' }, { id: 'p2', goalId: 'g', status: 'active' }] as Project[];
    const tasks = [task({ projectIds: ['p1'], status: 'done' }), task({ projectIds: ['p2'] })];
    expect(goalProgress(g({}), projects, tasks)).toBe(50);
    expect(goalProgress(g({ progressMode: 'manual', manualProgress: 70 }), projects, tasks)).toBe(70);
    expect(goalProgress(g({}), [], [])).toBe(0);
  });
  it('R-GOL-2: focus goal, else nearest target', () => {
    const a = g({ id: 'a', targetDate: '2030-01-01' });
    const b = g({ id: 'b', targetDate: '2027-01-01' });
    expect(focusGoal([a, b])?.id).toBe('b');
    expect(focusGoal([a, { ...b, inFocus: false }, { ...a, id: 'c', inFocus: true }])?.id).toBe('c');
    expect(focusGoal([{ ...a, status: 'achieved' }])).toBeUndefined();
  });
});

describe('today', () => {
  it('R-TOD-1 greeting', () => {
    expect(greeting(m('08:30'))).toBe('בוקר טוב');
    expect(greeting(m('14:10'))).toBe('צהריים טובים');
    expect(greeting(m('21:15'))).toBe('לילה טוב');
    expect(greeting(m('19:00'))).toBe('ערב טוב');
  });

  const scheduled = task({ id: 'plan', dueDate: TODAY, startTime: '08:30', durationMin: 30 });
  const later = task({ id: 'web', dueDate: TODAY, startTime: '10:00', durationMin: 120 });
  const t1 = task({ id: 'top1', dueDate: TODAY, top3Date: TODAY, top3Order: 1, status: 'done' });
  const t2 = task({ id: 'top2', dueDate: TODAY, top3Date: TODAY, top3Order: 2 });
  const plain = task({ id: 'plain', dueDate: TODAY });
  const rec = task({ id: 'rec', dueDate: TODAY, recurringId: 'r' });
  const sub = task({ id: 'sub', dueDate: TODAY, parentId: 'plain' });
  const all = [scheduled, later, t1, t2, plain, rec, sub];

  it('R-TOD-2: running scheduled task, else top-3 suggestion, else today, else empty', () => {
    const c = nowCard(all, TODAY, m('08:40'));
    expect(c.kind).toBe('scheduled');
    if (c.kind === 'scheduled') {
      expect(c.task.id).toBe('plan');
      expect(c.minutesLeft).toBe(20);
      expect(c.progress).toBe(33);
    }
    const s = nowCard(all, TODAY, m('14:10'));
    expect(s.kind === 'suggestion' && s.task.id).toBe('top2');
    expect(s.kind === 'suggestion' && s.source).toBe('top3');
    expect(nowCard([plain], TODAY, m('14:10')).kind).toBe('suggestion');
    expect(nowCard([], TODAY, m('14:10')).kind).toBe('empty');
  });
  it('R-TOD-3: next scheduled after now', () => {
    expect(nextTask(all, TODAY, m('08:40'))?.id).toBe('web');
    expect(nextTask(all, TODAY, m('12:00'))).toBeUndefined();
  });
  it('R-TOD-4/6/7: top 3, regulars and "more today" do not overlap', () => {
    expect(top3(all, TODAY).map((t) => t.id)).toEqual(['top1', 'top2']);
    expect(regulars(all, TODAY).map((t) => t.id)).toEqual(['rec']);
    expect(moreToday(all, TODAY).map((t) => t.id)).toEqual(['plan', 'web', 'plain']);
  });
  it('R-TOD-5: overdue excludes recurring instances and children of overdue parents', () => {
    const parent = task({ id: 'p', dueDate: '2026-09-28' });
    const child = task({ id: 'c', dueDate: '2026-09-28', parentId: 'p' });
    const recLate = task({ id: 'rl', dueDate: '2026-09-29', recurringId: 'r' });
    const doneLate = task({ id: 'dl', dueDate: '2026-09-29', status: 'done' });
    const yesterday = task({ id: 'y', dueDate: '2026-09-29' });
    expect(overdue([parent, child, recLate, doneLate, yesterday, plain], TODAY).map((t) => t.id)).toEqual(['p', 'y']);
  });
  it('R-TOD-8: free time subtracts the union of remaining busy blocks', () => {
    const blocks = dayBlocks(all, TODAY, DEFAULT_ROUTINES, { morning: true, evening: true });
    // at 08:30: morning 08:30–09:30 (60), plan 08:30–09:00 overlaps, web 10:00–12:00 (120), evening 18:00–22:30 (270)
    // 15.5h left − 7.5h busy = 8h
    expect(freeMinutes(blocks, m('08:30'))).toBe(480);
    expect(freeMinutes(blocks, m('23:59'))).toBe(0);
    expect(freeMinutes([], m('03:00'))).toBe(18 * 60);
  });
  it('R-TOD-9: rings average only rings with data', () => {
    expect(ring(0, 0).pct).toBeNull();
    expect(ringsAverage([ring(1, 2), ring(0, 0), ring(3, 4)])).toBe(63);
    expect(ringsAverage([ring(0, 0)])).toBeNull();
  });
});
