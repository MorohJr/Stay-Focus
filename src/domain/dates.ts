/**
 * Local-calendar date helpers. Dates are stored as `YYYY-MM-DD` in the device's time zone,
 * times as `HH:mm`. The week starts on Sunday (SPEC 1.2).
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** The local calendar date of an ISO timestamp (not its UTC date). */
export function localDate(isoTimestamp: string): string {
  return toISODate(new Date(isoTimestamp));
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(iso: string): number {
  return parseISODate(iso).getDay();
}

export function weekStart(iso: string): string {
  return addDays(iso, -dayOfWeek(iso));
}

/** Week of the year, weeks starting Sunday; the week containing January 1 is week 1 (R-TOD-1). */
export function weekNumber(iso: string): number {
  const first = weekStart(`${iso.slice(0, 4)}-01-01`);
  return Math.floor(diffDays(first, weekStart(iso)) / 7) + 1;
}

export function weeksInYear(year: number): number {
  return weekNumber(`${year}-12-31`);
}

export function isWeekend(iso: string): boolean {
  const d = dayOfWeek(iso);
  return d === 5 || d === 6;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

export function hhmmOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function nowMinutes(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const HE_DAYS_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
export const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** "יום רביעי · 30 בספטמבר" */
export function formatLong(iso: string): string {
  const d = parseISODate(iso);
  return `יום ${HE_DAYS[d.getDay()]} · ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`;
}

/** "30/9" */
export function formatShort(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/** "30/09/2026" */
export function formatDMY(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Relative wording for a past or near date: "היום", "אתמול", "לפני 3 ימים", "מחר", "30/9". */
export function formatRelative(iso: string, today: string): string {
  const n = diffDays(today, iso);
  if (n === 0) return 'היום';
  if (n === -1) return 'אתמול';
  if (n === 1) return 'מחר';
  if (n < 0 && n >= -6) return `לפני ${-n} ימים`;
  if (n < -6 && n >= -13) return 'לפני שבוע';
  if (n > 0 && n <= 6) return `יום ${HE_DAYS[dayOfWeek(iso)]}`;
  return formatShort(iso);
}
