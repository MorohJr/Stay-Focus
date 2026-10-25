import { describe, expect, it } from 'vitest';
import { minutesOf as m } from './dates';
import { eventOccursOn, eventsOn, eventSpan, eventsTimeline, occurrenceTime } from './events';
import { DEFAULT_ROUTINES, DEFAULT_WORK, type Area, type CalEvent, type Project, type Task } from './schemas';
import { dayBlocks, dayBounds, freeMinutes } from './today';
import { dayPlan, isWorkTask, layoutLanes, sleepRanges, snapMinutes, toSchedule, weekDays, workWindow, type PlanInput } from './week';

const T0 = '2026-09-01T00:00:00.000Z';
const TODAY = '2026-09-30'; // Wednesday
let n = 0;
function task(p: Partial<Task> = {}): Task {
  n++;
  return {
    id: p.id ?? `t${n}`, createdAt: T0, updatedAt: T0, seq: n, title: `task ${n}`, body: '', status: 'todo', projectIds: [], labels: [],
    urgent: false, important: false, links: [], attachmentIds: [], sortOrder: 0, someday: false, postponeCount: 0, ...p,
  };
}
function ev(p: Partial<CalEvent> = {}): CalEvent {
  n++;
  return { id: `e${n}`, createdAt: T0, updatedAt: T0, title: `event ${n}`, date: TODAY, allDay: false, startTime: '10:00', endTime: '11:00', location: '', body: '', repeat: 'none', skipDates: [], ...p };
}
const areas: Area[] = [
  { id: 'aw', name: 'עבודה', color: '#111', order: 0, work: true, createdAt: T0, updatedAt: T0 },
  { id: 'ap', name: 'אישי', color: '#222', order: 1, work: false, createdAt: T0, updatedAt: T0 },
];
const projects = [
  { id: 'pw', areaId: 'aw' },
  { id: 'pp', areaId: 'ap' },
] as Project[];

describe('events (3.17)', () => {
  it('R-EVT-1: one-off, weekly, monthly (short month → last day) and yearly (Feb 29)', () => {
    expect(eventOccursOn({ date: TODAY, repeat: 'none' }, TODAY)).toBe(true);
    expect(eventOccursOn({ date: TODAY, repeat: 'none' }, '2026-10-07')).toBe(false);
    expect(eventOccursOn({ date: TODAY, repeat: 'weekly' }, '2026-10-07')).toBe(true);
    expect(eventOccursOn({ date: TODAY, repeat: 'weekly' }, '2026-09-23')).toBe(false); // before the start
    expect(eventOccursOn({ date: '2026-01-31', repeat: 'monthly' }, '2026-02-28')).toBe(true);
    expect(eventOccursOn({ date: '2026-01-31', repeat: 'monthly' }, '2026-03-31')).toBe(true);
    expect(eventOccursOn({ date: '2026-01-31', repeat: 'monthly' }, '2026-03-30')).toBe(false);
    expect(eventOccursOn({ date: '2024-02-29', repeat: 'yearly' }, '2025-02-28')).toBe(true);
    expect(eventOccursOn({ date: '2024-02-29', repeat: 'yearly' }, '2028-02-29')).toBe(true);
    expect(eventOccursOn({ date: '2024-02-29', repeat: 'yearly' }, '2028-02-28')).toBe(false);
  });
  it('R-EVT-5: a skipped date is not an occurrence', () => {
    expect(eventOccursOn({ date: TODAY, repeat: 'weekly', skipDates: ['2026-10-07'] }, '2026-10-07')).toBe(false);
    expect(eventOccursOn({ date: TODAY, repeat: 'weekly', skipDates: ['2026-10-07'] }, '2026-10-14')).toBe(true);
  });
  it('R-EVT-6: upcoming by next date, then the last past ones', () => {
    const weekly = ev({ id: 'w', date: '2026-09-02', repeat: 'weekly' }); // Wednesdays
    const once = ev({ id: 'o', date: '2026-10-05' });
    const old = ev({ id: 'x', date: '2026-09-10' });
    const t = eventsTimeline([once, weekly, old], TODAY);
    expect(t.upcoming.map((o) => [o.event.id, o.date])).toEqual([['w', TODAY], ['o', '2026-10-05']]);
    expect(t.past.map((o) => [o.event.id, o.date])).toEqual([['w', '2026-09-23'], ['x', '2026-09-10']]);
  });
  it('R-EVT-3: the end is after the start, otherwise one hour', () => {
    expect(eventSpan({ allDay: false, startTime: '10:00', endTime: '11:30' })).toEqual({ start: m('10:00'), end: m('11:30') });
    expect(eventSpan({ allDay: false, startTime: '10:00', endTime: '09:00' })).toEqual({ start: m('10:00'), end: m('11:00') });
    expect(eventSpan({ allDay: true, startTime: '10:00' })).toBeUndefined();
  });
  it('R-TOD-12: all-day first, then by time', () => {
    const list = eventsOn([ev({ id: 'b', startTime: '14:00', endTime: '15:00' }), ev({ id: 'a', startTime: '09:00' }), ev({ id: 'd', allDay: true }), ev({ id: 'x', date: '2026-10-01' })], TODAY);
    expect(list.map((o) => o.event.id)).toEqual(['d', 'a', 'b']);
    expect(occurrenceTime(list[0]!)).toBe('כל היום');
    expect(occurrenceTime(list[1]!)).toBe('09:00–11:00');
  });
  it('R-TOD-8: timed events are busy on the strip', () => {
    const blocks = dayBlocks([], TODAY, DEFAULT_ROUTINES, { morning: false, evening: false }, eventsOn([ev({ startTime: '10:00', endTime: '12:00' }), ev({ allDay: true })], TODAY));
    expect(blocks).toHaveLength(1);
    expect(freeMinutes(blocks, m('06:00'), dayBounds(DEFAULT_ROUTINES, TODAY))).toBe(16.5 * 60 - 120);
  });
});

describe('work hours and the week (3.18, 5.15)', () => {
  it('R-WRK-1/2: Sun–Thu 09–18 by default, an override wins', () => {
    expect(workWindow(undefined, TODAY)).toEqual({ start: m('09:00'), end: m('18:00') });
    expect(workWindow(undefined, '2026-10-02')).toBeUndefined(); // Friday
    const work = { ...DEFAULT_WORK, overrides: [{ date: TODAY, off: true, note: 'חופש' }, { date: '2026-10-03', off: false, start: '10:00', end: '13:00', note: '' }] };
    expect(workWindow(work, TODAY)).toBeUndefined();
    expect(workWindow(work, '2026-10-03')).toEqual({ start: m('10:00'), end: m('13:00'), note: undefined });
  });
  it('R-WEK-1: the week runs Sunday to Saturday', () => {
    expect(weekDays(TODAY)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  });
  it('R-WEK-2: sleep before wake and after bed, and the previous late night is awake time', () => {
    expect(sleepRanges(DEFAULT_ROUTINES, TODAY)).toEqual([{ start: 0, end: m('06:00') }, { start: m('22:30'), end: 24 * 60 }]);
    const late = { ...DEFAULT_ROUTINES, eveningEnd: '00:30' };
    expect(sleepRanges(late, TODAY)).toEqual([{ start: 30, end: m('06:00') }]);
  });
  it('R-ARE-1: work by the area of a project', () => {
    expect(isWorkTask({ projectIds: ['pw'] }, projects, areas)).toBe(true);
    expect(isWorkTask({ projectIds: ['pp'] }, projects, areas)).toBe(false);
    expect(isWorkTask({ projectIds: [] }, projects, areas)).toBe(false);
  });
  it('R-WEK-4: open sprint tasks without a time', () => {
    const list = [task({ id: 'a', sprintId: 's' }), task({ id: 'b', sprintId: 's', startTime: '10:00', dueDate: TODAY }), task({ id: 'c', sprintId: 's', status: 'done' }), task({ id: 'd', sprintId: 's', parentId: 'a' }), task({ id: 'e', sprintId: 'x' }), task({ id: 'f', sprintId: 's', dueDate: TODAY })];
    expect(toSchedule(list, 's').map((t) => t.id)).toEqual(['a', 'd', 'f']); // sub-tasks too (25/10)
    expect(toSchedule(list, undefined)).toEqual([]);
  });
  it('R-WEK-5: drops snap to 15 minutes inside the day', () => {
    expect(snapMinutes(m('10:07'))).toBe(m('10:00'));
    expect(snapMinutes(m('10:08'))).toBe(m('10:15'));
    expect(snapMinutes(-20)).toBe(0);
    expect(snapMinutes(m('23:55'), 60)).toBe(m('23:00'));
  });
  it('R-WEK-3: overlapping blocks share the width', () => {
    const l = layoutLanes([
      { id: 'a', start: 600, end: 660 },
      { id: 'b', start: 630, end: 700 },
      { id: 'c', start: 700, end: 760 },
      { id: 'd', start: 640, end: 650 },
    ]);
    expect(l.get('a')).toEqual({ lane: 0, lanes: 3 });
    expect(l.get('b')).toEqual({ lane: 1, lanes: 3 });
    expect(l.get('d')).toEqual({ lane: 2, lanes: 3 });
    expect(l.get('c')).toEqual({ lane: 0, lanes: 1 });
  });
  it('R-WEK-6/7: free time inside and outside work, scheduled by kind', () => {
    const input: PlanInput = {
      today: TODAY, nowMin: m('08:00'), routines: DEFAULT_ROUTINES, hasRoutineItems: { morning: true, evening: true }, work: undefined, projects, areas,
      tasks: [task({ dueDate: '2026-10-01', startTime: '10:00', durationMin: 60, projectIds: ['pw'] }), task({ dueDate: '2026-10-01', startTime: '20:00', durationMin: 30 })],
      events: [ev({ date: '2026-10-01', startTime: '13:00', endTime: '14:00' })],
    };
    const p = dayPlan('2026-10-01', input);
    // work 09:00–18:00 = 540, minus morning routine 09:00–09:30, task 60, event 60 → 390
    // awake 06:00–22:30 = 990; outside work = 450, minus morning 06:00–09:00 (180) and evening 18:00–22:30 (270) → 0
    expect(p.free).toEqual({ work: 390, other: 0 });
    expect(p.scheduled).toEqual({ work: 60, personal: 30 });
    expect(dayPlan('2026-09-29', input).free).toBeUndefined(); // past
    // today counts from now
    expect(dayPlan(TODAY, { ...input, nowMin: m('17:00') }).free).toEqual({ work: 60, other: 0 });
  });
});
