import { db } from '../db/db';
import { SETTINGS_ID } from '../domain/schemas';
import { isDemoMode } from './demo';

/** Read-only queries for live hooks in the UI (CLAUDE.md iron rule 3: the UI never imports db). */
export const Q = {
  tasks: () => db.tasks.toArray(),
  task: (id: string) => db.tasks.get(id).then((x) => x ?? null),
  projects: () => db.projects.toArray(),
  project: (id: string) => db.projects.get(id).then((x) => x ?? null),
  sprints: () => db.sprints.orderBy('startDate').toArray(),
  notes: () => db.notes.toArray(),
  note: (id: string) => db.notes.get(id).then((x) => x ?? null),
  goals: () => db.goals.toArray(),
  goal: (id: string) => db.goals.get(id).then((x) => x ?? null),
  areas: () => db.areas.orderBy('order').toArray(),
  routineItems: () => db.routineItems.toArray(),
  routineLogsFor: (date: string) => db.routineLogs.where('date').equals(date).toArray(),
  challenges: () => db.challenges.orderBy('startDate').toArray(),
  challenge: (id: string) => db.challenges.get(id).then((x) => x ?? null),
  challengeLogs: (challengeId: string) => db.challengeLogs.where('challengeId').equals(challengeId).toArray(),
  allChallengeLogs: () => db.challengeLogs.toArray(),
  recurring: () => db.recurring.toArray(),
  recurringOne: (id: string) => db.recurring.get(id).then((x) => x ?? null),
  infoCards: () => db.infoCards.orderBy('order').toArray(),
  infoCard: (id: string) => db.infoCards.get(id).then((x) => x ?? null),
  templates: () => db.templates.toArray(),
  settings: () => db.settings.get(SETTINGS_ID),
  attachmentsOf: (ownerId: string) => db.attachments.where('ownerId').equals(ownerId).toArray(),
  demo: () => isDemoMode(),
};
