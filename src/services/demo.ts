import Dexie, { type EntityTable } from 'dexie';
import { db, TABLE_NAMES } from '../db/db';
import { defaultAreas, defaultTemplates } from '../db/seed';
import { logId } from '../domain/challenge';
import { addDays, hhmmOf, nowMinutes, weekStart } from '../domain/dates';
import { SETTINGS_ID, type ChallengeLog, type RoutineLog, type Task } from '../domain/schemas';
import { sprintName, sprintRange } from '../domain/sprints';
import { exportBackup, parseBackup, restoreBackup } from './backup';
import { getSettings, newId, nowIso } from './entity';
import { runDaily } from './planning';

/**
 * Demo mode (SPEC 5.11): the real data is kept as a full backup in a SEPARATE IndexedDB database,
 * the app shows sample data, and "החזר את הנתונים שלי" restores the real data exactly.
 */

interface Stash {
  key: 'real';
  savedAt: string;
  backup: string;
}

class DemoStore extends Dexie {
  stash!: EntityTable<Stash, 'key'>;
  constructor() {
    super(`${db.name}-demo-stash`);
    this.version(1).stores({ stash: 'key' });
  }
}

let store: DemoStore | undefined;
const demoStore = () => (store ??= new DemoStore());

export async function isDemoMode(): Promise<boolean> {
  return !!(await demoStore().stash.get('real'));
}

export async function assertNotDemo(): Promise<void> {
  if (await isDemoMode()) throw new Error('demo_mode');
}

/** Saves the real data first; only then replaces it. If generating fails, the real data comes back. */
export async function loadDemo(today: string, now: Date = new Date()): Promise<void> {
  if (await isDemoMode()) throw new Error('already_in_demo');
  const backup = await exportBackup();
  await parseBackup(backup); // the stash must be restorable before anything is replaced
  await demoStore().stash.put({ key: 'real', savedAt: nowIso(), backup });
  try {
    await generateDemo(today, now);
  } catch (e) {
    await restoreBackup(await parseBackup(backup));
    await demoStore().stash.delete('real');
    throw e;
  }
}

export async function exitDemo(): Promise<void> {
  const stash = await demoStore().stash.get('real');
  if (!stash) throw new Error('not_in_demo');
  await restoreBackup(await parseBackup(stash.backup));
  await demoStore().stash.delete('real');
}

// ---------------------------------------------------------------------------
// Sample data, built around "now" so the Today screen looks alive.
// ---------------------------------------------------------------------------

export async function generateDemo(today: string, now: Date = new Date()): Promise<void> {
  const settings = await getSettings();
  const ts = nowIso();
  const st = () => ({ id: newId(), createdAt: ts, updatedAt: ts });

  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) await db.table(name).clear();
    await db.settings.add({ ...settings, id: SETTINGS_ID, lastBackupAt: ts, seqCounter: 0, updatedAt: ts });
    await db.areas.bulkAdd(defaultAreas(ts));
    await db.templates.bulkAdd(defaultTemplates(ts));

    // Goals
    const gMoney = { ...st(), title: '500K₪ / 130K$', body: 'עצמאות כלכלית עד גיל 35.', areaId: 'area-work', targetDate: '2033-12-22', status: 'active' as const, progressMode: 'projects' as const, manualProgress: 0, inFocus: true };
    const gHome = { ...st(), title: 'בית גדול ו-3 כלבים', body: '', areaId: 'area-personal', targetDate: '2033-12-22', status: 'active' as const, progressMode: 'manual' as const, manualProgress: 12, inFocus: false };
    const gBody = { ...st(), title: 'גוף חזק ובריא', body: '', areaId: 'area-personal', targetDate: addDays(today, 180), status: 'active' as const, progressMode: 'projects' as const, manualProgress: 0, inFocus: false };
    await db.goals.bulkAdd([gMoney, gHome, gBody]);

    // Projects
    const P = (name: string, icon: string, status: 'planning' | 'active' | 'done' | 'archived', areaId: string, goalId?: string, extra: object = {}) =>
      ({ ...st(), name, icon, status, areaId, goalId, body: '', blockedByIds: [] as string[], ...extra });
    const pWeb = P('Powerful Websites', '🌐', 'active', 'area-work', gMoney.id, { priority: 'high', body: 'חשבונות ברשתות על אתרים שכדאי להכיר, ואחר כך קורס/כלים.' });
    const pNotion = P('תבניות Notion', '🧩', 'active', 'area-work', gMoney.id, { priority: 'medium' });
    const pSaas = P('ללמוד SaaS', '💻', 'planning', 'area-study', gMoney.id, { priority: 'high' });
    const pBody = P('גוף חזק', '💪', 'active', 'area-personal', gBody.id);
    const pHome = P('בית', '🏠', 'active', 'area-personal');
    const pMom = P('אמא', '❤️', 'active', 'area-family', undefined, { priority: 'high' });
    const pTechnion = P('טכניון', '🎓', 'planning', 'area-study');
    const pOld = P('Uneron Studios', '🎬', 'done', 'area-work');
    pSaas.blockedByIds = [pNotion.id];
    await db.projects.bulkAdd([pWeb, pNotion, pSaas, pBody, pHome, pMom, pTechnion, pOld]);

    // Sprints: two past, last, current, next
    const cur = weekStart(today);
    const sprints = [-21, -14, -7, 0, 7].map((off) => {
      const start = addDays(cur, off);
      return { ...st(), name: sprintName(start), ...sprintRange(start), reviewedAt: off < -7 ? ts : undefined };
    });
    await db.sprints.bulkAdd(sprints);
    const [s3, s2, sLast, sCur, sNext] = sprints as [typeof sprints[0], typeof sprints[0], typeof sprints[0], typeof sprints[0], typeof sprints[0]];

    // Tasks
    let seq = 0;
    const tasks: Task[] = [];
    const T = (title: string, p: Partial<Task> = {}): Task => {
      const t: Task = { ...st(), seq: ++seq, title, body: '', status: 'todo', projectIds: [], labels: [], urgent: false, important: false, links: [], attachmentIds: [], sortOrder: seq, ...p };
      if (t.status === 'done' && !t.completedAt) t.completedAt = ts;
      tasks.push(t);
      return t;
    };
    const nowMin = nowMinutes(now);
    const slot = (offsetMin: number) => hhmmOf(Math.max(6 * 60, Math.min(23 * 60, Math.floor((nowMin + offsetMin) / 15) * 15)));

    // Today: one running now, one next, top 3, more today
    T('עבודה על דף הנחיתה', { projectIds: [pWeb.id], sprintId: sCur.id, dueDate: today, startTime: slot(-20), durationMin: 60, top3Date: today, top3Order: 1, important: true, urgent: true, status: 'doing' });
    T('להתקשר למוסך', { projectIds: [pHome.id], sprintId: sCur.id, dueDate: today, startTime: slot(90), durationMin: 15, top3Date: today, top3Order: 2, urgent: true });
    T('אימון בית', { projectIds: [pBody.id], sprintId: sCur.id, dueDate: today, startTime: slot(240), durationMin: 60, top3Date: today, top3Order: 3, important: true });
    T('לשלם על הבלנדר', { projectIds: [pHome.id], dueDate: today, urgent: true });
    T('לפתוח פרופיל LinkedIn', { projectIds: [pSaas.id], dueDate: today, sprintId: sCur.id });
    T('להכין ספרינט חדש', { dueDate: today, startTime: '21:00', durationMin: 45 });
    T('לשאול את אמא על המתנה', { projectIds: [pMom.id], dueDate: today, status: 'done' });
    // Overdue
    T('לבדוק אילו תשלומים מיותרים', { dueDate: addDays(today, -1), important: true });
    T('לשלם ארנונה', { projectIds: [pHome.id], dueDate: addDays(today, -3), urgent: true, important: true });
    // Current sprint
    const logo = T('ליצור לוגו', { projectIds: [pWeb.id], sprintId: sCur.id, status: 'doing', priority: 'high' });
    T('סקיצות ראשונות', { parentId: logo.id, projectIds: [pWeb.id], sprintId: sCur.id, status: 'done' });
    T('לבחור צבעים', { parentId: logo.id, projectIds: [pWeb.id], sprintId: sCur.id });
    T('לפתוח חשבונות ברשתות', { projectIds: [pWeb.id, pNotion.id], sprintId: sCur.id, status: 'doing' });
    T('לכתוב 5 רעיונות לסרטונים', { projectIds: [pWeb.id], sprintId: sCur.id, status: 'done' });
    T('תבנית ניהול תקציב בעברית', { projectIds: [pNotion.id], sprintId: sCur.id, priority: 'medium' });
    T('תוכנית תזונה', { projectIds: [pBody.id], sprintId: sCur.id, status: 'done' });
    T('תרגילי גב ישר וכתפיים', { projectIds: [pBody.id], sprintId: sCur.id, important: true });
    T('לקבוע תור לרופא שיניים', { sprintId: sCur.id, dueDate: addDays(today, 2) });
    T('לסדר את הארון', { projectIds: [pHome.id], sprintId: sCur.id, status: 'done' });
    // Next sprint + backlog
    T('למכור תבניות בעברית', { projectIds: [pNotion.id], sprintId: sNext.id, important: true });
    T('לברר תנאי קבלה', { projectIds: [pTechnion.id], sprintId: sNext.id });
    T('ללמוד על מודעות באינסטגרם', { projectIds: [pSaas.id] });
    T('ללמוד על מודעות ב-TikTok', { projectIds: [pSaas.id] });
    T('קורס מכירות', { projectIds: [pSaas.id], important: true });
    T('לבדוק מחיר טיפול בשיניים', { projectIds: [pBody.id] });
    // Inbox
    T('לפתוח פרופיל Indeed');
    T('טיפול מוקדם לקרחת');
    T('רעיון: חדר הלבשה וירטואלי');
    T('לקנות מתנה ליום הולדת');
    // Past sprints
    for (const [s, list] of [
      [sLast, ['להחליף ספק אינטרנט', 'להעביר תשלומים לחשבון החדש', 'לסדר את המדפים', 'לקחת שמיכות לכביסה']],
      [s2, ['להחזיר את ה-TRX', 'לשנות שם בבנק', 'לבחור נישה']],
      [s3, ['ליצור מייל עסקי', 'אימון סיבולת ראשון']],
    ] as const) {
      for (const title of list) T(title, { sprintId: s.id, status: 'done', completedAt: `${s.endDate}T12:00:00.000Z`, dueDate: s.startDate });
    }
    T('לשנות ספרינטים לשבועות הגשמה', { sprintId: sLast.id, projectIds: [pNotion.id] });
    T('לארגן תמונות שמורות', { sprintId: sLast.id });
    await db.tasks.bulkAdd(tasks);

    // Notes
    const N = (title: string, body: string, kinds: ('note' | 'idea' | 'meeting')[], projectIds: string[] = [], pinned = false) =>
      ({ ...st(), title, body, kinds, projectIds, links: [], attachmentIds: [], pinned });
    await db.notes.bulkAdd([
      N('תבניות Notion ו-Excel למכירה', 'לבנות 3 תבניות בעברית: תקציב, משימות, הרגלים.\nלבדוק מחירים ב-Etsy ו-Gumroad.', ['idea'], [pNotion.id], true),
      N('חדר הלבשה וירטואלי', 'אווטאר תלת-ממדי שמודד בגדים מכל חנות אונליין.', ['idea']),
      N('אתרים שכדאי להכיר', 'רשימה לתוכן:\n- Perplexity\n- Gamma\n- Remove.bg', ['note'], [pWeb.id]),
      N('פגישה עם דיסקונט', '## החלטות\n- להעביר את התשלומים לחשבון העסקי\n## המשך\n- לשלוח מסמכים', ['meeting']),
      N('', 'להסתכל על מסי: תנועות בלי לגעת בכדור, תמיד הטייה לכיוון שהשחקן מולו כבר הולך.', ['note']),
    ]);

    // Routines + logs
    const R = (routine: 'morning' | 'evening', titles: string[]) => titles.map((title, order) => ({ ...st(), routine, title, order, active: true }));
    const morning = R('morning', ['השכמה', 'צחצוח שיניים', 'מקלחת', 'לקרוא את החוקים', 'אימון בית', 'להתכונן ליציאה']);
    const evening = R('evening', ['מקלחת', 'צחצוח שיניים', 'לקרוא ספר', 'עדכון תכנון למחר', 'לישון עד 23:30']);
    await db.routineItems.bulkAdd([...morning, ...evening]);
    const rlogs: RoutineLog[] = [];
    for (let back = 1; back <= 20; back++) {
      const d = addDays(today, -back);
      for (const [i, it] of [...morning, ...evening].entries()) if ((i + back) % 4 !== 0) rlogs.push({ id: `${d}:${it.id}`, date: d, itemId: it.id, done: true });
    }
    for (const it of morning.slice(0, Math.min(4, Math.max(0, Math.floor((nowMin - 6 * 60) / 20))))) rlogs.push({ id: `${today}:${it.id}`, date: today, itemId: it.id, done: true });
    await db.routineLogs.bulkAdd(rlogs);

    // Challenge: 90 days, started 17 days ago
    const rules = ['רק מים', 'בלי סוכר', 'בלי גלוטן', 'אימון כל יום', 'פחות עישון', 'לקרוא 10 דק׳', 'רשתות רק לעבודה', 'לצפות בסרטון של דוד'].map((title) => ({ id: newId(), title }));
    const ch = { ...st(), name: 'אתגר 90 יום', startDate: addDays(today, -17), endDate: addDays(today, 72), rules };
    await db.challenges.add(ch);
    const clogs: ChallengeLog[] = [];
    for (let back = 1; back <= 17; back++) {
      const d = addDays(today, -back);
      rules.forEach((r, i) => {
        const broken = back > 12 && (back + i) % 9 === 0;
        clogs.push({ id: logId(ch.id, d, r.id), challengeId: ch.id, date: d, ruleId: r.id, value: broken ? 'broken' : 'kept' });
      });
    }
    rules.slice(0, 4).forEach((r) => clogs.push({ id: logId(ch.id, today, r.id), challengeId: ch.id, date: today, ruleId: r.id, value: 'kept' }));
    await db.challengeLogs.bulkAdd(clogs);

    // Recurring: every rule falls on today so "the regulars" card shows
    const dow = new Date(`${today}T12:00:00`).getDay();
    await db.recurring.bulkAdd([
      { ...st(), title: 'לתת כביסה', body: '', projectIds: [pHome.id], labels: [], rule: { type: 'weekly', days: [dow] }, startDate: addDays(today, -60), active: true },
      { ...st(), title: 'לישון אצל אמא', body: '', projectIds: [pMom.id], labels: [], rule: { type: 'interval', weeks: 2, day: dow }, startDate: weekStart(today), active: true },
      { ...st(), title: 'ניקיון מקלחת ומגבות', body: '', projectIds: [pHome.id], labels: [], rule: { type: 'weekly', days: [5] }, startDate: addDays(today, -60), active: true },
    ]);

    // Info cards (the fixed texts from the Notion home page)
    const I = (icon: string, title: string, body: string, order: number) => ({ ...st(), icon, title, body, order });
    await db.infoCards.bulkAdd([
      I('🍗', 'תזונה', 'ראשון–חמישי\n• חביתה / כריך טונה / סמות׳י / בוטנים / שייק חלבון / פירות\n• חזה עוף / סלמון / פילה בקר\n• אורז / תפו״א / פירה + ירקות\n\nשישי\n• שניצל, אורז, ירקות, דג חריף\n\nשבת\n• שקשוקה', 0),
      I('🗒️', 'שגרה שבועית', 'רביעי\n• לתת כביסה\n• לישון אצל אמא\n\nשישי–שבת\n• לבשל לשבוע\n• ארוחה משפחתית\n• לאסוף כביסה', 1),
      I('🧹', 'ימי ניקיון', 'שישי\n• כל המקלחת\n• להחליף מגבות ומצעים\n• אבק, לטאטא, לשטוף\n• מרפסת (פעם בחודש)\n\nמוצ״ש\n• כלים', 2),
      I('🌹', 'חוקים אישיים', '• להיות גבר\n• בלי קנאה, בלי לבדוק\n• להביע עניין כשיוצאים', 3),
    ]);
  });

  await db.settings.update(SETTINGS_ID, { seqCounter: 200 });
  await runDaily(today);
}
