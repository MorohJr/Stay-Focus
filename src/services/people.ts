import { db } from '../db/db';
import type { Milestone, Person } from '../domain/schemas';
import { nowIso, stamps } from './entity';

// ---------------------------------------------------------------------------
// People and talking points (3.14, R-PPL)
// ---------------------------------------------------------------------------

export async function createPerson(name: string, emoji = '🙂'): Promise<Person> {
  const p: Person = { ...stamps(), name: name.trim(), emoji, body: '' };
  await db.people.add(p);
  return p;
}

export async function updatePerson(id: string, patch: Partial<Person>): Promise<void> {
  await db.people.update(id, { ...patch, updatedAt: nowIso() });
}

/** Removes the person and their talking points; tasks stay but stop waiting. */
export async function deletePerson(id: string): Promise<void> {
  await db.transaction('rw', db.people, db.agenda, db.tasks, async () => {
    await db.agenda.where('personId').equals(id).delete();
    await db.tasks.where('waitingPersonId').equals(id).modify({ waitingPersonId: undefined });
    await db.people.delete(id);
  });
}

export async function addAgenda(personId: string, text: string): Promise<void> {
  if (!text.trim()) return;
  await db.agenda.add({ ...stamps(), personId, text: text.trim() });
}

export async function toggleAgenda(id: string): Promise<void> {
  const a = await db.agenda.get(id);
  if (a) await db.agenda.update(id, { doneAt: a.doneAt ? undefined : nowIso(), updatedAt: nowIso() });
}

export async function deleteAgenda(id: string): Promise<void> {
  await db.agenda.delete(id);
}

// ---------------------------------------------------------------------------
// Milestones (3.15, R-MIL)
// ---------------------------------------------------------------------------

export async function addMilestone(projectId: string, title: string, dueDate?: string): Promise<void> {
  if (!title.trim()) return;
  const order = await db.milestones.where('projectId').equals(projectId).count();
  await db.milestones.add({ ...stamps(), projectId, title: title.trim(), dueDate, order });
}

export async function updateMilestone(id: string, patch: Partial<Milestone>): Promise<void> {
  await db.milestones.update(id, { ...patch, updatedAt: nowIso() });
}

export async function toggleMilestone(id: string): Promise<void> {
  const m = await db.milestones.get(id);
  if (m) await updateMilestone(id, { doneAt: m.doneAt ? undefined : nowIso() });
}

export async function deleteMilestone(id: string): Promise<void> {
  await db.milestones.delete(id);
}

export async function moveMilestone(id: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', db.milestones, async () => {
    const m = await db.milestones.get(id);
    if (!m) return;
    const list = (await db.milestones.where('projectId').equals(m.projectId).toArray()).sort((a, b) => a.order - b.order);
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    await db.milestones.bulkPut(list.map((x, k) => ({ ...x, order: k })));
  });
}

// ---------------------------------------------------------------------------
// Weekly goals (R-REV step 5)
// ---------------------------------------------------------------------------

export async function setWeeklyGoals(sprintId: string, goals: string[]): Promise<void> {
  await db.sprints.update(sprintId, { weeklyGoals: goals.map((g) => g.trim()).filter(Boolean).slice(0, 3), updatedAt: nowIso() });
}
