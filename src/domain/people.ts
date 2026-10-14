import { diffDays, HE_MONTHS, lastDayOfMonth } from './dates';

export interface BirthdayInfo {
  month: number;
  day: number;
  /** Date of the next birthday (today if it is today). */
  next: string;
  daysUntil: number;
  /** Age on the next birthday, when the year is known. */
  age?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** R-PPL-2. `birthday` is `MM-DD` or `YYYY-MM-DD`. Feb 29 falls on Feb 28 in common years. */
export function birthdayInfo(birthday: string, today: string): BirthdayInfo {
  const parts = birthday.split('-').map(Number);
  const [year, month, day] = parts.length === 3 ? parts : [undefined, parts[0]!, parts[1]!];
  const on = (y: number) => `${y}-${pad(month!)}-${pad(Math.min(day!, lastDayOfMonth(y, month!)))}`;
  const thisYear = Number(today.slice(0, 4));
  const next = on(thisYear) >= today ? on(thisYear) : on(thisYear + 1);
  const nextYear = Number(next.slice(0, 4));
  return { month: month!, day: day!, next, daysUntil: diffDays(today, next), age: year ? nextYear - year : undefined };
}

/** "🎂 14 באוקטובר · בעוד 12 ימים (גיל 35)" */
export function describeBirthday(info: BirthdayInfo): string {
  const age = info.age !== undefined ? ` (גיל ${info.age})` : '';
  if (info.daysUntil === 0) return `🎂 היום!${age}`;
  const when = info.daysUntil === 1 ? 'מחר' : `בעוד ${info.daysUntil} ימים`;
  return `🎂 ${info.day} ב${HE_MONTHS[info.month - 1]} · ${when}${age}`;
}
