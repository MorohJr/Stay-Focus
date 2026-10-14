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

/** Tables whose rows mean "someone already uses this device" (R-ONB-1). */
export const USER_DATA_TABLES = ['tasks', 'projects', 'notes', 'goals', 'challenges', 'routineItems', 'recurring', 'people'] as const;

export type TableName = keyof typeof SCHEMA_V5;
export const TABLE_NAMES = Object.keys(SCHEMA_V5) as TableName[];
export const CURRENT_SCHEMA_VERSION = 5;

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
        for (const name of USER_DATA_TABLES) {
          if ((await tx.table(name).count()) > 0) {
            await settings.update('settings', { onboardedAt: s.updatedAt });
            return;
          }
        }
      });
  }
}

export const db = new StayFocusDB();
