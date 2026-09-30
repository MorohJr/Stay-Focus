import { dayOfWeek, diffDays, HE_DAYS, lastDayOfMonth, parseISODate, weekStart } from './dates';
import type { Recurring, RecurrenceRule } from './schemas';

/** Does the rule fall on this date? (SPEC 3.9) */
export function occursOn(r: Pick<Recurring, 'rule' | 'startDate' | 'endDate' | 'active'>, date: string): boolean {
  if (!r.active || date < r.startDate || (r.endDate && date > r.endDate)) return false;
  const rule = r.rule;
  switch (rule.type) {
    case 'daily':
      return true;
    case 'weekly':
      return rule.days.includes(dayOfWeek(date));
    case 'interval': {
      if (dayOfWeek(date) !== rule.day) return false;
      const weeks = diffDays(weekStart(r.startDate), weekStart(date)) / 7;
      return weeks % rule.weeks === 0;
    }
    case 'monthly': {
      const d = parseISODate(date);
      const last = lastDayOfMonth(d.getFullYear(), d.getMonth() + 1);
      return d.getDate() === Math.min(rule.dayOfMonth, last);
    }
  }
}

/** "כל רביעי", "כל שבועיים ביום רביעי", "כל יום", "כל 15 בחודש" */
export function describeRule(rule: RecurrenceRule): string {
  switch (rule.type) {
    case 'daily':
      return 'כל יום';
    case 'weekly': {
      if (rule.days.length === 7) return 'כל יום';
      if (rule.days.length === 1) return `כל ${HE_DAYS[rule.days[0]!]}`;
      return `כל ${[...rule.days].sort().map((d) => HE_DAYS[d]).join(', ')}`;
    }
    case 'interval':
      if (rule.weeks === 1) return `כל ${HE_DAYS[rule.day]}`;
      return `${rule.weeks === 2 ? 'כל שבועיים' : `כל ${rule.weeks} שבועות`} ביום ${HE_DAYS[rule.day]}`;
    case 'monthly':
      return `כל ${rule.dayOfMonth} בחודש`;
  }
}
