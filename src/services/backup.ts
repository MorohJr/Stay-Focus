import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, TABLE_NAMES, db, type TableName } from '../db/db';
import * as S from '../domain/schemas';
import { SETTINGS_ID } from '../domain/schemas';
import { nowIso } from './entity';

/**
 * Full JSON backup (SPEC 5.9): every table, photos as base64, schema version.
 * Restore replaces all data after Zod validation and migration of older versions.
 */

export const BACKUP_FORMAT = 'stay-focus-backup';

const BackupAttachment = S.Attachment.omit({ blob: true }).extend({ dataBase64: z.string() });

const ROW_SCHEMAS: Record<TableName, z.ZodType> = {
  tasks: S.Task,
  projects: S.Project,
  sprints: S.Sprint,
  notes: S.Note,
  goals: S.Goal,
  areas: S.Area,
  routineItems: S.RoutineItem,
  routineLogs: S.RoutineLog,
  challenges: S.Challenge,
  challengeLogs: S.ChallengeLog,
  recurring: S.Recurring,
  attachments: BackupAttachment,
  templates: S.Template,
  settings: S.Settings,
  people: S.Person,
  agenda: S.AgendaItem,
  milestones: S.Milestone,
};

type BackupData = Partial<Record<string, unknown[]>>;

const BackupFile = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.int().positive(),
  exportedAt: z.string(),
  data: z.record(z.string(), z.array(z.unknown())),
});

export class BackupError extends Error {
  constructor(
    public readonly code: 'not_a_backup' | 'newer_version' | 'invalid_data',
    public readonly details?: string,
  ) {
    super(details ? `${code}: ${details}` : code);
    this.name = 'BackupError';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Response(blob).arrayBuffer());
}

export async function exportBackup(): Promise<string> {
  const data: BackupData = {};
  for (const name of TABLE_NAMES) {
    if (name === 'attachments') {
      const rows = await db.attachments.toArray();
      data.attachments = await Promise.all(rows.map(async ({ blob, ...rest }) => ({ ...rest, dataBase64: bytesToBase64(await blobBytes(blob)) })));
    } else {
      data[name] = await db.table(name).toArray();
    }
  }
  return JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: CURRENT_SCHEMA_VERSION, exportedAt: nowIso(), data });
}

/** stay-focus-backup-2026-09-30.json */
export function backupFileName(isoDate: string): string {
  return `stay-focus-backup-${isoDate}.json`;
}

export async function markBackupDone(): Promise<void> {
  const ts = nowIso();
  await db.settings.update(SETTINGS_ID, { lastBackupAt: ts, updatedAt: ts });
}

/**
 * Migrations of backup data, keyed by the version they migrate FROM (n → n+1).
 * Add a step for every Dexie version bump (CLAUDE.md iron rule 4).
 */
export const MIGRATIONS: Record<number, (data: BackupData) => BackupData> = {
  // v1 → v2: info cards were removed (SPEC 1.2).
  1: ({ infoCards: _gone, ...rest }) => rest,
  // v2 → v3: people, agenda and milestones are new; new task fields get Zod defaults.
  2: (data) => ({ ...data, people: data.people ?? [], agenda: data.agenda ?? [], milestones: data.milestones ?? [] }),
};

function migrate(data: BackupData, fromVersion: number): BackupData {
  let current = data;
  for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new BackupError('invalid_data', `no migration from schema version ${v}`);
    current = step(current);
  }
  return current;
}

export interface ParsedBackup {
  schemaVersion: number;
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
  counts: Record<TableName, number>;
}

export async function parseBackup(text: string): Promise<ParsedBackup> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError('not_a_backup');
  }
  const file = BackupFile.safeParse(json);
  if (!file.success) throw new BackupError('not_a_backup');
  if (file.data.schemaVersion > CURRENT_SCHEMA_VERSION) throw new BackupError('newer_version');

  const data = migrate(file.data.data as BackupData, file.data.schemaVersion);
  const unknownTables = Object.keys(data).filter((t) => !(TABLE_NAMES as string[]).includes(t));
  if (unknownTables.length) throw new BackupError('invalid_data', `unknown tables: ${unknownTables.join(', ')}`);

  const tables = {} as Record<TableName, unknown[]>;
  const counts = {} as Record<TableName, number>;
  for (const name of TABLE_NAMES) {
    const rows = data[name] ?? [];
    const validated = rows.map((row, i) => {
      const r = ROW_SCHEMAS[name].safeParse(row);
      if (!r.success) throw new BackupError('invalid_data', `${name}[${i}]: ${r.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
      return r.data;
    });
    tables[name] =
      name === 'attachments'
        ? (validated as z.infer<typeof BackupAttachment>[]).map(({ dataBase64, ...rest }) => ({ ...rest, blob: new Blob([base64ToBytes(dataBase64)], { type: rest.mime }) }))
        : validated;
    counts[name] = validated.length;
  }
  if (tables.settings.length !== 1) throw new BackupError('invalid_data', 'settings row missing');
  return { schemaVersion: file.data.schemaVersion, exportedAt: file.data.exportedAt, tables, counts };
}

/** Replaces ALL data, atomically. The UI asks for a double confirmation first (SPEC 5.9). */
export async function restoreBackup(backup: ParsedBackup): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) {
      const table = db.table(name);
      await table.clear();
      await table.bulkAdd(backup.tables[name]);
    }
  });
}

/** Is there anything worth backing up? (R-TOD-10) */
export async function hasUserData(): Promise<boolean> {
  const counts = await Promise.all([db.tasks.count(), db.projects.count(), db.notes.count(), db.goals.count(), db.challenges.count(), db.routineItems.count()]);
  return counts.some((c) => c > 0);
}

/** Deletes everything and starts fresh (settings → defaults). */
export async function wipeAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) await db.table(name).clear();
  });
}
