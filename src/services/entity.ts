import { db } from '../db/db';
import { defaultAreas, defaultSettings, defaultTemplates } from '../db/seed';
import { SETTINGS_ID, type Settings } from '../domain/schemas';

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function stamps() {
  const now = nowIso();
  return { id: newId(), createdAt: now, updatedAt: now };
}

/** Creates the default rows on first run (settings, areas, templates). Safe to call every start. */
export async function ensureSeed(): Promise<void> {
  await db.transaction('rw', db.settings, db.areas, db.templates, async () => {
    if (await db.settings.get(SETTINGS_ID)) return;
    const now = nowIso();
    await db.settings.add(defaultSettings(now));
    await db.areas.bulkPut(defaultAreas(now));
    await db.templates.bulkPut(defaultTemplates(now));
  });
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get(SETTINGS_ID);
  if (s) return s;
  await ensureSeed();
  return (await db.settings.get(SETTINGS_ID))!;
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  await getSettings();
  await db.settings.update(SETTINGS_ID, { ...patch, updatedAt: nowIso() });
}

/** Next running number for tasks (Task ID in Notion). */
export async function nextSeq(): Promise<number> {
  return db.transaction('rw', db.settings, async () => {
    const s = await getSettings();
    const seq = s.seqCounter + 1;
    await db.settings.update(SETTINGS_ID, { seqCounter: seq });
    return seq;
  });
}
