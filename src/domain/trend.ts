import { addDays, dayOfWeek, lastDayOfMonth, weekNumber, weeksInYear } from './dates';
import type { Area, Project, Task } from './schemas';
import { areaBreakdown, doneDay, type AreaShare } from './yearReview';

/** R-DSK-3: the big desktop chart of completed tasks, by week / month / year, split by area, against the period before. Pure. */

export type TrendPeriod = 'week' | 'month' | 'year';

export interface TrendBucket {
  from: string;
  to: string;
  total: number;
  /** Same order as Trend.areas. */
  byArea: number[];
  /** The same period a year earlier (for years: the year before). Undefined when there is nothing to compare with. */
  prev?: number;
  /** Starts after today (the current year is still running). */
  future: boolean;
}

export interface Trend {
  period: TrendPeriod;
  areas: AreaShare[];
  buckets: TrendBucket[];
  total: number;
  /** Last year up to the same date (the whole year when this one is over). Null when it had nothing. */
  prevTotal: number | null;
  /** Percent change against prevTotal. */
  change: number | null;
}

const yearOf = (d: string) => Number(d.slice(0, 4));
const pad = (n: number) => String(n).padStart(2, '0');

/** Same month and day, one year earlier (29/2 → 28/2). */
function yearBefore(date: string): string {
  const y = yearOf(date) - 1;
  const m = Number(date.slice(5, 7));
  const d = Math.min(Number(date.slice(8, 10)), lastDayOfMonth(y, m));
  return `${y}-${date.slice(5, 7)}-${pad(d)}`;
}

/** Bucket ranges of a year: weeks (Sunday to Saturday, cut at the year's edges) or months. */
function ranges(year: number, period: 'week' | 'month'): { from: string; to: string }[] {
  if (period === 'month') return Array.from({ length: 12 }, (_, m) => ({ from: `${year}-${pad(m + 1)}-01`, to: `${year}-${pad(m + 1)}-${pad(lastDayOfMonth(year, m + 1))}` }));
  const out: { from: string; to: string }[] = [];
  let from = `${year}-01-01`;
  for (let w = 0; w < weeksInYear(year); w++) {
    const to = addDays(from, 6 - dayOfWeek(from));
    out.push({ from, to: to > `${year}-12-31` ? `${year}-12-31` : to });
    from = addDays(to, 1);
  }
  return out;
}

function bucketOf(day: string, period: TrendPeriod): number {
  return period === 'week' ? weekNumber(day) - 1 : period === 'month' ? Number(day.slice(5, 7)) - 1 : yearOf(day);
}

export function trendSeries(tasks: Task[], projects: Project[], areas: Area[], year: number, period: TrendPeriod, today: string): Trend {
  const done = tasks.map((t) => ({ t, day: doneDay(t) })).filter((x): x is { t: Task; day: string } => !!x.day);
  const firstYear = Math.min(year, ...done.map((x) => yearOf(x.day)));
  const list =
    period === 'year'
      ? Array.from({ length: year - firstYear + 1 }, (_, i) => ({ from: `${firstYear + i}-01-01`, to: `${firstYear + i}-12-31` }))
      : ranges(year, period);
  const shown = done.filter((x) => x.day >= list[0]!.from && x.day <= list[list.length - 1]!.to);
  const areaList = areaBreakdown(
    shown.map((x) => x.t),
    projects,
    areas,
  );
  const areaIndex = new Map(areaList.map((a, i) => [a.id, i]));
  const areaOf = (t: Task) => t.projectIds.map((id) => projects.find((p) => p.id === id)?.areaId).find(Boolean) ?? '';

  const buckets: TrendBucket[] = list.map((r) => ({ ...r, total: 0, byArea: Array<number>(areaList.length).fill(0), future: r.from > today }));
  const first = bucketOf(list[0]!.from, period);
  for (const { t, day } of shown) {
    const b = buckets[bucketOf(day, period) - first]!;
    b.total++;
    b.byArea[areaIndex.get(areaOf(t))!]!++;
  }

  // the period before: the same weeks / months last year, or the year before
  const counts = new Map<number, number>();
  for (const { day } of done) if (yearOf(day) === year - 1) counts.set(bucketOf(day, period), (counts.get(bucketOf(day, period)) ?? 0) + 1);
  if (period === 'year') buckets.forEach((b, i) => i > 0 && (b.prev = buckets[i - 1]!.total));
  else if (counts.size) buckets.forEach((b, i) => (b.prev = counts.get(i) ?? 0));

  // totals: this year so far against last year up to the same date
  const cut = today < `${year}-12-31` ? yearBefore(today) : `${year - 1}-12-31`;
  const total = done.filter((x) => yearOf(x.day) === year).length;
  const prevCount = done.filter((x) => yearOf(x.day) === year - 1 && x.day <= cut).length;
  return {
    period,
    areas: areaList,
    buckets,
    total,
    prevTotal: prevCount || null,
    change: prevCount ? Math.round(((total - prevCount) / prevCount) * 100) : null,
  };
}

/** Round axis steps (1, 2, 5 × 10ⁿ) for whole counts: 0 … top, about `count` steps, top ≥ max. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw)!);
  const out: number[] = [];
  for (let v = 0; v < max + step; v += step) out.push(v);
  return out;
}
