import { db } from '../db/db';
import type { Area, Attachment, Link } from '../domain/schemas';
import { nowIso, stamps } from './entity';

// ---------------------------------------------------------------------------
// Areas (SPEC 3.6)
// ---------------------------------------------------------------------------

export async function saveArea(input: Partial<Area> & { name: string }): Promise<void> {
  const existing = input.id ? await db.areas.get(input.id) : undefined;
  const order = existing?.order ?? (await db.areas.count());
  await db.areas.put(existing ? { ...existing, ...input, updatedAt: nowIso() } : { ...stamps(), color: '#3346c4', order, ...input });
}

/** Projects and goals of a deleted area become "no area". */
export async function deleteArea(id: string): Promise<void> {
  await db.transaction('rw', db.areas, db.projects, db.goals, async () => {
    await db.projects.where('areaId').equals(id).modify({ areaId: undefined });
    const goals = (await db.goals.toArray()).filter((g) => g.areaId === id);
    await db.goals.bulkPut(goals.map((g) => ({ ...g, areaId: undefined })));
    await db.areas.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Attachments and links (SPEC 3.11)
// ---------------------------------------------------------------------------

export async function addAttachment(ownerType: 'task' | 'note', ownerId: string, blob: Blob, name: string): Promise<void> {
  const a: Attachment = { ...stamps(), ownerType, ownerId, name, mime: blob.type || 'image/jpeg', blob };
  const table = ownerType === 'task' ? db.tasks : db.notes;
  await db.transaction('rw', db.attachments, table, async () => {
    await db.attachments.add(a);
    const owner = await table.get(ownerId);
    if (owner) await table.update(ownerId, { attachmentIds: [...owner.attachmentIds, a.id], updatedAt: nowIso() });
  });
}

/** R-PRJ-3: sets (or replaces) a project's logo or cover image. */
export async function setProjectImage(projectId: string, kind: 'logo' | 'cover', blob: Blob, name: string): Promise<void> {
  const key = kind === 'logo' ? 'logoId' : 'coverId';
  await db.transaction('rw', db.attachments, db.projects, async () => {
    const p = await db.projects.get(projectId);
    if (!p) return;
    const old = p[key];
    const a: Attachment = { ...stamps(), ownerType: 'project', ownerId: projectId, name, mime: blob.type || 'image/jpeg', blob };
    await db.attachments.add(a);
    await db.projects.update(projectId, { [key]: a.id, updatedAt: nowIso() });
    if (old) await db.attachments.delete(old);
  });
}

export async function removeProjectImage(projectId: string, kind: 'logo' | 'cover'): Promise<void> {
  const key = kind === 'logo' ? 'logoId' : 'coverId';
  await db.transaction('rw', db.attachments, db.projects, async () => {
    const p = await db.projects.get(projectId);
    const old = p?.[key];
    if (!p || !old) return;
    await db.projects.update(projectId, { [key]: undefined, updatedAt: nowIso() });
    await db.attachments.delete(old);
  });
}

export async function deleteAttachment(id: string): Promise<void> {
  const a = await db.attachments.get(id);
  if (!a) return;
  if (a.ownerType === 'project') {
    const p = await db.projects.get(a.ownerId);
    if (p?.logoId === id) return removeProjectImage(a.ownerId, 'logo');
    if (p?.coverId === id) return removeProjectImage(a.ownerId, 'cover');
    await db.attachments.delete(id);
    return;
  }
  const table = a.ownerType === 'task' ? db.tasks : db.notes;
  await db.transaction('rw', db.attachments, table, async () => {
    const owner = await table.get(a.ownerId);
    if (owner) await table.update(a.ownerId, { attachmentIds: owner.attachmentIds.filter((x) => x !== id), updatedAt: nowIso() });
    await db.attachments.delete(id);
  });
}

/** Adds https:// when missing, so "google.com" opens. */
export function normalizeLink(raw: string, title?: string): Link | undefined {
  const url = raw.trim();
  if (!url) return undefined;
  const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  return { url: full, title: title?.trim() || undefined };
}

export function linkLabel(l: Link): string {
  if (l.title) return l.title;
  try {
    return new URL(l.url).hostname.replace(/^www\./, '');
  } catch {
    return l.url;
  }
}
