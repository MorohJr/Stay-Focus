import { addDays, localDate, minutesOf } from './dates';
import { routineWindows } from './routine';
import type { RoutineSettings, Task } from './schemas';
import { compareForDay, isOpen } from './tasks';

/** Selectors for the Today screen (SPEC 4). All pure; the screen only renders what they return. */

export const DEFAULT_DURATION = 30;
const DAY = 24 * 60;

/** R-SLP-1/2: wake and bedtime of a date, in minutes from that date's midnight (bed may pass 24:00). */
export interface DayBounds {
  wake: number;
  bed: number;
}

export function dayBounds(r: RoutineSettings, date: string): DayBounds {
  const wins = routineWindows(r, date);
  const wake = minutesOf(wins[0]!.start);
  let bed = minutesOf(wins[1]!.end);
  if (bed <= wake) bed += DAY;
  return { wake, bed };
}

/** The card's day: `date` and `now` (minutes from that date's midnight, may pass 24:00). */
export interface DayFrame extends DayBounds {
  date: string;
  now: number;
  /** R-SLP-4: between bedtime and the next wake. */
  asleep: boolean;
}

/** R-SLP-3: until wake time, the hours after midnight belong to the previous night. */
export function dayFrame(r: RoutineSettings, today: string, nowMin: number): DayFrame {
  const own = dayBounds(r, today);
  if (nowMin >= own.wake) return { date: today, ...own, now: nowMin, asleep: nowMin >= own.bed };
  const date = addDays(today, -1);
  const b = dayBounds(r, date);
  const now = nowMin + DAY;
  return { date, ...b, now, asleep: now >= b.bed };
}

/** R-TOD-1 */
export function greeting(nowMin: number): string {
  if (nowMin >= 5 * 60 && nowMin < 12 * 60) return 'בוקר טוב';
  if (nowMin >= 12 * 60 && nowMin < 17 * 60) return 'צהריים טובים';
  if (nowMin >= 17 * 60 && nowMin < 21 * 60) return 'ערב טוב';
  return 'לילה טוב';
}

export function taskSpan(t: Task): { start: number; end: number } | undefined {
  if (!t.startTime) return undefined;
  const start = minutesOf(t.startTime);
  return { start, end: start + (t.durationMin ?? DEFAULT_DURATION) };
}

const onDay = (t: Task, today: string) => t.dueDate === today && t.status !== 'archived';

/** R-TOD-4 */
export function top3(tasks: Task[], today: string): Task[] {
  return tasks
    .filter((t) => t.top3Date === today && t.status !== 'archived')
    .sort((a, b) => (a.top3Order ?? 9) - (b.top3Order ?? 9))
    .slice(0, 3);
}

/** R-TOD-7 */
export function moreToday(tasks: Task[], today: string): Task[] {
  const list = tasks.filter((t) => onDay(t, today) && t.top3Date !== today && !t.recurringId && !t.parentId);
  const open = list.filter(isOpen).sort(compareForDay);
  const done = list.filter((t) => t.status === 'done').sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
  return [...open, ...done];
}

/** R-TOD-6 */
export function regulars(tasks: Task[], today: string): Task[] {
  return tasks.filter((t) => onDay(t, today) && !!t.recurringId).sort(compareForDay);
}

/** R-TOD-5 */
export function overdue(tasks: Task[], today: string): Task[] {
  const late = tasks.filter((t) => isOpen(t) && !t.someday && !!t.dueDate && t.dueDate < today && !t.recurringId);
  const lateIds = new Set(late.map((t) => t.id));
  return late.filter((t) => !(t.parentId && lateIds.has(t.parentId))).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || compareForDay(a, b));
}

/** Open tasks of today with a start time, in time order. */
function scheduledOpen(tasks: Task[], today: string): { task: Task; start: number; end: number }[] {
  return tasks
    .filter((t) => onDay(t, today) && isOpen(t) && t.startTime)
    .map((task) => ({ task, ...taskSpan(task)! }))
    .sort((a, b) => a.start - b.start);
}

export type NowCard =
  | { kind: 'scheduled'; task: Task; start: number; end: number; minutesLeft: number; progress: number }
  | { kind: 'suggestion'; task: Task; source: 'top3' | 'today' }
  | { kind: 'empty'; hasLater: boolean };

/** R-TOD-2 */
export function nowCard(tasks: Task[], today: string, nowMin: number): NowCard {
  const running = scheduledOpen(tasks, today).filter((s) => s.start <= nowMin && nowMin < s.end);
  const cur = running[running.length - 1];
  if (cur) {
    return {
      kind: 'scheduled',
      task: cur.task,
      start: cur.start,
      end: cur.end,
      minutesLeft: cur.end - nowMin,
      progress: Math.round(((nowMin - cur.start) / (cur.end - cur.start)) * 100),
    };
  }
  // A task scheduled later today is shown in "next", not suggested now.
  const later = (t: Task) => !!t.startTime && minutesOf(t.startTime) > nowMin;
  const fromTop = top3(tasks, today).find((t) => isOpen(t) && !later(t));
  if (fromTop) return { kind: 'suggestion', task: fromTop, source: 'top3' };
  const fromToday = moreToday(tasks, today).find((t) => isOpen(t) && !later(t));
  if (fromToday) return { kind: 'suggestion', task: fromToday, source: 'today' };
  return { kind: 'empty', hasLater: scheduledOpen(tasks, today).some((s) => s.start > nowMin) };
}

/** R-TOD-3 */
export function nextTask(tasks: Task[], today: string, nowMin: number): Task | undefined {
  return scheduledOpen(tasks, today).find((s) => s.start > nowMin)?.task;
}

export interface DayBlock {
  start: number;
  end: number;
  kind: 'routine' | 'task' | 'top3' | 'event';
  title: string;
  open: boolean;
}

/** R-TOD-8: blocks on the wake–bedtime strip. */
export function dayBlocks(tasks: Task[], today: string, routines: RoutineSettings, hasRoutineItems: { morning: boolean; evening: boolean }, events: { start?: number; end?: number; event: { title: string } }[] = []): DayBlock[] {
  const blocks: DayBlock[] = [];
  for (const w of routineWindows(routines, today)) {
    if (!hasRoutineItems[w.kind]) continue;
    const start = minutesOf(w.start);
    let end = minutesOf(w.end);
    if (end <= start) end += DAY; // R-SLP-2: the evening may end after midnight
    blocks.push({ start, end, kind: 'routine', title: w.kind === 'morning' ? 'שגרת בוקר' : 'שגרת ערב', open: true });
  }
  for (const t of tasks) {
    if (!onDay(t, today) || !t.startTime) continue;
    const span = taskSpan(t)!;
    blocks.push({ ...span, kind: t.top3Date === today ? 'top3' : 'task', title: t.title, open: isOpen(t) });
  }
  // 1.16: timed events (R-EVT-1) are busy too
  for (const o of events) if (o.start !== undefined) blocks.push({ start: o.start, end: o.end!, kind: 'event', title: o.event.title, open: true });
  return blocks;
}

/** R-TOD-8: free minutes from now until bedtime, minus the remaining busy parts (a union), rounded to 30. */
export function freeMinutes(blocks: DayBlock[], nowMin: number, bounds: DayBounds): number {
  const from = Math.max(nowMin, bounds.wake);
  const to = bounds.bed;
  if (from >= to) return 0;
  return Math.round(freeBetween(blocks.filter((b) => b.open), from, to) / 30) * 30;
}

/** Minutes in [from, to) not covered by any block (the union of blocks, no double counting). */
export function freeBetween(blocks: { start: number; end: number }[], from: number, to: number): number {
  if (from >= to) return 0;
  const busy = blocks
    .map((b) => [Math.max(b.start, from), Math.min(b.end, to)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let used = 0;
  let curS = -1;
  let curE = -1;
  for (const [s, e] of busy) {
    if (s > curE) {
      if (curE > curS) used += curE - curS;
      curS = s;
      curE = e;
    } else curE = Math.max(curE, e);
  }
  if (curE > curS) used += curE - curS;
  return to - from - used;
}

/** R-TOD-8: hour labels under the strip: wake, every third whole hour, bedtime (no crowding at the edges). */
export function stripHours(b: DayBounds): { min: number; label: string }[] {
  const label = (m: number) => {
    const h = Math.floor(m / 60) % 24;
    return m % 60 ? `${h}:${String(m % 60).padStart(2, '0')}` : String(h === 0 ? 24 : h);
  };
  const out = [{ min: b.wake, label: label(b.wake) }];
  for (let m = Math.ceil(b.wake / 180) * 180; m < b.bed; m += 180) {
    if (m - b.wake >= 120 && b.bed - m >= 120) out.push({ min: m, label: label(m) });
  }
  out.push({ min: b.bed, label: label(b.bed) });
  return out;
}

export interface Ring {
  pct: number | null;
  done: number;
  total: number;
}

export function ring(done: number, total: number): Ring {
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : null };
}

/** R-TOD-9: average of the rings that have data. */
export function ringsAverage(rings: Ring[]): number | null {
  const withData = rings.filter((r) => r.pct !== null);
  if (!withData.length) return null;
  return Math.round(withData.reduce((a, r) => a + r.pct!, 0) / withData.length);
}

/** "6.5 שעות", "45 דק׳" */
export function formatDuration(min: number): string {
  if (min < 60) return `${min} דק׳`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} שעות`;
}

/** R-CLS: the optional day close shows from 20:00 until midnight. */
export const DAY_CLOSE_START = 20 * 60;

export type DayCloseCard = { closed: true } | { closed: false; doneCount: number; open: Task[] };

/** R-CLS */
export function dayCloseCard(tasks: Task[], today: string, nowMin: number, dayClosedOn: string | undefined): DayCloseCard | undefined {
  if (nowMin < DAY_CLOSE_START) return undefined;
  if (dayClosedOn === today) return { closed: true };
  const doneCount = tasks.filter((t) => t.status === 'done' && t.completedAt && localDate(t.completedAt) === today).length;
  const tops = top3(tasks, today).filter(isOpen);
  const rest = moreToday(tasks, today).filter(isOpen);
  return { closed: false, doneCount, open: [...tops, ...rest] };
}
