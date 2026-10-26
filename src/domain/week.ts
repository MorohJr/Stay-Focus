import { addDays, minutesOf, dayOfWeek, weekStart } from './dates';
import { eventsOn, type Occurrence } from './events';
import { DEFAULT_WORK, type Area, type CalEvent, type Project, type RoutineSettings, type Task, type WorkSettings } from './schemas';
import { isOpen } from './tasks';
import { dayBlocks, dayBounds, freeBetween, taskSpan, type DayBounds } from './today';

/** The Week screen (SPEC 5.15) and work hours (3.18). All pure. */

export interface Span {
  start: number;
  end: number;
}

/** Sunday … Saturday of the week that contains `date`. */
export function weekDays(date: string): string[] {
  const s = weekStart(date);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(s, i));
}

/** R-WRK-2: a date's work hours (an override wins), or undefined when off. */
export function workWindow(work: WorkSettings | undefined, date: string): (Span & { note?: string }) | undefined {
  const w = work ?? DEFAULT_WORK;
  const o = w.overrides.find((x) => x.date === date);
  if (o) {
    if (o.off || !o.start || !o.end) return undefined;
    return { start: minutesOf(o.start), end: minutesOf(o.end), note: o.note || undefined };
  }
  const d = w.days[dayOfWeek(date)];
  return d ? { start: minutesOf(d.start), end: minutesOf(d.end) } : undefined;
}

/** The override of a date, if any (for the "different day" label). */
export function workOverrideOf(work: WorkSettings | undefined, date: string) {
  return (work ?? DEFAULT_WORK).overrides.find((x) => x.date === date);
}

/** R-WEK-2: the sleeping parts of a date's 00:00–24:00 (the previous night may end after midnight, R-SLP-2). */
export function sleepRanges(r: RoutineSettings, date: string): Span[] {
  const own = dayBounds(r, date);
  const prev = dayBounds(r, addDays(date, -1));
  const out: Span[] = [];
  const awakeFromPrev = Math.max(0, prev.bed - 24 * 60);
  if (own.wake > awakeFromPrev) out.push({ start: awakeFromPrev, end: own.wake });
  if (own.bed < 24 * 60) out.push({ start: own.bed, end: 24 * 60 });
  return out;
}

/** R-ARE-1: a task is "work" when one of its projects is in a work area. */
export function isWorkTask(t: Pick<Task, 'projectIds'>, projects: Pick<Project, 'id' | 'areaId'>[], areas: Pick<Area, 'id' | 'work'>[]): boolean {
  const workAreas = new Set(areas.filter((a) => a.work).map((a) => a.id));
  return projects.some((p) => t.projectIds.includes(p.id) && !!p.areaId && workAreas.has(p.areaId));
}

/** R-WEK-4: open tasks of the sprint without a start time (sub-tasks included, no "someday"). */
export function toSchedule(tasks: Task[], sprintId: string | undefined): Task[] {
  if (!sprintId) return [];
  return tasks.filter((t) => t.sprintId === sprintId && isOpen(t) && !t.someday && !t.startTime).sort((a, b) => a.sortOrder - b.sortOrder || a.seq - b.seq);
}

/** R-WEK-5: drop position → start minute, 15-minute steps, inside the day. */
export function snapMinutes(min: number, duration = 0): number {
  const m = Math.round(min / 15) * 15;
  return Math.max(0, Math.min(24 * 60 - Math.max(15, duration), m));
}

/** R-WEK-3: overlapping blocks share the column width. Returns lane and lane count per id. */
export function layoutLanes(items: (Span & { id: string })[]): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= it.start);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = it.end;
    cluster.push({ id: it.id, lane });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

export interface DayPlan {
  date: string;
  bounds: DayBounds;
  work?: Span & { note?: string };
  sleep: Span[];
  routines: Span[];
  allDay: Occurrence[];
  events: (Occurrence & Span)[];
  tasks: (Span & { task: Task; work: boolean })[];
  /** R-WEK-6: undefined for past days. */
  free?: { work: number; other: number };
  /** R-WEK-7: scheduled minutes by kind. */
  scheduled: { work: number; personal: number };
}

export interface PlanInput {
  today: string;
  nowMin: number;
  routines: RoutineSettings;
  hasRoutineItems: { morning: boolean; evening: boolean };
  work: WorkSettings | undefined;
  tasks: Task[];
  events: CalEvent[];
  projects: Project[];
  areas: Area[];
}

const half = (m: number) => Math.round(m / 30) * 30;

/** R-WEK-2..7: everything the grid shows for one date. */
export function dayPlan(date: string, p: PlanInput): DayPlan {
  const bounds = dayBounds(p.routines, date);
  const work = workWindow(p.work, date);
  const routines = dayBlocks([], date, p.routines, p.hasRoutineItems).map(({ start, end }) => ({ start, end }));
  const occ = eventsOn(p.events, date);
  const events = occ.filter((o): o is Occurrence & Span => o.start !== undefined);
  const tasks = p.tasks
    .filter((t) => t.dueDate === date && t.startTime && t.status !== 'archived')
    .map((task) => ({ ...taskSpan(task)!, task, work: isWorkTask(task, p.projects, p.areas) }))
    .sort((a, b) => a.start - b.start);
  const scheduled = { work: 0, personal: 0 };
  for (const t of tasks) scheduled[t.work ? 'work' : 'personal'] += t.end - t.start;

  let free: DayPlan['free'];
  if (date >= p.today) {
    const from = date === p.today ? p.nowMin : 0;
    const busy = [...events, ...tasks.filter((t) => isOpen(t.task)), ...routines];
    const awake = freeBetween(busy, Math.max(bounds.wake, from), bounds.bed);
    const inWork = work ? freeBetween(busy, Math.max(work.start, from), work.end) : 0;
    const workAwake = work ? freeBetween(busy, Math.max(work.start, bounds.wake, from), Math.min(work.end, bounds.bed)) : 0;
    free = { work: half(inWork), other: half(awake - workAwake) };
  }
  return { date, bounds, work, sleep: sleepRanges(p.routines, date), routines, allDay: occ.filter((o) => o.start === undefined), events, tasks, free, scheduled };
}
