import type { Settings, Task } from './schemas';

/** The intro (SPEC 5.13, R-ONB). Pure rules; the UI lives in ui/screens/OnboardingScreen.tsx. */

/** R-ONB-1: shown when the intro was never finished (first run, or after "delete all data"), never in demo mode. */
export function needsOnboarding(settings: Pick<Settings, 'onboardedAt'> | undefined, demo: boolean): boolean {
  return !!settings && !settings.onboardedAt && !demo;
}

/** R-ONB-3: the steps after the slides, in order. */
export const ONBOARDING_STEPS = [
  { id: 'details', title: 'קצת עליך' },
  { id: 'how', title: 'איך זה עובד' },
  { id: 'areas', title: 'תחומים' },
  { id: 'goals', title: 'מטרות' },
  { id: 'projects', title: 'פרויקטים' },
  { id: 'tasks', title: 'משימות' },
  { id: 'sprint', title: 'השבוע הזה' },
  { id: 'recurring', title: 'משימות חוזרות' },
  { id: 'routines', title: 'שגרות' },
  { id: 'challenge', title: 'אתגר' },
  { id: 'people', title: 'אנשים' },
  { id: 'notes', title: 'פתקים' },
  { id: 'done', title: 'מוכנים' },
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];

/** R-ONB-3 step 1: the only thing needed to continue is a name. */
export function canLeaveStep(step: OnboardingStepId, userName: string): boolean {
  return step !== 'details' || userName.trim().length > 0;
}

/** R-ONB-3 step 6: where a new task lands. */
export type TaskDestination = { kind: 'inbox' } | { kind: 'today' } | { kind: 'week'; sprintId: string } | { kind: 'project'; projectId: string };

export function taskFieldsFor(dest: TaskDestination, today: string): Partial<Pick<Task, 'dueDate' | 'sprintId' | 'projectIds'>> {
  switch (dest.kind) {
    case 'inbox':
      return {};
    case 'today':
      return { dueDate: today };
    case 'week':
      return { sprintId: dest.sprintId };
    case 'project':
      return { projectIds: [dest.projectId] };
  }
}
