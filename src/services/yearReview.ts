import { db } from '../db/db';
import type { YearReview } from '../domain/schemas';
import { nowIso } from './entity';

/** R-YIR: one row per year, created on first open or first answer. */
async function ensure(year: number): Promise<YearReview> {
  const id = String(year);
  const cur = await db.yearReviews.get(id);
  if (cur) return cur;
  const now = nowIso();
  const row: YearReview = { id, createdAt: now, updatedAt: now, wins: '', lessons: '', nextFocus: '' };
  await db.yearReviews.add(row);
  return row;
}

/** R-YIR-1: opening the summary (or closing its banner) hides the January banner. */
export async function markYearSeen(year: number): Promise<void> {
  await db.transaction('rw', db.yearReviews, async () => {
    const r = await ensure(year);
    if (!r.seenAt) await db.yearReviews.update(r.id, { seenAt: nowIso() });
  });
}

/** R-YIR-2 step 12: the three answers. */
export async function saveYearAnswers(year: number, patch: Partial<Pick<YearReview, 'wins' | 'lessons' | 'nextFocus'>>): Promise<void> {
  await db.transaction('rw', db.yearReviews, async () => {
    const r = await ensure(year);
    await db.yearReviews.update(r.id, { ...patch, updatedAt: nowIso() });
  });
}
