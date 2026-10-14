import { addDays } from '../domain/dates';
import { taskFieldsFor, type TaskDestination } from '../domain/onboarding';
import { updateSettings, nowIso } from './entity';
import { createChallenge } from './habits';
import { runDaily } from './planning';
import { addToTop3, createTask } from './tasks';

/** R-ONB-1 + R-ONB-4: marks the intro as done and runs the daily jobs, so Today is built from what was added. */
export async function finishOnboarding(today: string): Promise<void> {
  await updateSettings({ onboardedAt: nowIso() });
  await runDaily(today);
}

/** R-ONB-3 step 6: a task with its destination; the star puts it in today's top 3. */
export async function addOnboardingTask(title: string, dest: TaskDestination, star: boolean, today: string) {
  if (!title.trim()) return undefined;
  const t = await createTask({ title, ...taskFieldsFor(dest, today) });
  if (star) await addToTop3(t.id, today);
  return t;
}

/** R-ONB-3 step 10: a challenge that starts today and lasts `days` days. */
export function startChallenge(name: string, days: number, rules: string[], today: string) {
  return createChallenge({ name: name.trim(), startDate: today, endDate: addDays(today, Math.max(1, days) - 1), rules });
}
