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

export type TableName = keyof typeof SCHEMA_V3;
export const TABLE_NAMES = Object.keys(SCHEMA_V3) as TableName[];
export const CURRENT_SCHEMA_VERSION = 3;

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
  }
}

export const db = new StayFocusDB();
