import { z } from 'zod'

// ---------- 基础格式 ----------
/** 带时区偏移的 ISO 时间，例如 2026-10-23T07:02:11+08:00（不带偏移的会被拒绝） */
export const OffsetDateTime = z.iso.datetime({ offset: true })
/** HH:mm，不接受带秒的 */
export const HHmm = z.iso.time({ precision: z.TimePrecision.Minute })
/** YYYY-MM-DD */
export const YMD = z.iso.date()
export const Id = z.uuid()
const Weekday = z.number().int().min(1).max(7) // 1 周一 … 7 周日

// ---------- 追加类记录（JSONL，一行一条，只追加） ----------
export const Checkin = z.looseObject({
  id: Id,
  type: z.enum(['wake', 'sleep']),
  at: OffsetDateTime,
  source: z.enum(['desktop', 'phone']),
})
export type Checkin = z.infer<typeof Checkin>

export const WeightEntry = z.looseObject({ id: Id, at: OffsetDateTime, kg: z.number().positive().max(500) })
export type WeightEntry = z.infer<typeof WeightEntry>

export const Workout = z.looseObject({
  id: Id,
  at: OffsetDateTime,
  summary: z.string().min(1),
  durationMin: z.number().nonnegative().nullable(),
})
export type Workout = z.infer<typeof Workout>

export const CheckResult = z.enum(['mastered', 'partial', 'missed'])
export type CheckResult = z.infer<typeof CheckResult>

export const LearningCheck = z.looseObject({
  id: Id,
  seq: z.number().int().positive(),
  at: OffsetDateTime,
  taskId: Id.nullable(),
  topic: z.string().min(1),
  checks: z.array(z.looseObject({ q: z.string(), result: CheckResult })),
})
export type LearningCheck = z.infer<typeof LearningCheck>

export const UsageFeature = z.enum(['plan', 'review', 'chat', 'weekly'])
export const UsageEntry = z.looseObject({
  id: Id,
  at: OffsetDateTime,
  provider: z.string(),
  model: z.string(),
  feature: UsageFeature,
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
})
export type UsageEntry = z.infer<typeof UsageEntry>

// ---------- 状态文件（JSON，整体替换） ----------
export const Task = z.looseObject({
  id: Id,
  title: z.string().min(1, '标题不能为空'),
  list: z.string().min(1),
  status: z.enum(['open', 'done', 'dropped']),
  createdAt: OffsetDateTime,
  doneAt: OffsetDateTime.nullable(),
  due: YMD.nullable(),
  checkpoints: z.array(z.string()),
  notes: z.string(),
})
export type Task = z.infer<typeof Task>

export const DEFAULT_LIST = '收集箱'
export const TasksFile = z.looseObject({
  version: z.literal(1),
  lists: z.array(z.string().min(1)),
  tasks: z.array(Task),
})
export type TasksFile = z.infer<typeof TasksFile>
export const emptyTasks = (): TasksFile => ({ version: 1, lists: [DEFAULT_LIST], tasks: [] })

export const TimelineItem = z.looseObject({ start: HHmm, end: HHmm, title: z.string().min(1), taskId: Id.nullable() })
export type TimelineItem = z.infer<typeof TimelineItem>

export const Review = z.looseObject({ done: z.string(), learned: z.string(), change: z.string(), at: OffsetDateTime })
export type Review = z.infer<typeof Review>

export const Energy = z.enum(['high', 'mid', 'low'])
export type Energy = z.infer<typeof Energy>

export const PlanFile = z.looseObject({
  version: z.literal(1),
  date: YMD,
  energy: Energy.nullable(),
  timeline: z.array(TimelineItem),
  taskIds: z.array(Id),
  review: Review.nullable(),
})
export type PlanFile = z.infer<typeof PlanFile>
export const emptyPlan = (date: string): PlanFile => ({
  version: 1,
  date,
  energy: null,
  timeline: [],
  taskIds: [],
  review: null,
})

export const FixedItem = z.looseObject({ weekday: Weekday, start: HHmm, end: HHmm, title: z.string().min(1) })
export type FixedItem = z.infer<typeof FixedItem>

/** 目标和固定安排：栏目齐全、值全空，由用户自己填 */
export const ProfileFile = z.looseObject({
  version: z.literal(1),
  goals: z.looseObject({ weightTargetKg: z.number().positive().nullable(), notes: z.string() }),
  schedule: z.looseObject({
    wakeTarget: HHmm.nullable(),
    sleepTarget: HHmm.nullable(),
    gymDays: z.array(Weekday),
    fixed: z.array(FixedItem),
  }),
})
export type ProfileFile = z.infer<typeof ProfileFile>
export const emptyProfile = (): ProfileFile => ({
  version: 1,
  goals: { weightTargetKg: null, notes: '' },
  schedule: { wakeTarget: null, sleepTarget: null, gymDays: [], fixed: [] },
})
// ---------- 设置 ----------
export const HeatmapWeights = z.looseObject({
  checkin: z.number().nonnegative(),
  taskDone: z.number().nonnegative(),
  weight: z.number().nonnegative(),
  workout: z.number().nonnegative(),
  review: z.number().nonnegative(),
  learnMastered: z.number().nonnegative(),
  learnPartial: z.number().nonnegative(),
  learnMissed: z.number().nonnegative(),
})
export type HeatmapWeights = z.infer<typeof HeatmapWeights>

export const ProviderKind = z.enum(['openai-compatible', 'anthropic'])
export const ContextStrategy = z.enum(['scene', 'full', 'tools'])
export const ActionMode = z.enum(['tools', 'json'])

export const SettingsFile = z.looseObject({
  version: z.literal(1),
  /** 一天从几点开始算，凌晨这个点之前的记录归前一天 */
  dayStartsAt: HHmm,
  provider: z.looseObject({ kind: ProviderKind, baseURL: z.string(), model: z.string() }),
  contextStrategy: ContextStrategy,
  actionMode: ActionMode,
  heatmap: z.looseObject({ weights: HeatmapWeights }),
  reminders: z.looseObject({ enabled: z.boolean(), plan: HHmm.nullable(), review: HHmm.nullable() }),
})
export type SettingsFile = z.infer<typeof SettingsFile>

export const defaultSettings = (): SettingsFile => ({
  version: 1,
  dayStartsAt: '04:00',
  provider: { kind: 'openai-compatible', baseURL: '', model: '' },
  contextStrategy: 'scene',
  actionMode: 'tools',
  heatmap: {
    weights: {
      checkin: 1,
      taskDone: 1,
      weight: 1,
      workout: 1,
      review: 2,
      learnMastered: 3,
      learnPartial: 2,
      learnMissed: 1,
    },
  },
  reminders: { enabled: false, plan: null, review: null },
})

