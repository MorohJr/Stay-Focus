import { z } from 'zod';

/** Entities (SPEC 3). Zod schemas validate backup files; types are inferred from them. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

const base = {
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const Link = z.object({ url: z.string(), title: z.string().optional() });
export type Link = z.infer<typeof Link>;

export const TaskStatus = z.enum(['todo', 'doing', 'done', 'archived']);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const Priority = z.enum(['low', 'medium', 'high']);
export type Priority = z.infer<typeof Priority>;

export const Task = z.object({
  ...base,
  seq: z.int(),
  title: z.string(),
  body: z.string().default(''),
  status: TaskStatus,
  priority: Priority.optional(),
  dueDate: isoDate.optional(),
  startTime: hhmm.optional(),
  durationMin: z.int().positive().optional(),
  projectIds: z.array(z.string()).default([]),
  sprintId: z.string().optional(),
  parentId: z.string().optional(),
  labels: z.array(z.string()).default([]),
  urgent: z.boolean().default(false),
  important: z.boolean().default(false),
  top3Date: isoDate.optional(),
  top3Order: z.int().optional(),
  recurringId: z.string().optional(),
  links: z.array(Link).default([]),
  attachmentIds: z.array(z.string()).default([]),
  completedAt: z.string().optional(),
  sortOrder: z.number().default(0),
  /** R-SMD */
  someday: z.boolean().default(false),
  /** R-WAI */
  waitingPersonId: z.string().optional(),
  /** R-PRC */
  postponeCount: z.int().default(0),
  /** R-CLN */
  keptAt: z.string().optional(),
});
export type Task = z.infer<typeof Task>;

export const ProjectStatus = z.enum(['planning', 'active', 'done', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const Project = z.object({
  ...base,
  name: z.string(),
  body: z.string().default(''),
  icon: z.string().default('🎯'),
  /** R-PRJ-3: uploaded logo and cover (Attachment ids). */
  logoId: z.string().optional(),
  coverId: z.string().optional(),
  status: ProjectStatus,
  priority: Priority.optional(),
  areaId: z.string().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  goalId: z.string().optional(),
  blockedByIds: z.array(z.string()).default([]),
});
export type Project = z.infer<typeof Project>;

export const Sprint = z.object({
  ...base,
  name: z.string(),
  startDate: isoDate,
  endDate: isoDate,
  reviewedAt: z.string().optional(),
  /** R-REV step 5: up to 3 goals for the week. */
  weeklyGoals: z.array(z.string()).default([]),
});
export type Sprint = z.infer<typeof Sprint>;

/** 3.14 */
export const Person = z.object({ ...base, name: z.string(), emoji: z.string().default('🙂'), body: z.string().default('') });
export type Person = z.infer<typeof Person>;

export const AgendaItem = z.object({ ...base, personId: z.string(), text: z.string(), doneAt: z.string().optional() });
export type AgendaItem = z.infer<typeof AgendaItem>;

/** 3.15 */
export const Milestone = z.object({ ...base, projectId: z.string(), title: z.string(), dueDate: isoDate.optional(), doneAt: z.string().optional(), order: z.number() });
export type Milestone = z.infer<typeof Milestone>;

export const NoteKind = z.enum(['note', 'idea', 'meeting']);
export type NoteKind = z.infer<typeof NoteKind>;

export const Note = z.object({
  ...base,
  title: z.string(),
  body: z.string().default(''),
  kinds: z.array(NoteKind).default([]),
  projectIds: z.array(z.string()).default([]),
  links: z.array(Link).default([]),
  attachmentIds: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
});
export type Note = z.infer<typeof Note>;

export const Goal = z.object({
  ...base,
  title: z.string(),
  body: z.string().default(''),
  areaId: z.string().optional(),
  targetDate: isoDate.optional(),
  status: z.enum(['active', 'achieved', 'archived']),
  progressMode: z.enum(['projects', 'manual']),
  manualProgress: z.number().min(0).max(100).default(0),
  inFocus: z.boolean().default(false),
});
export type Goal = z.infer<typeof Goal>;

export const Area = z.object({ ...base, name: z.string(), color: z.string(), order: z.number() });
export type Area = z.infer<typeof Area>;

export const RoutineKind = z.enum(['morning', 'evening']);
export type RoutineKind = z.infer<typeof RoutineKind>;

export const RoutineItem = z.object({ ...base, routine: RoutineKind, title: z.string(), order: z.number(), active: z.boolean() });
export type RoutineItem = z.infer<typeof RoutineItem>;

/** id = `${date}:${itemId}` */
export const RoutineLog = z.object({ id: z.string(), date: isoDate, itemId: z.string(), done: z.boolean() });
export type RoutineLog = z.infer<typeof RoutineLog>;

export const Rule = z.object({ id: z.string(), title: z.string() });
export type Rule = z.infer<typeof Rule>;

export const Challenge = z.object({
  ...base,
  name: z.string(),
  startDate: isoDate,
  endDate: isoDate,
  rules: z.array(Rule),
});
export type Challenge = z.infer<typeof Challenge>;

export const RuleValue = z.enum(['kept', 'broken']);
export type RuleValue = z.infer<typeof RuleValue>;

/** id = `${challengeId}:${date}:${ruleId}` */
export const ChallengeLog = z.object({ id: z.string(), challengeId: z.string(), date: isoDate, ruleId: z.string(), value: RuleValue });
export type ChallengeLog = z.infer<typeof ChallengeLog>;

export const RecurrenceRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily') }),
  z.object({ type: z.literal('weekly'), days: z.array(z.int().min(0).max(6)).min(1) }),
  z.object({ type: z.literal('interval'), weeks: z.int().min(1), day: z.int().min(0).max(6) }),
  z.object({ type: z.literal('monthly'), dayOfMonth: z.int().min(1).max(31) }),
]);
export type RecurrenceRule = z.infer<typeof RecurrenceRule>;

export const Recurring = z.object({
  ...base,
  title: z.string(),
  body: z.string().default(''),
  projectIds: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  startTime: hhmm.optional(),
  durationMin: z.int().positive().optional(),
  rule: RecurrenceRule,
  startDate: isoDate,
  endDate: isoDate.optional(),
  active: z.boolean(),
});
export type Recurring = z.infer<typeof Recurring>;

export const Attachment = z.object({
  ...base,
  ownerType: z.enum(['task', 'note', 'project']),
  ownerId: z.string(),
  name: z.string(),
  mime: z.string(),
  blob: z.instanceof(Blob),
});
export type Attachment = z.infer<typeof Attachment>;

export const Template = z.object({
  ...base,
  kind: z.enum(['task', 'project', 'note']),
  name: z.string(),
  title: z.string(),
  body: z.string(),
  subtasks: z.array(z.string()).default([]),
});
export type Template = z.infer<typeof Template>;

export const RoutineSettings = z.object({
  morningStart: hhmm,
  morningEnd: hhmm,
  weekendDifferent: z.boolean(),
  weekendMorningEnd: hhmm,
  eveningStart: hhmm,
  eveningEnd: hhmm,
});
export type RoutineSettings = z.infer<typeof RoutineSettings>;

export const SETTINGS_ID = 'settings';

export const Settings = z.object({
  id: z.literal(SETTINGS_ID),
  userName: z.string(),
  weather: z.object({ placeName: z.string(), lat: z.number(), lon: z.number() }).optional(),
  weatherCache: z.object({ fetchedAt: z.string(), tempC: z.number(), code: z.int() }).optional(),
  routines: RoutineSettings,
  lastBackupAt: z.string().optional(),
  seqCounter: z.int(),
  updatedAt: z.string(),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_ROUTINES: RoutineSettings = {
  morningStart: '06:00',
  morningEnd: '09:30',
  weekendDifferent: false,
  weekendMorningEnd: '11:00',
  eveningStart: '18:00',
  eveningEnd: '22:30',
};
