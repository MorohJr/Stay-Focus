import { DEFAULT_ROUTINES, SETTINGS_ID, type Area, type Settings, type Template } from '../domain/schemas';

/** Defaults only, never user data (SPEC E6). */

export function defaultSettings(now: string): Settings {
  return { id: SETTINGS_ID, userName: 'אלכס', routines: { ...DEFAULT_ROUTINES }, seqCounter: 0, updatedAt: now };
}

export function defaultAreas(now: string): Area[] {
  return [
    ['area-personal', 'אישי', '#16a34a'],
    ['area-work', 'עבודה', '#3346c4'],
    ['area-family', 'משפחה', '#ea580c'],
    ['area-study', 'לימודים', '#7c3aed'],
  ].map(([id, name, color], i) => ({ id: id!, name: name!, color: color!, order: i, createdAt: now, updatedAt: now }));
}

/** R-NOT-2 + a project template (the Notion "New Project" page). */
export function defaultTemplates(now: string): Template[] {
  const t = (id: string, kind: Template['kind'], name: string, title: string, body: string, subtasks: string[] = []): Template => ({
    id, kind, name, title, body, subtasks, createdAt: now, updatedAt: now,
  });
  return [
    t('tpl-prd', 'note', 'אפיון מוצר (PRD)', 'אפיון: ', '## הבעיה\n\n## למי זה\n\n## מה בונים\n\n## מה לא בונים\n\n## איך נמדוד הצלחה\n\n## שאלות פתוחות\n'),
    t('tpl-brainstorm', 'note', 'סיעור מוחות', 'סיעור מוחות: ', '## השאלה\n\n## רעיונות\n- \n\n## הכי מבטיחים\n\n## צעד הבא\n'),
    t('tpl-techspec', 'note', 'אפיון טכני', 'אפיון טכני: ', '## רקע\n\n## פתרון מוצע\n\n## חלופות\n\n## סיכונים\n\n## שלבים\n'),
    t('tpl-meeting', 'note', 'סיכום פגישה', 'פגישה: ', '## משתתפים\n\n## נושאים\n\n## החלטות\n\n## משימות להמשך\n- \n'),
    t('tpl-project', 'project', 'פרויקט חדש', '', '## מטרת הפרויקט\n\n## איך ייראה "הושלם"\n', ['להגדיר את הצעד הראשון']),
  ];
}
