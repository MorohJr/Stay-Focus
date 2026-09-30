import { isWeekend, minutesOf } from './dates';
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

/** R-RTN-1/2: which routine is showing right now (by minutes since midnight), if any. */
export function activeRoutineWindow(s: RoutineSettings, date: string, nowMin: number): RoutineWindow | undefined {
  return routineWindows(s, date).find((w) => minutesOf(w.start) <= nowMin && nowMin < minutesOf(w.end));
}

export function itemsOf(items: RoutineItem[], kind: RoutineKind): RoutineItem[] {
  return items.filter((i) => i.routine === kind && i.active).sort((a, b) => a.order - b.order);
}

export function isItemDone(logs: RoutineLog[], date: string, itemId: string): boolean {
  return logs.some((l) => l.date === date && l.itemId === itemId && l.done);
}

export interface RoutineCardModel {
  window: RoutineWindow;
  items: { item: RoutineItem; done: boolean }[];
  done: number;
  total: number;
  /** R-RTN-5 */
  complete: boolean;
}

/** R-RTN-1..3/5: the routine card for "now", or undefined when none is showing. */
export function routineCard(s: RoutineSettings, allItems: RoutineItem[], logs: RoutineLog[], date: string, nowMin: number): RoutineCardModel | undefined {
  const w = activeRoutineWindow(s, date, nowMin);
  if (!w) return undefined;
  const items = itemsOf(allItems, w.kind).map((item) => ({ item, done: isItemDone(logs, date, item.id) }));
  if (items.length === 0) return undefined; // R-RTN-3
  const done = items.filter((x) => x.done).length;
  return { window: w, items, done, total: items.length, complete: done === items.length };
}

/** Routine ring (R-TOD-9): items ticked today ÷ all active items of both routines. */
export function routineDayStats(allItems: RoutineItem[], logs: RoutineLog[], date: string): { done: number; total: number } {
  const active = allItems.filter((i) => i.active);
  return { done: active.filter((i) => isItemDone(logs, date, i.id)).length, total: active.length };
}

export const ROUTINE_LABEL: Record<RoutineKind, string> = { morning: 'שגרת בוקר', evening: 'שגרת ערב' };
