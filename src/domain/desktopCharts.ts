import { addDays, diffDays, localDate, weekStart } from './dates';
import { dayMark, type DayMark } from './challenge';
import { isItemDone } from './routine';
import type { Challenge, ChallengeLog, RoutineItem, RoutineLog, Sprint, Task } from './schemas';
import { completion } from './tasks';
import { doneDay } from './yearReview';

/** R-DSK-4: the extra desktop charts. Pure: everything comes from the data and "today". */

const pctChange = (now: number, before: number) => (before ? Math.round(((now - before) / before) * 100) : null);
/** Main tasks only, archived ones left out (like the sprint and project counts). */
const mainTasks = (tasks: Task[]) => tasks.filter((t) => !t.parentId && t.status !== 'archived');

/** Today: tasks done on each of the last `days` days (oldest first), and the same days one period earlier. */
export function dailyTrend(tasks: Task[], today: string, days = 30) {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const d = doneDay(t);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const rows = Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - days + 1);
    return { date, count: counts.get(date) ?? 0, prev: counts.get(addDays(date, -days)) ?? 0 };
  });
  const total = rows.reduce((n, r) => n + r.count, 0);
  const prevTotal = rows.reduce((n, r) => n + r.prev, 0);
  return { days: rows, total, prevTotal, avg: Math.round((total / days) * 10) / 10, change: pctChange(total, prevTotal) };
}

/** Sprint: completion of the last `n` sprints that have started (oldest first). Empty sprints are left out. */
export function sprintHistory(sprints: Sprint[], tasks: Task[], today: string, n = 12) {
  const rows = sprints
    .filter((s) => s.startDate <= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, current: s.endDate >= today, ...completion(mainTasks(tasks).filter((t) => t.sprintId === s.id)) }))
    .filter((r) => r.total > 0)
    .slice(-n);
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : null;
  return { rows, avg };
}

/** Sprint: open tasks left at the end of each day of the sprint (undefined for days still ahead), and the even pace down to 0. */
export function burndown(sprint: Sprint, tasks: Task[], today: string) {
  const mine = mainTasks(tasks).filter((t) => t.sprintId === sprint.id);
  const total = mine.length;
  const len = diffDays(sprint.startDate, sprint.endDate) + 1;
  const days = Array.from({ length: len }, (_, i) => {
    const date = addDays(sprint.startDate, i);
    const done = mine.filter((t) => {
      const d = doneDay(t);
      return d !== undefined && d <= date;
    }).length;
    return { date, left: date > today ? undefined : total - done, ideal: Math.round((total * (len - 1 - i)) / Math.max(1, len - 1) * 10) / 10 };
  });
  return { total, days };
}

/** Tasks: per week (Sunday to Saturday, oldest first) tasks added, tasks done, and open tasks at the end of the week. */
export function taskFlow(tasks: Task[], today: string, weeks = 12) {
  const main = mainTasks(tasks);
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const rows = Array.from({ length: weeks }, (_, i) => {
    const from = addDays(first, i * 7);
    const to = addDays(from, 6);
    const inWeek = (d: string | undefined) => d !== undefined && d >= from && d <= to;
    const end = to < today ? to : today;
    return {
      from,
      to,
      added: main.filter((t) => inWeek(localDate(t.createdAt))).length,
      done: main.filter((t) => inWeek(doneDay(t))).length,
      open: main.filter((t) => {
        if (localDate(t.createdAt) > end) return false;
        const d = doneDay(t);
        return d === undefined || d > end;
      }).length,
    };
  });
  return { rows, added: rows.reduce((n, r) => n + r.added, 0), done: rows.reduce((n, r) => n + r.done, 0) };
}

/** Routines: for each active item, ticked or not on each of the last `days` days (null before the item existed), and the share per day. */
export function routineMatrix(items: RoutineItem[], logs: RoutineLog[], today: string, days = 30) {
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const active = items.filter((i) => i.active).sort((a, b) => (a.routine === b.routine ? a.order - b.order : a.routine === 'morning' ? -1 : 1));
  const rows = active.map((it) => ({
    id: it.id,
    title: it.title,
    routine: it.routine,
    cells: dates.map((d) => (d < localDate(it.createdAt) ? null : isItemDone(logs, d, it.id))),
  }));
  const pct = dates.map((_, k) => {
    const cells = rows.map((r) => r.cells[k]).filter((c): c is boolean => c !== null);
    return cells.length ? Math.round((cells.filter(Boolean).length / cells.length) * 100) : null;
  });
  return { dates, rows, pct };
}

/** Challenges: one lane per challenge that touches the last `days` days: its day marks, runs of clean days, current and longest run. */
export function challengeLanes(challenges: Challenge[], logs: ChallengeLog[], today: string, days = 60) {
  const from = addDays(today, -days + 1);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const lanes = challenges
    .filter((c) => c.startDate <= today && c.endDate >= from && c.rules.length > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((c) => {
      const mine = logs.filter((l) => l.challengeId === c.id);
      const marks: (DayMark | null)[] = dates.map((d) => (d < c.startDate || d > c.endDate ? null : dayMark(c, mine, d, today)));
      const runs: { start: number; end: number }[] = [];
      marks.forEach((m, i) => {
        if (m !== 'clean') return;
        const last = runs[runs.length - 1];
        if (last && last.end === i - 1) last.end = i;
        else runs.push({ start: i, end: i });
      });
      const longest = Math.max(0, ...runs.map((r) => r.end - r.start + 1));
      // the run that reaches today (or yesterday, when today is not marked yet)
      const tail = runs[runs.length - 1];
      const current = tail && tail.end >= days - 2 ? tail.end - tail.start + 1 : 0;
      return { id: c.id, name: c.name, marks, runs, longest, current, clean: marks.filter((m) => m === 'clean').length };
    });
  return { dates, lanes };
}
