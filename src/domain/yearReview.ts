import { addDays, dayOfWeek, diffDays, HE_DAYS, HE_MONTHS, localDate, formatDMY } from './dates';
import { isCleanDay } from './challenge';
import { completion } from './tasks';
import type { AgendaItem, Area, Challenge, ChallengeLog, Goal, Milestone, Note, Person, Project, RoutineItem, RoutineLog, Sprint, Task, YearReview } from './schemas';

/** The year summary (SPEC 5.14, R-YIR). Pure: everything is derived from the data and "today". */

export interface YearInput {
  tasks: Task[];
  projects: Project[];
  goals: Goal[];
  milestones: Milestone[];
  challenges: Challenge[];
  challengeLogs: ChallengeLog[];
  sprints: Sprint[];
  routineItems: RoutineItem[];
  routineLogs: RoutineLog[];
  notes: Note[];
  people: Person[];
  agenda: AgendaItem[];
  areas: Area[];
}

const yearOf = (date: string) => Number(date.slice(0, 4));
const inYear = (date: string | undefined, year: number) => !!date && yearOf(date) === year;
const yearStart = (y: number) => `${y}-01-01`;
const yearEnd = (y: number) => `${y}-12-31`;

/** Local completion day of a done task. */
export function doneDay(t: Pick<Task, 'status' | 'completedAt'>): string | undefined {
  return t.status === 'done' && t.completedAt ? localDate(t.completedAt) : undefined;
}

export function completedIn(tasks: Task[], year: number): Task[] {
  return tasks.filter((t) => inYear(doneDay(t), year));
}

/** R-YIR-3: years that have something finished, newest first; the current year is always there. */
export function yearsWithData(input: Pick<YearInput, 'tasks' | 'projects'>, today: string): number[] {
  const ys = new Set<number>([yearOf(today)]);
  for (const t of input.tasks) {
    const d = doneDay(t);
    if (d) ys.add(yearOf(d));
  }
  for (const p of input.projects) if (p.doneAt) ys.add(yearOf(localDate(p.doneAt)));
  return [...ys].filter((y) => y <= yearOf(today)).sort((a, b) => b - a);
}

/** R-YIR-1: in January, last year's summary waits until it is opened. */
export function yearBanner(today: string, tasks: Task[], reviews: Pick<YearReview, 'id' | 'seenAt'>[]): number | undefined {
  if (today.slice(5, 7) !== '01') return undefined;
  const y = yearOf(today) - 1;
  if (reviews.some((r) => r.id === String(y) && r.seenAt)) return undefined;
  return tasks.some((t) => inYear(doneDay(t), y)) ? y : undefined;
}

// ---------------------------------------------------------------------------
// Counts per month / day / weekday / time of day
// ---------------------------------------------------------------------------

export function monthlyCounts(done: Task[]): number[] {
  const out = Array<number>(12).fill(0);
  for (const t of done) out[Number(doneDay(t)!.slice(5, 7)) - 1]!++;
  return out;
}

export function dailyCounts(done: Task[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of done) {
    const d = doneDay(t)!;
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

/** Active day = at least one task completed. Longest run of consecutive active days. */
export function activeDayStats(daily: Record<string, number>): { activeDays: number; longestStreak: number; best?: { date: string; count: number } } {
  const days = Object.keys(daily).sort();
  let longest = 0;
  let run = 0;
  let prev: string | undefined;
  let best: { date: string; count: number } | undefined;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
    if (!best || daily[d]! > best.count) best = { date: d, count: daily[d]! };
  }
  return { activeDays: days.length, longestStreak: longest, best };
}

export function weekdayCounts(done: Task[]): number[] {
  const out = Array<number>(7).fill(0);
  for (const t of done) out[dayOfWeek(doneDay(t)!)]!++;
  return out;
}

export type DayPart = 'morning' | 'noon' | 'evening' | 'night';
export const DAY_PART_LABEL: Record<DayPart, string> = { morning: 'בוקר', noon: 'צהריים', evening: 'ערב', night: 'לילה' };

/** Morning 05–12, noon 12–17, evening 17–22, night otherwise (local time). */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'noon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function dayPartCounts(done: Task[]): Record<DayPart, number> {
  const out: Record<DayPart, number> = { morning: 0, noon: 0, evening: 0, night: 0 };
  for (const t of done) out[dayPart(new Date(t.completedAt!).getHours())]++;
  return out;
}

/** Share of dated tasks that were completed on or before their date. null without dated tasks. */
export function onTimeRate(done: Task[]): number | null {
  const dated = done.filter((t) => t.dueDate && !t.recurringId);
  if (!dated.length) return null;
  return Math.round((dated.filter((t) => doneDay(t)! <= t.dueDate!).length / dated.length) * 100);
}

// ---------------------------------------------------------------------------
// Projects along the year (Gantt) and by area
// ---------------------------------------------------------------------------

export interface ProjectSpan {
  id: string;
  name: string;
  icon: string;
  logoId?: string;
  start: string;
  end: string;
  done: boolean;
  tasksDone: number;
}

/** R-YIR-2 step 7: every project that was alive during the year, clipped to it. */
export function projectSpans(projects: Project[], tasks: Task[], year: number, today: string): ProjectSpan[] {
  const out: ProjectSpan[] = [];
  for (const p of projects) {
    const done = !!p.doneAt;
    if (!done && p.status === 'archived') continue;
    if (!done && p.status === 'planning' && !p.startDate) continue;
    const start = p.startDate ?? localDate(p.createdAt);
    const end = p.doneAt ? localDate(p.doneAt) : p.endDate && p.endDate < today ? p.endDate : today;
    const s = start < yearStart(year) ? yearStart(year) : start;
    const e = end > yearEnd(year) ? yearEnd(year) : end;
    if (s > yearEnd(year) || e < yearStart(year) || e < s) continue;
    const tasksDone = tasks.filter((t) => t.projectIds.includes(p.id) && inYear(doneDay(t), year)).length;
    out.push({ id: p.id, name: p.name, icon: p.icon, logoId: p.logoId, start: s, end: e, done: done && inYear(localDate(p.doneAt!), year), tasksDone });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

/** Position of a date on the year axis, 0–1. */
export function yearFraction(date: string, year: number): number {
  const total = diffDays(yearStart(year), yearEnd(year)) + 1;
  return Math.min(1, Math.max(0, diffDays(yearStart(year), date) / total));
}

export interface AreaShare {
  id: string;
  name: string;
  color: string;
  count: number;
  pct: number;
}

/** R-YIR-2 step 8: completed tasks by the area of their (first) project. */
export function areaBreakdown(done: Task[], projects: Project[], areas: Area[]): AreaShare[] {
  const byId = new Map<string, number>();
  for (const t of done) {
    const area = t.projectIds.map((id) => projects.find((p) => p.id === id)?.areaId).find(Boolean) ?? '';
    byId.set(area, (byId.get(area) ?? 0) + 1);
  }
  const total = done.length || 1;
  return [...byId.entries()]
    .map(([id, count]) => {
      const a = areas.find((x) => x.id === id);
      return { id, name: a?.name ?? 'בלי תחום', color: a?.color ?? 'var(--track2)', count, pct: Math.round((count / total) * 100) };
    })
    .sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : b.count - a.count));
}

/** R-YIR-5: completed tasks per month, split by area (same areas and order as areaBreakdown). months[m][i] = count. */
export function monthlyByArea(done: Task[], projects: Project[], areas: Area[]): { areas: AreaShare[]; months: number[][] } {
  const list = areaBreakdown(done, projects, areas);
  const months = Array.from({ length: 12 }, () => Array<number>(list.length).fill(0));
  for (const t of done) {
    const area = t.projectIds.map((id) => projects.find((p) => p.id === id)?.areaId).find(Boolean) ?? '';
    const i = list.findIndex((x) => x.id === area);
    months[Number(doneDay(t)!.slice(5, 7)) - 1]![i]!++;
  }
  return { areas: list, months };
}

// ---------------------------------------------------------------------------
// Habits, weeks, people, notes
// ---------------------------------------------------------------------------

export function sprintStats(sprints: Sprint[], tasks: Task[], year: number, today: string): { count: number; avgPct: number | null; best?: { sprint: Sprint; pct: number; total: number } } {
  const rows = sprints
    .filter((s) => inYear(s.startDate, year) && s.startDate <= today)
    .map((s) => ({ sprint: s, ...completion(tasks.filter((t) => t.sprintId === s.id && !t.parentId)) }))
    .filter((r) => r.total > 0);
  if (!rows.length) return { count: 0, avgPct: null };
  const avgPct = Math.round(rows.reduce((n, r) => n + r.pct, 0) / rows.length);
  const best = rows.filter((r) => r.total >= 3).sort((a, b) => b.pct - a.pct || b.total - a.total)[0];
  return { count: rows.length, avgPct, best: best && { sprint: best.sprint, pct: best.pct, total: best.total } };
}

/** Routine items ticked ÷ (active items × days they existed in the year, up to today). */
export function routineRate(items: RoutineItem[], logs: RoutineLog[], year: number, today: string): number | null {
  const last = today < yearEnd(year) ? today : yearEnd(year);
  let possible = 0;
  for (const it of items.filter((i) => i.active)) {
    const from = localDate(it.createdAt) > yearStart(year) ? localDate(it.createdAt) : yearStart(year);
    if (from <= last) possible += diffDays(from, last) + 1;
  }
  if (!possible) return null;
  const ids = new Set(items.filter((i) => i.active).map((i) => i.id));
  const done = logs.filter((l) => l.done && inYear(l.date, year) && l.date <= last && ids.has(l.itemId)).length;
  return Math.min(100, Math.round((done / possible) * 100));
}

export function challengeStats(challenges: Challenge[], logs: ChallengeLog[], year: number, today: string): { count: number; cleanDays: number; longest: number } {
  let cleanDays = 0;
  let longest = 0;
  const list = challenges.filter((c) => c.startDate <= yearEnd(year) && c.endDate >= yearStart(year) && c.startDate <= today);
  for (const c of list) {
    const mine = logs.filter((l) => l.challengeId === c.id);
    let run = 0;
    const from = c.startDate > yearStart(year) ? c.startDate : yearStart(year);
    const to = [c.endDate, yearEnd(year), today].sort()[0]!;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (isCleanDay(c, mine, d)) {
        cleanDays++;
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
    }
  }
  return { count: list.length, cleanDays, longest };
}

export function peopleAndNotes(input: Pick<YearInput, 'notes' | 'people' | 'agenda'>, year: number) {
  const notes = input.notes.filter((n) => inYear(localDate(n.createdAt), year));
  return {
    notes: notes.length,
    ideas: notes.filter((n) => n.kinds.includes('idea')).length,
    meetings: notes.filter((n) => n.kinds.includes('meeting')).length,
    people: input.people.filter((p) => inYear(localDate(p.createdAt), year)).length,
    talks: input.agenda.filter((a) => a.doneAt && inYear(localDate(a.doneAt), year)).length,
  };
}

// ---------------------------------------------------------------------------
// Timeline (R-YIR-2 step 9)
// ---------------------------------------------------------------------------

export type EventKind = 'project' | 'goal' | 'milestone' | 'challenge';
export interface TimelineEvent {
  date: string;
  kind: EventKind;
  title: string;
  icon?: string;
  refId: string;
}
export interface TimelineMonth {
  month: number; // 1–12
  events: TimelineEvent[];
  tasks: Task[];
}

export function timeline(input: Pick<YearInput, 'tasks' | 'projects' | 'goals' | 'milestones' | 'challenges'>, year: number, today: string): TimelineMonth[] {
  const events: TimelineEvent[] = [];
  for (const p of input.projects) if (p.doneAt && inYear(localDate(p.doneAt), year)) events.push({ date: localDate(p.doneAt), kind: 'project', title: p.name, icon: p.icon, refId: p.id });
  for (const g of input.goals) if (g.achievedAt && inYear(localDate(g.achievedAt), year)) events.push({ date: localDate(g.achievedAt), kind: 'goal', title: g.title, refId: g.id });
  for (const m of input.milestones) {
    if (!m.doneAt || !inYear(localDate(m.doneAt), year)) continue;
    const p = input.projects.find((x) => x.id === m.projectId);
    events.push({ date: localDate(m.doneAt), kind: 'milestone', title: p ? `${m.title} · ${p.name}` : m.title, refId: m.projectId });
  }
  for (const c of input.challenges) if (inYear(c.endDate, year) && c.endDate < today) events.push({ date: c.endDate, kind: 'challenge', title: c.name, refId: c.id });
  const done = completedIn(input.tasks, year);
  const months: TimelineMonth[] = [];
  for (let m = 12; m >= 1; m--) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    const ev = events.filter((e) => e.date.startsWith(key)).sort((a, b) => b.date.localeCompare(a.date));
    const ts = done.filter((t) => doneDay(t)!.startsWith(key)).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
    if (ev.length || ts.length) months.push({ month: m, events: ev, tasks: ts });
  }
  return months;
}

// ---------------------------------------------------------------------------
// Everything together + highlights
// ---------------------------------------------------------------------------

export interface Highlight {
  icon: string;
  text: string;
}

export function yearSummary(input: YearInput, year: number, today: string) {
  const done = completedIn(input.tasks, year);
  const prevDone = completedIn(input.tasks, year - 1).length;
  const months = monthlyCounts(done);
  const prevMonths = prevDone ? monthlyCounts(completedIn(input.tasks, year - 1)) : undefined;
  const daily = dailyCounts(done);
  const days = activeDayStats(daily);
  const weekdays = weekdayCounts(done);
  const parts = dayPartCounts(done);
  const projectsDone = input.projects.filter((p) => p.doneAt && inYear(localDate(p.doneAt), year));
  const spans = projectSpans(input.projects, input.tasks, year, today);
  const areas = areaBreakdown(done, input.projects, input.areas);
  const areaMonths = monthlyByArea(done, input.projects, input.areas).months;
  const sprints = sprintStats(input.sprints, input.tasks, year, today);
  const kpi = {
    tasks: done.length,
    change: prevDone ? Math.round(((done.length - prevDone) / prevDone) * 100) : null,
    projects: projectsDone.length,
    milestones: input.milestones.filter((m) => m.doneAt && inYear(localDate(m.doneAt), year)).length,
    goals: input.goals.filter((g) => g.achievedAt && inYear(localDate(g.achievedAt), year)).length,
    activeDays: days.activeDays,
    longestStreak: days.longestStreak,
    perDay: days.activeDays ? Math.round((done.length / days.activeDays) * 10) / 10 : 0,
    onTime: onTimeRate(done),
  };

  const highlights: Highlight[] = [];
  const maxMonth = Math.max(...months);
  if (maxMonth > 0) highlights.push({ icon: 'cal', text: `החודש החזק ביותר: ${HE_MONTHS[months.indexOf(maxMonth)]}, עם ${maxMonth} משימות` });
  const maxWd = Math.max(...weekdays);
  if (maxWd > 0) highlights.push({ icon: 'today', text: `היום החזק בשבוע: יום ${HE_DAYS[weekdays.indexOf(maxWd)]}` });
  if (days.best && days.best.count > 1) highlights.push({ icon: 'bolt', text: `השיא ליום אחד: ${days.best.count} משימות ב-${formatDMY(days.best.date)}` });
  const bigProject = projectsDone
    .map((p) => ({ p, n: input.tasks.filter((t) => t.projectIds.includes(p.id) && t.status === 'done').length }))
    .sort((a, b) => b.n - a.n)[0];
  if (bigProject) highlights.push({ icon: 'target', text: `הפרויקט הגדול שהושלם: ${bigProject.p.name}${bigProject.n ? ` (${bigProject.n} משימות)` : ''}` });
  const topArea = areas.find((a) => a.id !== '');
  if (topArea) highlights.push({ icon: 'tag', text: `התחום המוביל: ${topArea.name}, ${topArea.pct}% מהמשימות` });
  if (sprints.best) highlights.push({ icon: 'sprint', text: `השבוע הטוב ביותר: ${sprints.best.sprint.name}, ${sprints.best.pct}% הושלמו` });
  if (days.longestStreak > 2) highlights.push({ icon: 'repeat', text: `רצף של ${days.longestStreak} ימים פעילים ברצף` });

  return {
    year,
    partial: yearEnd(year) > today,
    kpi,
    highlights,
    months,
    prevMonths,
    daily,
    weekdays,
    parts,
    spans,
    areas,
    areaMonths,
    sprints,
    routine: routineRate(input.routineItems, input.routineLogs, year, today),
    challenges: challengeStats(input.challenges, input.challengeLogs, year, today),
    social: peopleAndNotes(input, year),
    timeline: timeline(input, year, today),
  };
}
export type YearSummary = ReturnType<typeof yearSummary>;
