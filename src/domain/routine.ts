import { addDays, isWeekend, minutesOf } from './dates';
import type { RoutineItem, RoutineKind, RoutineLog, RoutineSettings } from './schemas';

export interface RoutineWindow {
  kind: RoutineKind;
  start: string;
  end: string;
}

/** The two windows of a given date, with the weekend exception for the morning end (SPEC 3.7). */
export function routineWindows(s: RoutineSettings, date: string): RoutineWindow[] {
  const morningEnd = s.weekendDifferent && isWeekend(date) ? s.weekendMorningEnd : s.morningEnd;
  return [
    { kind: 'morning', start: s.morningStart, end: morningEnd },
    { kind: 'evening', start: s.eveningStart, end: s.eveningEnd },
  ];
}

/** R-RTN-1/2: which routine is showing right now, and the day it belongs to: an evening that ends after midnight belongs to the day before. */
export function activeRoutine(s: RoutineSettings, today: string, nowMin: number): { window: RoutineWindow; date: string } | undefined {
  for (const w of routineWindows(s, today)) {
    const a = minutesOf(w.start);
    const b = minutesOf(w.end);
    if (b < a ? nowMin >= a : a <= nowMin && nowMin < b) return { window: w, date: today };
  }
  const prev = addDays(today, -1);
  const evening = routineWindows(s, prev)[1]!;
  if (minutesOf(evening.end) < minutesOf(evening.start) && nowMin < minutesOf(evening.end)) return { window: evening, date: prev };
  return undefined;
}

export function activeRoutineWindow(s: RoutineSettings, date: string, nowMin: number): RoutineWindow | undefined {
  return activeRoutine(s, date, nowMin)?.window;
}

export function itemsOf(items: RoutineItem[], kind: RoutineKind): RoutineItem[] {
  return items.filter((i) => i.routine === kind && i.active).sort((a, b) => a.order - b.order);
}

export function isItemDone(logs: RoutineLog[], date: string, itemId: string): boolean {
  return logs.some((l) => l.date === date && l.itemId === itemId && l.done);
}

export interface RoutineCardModel {
  window: RoutineWindow;
  /** The day the ticks are saved on (yesterday after midnight, R-RTN-2). */
  date: string;
  items: { item: RoutineItem; done: boolean }[];
  done: number;
  total: number;
  /** R-RTN-5 */
  complete: boolean;
}

/** R-RTN-1..3/5: the routine card for "now", or undefined when none is showing. */
export function routineCard(s: RoutineSettings, allItems: RoutineItem[], logs: RoutineLog[], date: string, nowMin: number): RoutineCardModel | undefined {
  const active = activeRoutine(s, date, nowMin);
  if (!active) return undefined;
  const w = active.window;
  const items = itemsOf(allItems, w.kind).map((item) => ({ item, done: isItemDone(logs, active.date, item.id) }));
  if (items.length === 0) return undefined; // R-RTN-3
  const done = items.filter((x) => x.done).length;
  return { window: w, date: active.date, items, done, total: items.length, complete: done === items.length };
}

/** Routine ring (R-TOD-9): items ticked today ÷ all active items of both routines. */
export function routineDayStats(allItems: RoutineItem[], logs: RoutineLog[], date: string): { done: number; total: number } {
  const active = allItems.filter((i) => i.active);
  return { done: active.filter((i) => isItemDone(logs, date, i.id)).length, total: active.length };
}

export const ROUTINE_LABEL: Record<RoutineKind, string> = { morning: 'שגרת בוקר', evening: 'שגרת ערב' };
