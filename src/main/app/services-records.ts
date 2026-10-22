import { PATHS } from '../../shared/paths'
import { ProfileFile, SettingsFile, Workout, WeightEntry } from '../../shared/schema'
import type { SettingsPatch } from '../../shared/views'
import { nowISO } from '../domain/day'
import { loadSettings } from '../domain/load'
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
