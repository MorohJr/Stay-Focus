import { addDays, diffDays } from './dates';
import type { Challenge, ChallengeLog, RuleValue } from './schemas';

/** R-CHL-1 */
export function activeChallenge(challenges: Challenge[], today: string): Challenge | undefined {
  return challenges
    .filter((c) => c.startDate <= today && today <= c.endDate && c.rules.length > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

export function challengePhase(c: Challenge, today: string): 'active' | 'future' | 'ended' {
  if (today < c.startDate) return 'future';
  if (today > c.endDate) return 'ended';
  return 'active';
}

export function ruleValue(logs: ChallengeLog[], challengeId: string, date: string, ruleId: string): RuleValue | undefined {
  return logs.find((l) => l.challengeId === challengeId && l.date === date && l.ruleId === ruleId)?.value;
}

/** R-CHL-3: unmarked → kept → broken → unmarked. */
export function nextRuleValue(v: RuleValue | undefined): RuleValue | undefined {
  if (v === undefined) return 'kept';
  if (v === 'kept') return 'broken';
  return undefined;
}

export interface DayStats {
  kept: number;
  broken: number;
  marked: number;
  total: number;
}

export function dayStats(c: Challenge, logs: ChallengeLog[], date: string): DayStats {
  let kept = 0;
  let broken = 0;
  for (const r of c.rules) {
    const v = ruleValue(logs, c.id, date, r.id);
    if (v === 'kept') kept++;
    else if (v === 'broken') broken++;
  }
  return { kept, broken, marked: kept + broken, total: c.rules.length };
}

/** R-CHL-2: the card shows until every rule of today is marked. */
export function rulesCardVisible(c: Challenge | undefined, logs: ChallengeLog[], today: string): boolean {
  if (!c) return false;
  const s = dayStats(c, logs, today);
  return s.marked < s.total;
}

/** R-CHL-4: a clean day = every rule kept. */
export function isCleanDay(c: Challenge, logs: ChallengeLog[], date: string): boolean {
  const s = dayStats(c, logs, date);
  return s.total > 0 && s.kept === s.total;
}

/** R-CHL-4: consecutive clean days back from yesterday, plus today if already clean. */
export function streak(c: Challenge, logs: ChallengeLog[], today: string): number {
  let n = isCleanDay(c, logs, today) ? 1 : 0;
  let d = addDays(today, -1);
  while (d >= c.startDate && isCleanDay(c, logs, d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** R-CHL-5: "day X" counts from the start date, inclusive. */
export function challengeDay(c: Challenge, today: string): number {
  return diffDays(c.startDate, today) + 1;
}

export function challengeLength(c: Challenge): number {
  return diffDays(c.startDate, c.endDate) + 1;
}

export type DayMark = 'clean' | 'broken' | 'partial' | 'empty' | 'future';

/** History grid (SPEC 5.7): one mark per day of the challenge. */
export function dayMark(c: Challenge, logs: ChallengeLog[], date: string, today: string): DayMark {
  if (date > today) return 'future';
  const s = dayStats(c, logs, date);
  if (s.broken > 0) return 'broken';
  if (s.total > 0 && s.kept === s.total) return 'clean';
  if (s.marked > 0) return 'partial';
  return 'empty';
}

export function logId(challengeId: string, date: string, ruleId: string): string {
  return `${challengeId}:${date}:${ruleId}`;
}
