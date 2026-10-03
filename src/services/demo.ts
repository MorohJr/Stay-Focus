import Dexie, { type EntityTable } from 'dexie';
import { db, TABLE_NAMES } from '../db/db';
import { defaultAreas, defaultTemplates } from '../db/seed';
import { logId } from '../domain/challenge';
import { addDays, dayOfWeek, hhmmOf, nowMinutes, weekStart } from '../domain/dates';
import { SETTINGS_ID, type AgendaItem, type Challenge, type ChallengeLog, type Goal, type Milestone, type Note, type Person, type Project, type Recurring, type RoutineItem, type RoutineLog, type Sprint, type Task } from '../domain/schemas';
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
// Sample data (R-DEM-1): generic, random on every load, built around "now".
// No fitness/nutrition and no money topics — those live in separate apps.
// ---------------------------------------------------------------------------

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: readonly T[]): T => a[rnd(a.length)]!;
const shuffle = <T,>(a: readonly T[]): T[] => [...a].sort(() => Math.random() - 0.5);
const chance = (p: number) => Math.random() < p;

type GoalKey = 'product' | 'spanish' | 'book' | 'japan' | 'audience' | 'guitar' | 'home';
const GOALS: Record<GoalKey, { title: string; area: string; body: string; years: number }> = {
  product: { title: 'להשיק מוצר דיגיטלי משלי', area: 'area-work', body: 'משהו קטן שאנשים באמת משתמשים בו.', years: 1 },
  spanish: { title: 'לדבר ספרדית שוטפת', area: 'area-study', body: 'שיחה של חצי שעה בלי להיתקע.', years: 2 },
  book: { title: 'לכתוב ולהוציא ספר קצר', area: 'area-personal', body: '', years: 2 },
  japan: { title: 'חודש של טיול ביפן', area: 'area-personal', body: '', years: 1 },
  audience: { title: 'קהילה של 10,000 עוקבים', area: 'area-work', body: 'תוכן שימושי, פעמיים בשבוע.', years: 2 },
  guitar: { title: 'לנגן 10 שירים בגיטרה', area: 'area-personal', body: '', years: 1 },
  home: { title: 'בית מסודר ונעים', area: 'area-personal', body: '', years: 1 },
};

const PROJECTS: { name: string; icon: string; area: string; goal?: GoalKey; tasks: string[] }[] = [
  { name: 'אתר תדמית חדש', icon: '🌐', area: 'area-work', goal: 'product', tasks: ['לבחור פלטפורמה לאתר', 'לכתוב טקסטים לדף הבית', 'לצלם תמונות לאתר', 'לעצב לוגו חדש', 'לבנות דף אודות', 'לחבר דומיין', 'בדיקות במובייל', 'להעלות לאוויר', 'לשלוח לחברים לפידבק'] },
  { name: 'ערוץ יוטיוב', icon: '🎬', area: 'area-work', goal: 'audience', tasks: ['לחקור 10 ערוצים מצליחים', 'לכתוב תסריט לפרק 1', 'לסדר פינת צילום בבית', 'לצלם פרק ראשון', 'לערוך ולהוסיף כתוביות', 'לעצב תמונה ממוזערת', 'לתכנן לוח העלאות לחודש'] },
  { name: 'ניוזלטר שבועי', icon: '✉️', area: 'area-work', goal: 'audience', tasks: ['לבחור שם לניוזלטר', 'לכתוב גיליון ראשון', 'לבנות דף הרשמה', 'להזמין 50 אנשים ראשונים', 'לקבוע יום קבוע לשליחה'] },
  { name: 'אפליקציית מתכונים', icon: '💡', area: 'area-work', goal: 'product', tasks: ['לכתוב אפיון קצר', 'סקיצות למסכים', 'לבחור טכנולוגיה', 'לבנות אב טיפוס', 'לבדוק עם 5 משתמשים', 'לתקן לפי הפידבק'] },
  { name: 'פודקאסט עם חבר', icon: '🎙️', area: 'area-work', goal: 'audience', tasks: ['לבחור קונספט', 'פגישת תכנון', 'להקליט פרק ניסיון', 'לבחור פלטפורמה', 'לעצב עטיפה'] },
  { name: 'ספרדית', icon: '📚', area: 'area-study', goal: 'spanish', tasks: ['שיעורים 1–5 באפליקציה', 'ללמוד 100 מילים בסיסיות', 'למצוא שותף לשיחה', 'לראות סדרה עם כתוביות בספרדית', 'לקרוא ספר ילדים בספרדית', 'מבחן רמה'] },
  { name: 'קורס עיצוב UX', icon: '🎓', area: 'area-study', tasks: ['פרק 1: מחקר משתמשים', 'פרק 2: וויירפריימים', 'פרק 3: אב טיפוס', 'פרויקט גמר', 'להוסיף לפורטפוליו', 'לקרוא Don’t Make Me Think'] },
  { name: 'מעבר דירה', icon: '📦', area: 'area-personal', goal: 'home', tasks: ['רשימה של מה לוקחים', 'לתאם מובילים', 'לארוז את המטבח', 'לעדכן כתובת בכל המקומות', 'לחבר אינטרנט בדירה החדשה', 'לתלות תמונות'] },
  { name: 'סידור הבית', icon: '🏠', area: 'area-personal', goal: 'home', tasks: ['לפנות את המחסן', 'לסדר את הארון', 'למסור בגדים שלא לובשים', 'לתקן את הברז במטבח', 'להחליף נורות במסדרון'] },
  { name: 'גינה במרפסת', icon: '🌱', area: 'area-personal', goal: 'home', tasks: ['לבחור צמחים', 'להביא עציצים ואדמה', 'לשתול תבלינים', 'מערכת השקיה פשוטה'] },
  { name: 'לכתוב ספר קצר', icon: '✍️', area: 'area-personal', goal: 'book', tasks: ['לבחור נושא', 'ראשי פרקים', 'לכתוב פרק 1', 'לכתוב פרק 2', 'לכתוב פרק 3', 'למצוא עורך', 'עיצוב כריכה'] },
  { name: 'טיול ליפן', icon: '✈️', area: 'area-personal', goal: 'japan', tasks: ['לבחור תאריכים', 'מסלול: טוקיו, קיוטו, אוסקה', 'להזמין טיסות', 'להזמין מלונות', 'רשימת מקומות לראות', 'ללמוד 30 מילים ביפנית'] },
  { name: 'גיטרה', icon: '🎸', area: 'area-personal', goal: 'guitar', tasks: ['ללמוד 4 אקורדים בסיסיים', 'שיר ראשון', 'לתרגל 15 דק׳ ביום', 'לנגן מול חברים'] },
  { name: 'משפחה', icon: '❤️', area: 'area-family', tasks: ['ארוחת שישי אצל ההורים', 'לתכנן טיול עם האחיינים', 'להתקשר לסבא', 'לסדר אלבום תמונות משפחתי', 'לבחור מתנה לאחות'] },
  { name: 'יום הולדת לסבתא', icon: '🎂', area: 'area-family', tasks: ['לבחור תאריך', 'להזמין את כל הדודים', 'להזמין מקום', 'מצגת תמונות', 'לכתוב ברכה'] },
];

const INBOX = ['לבדוק שעות פתיחה של הדואר', 'רעיון לפוסט: 5 טעויות של מתחילים', 'להחזיר ספר לספרייה', 'לקבוע תספורת', 'לברר על סדנת צילום', 'להוריד אפליקציית מדיטציה', 'לשאול את דנה על ההמלצה', 'רעיון: פודקאסט על הרגלים', 'לחדש דרכון', 'לכתוב תודה למורה מהתיכון'];

const NOTES: { title: string; body: string; kinds: Note['kinds']; project?: string }[] = [
  { title: 'רעיונות לסרטונים', body: '- איך אני מתכנן שבוע\n- 3 אפליקציות שחוסכות לי שעה ביום\n- מה למדתי מ-30 יום בלי טלפון בבוקר', kinds: ['idea'], project: 'ערוץ יוטיוב' },
  { title: 'פגישה עם המעצבת', body: '## החלטות\n- צבע ראשי: כחול כהה\n- גופן: Heebo\n## להמשך\n- לשלוח טקסטים עד יום חמישי', kinds: ['meeting'], project: 'אתר תדמית חדש' },
  { title: 'מילים בספרדית', body: 'hola, gracias, por favor, ¿dónde está…?, me gustaría', kinds: ['note'], project: 'ספרדית' },
  { title: 'שמות לניוזלטר', body: 'יום ראשון של פוקוס / שבוע אחד קדימה / המכתב הקטן', kinds: ['idea'], project: 'ניוזלטר שבועי' },
  { title: 'מה לבדוק בדירה החדשה', body: '- לחץ מים\n- קליטה בסלולר\n- רעש מהכביש בערב', kinds: ['note'], project: 'מעבר דירה' },
  { title: 'ספרים לקרוא', body: '1. Deep Work\n2. Atomic Habits\n3. Show Your Work\n4. Make Time', kinds: ['note'] },
  { title: 'פגישת תכנון פודקאסט', body: '## משתתפים\nאני ויואב\n## החלטות\nפרק של 30 דקות, פעם בשבועיים', kinds: ['meeting'], project: 'פודקאסט עם חבר' },
  { title: 'רעיון: אפליקציה לרשימות קניות משותפות', body: 'כל המשפחה מוסיפה, ומי שבסופר מסמן.', kinds: ['idea'] },
  { title: 'פרק 1: שורות פתיחה', body: 'היא ידעה שהבוקר הזה יהיה שונה כבר כשהקפה נשפך…', kinds: ['note'], project: 'לכתוב ספר קצר' },
  { title: 'מסלול יפן, טיוטה', body: 'טוקיו 6 לילות\nהקונה 2 לילות\nקיוטו 5 לילות\nאוסקה 3 לילות', kinds: ['note'], project: 'טיול ליפן' },
  { title: 'סיכום שיחה עם מנטור', body: '- להתמקד בדבר אחד ברבעון\n- לפרסם גם כשזה לא מושלם', kinds: ['meeting'] },
  { title: 'שירים ללמוד', body: 'Wonderwall, Let It Be, Stand By Me, עטור מצחך', kinds: ['note'], project: 'גיטרה' },
  { title: 'רעיונות לגינה', body: 'בזיליקום, נענע, רוזמרין, עגבניות שרי', kinds: ['idea'], project: 'גינה במרפסת' },
  { title: 'מתנה לסבתא', body: 'אלבום מודפס עם תמונות מכל הנכדים', kinds: ['idea'], project: 'יום הולדת לסבתא' },
  { title: 'דברים שלמדתי השבוע', body: 'לכתוב את 3 החשובים בערב הקודם עובד הרבה יותר טוב מבבוקר.', kinds: ['note'] },
  { title: 'רעיון: סדנה קטנה לחברים', body: 'ערב אחד: איך לתכנן שבוע בלי להשתגע.', kinds: ['idea'] },
];

const PEOPLE: [string, string][] = [['אמא', '❤️'], ['אבא', '👨'], ['נועה', '👩'], ['יואב', '🧑‍💼'], ['סבתא', '👵'], ['דני מהעבודה', '🤝'], ['מיכל', '⭐']];
const TALK = ['לספר על הפרויקט החדש', 'לשאול איך היה הטיול', 'להחזיר את הספר', 'לתאם ארוחת שישי', 'לשאול על ההמלצה לרופא', 'להראות את התמונות', 'לשאול מה הוא חושב על הרעיון', 'להגיד תודה על העזרה'];
const WAITING = ['לקבל הצעה מהמעצבת', 'תשובה לגבי התאריכים', 'שיחזיר את המקדחה', 'פידבק על הטיוטה', 'אישור לגבי הפגישה', 'שישלח את התמונות'];
const SOMEDAY = ['ללמוד קרמיקה', 'לכתוב בלוג על טכנולוגיה', 'לבנות שולחן מעץ', 'טיול לאיסלנד', 'ללמוד לצלם בפילם', 'קורס אפייה של לחם', 'להתנדב פעם בשבוע', 'ללמוד צרפתית'];
const MILESTONES = ['גרסה ראשונה', 'פידבק מ-5 אנשים', 'השקה', 'חצי הדרך', 'סיום תכנון', 'גרסה סופית'];
const WEEK_GOALS = ['לסיים את דף הבית', 'שני פרקים בספר', 'ערב אחד בלי מסכים', 'לצלם פרק ראשון', 'שיחה בספרדית', 'לסגור את המחסן'];

const MORNING = ['השכמה בלי טלפון', 'כוס מים', 'מדיטציה 10 דק׳', 'לכתוב את 3 החשובים', 'לקרוא 10 עמודים', 'לעבור על המשימות של היום'];
const EVENING = ['לסגור את המחשב', 'לסדר את השולחן', 'יומן: מה הלך טוב', 'להכין את המחר', 'לקרוא לפני השינה', 'במיטה עד 23:30'];

export async function generateDemo(today: string, now: Date = new Date()): Promise<void> {
  const settings = await getSettings();
  const ts = nowIso();
  const st = () => ({ id: newId(), createdAt: ts, updatedAt: ts });
  const nowMin = nowMinutes(now);
  const slot = (offsetMin: number) => hhmmOf(Math.max(6 * 60, Math.min(23 * 60, Math.floor((nowMin + offsetMin) / 15) * 15)));
  const dow = dayOfWeek(today);

  // Goals: 4 of the pool, one in focus.
  const goalKeys = shuffle(Object.keys(GOALS) as GoalKey[]).slice(0, 4);
  const goals: Goal[] = goalKeys.map((k, i) => ({
    ...st(), title: GOALS[k].title, body: GOALS[k].body, areaId: GOALS[k].area,
    targetDate: addDays(today, 365 * GOALS[k].years - rnd(120)), status: 'active', progressMode: chance(0.75) ? 'projects' : 'manual',
    manualProgress: 10 + rnd(50), inFocus: i === 0,
  }));
  const goalId = (k?: GoalKey) => (k ? goals.find((g) => g.title === GOALS[k].title)?.id : undefined);

  // Projects: 12 of the pool, with mixed statuses.
  const statuses: Project['status'][] = shuffle(['active', 'active', 'active', 'active', 'active', 'planning', 'planning', 'planning', 'planning', 'done', 'done', 'archived']);
  const chosen = shuffle(PROJECTS).slice(0, 12);
  const projects: Project[] = chosen.map((p, i) => ({
    ...st(), name: p.name, icon: p.icon, body: '', status: statuses[i]!, areaId: p.area, goalId: goalId(p.goal), blockedByIds: [],
    priority: pick(['high', 'medium', 'low', undefined] as const),
    startDate: chance(0.5) ? addDays(today, -rnd(60)) : undefined, endDate: chance(0.4) ? addDays(today, 20 + rnd(120)) : undefined,
  }));
  const planning = projects.filter((p) => p.status === 'planning');
  const active = projects.filter((p) => p.status === 'active');
  if (planning[0] && active[0]) planning[0].blockedByIds = [active[0].id];

  // Sprints: 6 past weeks, this week, next week.
  const cur = weekStart(today);
  const sprints: Sprint[] = [-42, -35, -28, -21, -14, -7, 0, 7].map((off) => {
    const start = addDays(cur, off);
    return { ...st(), name: sprintName(start), ...sprintRange(start), reviewedAt: off < -7 ? ts : undefined, weeklyGoals: [] as string[] };
  });
  const past = sprints.slice(0, 6);
  const sCur = sprints[6]!;
  const sNext = sprints[7]!;

  // Tasks
  let seq = 0;
  const tasks: Task[] = [];
  const T = (title: string, p: Partial<Task> = {}): Task => {
    const t = { ...st(), seq: ++seq, title, body: '', status: 'todo', projectIds: [], labels: [], urgent: false, important: false, links: [], attachmentIds: [], sortOrder: seq, someday: false, postponeCount: 0, ...p } as Task;
    if (t.status === 'done' && !t.completedAt) t.completedAt = ts;
    tasks.push(t);
    return t;
  };
  for (const [i, p] of projects.entries()) {
    const titles = chosen[i]!.tasks;
    const doneShare = p.status === 'done' || p.status === 'archived' ? 1 : p.status === 'active' ? 0.3 + Math.random() * 0.4 : Math.random() * 0.15;
    titles.forEach((title, k) => {
      const done = k < Math.round(titles.length * doneShare);
      const created = addDays(today, -(10 + rnd(70)));
      if (done) {
        const s = pick(past);
        T(title, { projectIds: [p.id], sprintId: chance(0.8) ? s.id : undefined, status: 'done', completedAt: `${addDays(s.startDate, rnd(7))}T1${rnd(9)}:00:00.000Z`, createdAt: `${created}T09:00:00.000Z` });
      } else if (p.status === 'active') {
        const where = rnd(10);
        T(title, {
          projectIds: [p.id], createdAt: `${created}T09:00:00.000Z`,
          sprintId: where < 5 ? sCur.id : where < 7 ? sNext.id : undefined,
          status: where < 5 && chance(0.3) ? (chance(0.5) ? 'doing' : 'done') : 'todo',
          urgent: chance(0.25), important: chance(0.4), priority: pick(['high', 'medium', undefined, undefined] as const),
        });
      } else {
        T(title, { projectIds: [p.id], createdAt: `${created}T09:00:00.000Z`, important: chance(0.3) });
      }
    });
  }
  // Last week: a few more done, and some left over for the weekly review (R-SPR-4)
  const sLast = past[5]!;
  for (const t of shuffle(tasks.filter((x) => x.status === 'done' && x.sprintId && x.sprintId !== sLast.id)).slice(0, 5)) {
    Object.assign(t, { sprintId: sLast.id, completedAt: `${addDays(sLast.startDate, rnd(7))}T15:00:00.000Z` });
  }
  for (const t of shuffle(tasks.filter((x) => x.status === 'todo' && !x.sprintId)).slice(0, 3)) t.sprintId = sLast.id;
  // A few sub-tasks
  for (const parent of shuffle(tasks.filter((t) => t.status !== 'done' && t.sprintId === sCur.id)).slice(0, 2)) {
    for (const sub of ['טיוטה ראשונה', 'לבקש פידבק', 'גרסה סופית'].slice(0, 2 + rnd(2))) {
      T(sub, { parentId: parent.id, projectIds: parent.projectIds, sprintId: parent.sprintId, status: chance(0.4) ? 'done' : 'todo' });
    }
  }
  // Today: one running now, two later (all top 3), more today, overdue
  const openCur = shuffle(tasks.filter((t) => t.sprintId === sCur.id && t.status !== 'done' && !t.parentId));
  const [a, b, c, ...rest] = openCur;
  if (a) Object.assign(a, { dueDate: today, startTime: slot(-20), durationMin: 60, top3Date: today, top3Order: 1, status: 'doing' });
  if (b) Object.assign(b, { dueDate: today, startTime: slot(90), durationMin: 30, top3Date: today, top3Order: 2 });
  if (c) Object.assign(c, { dueDate: today, startTime: slot(240), durationMin: 60, top3Date: today, top3Order: 3 });
  rest.slice(0, 3).forEach((t, i) => Object.assign(t, { dueDate: today, startTime: i === 0 ? slot(330) : undefined }));
  rest.slice(3, 6).forEach((t, i) => Object.assign(t, { dueDate: addDays(today, -(1 + i * 2)) }));
  rest.slice(6, 10).forEach((t, i) => Object.assign(t, { dueDate: addDays(today, 1 + i) }));
  T('להכין את השבוע הבא', { dueDate: today, startTime: '21:00', durationMin: 45, sprintId: sCur.id });
  T(pick(['לקבוע תור לרופא', 'להתקשר לסבא', 'לאסוף חבילה מהדואר']), { dueDate: today, status: 'done' });
  // Inbox
  for (const title of shuffle(INBOX).slice(0, 6)) T(title, { createdAt: `${addDays(today, -rnd(5))}T08:00:00.000Z` });

  // People + talking points + waiting (R-PPL, R-WAI)
  const people: Person[] = shuffle(PEOPLE).slice(0, 5).map(([name, emoji]) => ({ ...st(), name, emoji, body: '' }));
  const agenda: AgendaItem[] = [];
  for (const p of people) for (const text of shuffle(TALK).slice(0, 1 + rnd(3))) agenda.push({ ...st(), personId: p.id, text });
  for (const [i, title] of shuffle(WAITING).slice(0, 4).entries()) {
    T(title, { waitingPersonId: people[i % people.length]!.id, dueDate: addDays(today, rnd(2) ? 1 + rnd(5) : -1), createdAt: `${addDays(today, -rnd(10))}T09:00:00.000Z` });
  }
  // Someday (R-SMD) and procrastinated tasks (R-PRC)
  for (const title of shuffle(SOMEDAY).slice(0, 6)) T(title, { someday: true, createdAt: `${addDays(today, -rnd(90))}T09:00:00.000Z` });
  for (const t of shuffle(tasks.filter((x) => x.status === 'todo' && !x.someday && !x.top3Date)).slice(0, 3)) Object.assign(t, { postponeCount: 3 + rnd(3) });
  // Old untouched tasks, so "cleanup" has something (R-CLN)
  for (const t of shuffle(tasks.filter((x) => x.status === 'todo' && !x.sprintId && !x.dueDate && !x.someday)).slice(0, 4)) t.createdAt = `${addDays(today, -(70 + rnd(60)))}T09:00:00.000Z`;

  // Milestones for active and planned projects (R-MIL)
  const milestones: Milestone[] = [];
  for (const p of projects.filter((x) => x.status === 'active' || x.status === 'planning')) {
    shuffle(MILESTONES).slice(0, 2 + rnd(2)).forEach((title, order) => {
      const due = addDays(today, -20 + order * 25 + rnd(10));
      const done = p.status === 'active' && order === 0 && chance(0.7);
      milestones.push({ ...st(), projectId: p.id, title, order, dueDate: due, doneAt: done ? `${addDays(due, chance(0.6) ? -2 : 3)}T12:00:00.000Z` : undefined });
    });
  }
  sCur.weeklyGoals = shuffle(WEEK_GOALS).slice(0, 3);

  // Notes
  const notes: Note[] = shuffle(NOTES).slice(0, 15).map((n, i) => {
    const p = projects.find((x) => x.name === n.project);
    const d = addDays(today, -rnd(40));
    return { ...st(), title: n.title, body: n.body, kinds: n.kinds, projectIds: p ? [p.id] : [], links: [], attachmentIds: [], pinned: i < 2, createdAt: `${d}T10:00:00.000Z`, updatedAt: `${d}T10:00:00.000Z` };
  });

  // Routines + a month of history
  const R = (routine: 'morning' | 'evening', titles: string[]): RoutineItem[] => titles.map((title, order) => ({ ...st(), routine, title, order, active: true }));
  const items = [...R('morning', MORNING), ...R('evening', EVENING)];
  const rlogs: RoutineLog[] = [];
  for (let back = 1; back <= 30; back++) {
    const d = addDays(today, -back);
    for (const it of items) if (chance(0.72)) rlogs.push({ id: `${d}:${it.id}`, date: d, itemId: it.id, done: true });
  }
  for (const it of items.slice(0, Math.min(4, Math.max(0, Math.floor((nowMin - 6 * 60) / 25))))) rlogs.push({ id: `${today}:${it.id}`, date: today, itemId: it.id, done: true });

  // Challenges: one that ended, one active
  const rule = (title: string) => ({ id: newId(), title });
  const ended: Challenge = { ...st(), name: 'חודש בלי רשתות חברתיות', startDate: addDays(today, -75), endDate: addDays(today, -46), rules: ['בלי אינסטגרם', 'בלי טיקטוק', 'מייל רק פעמיים ביום'].map(rule) };
  const activeCh: Challenge = { ...st(), name: '30 יום של פוקוס', startDate: addDays(today, -12 - rnd(8)), endDate: addDays(today, 10 + rnd(10)), rules: ['בלי טלפון בשעה הראשונה', 'שעתיים עבודה עמוקה', 'לקרוא 20 דק׳', 'לכתוב עמוד אחד', 'לישון לפני 23:30', '15 דק׳ ספרדית'].map(rule) };
  const clogs: ChallengeLog[] = [];
  for (const ch of [ended, activeCh]) {
    for (let d = ch.startDate; d < today && d <= ch.endDate; d = addDays(d, 1)) {
      for (const r of ch.rules) clogs.push({ id: logId(ch.id, d, r.id), challengeId: ch.id, date: d, ruleId: r.id, value: chance(0.9) ? 'kept' : 'broken' });
    }
  }
  activeCh.rules.slice(0, 3).forEach((r) => clogs.push({ id: logId(activeCh.id, today, r.id), challengeId: activeCh.id, date: today, ruleId: r.id, value: 'kept' }));

  // Recurring: at least two fall today, so "today's regulars" shows
  const recurring: Recurring[] = [
    { ...st(), title: 'שיחה עם ההורים', body: '', projectIds: [], labels: [], rule: { type: 'weekly', days: [dow] }, startDate: addDays(today, -90), active: true },
    { ...st(), title: 'להשקות עציצים', body: '', projectIds: [], labels: [], rule: { type: 'weekly', days: [dow, (dow + 3) % 7] }, startDate: addDays(today, -90), active: true },
    { ...st(), title: 'לגבות את האפליקציה', body: '', projectIds: [], labels: [], rule: { type: 'interval', weeks: 2, day: dow }, startDate: weekStart(today), active: true },
    { ...st(), title: 'לתכנן את השבוע', body: '', projectIds: [], labels: [], startTime: '20:00', durationMin: 30, rule: { type: 'weekly', days: [0] }, startDate: addDays(today, -90), active: true },
    { ...st(), title: 'ניקיון יסודי', body: '', projectIds: [], labels: [], rule: { type: 'weekly', days: [5] }, startDate: addDays(today, -90), active: true },
  ];

  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLE_NAMES) await db.table(name).clear();
    await db.settings.add({ ...settings, id: SETTINGS_ID, lastBackupAt: ts, seqCounter: seq, updatedAt: ts });
    await db.areas.bulkAdd(defaultAreas(ts));
    await db.templates.bulkAdd(defaultTemplates(ts));
    await db.goals.bulkAdd(goals);
    await db.projects.bulkAdd(projects);
    await db.sprints.bulkAdd(sprints);
    await db.tasks.bulkAdd(tasks);
    await db.notes.bulkAdd(notes);
    await db.routineItems.bulkAdd(items);
    await db.routineLogs.bulkAdd(rlogs);
    await db.challenges.bulkAdd([ended, activeCh]);
    await db.challengeLogs.bulkAdd(clogs);
    await db.recurring.bulkAdd(recurring);
    await db.people.bulkAdd(people);
    await db.agenda.bulkAdd(agenda);
    await db.milestones.bulkAdd(milestones);
  });
  await runDaily(today);
}
