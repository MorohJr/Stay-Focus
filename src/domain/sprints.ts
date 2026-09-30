import { addDays, formatShort, weekNumber, weekStart } from './dates';
import type { Sprint } from './schemas';

export type SprintStatus = 'current' | 'next' | 'future' | 'last' | 'past';

export const SPRINT_STATUS_LABEL: Record<SprintStatus, string> = {
  current: 'נוכחי',
  next: 'הבא',
  future: 'עתידי',
  last: 'שעבר',
  past: 'עבר',
};

/** R-SPR-1: Sunday to Saturday. */
export function sprintRange(date: string): { startDate: string; endDate: string } {
  const startDate = weekStart(date);
  return { startDate, endDate: addDays(startDate, 6) };
}

/** "שבוע 40 · 27/9–3/10". The range is a left-to-right isolate so it doesn't flip in RTL. */
export function sprintName(startDate: string): string {
  return `שבוע ${weekNumber(startDate)} · \u2066${formatShort(startDate)}–${formatShort(addDays(startDate, 6))}\u2069`;
}

/** R-SPR-2: status derived from dates. */
export function sprintStatus(s: Pick<Sprint, 'startDate' | 'endDate'>, today: string): SprintStatus {
  const cur = weekStart(today);
  if (s.startDate <= today && today <= s.endDate) return 'current';
  if (s.startDate > today) return s.startDate === addDays(cur, 7) ? 'next' : 'future';
  return s.startDate === addDays(cur, -7) ? 'last' : 'past';
}

/** R-SPR-1: the weeks that must exist (this week and next week) and are missing. */
export function missingSprintWeeks(existing: Pick<Sprint, 'startDate'>[], today: string): string[] {
  const cur = weekStart(today);
  return [cur, addDays(cur, 7)].filter((w) => !existing.some((s) => s.startDate === w));
}

export function findSprintFor(sprints: Sprint[], date: string): Sprint | undefined {
  return sprints.find((s) => s.startDate <= date && date <= s.endDate);
}

/** R-SPR-4: last week's sprint that still needs a summary. */
export function sprintNeedingReview(sprints: Sprint[], today: string): Sprint | undefined {
  return sprints.find((s) => sprintStatus(s, today) === 'last' && !s.reviewedAt);
}
