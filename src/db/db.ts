import Dexie, { type EntityTable } from 'dexie';
import type * as D from '../domain/schemas';

export const DB_NAME = 'stay-focus';

/**
 * Table name → Dexie index spec. The first key is the primary key.
 * Every schema change MUST add a new `db.version(n)` and a step in MIGRATIONS (services/backup.ts).
 * Never edit a published version (CLAUDE.md iron rule 4).
 */
export const SCHEMA_V1 = {
  tasks: 'id, seq, status, dueDate, sprintId, parentId, recurringId, top3Date, *projectIds',
  projects: 'id, status, goalId, areaId',
  sprints: 'id, &startDate',
  notes: 'id, updatedAt, *projectIds',
  goals: 'id, status',
  areas: 'id, order',
  routineItems: 'id, routine',
  routineLogs: 'id, date',
  challenges: 'id, startDate',
  challengeLogs: 'id, challengeId, date',
  recurring: 'id',
  infoCards: 'id, order',
  attachments: 'id, ownerId',
  templates: 'id, kind',
  settings: 'id',
} as const;

/** v2 (03/10/2026, SPEC 1.2): info cards removed. Project logo/cover need no index. */
const { infoCards: _removed, ...SCHEMA_V2 } = SCHEMA_V1;
export { SCHEMA_V2 };

/** v3 (03/10/2026, SPEC 1.3): people, agenda, milestones; tasks indexed by waitingPersonId. */
export const SCHEMA_V3 = {
  ...SCHEMA_V2,
  tasks: 'id, seq, status, dueDate, sprintId, parentId, recurringId, top3Date, waitingPersonId, *projectIds',
  people: 'id',
  agenda: 'id, personId',
  milestones: 'id, projectId, dueDate',
} as const;

/** v4 (14/10/2026, SPEC 1.5): no index changes. New fields (yearly rule, birthday, dayClosedOn) are optional. */
export const SCHEMA_V4 = SCHEMA_V3;

/** v5 (14/10/2026, SPEC 1.7): no index changes. settings.onboardedAt (R-ONB-1) is new. */
export const SCHEMA_V5 = SCHEMA_V4;

/** v6 (14/10/2026, SPEC 1.9): year reviews (R-YIR). Project.doneAt / Goal.achievedAt need no index. */
export const SCHEMA_V6 = { ...SCHEMA_V5, yearReviews: 'id' } as const;

/** v7 (24/10/2026, SPEC 1.16): events (3.17). Area.work (R-ARE-1) and settings.work (3.18) need no index. */
export const SCHEMA_V7 = { ...SCHEMA_V6, events: 'id, date' } as const;

/** Tables whose rows mean "someone already uses this device" (R-ONB-1). */
export const USER_DATA_TABLES = ['tasks', 'projects', 'notes', 'goals', 'challenges', 'routineItems', 'recurring', 'people', 'events'] as const;
/** The same list as it was at db v5 (its upgrade must not see later tables). */
const USER_DATA_TABLES_V5 = USER_DATA_TABLES.filter((t) => t !== 'events');

export type TableName = keyof typeof SCHEMA_V7;
export const TABLE_NAMES = Object.keys(SCHEMA_V7) as TableName[];
export const CURRENT_SCHEMA_VERSION = 7;

export class StayFocusDB extends Dexie {
  tasks!: EntityTable<D.Task, 'id'>;
  projects!: EntityTable<D.Project, 'id'>;
  sprints!: EntityTable<D.Sprint, 'id'>;
  notes!: EntityTable<D.Note, 'id'>;
  goals!: EntityTable<D.Goal, 'id'>;
  areas!: EntityTable<D.Area, 'id'>;
  routineItems!: EntityTable<D.RoutineItem, 'id'>;
  routineLogs!: EntityTable<D.RoutineLog, 'id'>;
  challenges!: EntityTable<D.Challenge, 'id'>;
  challengeLogs!: EntityTable<D.ChallengeLog, 'id'>;
  recurring!: EntityTable<D.Recurring, 'id'>;
  attachments!: EntityTable<D.Attachment, 'id'>;
  templates!: EntityTable<D.Template, 'id'>;
  settings!: EntityTable<D.Settings, 'id'>;
  people!: EntityTable<D.Person, 'id'>;
  agenda!: EntityTable<D.AgendaItem, 'id'>;
  milestones!: EntityTable<D.Milestone, 'id'>;
  yearReviews!: EntityTable<D.YearReview, 'id'>;
  events!: EntityTable<D.CalEvent, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores({ ...SCHEMA_V2, infoCards: null });
    this.version(3).stores(SCHEMA_V3);
    this.version(4).stores(SCHEMA_V4);
    // R-ONB-1: a device that already has data skips the intro after the upgrade.
    this.version(5)
      .stores(SCHEMA_V5)
      .upgrade(async (tx) => {
        const settings = tx.table('settings');
        const s = await settings.get('settings');
        if (!s || s.onboardedAt) return;
        for (const name of USER_DATA_TABLES_V5) {
          if ((await tx.table(name).count()) > 0) {
            await settings.update('settings', { onboardedAt: s.updatedAt });
            return;
          }
        }
      });
    // R-PRJ-4 / R-GOL-3: things finished before 1.9 get their last update as the finish time.
    this.version(6)
      .stores(SCHEMA_V6)
      .upgrade(async (tx) => {
        await tx.table('projects').toCollection().modify((p) => {
          if (p.status === 'done' && !p.doneAt) p.doneAt = p.updatedAt;
        });
        await tx.table('goals').toCollection().modify((g) => {
          if (g.status === 'achieved' && !g.achievedAt) g.achievedAt = g.updatedAt;
        });
      });
    // R-ARE-1: the default "work" area (or one named עבודה) counts as work.
    this.version(7)
      .stores(SCHEMA_V7)
      .upgrade(async (tx) => {
        await tx.table('areas').toCollection().modify((a) => {
          a.work = isWorkAreaByDefault(a);
        });
      });
  }
}

/** R-ARE-1: before 1.16 there was no flag; the default work area gets it. */
export function isWorkAreaByDefault(a: { id: string; name: string }): boolean {
  return a.id === 'area-work' || a.name.trim() === 'עבודה';
}

export const db = new StayFocusDB();
