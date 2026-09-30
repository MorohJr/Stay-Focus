import { db } from '../db/db';
import { logId, nextRuleValue, ruleValue } from '../domain/challenge';
import type { Challenge, InfoCard, Recurring, RoutineItem, RoutineKind, Rule } from '../domain/schemas';
import { newId, nowIso, stamps } from './entity';

// ---------------------------------------------------------------------------
// Routines (SPEC 3.7)
// ---------------------------------------------------------------------------

export async function toggleRoutineItem(date: string, itemId: string): Promise<void> {
  const id = `${date}:${itemId}`;
  const cur = await db.routineLogs.get(id);
  if (cur?.done) await db.routineLogs.delete(id);
  else await db.routineLogs.put({ id, date, itemId, done: true });
}

export async function addRoutineItem(routine: RoutineKind, title: string): Promise<void> {
  const count = await db.routineItems.where('routine').equals(routine).count();
  await db.routineItems.add({ ...stamps(), routine, title: title.trim(), order: count, active: true });
}

export async function updateRoutineItem(id: string, patch: Partial<RoutineItem>): Promise<void> {
  await db.routineItems.update(id, { ...patch, updatedAt: nowIso() });
}

/** Deleting an item keeps past logs out of the rings (they reference a missing item and are ignored). */
export async function deleteRoutineItem(id: string): Promise<void> {
  await db.routineItems.delete(id);
}

export async function moveRoutineItem(id: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', db.routineItems, async () => {
    const item = await db.routineItems.get(id);
    if (!item) return;
    const list = (await db.routineItems.where('routine').equals(item.routine).toArray()).sort((a, b) => a.order - b.order);
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    await db.routineItems.bulkPut(list.map((x, k) => ({ ...x, order: k })));
  });
}

// ---------------------------------------------------------------------------
// Challenges (SPEC 3.8)
// ---------------------------------------------------------------------------

/** R-CHL-3 */
export async function cycleRule(challengeId: string, date: string, ruleId: string): Promise<void> {
  const logs = await db.challengeLogs.where('challengeId').equals(challengeId).toArray();
  const next = nextRuleValue(ruleValue(logs, challengeId, date, ruleId));
  const id = logId(challengeId, date, ruleId);
  if (next) await db.challengeLogs.put({ id, challengeId, date, ruleId, value: next });
  else await db.challengeLogs.delete(id);
}

export async function createChallenge(input: { name: string; startDate: string; endDate: string; rules: string[] }): Promise<Challenge> {
  const c: Challenge = { ...stamps(), name: input.name, startDate: input.startDate, endDate: input.endDate, rules: input.rules.filter((r) => r.trim()).map((title) => ({ id: newId(), title: title.trim() })) };
  await db.challenges.add(c);
  return c;
}

export async function updateChallenge(id: string, patch: Partial<Challenge>): Promise<void> {
  await db.challenges.update(id, { ...patch, updatedAt: nowIso() });
}

export function newRule(title: string): Rule {
  return { id: newId(), title: title.trim() };
}

export async function deleteChallenge(id: string): Promise<void> {
  await db.transaction('rw', db.challenges, db.challengeLogs, async () => {
    await db.challengeLogs.where('challengeId').equals(id).delete();
    await db.challenges.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Recurring rules, info cards
// ---------------------------------------------------------------------------

export async function saveRecurring(input: Partial<Recurring> & Pick<Recurring, 'title' | 'rule' | 'startDate'>): Promise<Recurring> {
  const existing = input.id ? await db.recurring.get(input.id) : undefined;
  const r: Recurring = existing
    ? { ...existing, ...input, updatedAt: nowIso() }
    : { ...stamps(), body: '', projectIds: [], labels: [], active: true, ...input };
  await db.recurring.put(r);
  return r;
}

/** Removing a rule keeps the tasks it already created (history). */
export async function deleteRecurring(id: string): Promise<void> {
  await db.recurring.delete(id);
}

export async function saveInfoCard(input: Partial<InfoCard> & { title: string }): Promise<void> {
  const existing = input.id ? await db.infoCards.get(input.id) : undefined;
  const order = existing?.order ?? (await db.infoCards.count());
  await db.infoCards.put(existing ? { ...existing, ...input, updatedAt: nowIso() } : { ...stamps(), icon: '📌', body: '', order, ...input });
}

export async function deleteInfoCard(id: string): Promise<void> {
  await db.infoCards.delete(id);
}
