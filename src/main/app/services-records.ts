import { PATHS } from '../../shared/paths'
import { LearningCheck, ProfileFile, SettingsFile, Workout, WeightEntry } from '../../shared/schema'
import type { SettingsPatch } from '../../shared/views'
import { nowISO } from '../domain/day'
import { nextLearningSeq } from '../domain/learning'
import { loadProfile, loadSettings } from '../domain/load'
import type { AppContext } from './context'
import { mutate } from './services'

export const logWeight = (ctx: AppContext, kg: number): Promise<void> =>
  mutate(ctx, '记体重', (tx) => tx.appendLine(PATHS.weight, { id: ctx.newId(), at: nowISO(ctx.now()), kg }, WeightEntry))

export const logWorkout = (ctx: AppContext, input: { summary: string; durationMin: number | null }): Promise<void> =>
  mutate(ctx, '记健身', (tx) =>
    tx.appendLine(PATHS.workouts, { id: ctx.newId(), at: nowISO(ctx.now()), summary: input.summary.trim(), durationMin: input.durationMin }, Workout),
  )

/** 改设置：只改给出的字段，改完整体校验 */
export const changeSettings = (ctx: AppContext, patch: SettingsPatch): Promise<void> =>
  mutate(ctx, '修改设置', async (tx) => {
    const current = await loadSettings(tx)
    const next: SettingsFile = {
      ...current,
      ...(patch.dayStartsAt !== undefined ? { dayStartsAt: patch.dayStartsAt } : {}),
      heatmap: { ...current.heatmap, weights: { ...current.heatmap.weights, ...patch.weights } },
      reminders: { ...current.reminders, ...patch.reminders },
    }
    await tx.writeJson(PATHS.settings, next, SettingsFile)
  })

export const changeProfile = (ctx: AppContext, profile: ProfileFile): Promise<void> =>
  mutate(ctx, '修改目标和安排', (tx) => tx.writeJson(PATHS.profile, profile, ProfileFile))

/** 只改给出的字段（管家用）；undefined 的字段保持不动，null 表示清空 */
export const patchProfile = (
  ctx: AppContext,
  patch: {
    weightTargetKg?: number | null
    notes?: string
    wakeTarget?: string | null
    sleepTarget?: string | null
    gymDays?: number[]
    fixed?: ProfileFile['schedule']['fixed']
  },
): Promise<void> =>
  mutate(ctx, '修改目标和安排', async (tx) => {
    const current = await loadProfile(tx)
    const next: ProfileFile = {
      ...current,
      goals: {
        ...current.goals,
        ...(patch.weightTargetKg !== undefined ? { weightTargetKg: patch.weightTargetKg } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
      schedule: {
        ...current.schedule,
        ...(patch.wakeTarget !== undefined ? { wakeTarget: patch.wakeTarget } : {}),
        ...(patch.sleepTarget !== undefined ? { sleepTarget: patch.sleepTarget } : {}),
        ...(patch.gymDays !== undefined ? { gymDays: [...new Set(patch.gymDays)].sort() } : {}),
        ...(patch.fixed !== undefined ? { fixed: patch.fixed } : {}),
      },
    }
    await tx.writeJson(PATHS.profile, next, ProfileFile)
  })

/** 记一次学习检验：序号自动接着往下排 */
export const recordLearning = (
  ctx: AppContext,
  input: { topic: string; taskId: string | null; checks: LearningCheck['checks'] },
): Promise<number> =>
  mutate(ctx, '记学习检验', async (tx) => {
    const { items } = await tx.readLines(PATHS.learning, LearningCheck)
    const seq = nextLearningSeq(items)
    await tx.appendLine(
      PATHS.learning,
      { id: ctx.newId(), seq, at: nowISO(ctx.now()), taskId: input.taskId, topic: input.topic.trim(), checks: input.checks },
      LearningCheck,
    )
    return seq
  })
