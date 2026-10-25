import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { SETTINGS_ID } from '../domain/schemas';
import { exportBackup, parseBackup, restoreBackup, BackupError } from './backup';
import { exitDemo, isDemoMode, loadDemo } from './demo';
import { ensureSeed, getSettings } from './entity';
import { addAttachment, removeProjectImage, setProjectImage } from './misc';
import { createProject, deleteProject, ensureSprints, materializeRecurring, reviewSprint, setFocusGoal, createGoal } from './planning';
import { cycleRule, createChallenge, toggleRoutineItem, saveRecurring } from './habits';
import { addToTop3, createTask, deleteTask, moveTop3, moveToTomorrow, postponeAllOverdue, postponeTask, resolveStuck, restoreTasks, linkTasksToProject, setSomeday, setWaiting, updateTask } from './tasks';
import { addAgenda, addMilestone, createPerson, deletePerson } from './people';
import { addOnboardingTask, finishOnboarding, restartOnboarding, startChallenge } from './onboarding';
import { wipeAll } from './backup';
import Dexie from 'dexie';
import { SCHEMA_V4, SCHEMA_V5, StayFocusDB } from '../db/db';
import { updateGoal, updateProject } from './planning';
import { markYearSeen, saveYearAnswers } from './yearReview';

const TODAY = '2026-09-30';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeed();
});

describe('tasks service', () => {
  it('numbers tasks and sets completedAt (R-TSK-1)', async () => {
    const a = await createTask({ title: ' a ' });
    const b = await createTask({ title: 'b' });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(a.title).toBe('a');
    await updateTask(a.id, { status: 'done' });
    expect((await db.tasks.get(a.id))!.completedAt).toBeTruthy();
    await updateTask(a.id, { status: 'todo' });
    expect((await db.tasks.get(a.id))!.completedAt).toBeUndefined();
  });

  it('R-TSK-2/3: sub-tasks inherit, delete is recursive and undoable', async () => {
    const p = await createTask({ title: 'p', projectIds: ['x'], sprintId: 's' });
    const c = await createTask({ title: 'c', parentId: p.id });
    expect(c.projectIds).toEqual(['x']);
    expect(c.sprintId).toBe('s');
    await createTask({ title: 'g', parentId: c.id });
    await addAttachment('task', c.id, new Blob(['x'], { type: 'image/png' }), 'x.png');
    const del = await deleteTask(p.id);
    expect(del.tasks).toHaveLength(3);
    expect(del.attachments).toHaveLength(1);
    expect(await db.tasks.count()).toBe(0);
    await restoreTasks(del);
    expect(await db.tasks.count()).toBe(3);
    expect(await db.attachments.count()).toBe(1);
  });

  it('R-TOD-4: top 3 fills free slots, gives a date, max 3, reorders', async () => {
    const ids = [];
    for (const t of ['a', 'b', 'c', 'd']) ids.push((await createTask({ title: t })).id);
    for (const id of ids) await addToTop3(id, TODAY);
    const top = (await db.tasks.where('top3Date').equals(TODAY).sortBy('top3Order')).map((t) => t.title);
    expect(top).toEqual(['a', 'b', 'c']);
    expect((await db.tasks.get(ids[0]!))!.dueDate).toBe(TODAY);
    await moveTop3(ids[2]!, TODAY, -1);
    expect((await db.tasks.where('top3Date').equals(TODAY).sortBy('top3Order')).map((t) => t.title)).toEqual(['a', 'c', 'b']);
  });

  it('postpone: time shift, tomorrow frees the top-3 slot; postpone all overdue', async () => {
    const t = await createTask({ title: 't', dueDate: TODAY, startTime: '10:00', top3Date: TODAY, top3Order: 1 });
    await postponeTask(t.id, 'plus60', TODAY);
    expect((await db.tasks.get(t.id))!.startTime).toBe('11:00');
    await postponeTask(t.id, 'tomorrow', TODAY);
    const moved = (await db.tasks.get(t.id))!;
    expect(moved.dueDate).toBe('2026-10-01');
    expect(moved.top3Date).toBeUndefined();
    await createTask({ title: 'late1', dueDate: '2026-09-28' });
    await createTask({ title: 'late2', dueDate: '2026-09-29' });
    await postponeAllOverdue(TODAY);
    expect((await db.tasks.where('dueDate').equals('2026-10-01').count())).toBe(3);
  });
});

describe('1.13 project links', () => {
  it('R-PRJ-8: linking adds the project and keeps the others', async () => {
    const a = await createTask({ title: 'a', projectIds: ['old'] });
    const b = await createTask({ title: 'b' });
    await linkTasksToProject('new', [a.id, b.id, 'missing']);
    await linkTasksToProject('new', [a.id]);
    expect((await db.tasks.get(a.id))!.projectIds).toEqual(['old', 'new']);
    expect((await db.tasks.get(b.id))!.projectIds).toEqual(['new']);
  });
});

describe('1.3 features', () => {
  it('R-PRC: every postponement counts, time shifts do not', async () => {
    const t = await createTask({ title: 't', dueDate: '2026-09-28', startTime: '10:00' });
    await postponeTask(t.id, 'plus30', TODAY);
    expect((await db.tasks.get(t.id))!.postponeCount).toBe(0);
    await postponeTask(t.id, 'tomorrow', TODAY);
    await updateTask(t.id, { dueDate: '2026-09-29' }); // moving back is not a postponement
    await postponeAllOverdue(TODAY);
    expect((await db.tasks.get(t.id))!.postponeCount).toBe(2);
    await updateTask(t.id, { dueDate: '2026-10-08' }); // overdue → later date counts
    expect((await db.tasks.get(t.id))!.postponeCount).toBe(3);
    await resolveStuck(t.id, 'today', TODAY);
    const after = (await db.tasks.get(t.id))!;
    expect(after.postponeCount).toBe(0);
    expect(after.dueDate).toBe(TODAY);
    expect(after.top3Date).toBe(TODAY);
  });

  it('R-SMD: someday clears date, sprint and top 3', async () => {
    const t = await createTask({ title: 't', dueDate: TODAY, sprintId: 's', top3Date: TODAY, top3Order: 1, postponeCount: 4 });
    await setSomeday(t.id, true);
    const x = (await db.tasks.get(t.id))!;
    expect([x.someday, x.dueDate, x.sprintId, x.top3Date, x.postponeCount]).toEqual([true, undefined, undefined, undefined, 0]);
    await setSomeday(t.id, false);
    expect((await db.tasks.get(t.id))!.someday).toBe(false);
  });

  it('R-PPL/R-WAI: deleting a person keeps tasks but removes waiting and agenda', async () => {
    const p = await createPerson('אמא');
    const t = await createTask({ title: 't' });
    await setWaiting(t.id, p.id);
    await addAgenda(p.id, 'לשאול על המתנה');
    await deletePerson(p.id);
    expect((await db.tasks.get(t.id))!.waitingPersonId).toBeUndefined();
    expect(await db.agenda.count()).toBe(0);
  });

  it('R-MIL: milestones go with the project', async () => {
    const p = await createProject({ name: 'p' });
    await addMilestone(p.id, 'גרסה ראשונה', '2026-10-10');
    await addMilestone(p.id, '  ');
    expect(await db.milestones.count()).toBe(1);
    await deleteProject(p.id);
    expect(await db.milestones.count()).toBe(0);
  });

  it('R-CLS: "למחר" clears time and top 3 and counts as a postpone', async () => {
    const t = await createTask({ title: 'x', dueDate: TODAY, startTime: '21:00' });
    await addToTop3(t.id, TODAY);
    await moveToTomorrow([t.id], TODAY);
    const after = (await db.tasks.get(t.id))!;
    expect([after.dueDate, after.startTime, after.top3Date, after.postponeCount]).toEqual(['2026-10-01', undefined, undefined, 1]);
  });

  it('migrates a v3 backup (no birthday, dayClosedOn or yearly rule) to v4', async () => {
    await createPerson('דנה');
    const file = JSON.parse(await exportBackup());
    file.schemaVersion = 3;
    await restoreBackup(await parseBackup(JSON.stringify(file)));
    expect((await db.people.toArray())[0]!.birthday).toBeUndefined();
  });

  it('migrates a v2 backup to v3', async () => {
    await createTask({ title: 'ישן' });
    const file = JSON.parse(await exportBackup());
    file.schemaVersion = 2;
    delete file.data.people;
    delete file.data.agenda;
    delete file.data.milestones;
    for (const t of file.data.tasks) {
      delete t.someday;
      delete t.postponeCount;
    }
    const parsed = await parseBackup(JSON.stringify(file));
    await restoreBackup(parsed);
    const t = (await db.tasks.toArray())[0]!;
    expect([t.someday, t.postponeCount]).toEqual([false, 0]);
  });
});

describe('planning', () => {
  it('R-SPR-1: ensures this and next week once', async () => {
    await ensureSprints(TODAY);
    await ensureSprints(TODAY);
    expect((await db.sprints.orderBy('startDate').toArray()).map((s) => s.startDate)).toEqual(['2026-09-27', '2026-10-04']);
  });

  it('R-SPR-4: review moves leftovers and marks reviewed', async () => {
    await ensureSprints('2026-09-23');
    await ensureSprints(TODAY);
    const [last, cur] = await db.sprints.orderBy('startDate').toArray();
    const a = await createTask({ title: 'a', sprintId: last!.id });
    const b = await createTask({ title: 'b', sprintId: last!.id });
    await reviewSprint(last!.id, { [a.id]: 'current', [b.id]: 'backlog' }, cur!.id);
    expect((await db.tasks.get(a.id))!.sprintId).toBe(cur!.id);
    expect((await db.tasks.get(b.id))!.sprintId).toBeUndefined();
    expect((await db.sprints.get(last!.id))!.reviewedAt).toBeTruthy();
  });

  it('R-REC-1/2: creates today once, archives missed instances', async () => {
    const r = await saveRecurring({ title: 'כביסה', rule: { type: 'weekly', days: [2, 3] }, startDate: '2026-09-01' });
    await materializeRecurring('2026-09-29');
    await materializeRecurring(TODAY);
    await materializeRecurring(TODAY);
    const all = await db.tasks.toArray();
    expect(all.filter((t) => t.recurringId === r.id)).toHaveLength(2);
    expect(all.find((t) => t.dueDate === '2026-09-29')!.status).toBe('archived');
    expect(all.find((t) => t.dueDate === TODAY)!.status).toBe('todo');
  });

  it('saveRecurring from the form (id: undefined) still gets an id', async () => {
    const r = await saveRecurring({ id: undefined, title: 'כביסה', rule: { type: 'daily' }, startDate: TODAY, startTime: undefined });
    expect(r.id).toBeTruthy();
    expect((await db.recurring.get(r.id))!.title).toBe('כביסה');
  });

  it('deleting a project unlinks tasks; R-GOL-2 single focus', async () => {
    const p = await createProject({ name: 'p' }, ['first step']);
    expect(await db.tasks.where('projectIds').equals(p.id).count()).toBe(1);
    await deleteProject(p.id);
    expect((await db.tasks.toArray())[0]!.projectIds).toEqual([]);
    const g1 = await createGoal({ title: 'a' });
    const g2 = await createGoal({ title: 'b' });
    await setFocusGoal(g1.id);
    await setFocusGoal(g2.id);
    expect((await db.goals.toArray()).filter((g) => g.inFocus).map((g) => g.id)).toEqual([g2.id]);
  });
});

describe('habits', () => {
  it('routine toggle and R-CHL-3 cycle', async () => {
    await toggleRoutineItem(TODAY, 'i1');
    expect(await db.routineLogs.count()).toBe(1);
    await toggleRoutineItem(TODAY, 'i1');
    expect(await db.routineLogs.count()).toBe(0);
    const c = await createChallenge({ name: 'x', startDate: TODAY, endDate: '2026-12-01', rules: ['a', ' ', 'b'] });
    expect(c.rules).toHaveLength(2);
    const rid = c.rules[0]!.id;
    await cycleRule(c.id, TODAY, rid);
    expect((await db.challengeLogs.toArray())[0]!.value).toBe('kept');
    await cycleRule(c.id, TODAY, rid);
    expect((await db.challengeLogs.toArray())[0]!.value).toBe('broken');
    await cycleRule(c.id, TODAY, rid);
    expect(await db.challengeLogs.count()).toBe(0);
  });
});

describe('backup and demo', () => {
  it('round-trips every table including photos', async () => {
    const t = await createTask({ title: 'שלום' });
    await addAttachment('task', t.id, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'a.png');
    const text = await exportBackup();
    await db.tasks.clear();
    const parsed = await parseBackup(text);
    expect(parsed.counts.tasks).toBe(1);
    await restoreBackup(parsed);
    expect((await db.tasks.toArray())[0]!.title).toBe('שלום');
    const att = (await db.attachments.toArray())[0]!;
    expect(new Uint8Array(await new Response(att.blob).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('migrates a v1 backup: info cards are dropped (SPEC 1.2)', async () => {
    await createTask({ title: 'ישן' });
    const file = JSON.parse(await exportBackup());
    file.schemaVersion = 1;
    file.data.infoCards = [{ id: 'i', createdAt: 'x', updatedAt: 'x', title: 'Nutrition', icon: '🍗', body: '', order: 0 }];
    const parsed = await parseBackup(JSON.stringify(file));
    expect(Object.keys(parsed.tables)).not.toContain('infoCards');
    await restoreBackup(parsed);
    expect((await db.tasks.toArray())[0]!.title).toBe('ישן');
  });

  it('R-PRJ-3: logo and cover replace, remove and go with the project', async () => {
    const p = await createProject({ name: 'p' });
    const img = () => new Blob([new Uint8Array([1])], { type: 'image/png' });
    await setProjectImage(p.id, 'logo', img(), 'a.png');
    await setProjectImage(p.id, 'logo', img(), 'b.png');
    await setProjectImage(p.id, 'cover', img(), 'c.png');
    expect(await db.attachments.count()).toBe(2);
    const cur = (await db.projects.get(p.id))!;
    expect(cur.logoId && cur.coverId).toBeTruthy();
    await removeProjectImage(p.id, 'cover');
    expect((await db.projects.get(p.id))!.coverId).toBeUndefined();
    expect(await db.attachments.count()).toBe(1);
    await deleteProject(p.id);
    expect(await db.attachments.count()).toBe(0);
  });

  it('rejects garbage and newer versions', async () => {
    await expect(parseBackup('nope')).rejects.toBeInstanceOf(BackupError);
    const text = JSON.parse(await exportBackup());
    text.schemaVersion = 99;
    await expect(parseBackup(JSON.stringify(text))).rejects.toMatchObject({ code: 'newer_version' });
  });

  it('demo mode replaces data and restores it exactly', async () => {
    await createTask({ title: 'אמיתי' });
    await loadDemo(TODAY, new Date(`${TODAY}T08:30:00`));
    expect(await isDemoMode()).toBe(true);
    expect(await db.tasks.count()).toBeGreaterThan(70);
    expect(await db.projects.count()).toBe(12);
    expect(await db.challenges.count()).toBe(2);
    expect(await db.people.count()).toBe(5);
    expect(await db.milestones.count()).toBeGreaterThan(5);
    // R-DEM-1: nothing about fitness or money
    const text = JSON.stringify(await db.tasks.toArray()) + JSON.stringify(await db.projects.toArray()) + JSON.stringify(await db.notes.toArray());
    for (const word of ['אימון', 'כושר', 'תזונה', 'חלבון', 'תקציב', 'משכורת', 'השקע', 'חיסכון', 'מניות']) expect(text).not.toContain(word);
    await exitDemo();
    expect(await isDemoMode()).toBe(false);
    expect((await db.tasks.toArray()).map((t) => t.title)).toEqual(['אמיתי']);
    expect((await getSettings()).id).toBe(SETTINGS_ID);
  });
});

describe('onboarding (R-ONB)', () => {
  it('R-ONB-1: first run needs the intro; finishing marks it; wiping all data brings it back', async () => {
    expect((await getSettings()).onboardedAt).toBeUndefined();
    await finishOnboarding(TODAY);
    expect((await getSettings()).onboardedAt).toBeTruthy();
    await wipeAll();
    await ensureSeed();
    expect((await getSettings()).onboardedAt).toBeUndefined();
  });

  it('R-ONB-5: showing the intro again clears the mark and keeps the data', async () => {
    await createTask({ title: 'a' });
    await finishOnboarding(TODAY);
    await restartOnboarding();
    expect((await getSettings()).onboardedAt).toBeUndefined();
    expect(await db.tasks.count()).toBe(1);
  });

  it('R-ONB-4: finishing runs the daily jobs (sprints + today\'s recurring tasks)', async () => {
    await saveRecurring({ title: 'כביסה', rule: { type: 'daily' }, startDate: TODAY });
    await finishOnboarding(TODAY);
    expect((await db.tasks.toArray()).map((t) => t.title)).toContain('כביסה');
    expect(await db.sprints.count()).toBeGreaterThanOrEqual(2);
  });

  it('R-ONB-3: tasks land where chosen, the star adds to top 3; challenge starts today', async () => {
    const a = await addOnboardingTask('a', { kind: 'today' }, true, TODAY);
    expect(a).toBeTruthy();
    const saved = (await db.tasks.get(a!.id))!;
    expect(saved.dueDate).toBe(TODAY);
    expect(saved.top3Date).toBe(TODAY);
    const b = await addOnboardingTask('b', { kind: 'inbox' }, true, TODAY);
    expect((await db.tasks.get(b!.id))!.dueDate).toBe(TODAY); // R-TOD-4: top 3 gives today's date
    expect(await addOnboardingTask('  ', { kind: 'inbox' }, false, TODAY)).toBeUndefined();
    const c = await startChallenge(' 30 יום ', 30, ['רק מים', ''], TODAY);
    expect(c).toMatchObject({ name: '30 יום', startDate: TODAY, endDate: '2026-10-29' });
    expect(c.rules).toHaveLength(1);
  });

  it('R-ONB-1: an old backup counts as onboarded (migration v4 → v5)', async () => {
    const text = await exportBackup();
    const old = JSON.parse(text);
    old.schemaVersion = 4;
    const parsed = await parseBackup(JSON.stringify(old));
    expect((parsed.tables.settings[0] as { onboardedAt?: string }).onboardedAt).toBeTruthy();
  });

  it('R-ONB-1: upgrading a device with data to db v5 skips the intro; an empty one does not', async () => {
    for (const withData of [true, false]) {
      const name = `upgrade-${withData}`;
      const v4 = new Dexie(name);
      v4.version(4).stores(SCHEMA_V4);
      await v4.open();
      await v4.table('settings').add({ id: SETTINGS_ID, userName: 'x', routines: {}, seqCounter: 0, updatedAt: '2026-10-01T00:00:00.000Z' });
      if (withData) await v4.table('notes').add({ id: 'n1', title: 'n' });
      v4.close();
      const v5 = new StayFocusDB(name);
      await v5.open();
      expect((await v5.settings.get(SETTINGS_ID))!.onboardedAt).toBe(withData ? '2026-10-01T00:00:00.000Z' : undefined);
      v5.close();
      await Dexie.delete(name);
    }
  });
});

describe('year review data (1.9)', () => {
  it('R-PRJ-4 / R-GOL-3: done and achieved get a time, leaving clears it', async () => {
    const p = await createProject({ name: 'p', status: 'active' });
    await updateProject(p.id, { status: 'done' });
    expect((await db.projects.get(p.id))!.doneAt).toBeTruthy();
    await updateProject(p.id, { name: 'renamed' });
    expect((await db.projects.get(p.id))!.doneAt).toBeTruthy();
    await updateProject(p.id, { status: 'active' });
    expect((await db.projects.get(p.id))!.doneAt).toBeUndefined();
    const g = await createGoal({ title: 'g' });
    await updateGoal(g.id, { status: 'achieved' });
    expect((await db.goals.get(g.id))!.achievedAt).toBeTruthy();
  });

  it('R-YIR-1/2: opening marks the year seen once; answers are saved', async () => {
    await markYearSeen(2025);
    const first = (await db.yearReviews.get('2025'))!.seenAt;
    await markYearSeen(2025);
    expect((await db.yearReviews.get('2025'))!.seenAt).toBe(first);
    await saveYearAnswers(2025, { wins: 'הרבה' });
    expect((await db.yearReviews.get('2025'))!.wins).toBe('הרבה');
  });

  it('migration v5 → v6: backups and devices get finish times for done projects and achieved goals', async () => {
    const p = await createProject({ name: 'p', status: 'active' });
    await db.projects.update(p.id, { status: 'done' }); // as before 1.9: no doneAt
    const old = JSON.parse(await exportBackup());
    old.schemaVersion = 5;
    delete old.data.yearReviews;
    const parsed = await parseBackup(JSON.stringify(old));
    expect((parsed.tables.projects[0] as { doneAt?: string }).doneAt).toBe(old.data.projects[0].updatedAt);
    expect(parsed.tables.yearReviews).toEqual([]);

    const name = 'upgrade-v6';
    const v5 = new Dexie(name);
    v5.version(5).stores(SCHEMA_V5);
    await v5.open();
    await v5.table('projects').add({ id: 'x', status: 'done', updatedAt: '2026-03-01T00:00:00.000Z' });
    await v5.table('goals').add({ id: 'g', status: 'achieved', updatedAt: '2026-04-01T00:00:00.000Z' });
    v5.close();
    const v6 = new StayFocusDB(name);
    await v6.open();
    expect((await v6.projects.get('x'))!.doneAt).toBe('2026-03-01T00:00:00.000Z');
    expect((await v6.goals.get('g'))!.achievedAt).toBe('2026-04-01T00:00:00.000Z');
    v6.close();
    await Dexie.delete(name);
  });
});
