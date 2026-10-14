import { describe, expect, it } from 'vitest';
import { canLeaveStep, needsOnboarding, ONBOARDING_STEPS, taskFieldsFor } from './onboarding';

const TODAY = '2026-10-14';

describe('onboarding (R-ONB)', () => {
  it('R-ONB-1: shown until finished, never in demo mode', () => {
    expect(needsOnboarding({}, false)).toBe(true);
    expect(needsOnboarding({ onboardedAt: '2026-10-14T08:00:00.000Z' }, false)).toBe(false);
    expect(needsOnboarding({}, true)).toBe(false);
    expect(needsOnboarding(undefined, false)).toBe(false); // settings not loaded yet
  });

  it('R-ONB-3: 13 steps, a name is the only requirement', () => {
    expect(ONBOARDING_STEPS).toHaveLength(13);
    expect(ONBOARDING_STEPS.at(-1)!.id).toBe('done');
    expect(canLeaveStep('details', '  ')).toBe(false);
    expect(canLeaveStep('details', 'אלכס')).toBe(true);
    expect(canLeaveStep('tasks', '')).toBe(true);
  });

  it('R-ONB-3 step 6: task destinations', () => {
    expect(taskFieldsFor({ kind: 'inbox' }, TODAY)).toEqual({});
    expect(taskFieldsFor({ kind: 'today' }, TODAY)).toEqual({ dueDate: TODAY });
    expect(taskFieldsFor({ kind: 'week', sprintId: 's1' }, TODAY)).toEqual({ sprintId: 's1' });
    expect(taskFieldsFor({ kind: 'project', projectId: 'p1' }, TODAY)).toEqual({ projectIds: ['p1'] });
  });
});
